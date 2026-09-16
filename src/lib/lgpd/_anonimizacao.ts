import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Contexto } from "@/lib/auth/guard";
import { vivosE } from "@/lib/db/consultas";
import {
  atualizarComTrava,
  inserirAuditado,
  registrarAuditoria,
  type Transacao,
} from "@/lib/db/mutacoes";
import { contatos } from "@/lib/db/schema/contatos";
import type { ResultadoLgpd } from "@/lib/db/schema/lgpd";
import { lgpd_solicitacoes } from "@/lib/db/schema/lgpd";
import { ErroDeEscopo, ErroDeValidacao } from "@/lib/erros";
import { protocoloEmUso } from "./_consultas";

/**
 * Anonimização do titular (01-dados-dominio.md §8, ADR 0013) — a eliminação do
 * art. 18, VI, em TRANSAÇÃO ÚNICA, nunca `DELETE`.
 *
 * A ordem é a do documento e não muda:
 *   1. trilha `lgpd_anonimizado` ANTES do efeito, sem PII (o efeito destrói o
 *      estado anterior; trilha depois seria trilha nenhuma);
 *   2. `contatos` sem identidade;
 *   3. mensagens com o MARCADOR — nunca `NULL`, que violaria
 *      `conversas_mensagens_conteudo_presente` e abortaria tudo;
 *   4. legendas, transcrições e comentário de pesquisa;
 *   5. mídias recebidas do titular marcadas `is_deleted` (o binário sai
 *      DEPOIS do commit, pelo job `limpar-midia`);
 *   6. a solicitação com a contagem por tabela;
 *   7. pedidos, itens e pagamentos PERMANECEM (registro fiscal).
 *
 * POR QUE `execute(sql...)` NOS PASSOS 3–5: são `UPDATE`s em lote por titular,
 * que nenhum helper de `mutacoes.ts` expressa (os helpers são por linha, com
 * trava de colisão). Alcançam também linhas já excluídas — dado pessoal em
 * linha excluída continua sendo dado pessoal. Registrado como achado para a
 * fundação (helper dedicado em `mutacoes.ts`).
 *
 * ACHADO: `conversas.ultima_mensagem_previa` (cache dos 100 primeiros
 * caracteres) não está na lista do §8, mas guarda o texto da mensagem — sem
 * ela, o telefone citado numa mensagem sobreviveria na lista de conversas.
 */

export const MARCADOR = "[removido a pedido do titular]";
export const NOME_ANONIMO = "Titular anonimizado";

export type EntradaAnonimizacao = {
  contatoId: string;
  updatedAt: Date;
  protocolo: string;
  motivo: string;
};

export type SaidaAnonimizacao = {
  solicitacaoId: string;
  lojaId: string;
  midiaIds: string[];
  resultado: ResultadoLgpd;
};

function linhasAfetadas(resultado: unknown): number {
  return (resultado as { rowCount?: number | null }).rowCount ?? 0;
}

export async function anonimizarContato(
  tx: Transacao,
  ctx: Contexto,
  entrada: EntradaAnonimizacao,
): Promise<SaidaAnonimizacao> {
  if (ctx.escopo.tipo !== "uma") throw new ErroDeEscopo();
  const lojaId = ctx.escopo.lojaId;
  const { contatoId } = entrada;

  const [contato] = await tx
    .select({ id: contatos.id, anonimizadoEm: contatos.anonimizado_em })
    .from(contatos)
    .where(vivosE(contatos, eq(contatos.id, contatoId), eq(contatos.loja_id, lojaId)))
    .for("update");
  if (!contato) throw new ErroDeEscopo();
  if (contato.anonimizadoEm) {
    throw new ErroDeValidacao({ protocolo: ["Os dados deste contato já foram eliminados."] });
  }
  if (await protocoloEmUso(tx, lojaId, entrada.protocolo)) {
    throw new ErroDeValidacao({ protocolo: ["Este protocolo já foi usado nesta loja."] });
  }

  // 1. Trilha ANTES do efeito, na mesma transação (fail-closed). Sem motivo:
  //    texto livre pode carregar o nome do titular.
  await registrarAuditoria(tx, ctx, "lgpd_anonimizado", "contatos", contatoId, {
    antes: null,
    depois: { protocolo: entrada.protocolo },
  });

  const agora = new Date();

  // 2. Identidade. A trava de colisão usa a versão que a tela mostrou.
  await atualizarComTrava(
    tx,
    contatos,
    {
      id: contatoId,
      escopo: ctx.escopo,
      updatedAtOriginal: entrada.updatedAt,
      dados: {
        nome: NOME_ANONIMO,
        telefone: null,
        email: null,
        whatsapp_id: null,
        instagram_id: null,
        facebook_id: null,
        tiktok_id: null,
        avatar_url: null,
        observacoes: null,
        endereco: null,
        aniversario: null,
        anonimizado_em: agora,
      },
    },
    ctx,
    "contato_alterado",
  );

  const conversasDoTitular = sql`(select id from conversas
    where contato_id = ${contatoId} and loja_id = ${lojaId})`;
  const mensagensDoTitular = sql`(select id from conversas_mensagens
    where loja_id = ${lojaId} and conversa_id in ${conversasDoTitular})`;

  // 3. Conteúdo das mensagens e a prévia da lista.
  const mensagens = await tx.execute(sql`
    update conversas_mensagens
       set conteudo = ${MARCADOR}, metadados = '{}'::jsonb,
           updated_at = ${agora}, modified_by = ${ctx.autorId}
     where loja_id = ${lojaId} and conversa_id in ${conversasDoTitular}`);
  const previas = await tx.execute(sql`
    update conversas set ultima_mensagem_previa = ${MARCADOR}
     where loja_id = ${lojaId} and contato_id = ${contatoId}
       and ultima_mensagem_previa is not null`);

  // 4. Campos livres.
  const midiasDeMensagem = await tx.execute(sql`
    update conversas_mensagens_midias
       set legenda = null, transcricao = null,
           updated_at = ${agora}, modified_by = ${ctx.autorId}
     where loja_id = ${lojaId} and mensagem_id in ${mensagensDoTitular}`);
  const pesquisas = await tx.execute(sql`
    update pesquisas_satisfacao
       set comentario = null, updated_at = ${agora}, modified_by = ${ctx.autorId}
     where loja_id = ${lojaId} and contato_id = ${contatoId}`);

  // 5. Mídias RECEBIDAS do titular: todas entram no job; as vivas viram excluídas.
  const recebidas = await tx.execute<{ id: string }>(sql`
    select distinct lm.id
      from lojas_midias lm
      join conversas_mensagens_midias cmm on cmm.midia_id = lm.id
      join conversas_mensagens m on m.id = cmm.mensagem_id
     where lm.loja_id = ${lojaId} and lm.origem = 'recebida'
       and m.direcao = 'entrada' and m.id in ${mensagensDoTitular}`);
  const midiaIds = recebidas.rows.map((linha) => linha.id);
  let midiasExcluidas = 0;
  if (midiaIds.length > 0) {
    // `nome_original` do documento recebido também é campo livre do titular.
    const lista = sql.join(midiaIds.map((id) => sql`${id}::uuid`), sql`, `);
    midiasExcluidas = linhasAfetadas(
      await tx.execute(sql`
        update lojas_midias
           set nome_original = null,
               deleted_at = case when is_deleted then deleted_at else ${agora} end,
               is_deleted = true,
               updated_at = ${agora}, modified_by = ${ctx.autorId}
         where loja_id = ${lojaId} and id in (${lista})`),
    );
  }

  // 6. A solicitação, com a contagem. `objetos_removidos` é do job.
  const resultado: ResultadoLgpd = {
    tabelas: {
      contatos: 1,
      conversas_mensagens: linhasAfetadas(mensagens),
      conversas: linhasAfetadas(previas),
      conversas_mensagens_midias: linhasAfetadas(midiasDeMensagem),
      pesquisas_satisfacao: linhasAfetadas(pesquisas),
      lojas_midias: midiasExcluidas,
    },
    objetos_removidos: 0,
    concluido_em: agora.toISOString(),
  };
  const solicitacao = await inserirAuditado(
    tx,
    lgpd_solicitacoes,
    {
      loja_id: lojaId,
      contato_id: contatoId,
      tipo: "eliminacao",
      protocolo: entrada.protocolo,
      motivo: entrada.motivo,
      solicitado_em: agora,
      executado_por: ctx.origem === "ui" ? ctx.autorId : null,
      executado_em: agora,
      resultado,
    },
    ctx,
    "lgpd_solicitacao_registrada",
  );

  return { solicitacaoId: String(solicitacao.id), lojaId, midiaIds, resultado };
}
