import "server-only";
import { and, eq } from "drizzle-orm";
import { condicaoDeLoja, vivosE } from "@/lib/db/consultas";
import {
  atualizarComTrava,
  atualizarEstado,
  excluirLogico,
  inserirAuditado,
  inserirDestinatariosEmLote,
  type ContextoDeGravacao,
  type Transacao,
} from "@/lib/db/mutacoes";
import { campanhas, campanhas_destinatarios } from "@/lib/db/schema/campanhas";
import type { SegmentoCampanha } from "@/lib/db/schema/campanhas";
import type { VariavelTemplate } from "@/lib/db/schema/integracoes";
import { ErroDeEscopo, ErroDeValidacao } from "@/lib/erros";
import { enfileirar } from "@/lib/fila/filas";
import { jobId } from "@/lib/fila/idempotencia";
import type { z } from "zod";
import type { campanhaSchema } from "@/lib/validadores/campanhas";
import { contaDaLoja, exigirVariaveisDoModelo, modeloDaConta } from "./conta";
import {
  conteudoDoProvedor,
  PODE_EXCLUIR,
  PODE_INICIAR,
  PODE_PAUSAR,
  PODE_REENVIAR,
  PODE_RETOMAR,
  podeSair,
  RITMO_POR_SEGUNDO,
  type ProvedorDeCampanha,
} from "./regras";
import { conferirEtiquetas, idsDoSegmento } from "./segmento";

/**
 * Transições de campanha feitas por PESSOA (03-arquitetura.md §6.4). Tudo aqui
 * roda dentro da transação da action; o enfileiramento do lote acontece DEPOIS
 * do commit (`agendarLote`), senão o worker poderia ler a campanha ainda em
 * rascunho e encerrar a cadeia.
 *
 * A trava de colisão é o que impede a materialização em dobro (03/C1): duas
 * abas clicando "Iniciar" com o mesmo `updated_at` — a segunda recebe COLISAO.
 */

type Alvo = { id: string; updated_at: Date };
export type Disparo = { lojaId: string; campanhaId: string; provedor: ProvedorDeCampanha };

function lojaDe(ctx: ContextoDeGravacao): string {
  if (ctx.escopo.tipo !== "uma") throw new ErroDeEscopo();
  return ctx.escopo.lojaId;
}

async function carregar(tx: Transacao, ctx: ContextoDeGravacao, id: string) {
  const [linha] = await tx
    .select()
    .from(campanhas)
    .where(vivosE(campanhas, condicaoDeLoja(campanhas, ctx.escopo), eq(campanhas.id, id)))
    .limit(1);
  if (!linha) throw new ErroDeEscopo();
  return linha;
}

function recusarStatus(status: string, frase: string): never {
  throw new ErroDeValidacao({ status: [frase] }, undefined, `A campanha está "${status}": ${frase}`);
}

/** Conteúdo conforme o provedor da conta, variáveis conforme o modelo. */
async function conferirConteudo(
  tx: Transacao,
  lojaId: string,
  c: { integracao_id: string; template_id: string | null; conteudo_texto: string | null; variaveis: VariavelTemplate[] },
) {
  const conta = await contaDaLoja(tx, lojaId, c.integracao_id);
  if (conteudoDoProvedor(conta.provedor) === "modelo") {
    if (!c.template_id) {
      throw new ErroDeValidacao({ template_id: ["O número oficial dispara por modelo aprovado. Escolha um."] });
    }
    exigirVariaveisDoModelo(c.variaveis, await modeloDaConta(tx, conta.id, c.template_id));
  } else {
    if (c.template_id || !c.conteudo_texto) {
      throw new ErroDeValidacao({ conteudo_texto: ["Este número não usa modelo. Escreva o texto da campanha."] });
    }
    if (c.variaveis.length > 0) {
      throw new ErroDeValidacao({ variaveis: ["Variáveis só existem em modelo do número oficial."] });
    }
  }
  return conta;
}

export async function criarCampanha(
  tx: Transacao,
  ctx: ContextoDeGravacao,
  dados: z.output<typeof campanhaSchema>,
): Promise<{ id: string }> {
  const lojaId = lojaDe(ctx);
  await conferirConteudo(tx, lojaId, dados);
  await conferirEtiquetas(tx, lojaId, dados.segmento.etiquetas_ids);
  // `exactOptionalPropertyTypes`: chave ausente, nunca chave com `undefined`.
  const segmento = Object.fromEntries(
    Object.entries(dados.segmento).filter(([, v]) => v !== undefined),
  ) as SegmentoCampanha;
  const linha = await inserirAuditado(
    tx,
    campanhas,
    {
      loja_id: lojaId,
      nome: dados.nome,
      integracao_id: dados.integracao_id,
      template_id: dados.template_id,
      conteudo_texto: dados.conteudo_texto,
      variaveis: dados.variaveis,
      segmento,
      criada_por: ctx.autorId,
    },
    ctx,
    "campanha_criada",
  );
  return { id: String(linha.id) };
}

/**
 * rascunho -> enviando. Revalida TUDO (a conta pode ter caído, o modelo pode
 * ter sido pausado pela Meta) e materializa os destinatários lendo a verdade
 * do consentimento.
 */
export async function iniciarCampanha(tx: Transacao, ctx: ContextoDeGravacao, alvo: Alvo): Promise<Disparo> {
  const c = await carregar(tx, ctx, alvo.id);
  if (!podeSair(c.status, PODE_INICIAR)) recusarStatus(c.status, "só um rascunho pode ser iniciado.");
  const conta = await conferirConteudo(tx, c.loja_id, c);
  if (conta.status !== "conectado") {
    throw new ErroDeValidacao({ integracao_id: [`O número "${conta.rotulo}" não está conectado.`] });
  }
  const ids = await idsDoSegmento(tx, c.loja_id, c.segmento);
  if (ids.length === 0) {
    throw new ErroDeValidacao({ segmento: ["Nenhuma pessoa atende a este filtro agora."] });
  }

  await atualizarComTrava(
    tx,
    campanhas,
    {
      id: c.id,
      escopo: ctx.escopo,
      updatedAtOriginal: alvo.updated_at,
      dados: { status: "enviando", iniciada_em: new Date(), total_destinatarios: ids.length },
    },
    ctx,
    "campanha_iniciada",
  );

  // Uma linha de trilha pelo lote; o único `(campanha_id, contato_id)` segura a duplicata.
  await inserirDestinatariosEmLote(tx, ctx, { lojaId: c.loja_id, campanhaId: c.id, contatoIds: ids }, "campanha_iniciada");
  return { lojaId: c.loja_id, campanhaId: c.id, provedor: conta.provedor };
}

export async function retomarCampanha(tx: Transacao, ctx: ContextoDeGravacao, alvo: Alvo): Promise<Disparo> {
  const c = await carregar(tx, ctx, alvo.id);
  if (!podeSair(c.status, PODE_RETOMAR)) recusarStatus(c.status, "só uma campanha pausada pode ser retomada.");
  const conta = await contaDaLoja(tx, c.loja_id, c.integracao_id);
  if (conta.status !== "conectado") {
    throw new ErroDeValidacao({ integracao_id: [`O número "${conta.rotulo}" não está conectado.`] });
  }
  await atualizarComTrava(
    tx,
    campanhas,
    { id: c.id, escopo: ctx.escopo, updatedAtOriginal: alvo.updated_at, dados: { status: "enviando" } },
    ctx,
    "campanha_iniciada",
  );
  return { lojaId: c.loja_id, campanhaId: c.id, provedor: conta.provedor };
}

/** O lote em curso termina; o próximo lê `pausada` e para. Nada é reenviado. */
export async function pausarCampanha(tx: Transacao, ctx: ContextoDeGravacao, alvo: Alvo): Promise<void> {
  const c = await carregar(tx, ctx, alvo.id);
  if (!podeSair(c.status, PODE_PAUSAR)) recusarStatus(c.status, "só uma campanha enviando pode ser pausada.");
  await atualizarComTrava(
    tx,
    campanhas,
    { id: c.id, escopo: ctx.escopo, updatedAtOriginal: alvo.updated_at, dados: { status: "pausada" } },
    ctx,
    "campanha_pausada",
  );
}

export async function excluirCampanha(tx: Transacao, ctx: ContextoDeGravacao, alvo: Alvo): Promise<void> {
  const c = await carregar(tx, ctx, alvo.id);
  if (!podeSair(c.status, PODE_EXCLUIR)) recusarStatus(c.status, "pause a campanha antes de excluir.");
  await excluirLogico(
    tx,
    campanhas,
    { id: c.id, escopo: ctx.escopo, updatedAtOriginal: alvo.updated_at },
    ctx,
    "campanha_excluida",
  );
}

/**
 * Falhas voltam à fila. Só `falhou` sai daqui (a linha é travada antes), e a
 * campanha volta a `enviando` para o lote existir.
 */
export async function reenviarFalhas(
  tx: Transacao,
  ctx: ContextoDeGravacao,
  alvo: Alvo,
): Promise<Disparo & { quantidade: number; enfileirar: boolean }> {
  const c = await carregar(tx, ctx, alvo.id);
  if (!podeSair(c.status, PODE_REENVIAR)) recusarStatus(c.status, "não há falhas para reenviar.");
  const conta = await contaDaLoja(tx, c.loja_id, c.integracao_id);
  const falhas = await tx
    .select({ id: campanhas_destinatarios.id })
    .from(campanhas_destinatarios)
    .where(
      vivosE(
        campanhas_destinatarios,
        and(eq(campanhas_destinatarios.campanha_id, c.id), eq(campanhas_destinatarios.status, "falhou")),
      ),
    )
    .for("update", { skipLocked: true });
  if (falhas.length === 0) throw new ErroDeValidacao({ status: ["Nenhuma falha para reenviar."] });

  for (const f of falhas) {
    await atualizarEstado(tx, campanhas_destinatarios, { id: f.id, escopo: ctx.escopo }, {
      status: "pendente",
      erro: null,
      reservado_em: null,
    });
  }
  // `enviando` e `pausada` ficam como estão: pausada continua pausada até alguém retomar.
  if (c.status === "concluida") {
    await atualizarComTrava(
      tx,
      campanhas,
      {
        id: c.id,
        escopo: ctx.escopo,
        updatedAtOriginal: alvo.updated_at,
        dados: { status: "enviando", concluida_em: null },
      },
      ctx,
      "campanha_alterada",
      { motivo: `reenvio de ${falhas.length} falha(s)` },
    );
  }
  return {
    lojaId: c.loja_id,
    campanhaId: c.id,
    provedor: conta.provedor,
    quantidade: falhas.length,
    enfileirar: c.status !== "pausada",
  };
}

/**
 * Primeiro lote de uma RODADA. A rodada entra no `jobId`: retomar depois de
 * pausar abre outra cadeia, e o BullMQ não descarta o job por id repetido.
 */
export async function agendarLote(d: Disparo, atrasoMs = 0): Promise<void> {
  const rodada = String(Date.now());
  await enfileirar(
    "campanhas",
    "processar-lote",
    { lojaId: d.lojaId, campanhaId: d.campanhaId, tamanho: RITMO_POR_SEGUNDO[d.provedor], rodada, sequencia: 0 },
    { jobId: jobId("lote", d.campanhaId, rodada, "0"), delay: atrasoMs },
  );
}
