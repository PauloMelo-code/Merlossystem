import { and, eq, getTableName, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Contexto } from "@/lib/auth/guard";
import type { EscopoLoja } from "@/lib/auth/loja";
import { ErroDeColisao, ErroDeEscopo } from "@/lib/erros";
import { db } from "./client";
import { condicaoDeLoja, marcaDeExclusao, travaDeColisao, vivos } from "./consultas";
import { CONTADORES, ESTADOS_DE_SISTEMA } from "./listas-fechadas";
import { auditoria_eventos, type DiffAuditado } from "./schema/auditoria";
import { usuarios } from "./schema/auth/usuarios";
import { CAMPOS_PII, type AcaoAuditada } from "./schema/_enums/auditoria";
import { STATUS_ENTREGA } from "./schema/_enums/conversas";
import { campanhas_destinatarios } from "./schema/campanhas";
import { contatos } from "./schema/contatos";
import { conversas_mensagens } from "./schema/conversas/mensagens";
import { pedidos_numeracao } from "./schema/pedidos/numeracao";

/**
 * O ÚNICO arquivo do repositório com `.insert(` e `.update(` sobre tabela de
 * domínio (03-arquitetura.md §6.4). A trava `tests/travas/mutacoes.test.ts`
 * reprova qualquer outro. Não existe `delete` em lugar nenhum.
 */

// Reexportadas para quem chama `atualizarContador` continuar importando de um
// lugar so; a definicao mora em `listas-fechadas.ts`, sem `server-only`.
export { CONTADORES, ESTADOS_DE_SISTEMA };

export type Transacao = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** O mínimo que uma tabela de domínio oferece aos helpers. */
export type TabelaDominio = PgTable & {
  id: PgColumn;
  updated_at: PgColumn;
  is_deleted: PgColumn;
  deleted_at: PgColumn;
  modified_by: PgColumn;
  loja_id?: PgColumn;
};

type Linha = Record<string, unknown>;
type Alvo = { id: string; escopo: EscopoLoja; updatedAtOriginal: Date };

const SEGREDO = /senha|password|token|secret|credencia|authorization|apikey/i;

/** O diff só guarda escalar: objeto inteiro no log é PII entrando pela porta lateral. */
function paraValorDiff(valor: unknown): string | number | boolean | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") {
    return valor;
  }
  return "(alterado)";
}

/** Campos que mudaram, sem PII e sem segredo (01-dados.md §7.2). */
function diffAuditado(
  entidade: string,
  antes: Linha | null,
  depois: Linha,
): { antes: DiffAuditado | null; depois: DiffAuditado } {
  const pii = new Set(CAMPOS_PII[entidade] ?? []);
  const a: DiffAuditado = {};
  const d: DiffAuditado = {};
  for (const [campo, valor] of Object.entries(depois)) {
    if (SEGREDO.test(campo)) continue;
    const anterior = antes?.[campo];
    if (antes && Object.is(anterior, valor)) continue;
    if (pii.has(campo)) {
      d[campo] = "(alterado)";
      if (antes) a[campo] = "(alterado)";
      continue;
    }
    d[campo] = paraValorDiff(valor);
    if (antes) a[campo] = paraValorDiff(anterior);
  }
  return { antes: antes ? a : null, depois: d };
}

/**
 * Trilha de negócio, na MESMA transação do efeito: se ela falha, a operação
 * inteira cai. Em ação administrativa destrutiva quem chama grava ANTES do
 * efeito — o efeito destrói o estado anterior e trilha depois seria trilha
 * nenhuma (01-dados.md §7.4).
 */
export async function registrarAuditoria(
  tx: Transacao,
  ctx: Contexto,
  acao: AcaoAuditada,
  entidade: string,
  entidadeId: string,
  diff: { antes: DiffAuditado | null; depois: DiffAuditado },
  motivo?: string,
) {
  await tx.insert(auditoria_eventos).values({
    ator_tipo: ctx.origem === "ui" ? "usuario" : "sistema",
    ator_id: ctx.autorId,
    loja_id: ctx.escopo.tipo === "uma" ? ctx.escopo.lojaId : null,
    acao,
    entidade,
    entidade_id: entidadeId,
    antes: diff.antes,
    depois: diff.depois,
    motivo: motivo ?? null,
  });
}

/**
 * Abre a transação. É o que a action importa.
 *
 * `escopo.tipo === "nenhuma"` é fail-closed: `condicaoDeLoja` devolveria
 * `false` e a gravação passaria em silêncio sem tocar em linha nenhuma.
 */
export async function emTransacao<T>(
  ctx: Contexto,
  fn: (tx: Transacao, ctx: Contexto) => Promise<T>,
): Promise<T> {
  if (ctx.escopo.tipo === "nenhuma") throw new ErroDeEscopo();
  return db.transaction((tx) => fn(tx, ctx));
}

export async function inserirAuditado(
  tx: Transacao,
  tabela: TabelaDominio,
  dados: Linha,
  ctx: Contexto,
  acao: AcaoAuditada,
): Promise<Linha> {
  const agora = new Date();
  const [linha] = await tx
    .insert(tabela)
    .values({ ...dados, created_at: agora, updated_at: agora, modified_by: ctx.autorId })
    .returning();
  if (!linha) throw new ErroDeEscopo();
  const nome = getTableName(tabela);
  const gravada = linha as Linha;
  await registrarAuditoria(tx, ctx, acao, nome, String(gravada.id), diffAuditado(nome, null, dados));
  return gravada;
}

/** Lê a linha atual para montar o diff e, na colisão, dizer quem gravou. */
async function lerAtual(tx: Transacao, tabela: TabelaDominio, id: string, escopo: EscopoLoja) {
  const [linha] = await tx
    .select()
    .from(tabela)
    .where(and(eq(tabela.id, id), condicaoDeLoja(tabela as never, escopo), vivos(tabela)))
    .limit(1);
  return (linha ?? null) as Linha | null;
}

async function colisaoOuEscopo(
  tx: Transacao,
  tabela: TabelaDominio,
  alvo: Alvo,
): Promise<never> {
  const atual = await lerAtual(tx, tabela, alvo.id, alvo.escopo);
  if (!atual) throw new ErroDeEscopo();
  let autor: string | undefined;
  if (typeof atual.modified_by === "string") {
    const [pessoa] = await tx
      .select({ nome: usuarios.nome })
      .from(usuarios)
      .where(eq(usuarios.id, atual.modified_by))
      .limit(1);
    autor = pessoa?.nome;
  }
  throw new ErroDeColisao(autor, atual.updated_at instanceof Date ? atual.updated_at : undefined);
}

/**
 * Optimistic locking é o PADRÃO (01-dados.md §4.7), com a lista fechada de
 * exceções daquele parágrafo. Zero linhas = `ErroDeColisao` com quem gravou e
 * quando — é esse dado que a faixa de conflito da UI mostra.
 */
export async function atualizarComTrava(
  tx: Transacao,
  tabela: TabelaDominio,
  alvo: Alvo & { dados: Linha },
  ctx: Contexto,
  acao: AcaoAuditada,
): Promise<Linha> {
  const antes = await lerAtual(tx, tabela, alvo.id, alvo.escopo);
  const [linha] = await tx
    .update(tabela)
    .set({ ...alvo.dados, updated_at: new Date(), modified_by: ctx.autorId })
    .where(
      and(
        travaDeColisao(tabela, alvo.id, alvo.updatedAtOriginal),
        condicaoDeLoja(tabela as never, alvo.escopo),
      ),
    )
    .returning();
  if (!linha) return colisaoOuEscopo(tx, tabela, alvo);
  const nome = getTableName(tabela);
  await registrarAuditoria(tx, ctx, acao, nome, alvo.id, diffAuditado(nome, antes, alvo.dados));
  return linha as Linha;
}

/** Exclusão é SEMPRE lógica. Nenhum `DELETE` de linha existe no sistema. */
export async function excluirLogico(
  tx: Transacao,
  tabela: TabelaDominio,
  alvo: Alvo,
  ctx: Contexto,
  acao: AcaoAuditada,
): Promise<void> {
  const [linha] = await tx
    .update(tabela)
    .set(marcaDeExclusao(ctx.autorId))
    .where(
      and(
        travaDeColisao(tabela, alvo.id, alvo.updatedAtOriginal),
        condicaoDeLoja(tabela as never, alvo.escopo),
      ),
    )
    .returning();
  if (!linha) return colisaoOuEscopo(tx, tabela, alvo);
  await registrarAuditoria(tx, ctx, acao, getTableName(tabela), alvo.id, {
    antes: { is_deleted: false },
    depois: { is_deleted: true },
  });
}

function exigirPares(mapa: Readonly<Record<string, readonly string[]>>, nome: string, campos: string[]) {
  const permitidos = mapa[nome];
  if (!permitidos) throw new Error(`tabela "${nome}" não está na lista fechada`);
  for (const campo of campos) {
    if (!permitidos.includes(campo)) throw new Error(`"${nome}.${campo}" está fora da lista fechada`);
  }
}

/**
 * Contador e cache. Valor numérico INCREMENTA; qualquer outro valor é gravado
 * como está. Nunca toca `updated_at` nem `modified_by`, e nunca grava trilha:
 * senão o `updated_at` que a tela levou envelheceria a cada mensagem que chega
 * e toda edição legítima falharia com "Registro alterado por outro usuário".
 */
export async function atualizarContador(
  tx: Transacao,
  tabela: TabelaDominio,
  alvo: { id: string; escopo: EscopoLoja },
  incrementos: Record<string, number | string | Date | null>,
): Promise<void> {
  const nome = getTableName(tabela);
  const campos = Object.keys(incrementos);
  exigirPares(CONTADORES, nome, campos);
  const set: Record<string, unknown> = {};
  for (const [campo, valor] of Object.entries(incrementos)) {
    const coluna = (tabela as unknown as Record<string, PgColumn>)[campo];
    set[campo] =
      typeof valor === "number" && coluna ? sql`${coluna} + ${valor}` : valor;
  }
  await tx
    .update(tabela)
    .set(set)
    .where(and(eq(tabela.id, alvo.id), condicaoDeLoja(tabela as never, alvo.escopo), vivos(tabela)));
}

/** Máquina de estado de sistema: sem trava de colisão, sem trilha de negócio. */
export async function atualizarEstado(
  tx: Transacao,
  tabela: TabelaDominio,
  alvo: { id: string; escopo: EscopoLoja },
  novoEstado: Linha,
): Promise<void> {
  const nome = getTableName(tabela);
  exigirPares(ESTADOS_DE_SISTEMA, nome, Object.keys(novoEstado));
  await tx
    .update(tabela)
    .set(novoEstado)
    .where(and(eq(tabela.id, alvo.id), condicaoDeLoja(tabela as never, alvo.escopo), vivos(tabela)));
}

/**
 * Numeração de pedido (01-dados-dominio.md §6.2). O `UPDATE ... RETURNING` é a
 * própria trava; não passa por `vivos()` porque o CHECK
 * `pedidos_numeracao_nunca_excluida` garante que não existe linha morta.
 */
export async function proximoNumeroDePedido(
  tx: Transacao,
  lojaId: string,
  anoMes: string,
): Promise<number> {
  await tx.insert(pedidos_numeracao).values({ loja_id: lojaId, ano_mes: anoMes }).onConflictDoNothing();
  const [linha] = await tx
    .update(pedidos_numeracao)
    .set({ ultimo_numero: sql`${pedidos_numeracao.ultimo_numero} + 1`, updated_at: new Date() })
    .where(and(eq(pedidos_numeracao.loja_id, lojaId), eq(pedidos_numeracao.ano_mes, anoMes)))
    .returning({ numero: pedidos_numeracao.ultimo_numero });
  if (!linha) throw new ErroDeEscopo();
  return linha.numero;
}

/** Colunas de identificador de canal aceitas pelo casamento de contato. */
export type CanalDeContato = "whatsapp_id" | "instagram_id" | "facebook_id" | "tiktok_id";

/**
 * Casamento do contato na entrada de mensagem — TRÊS PASSOS, uma transação
 * (01-dados-dominio.md §2.1). Fecha 02/C-01 e 01/D-03, em que toda mensagem
 * daquele cliente se perdia para sempre com 200 devolvido ao provedor.
 *
 * O upsert sozinho não basta: `ON CONFLICT (loja_id, whatsapp_id)` não enxerga
 * o contato criado pelo CRM, que tem o mesmo telefone e `whatsapp_id` nulo — e
 * a inserção nova viola `(loja_id, telefone)`. O passo 1 roda em SAVEPOINT
 * (`tx.transaction`) porque no Postgres um erro aborta a transação inteira.
 */
export async function upsertContatoPorCanal(
  tx: Transacao,
  lojaId: string,
  identificadores: { canal: CanalDeContato; valor: string; telefone?: string; nome?: string },
  agora: Date,
): Promise<Linha> {
  const { canal, valor, telefone, nome } = identificadores;
  const coluna = contatos[canal];
  const porCanal = async () => {
    const [linha] = await tx.transaction((sp) =>
      sp
        .insert(contatos)
        .values({ loja_id: lojaId, [canal]: valor, telefone, nome, ultimo_contato_em: agora })
        .onConflictDoUpdate({
          target: [contatos.loja_id, coluna],
          // REPETE o predicado do índice parcial: sem ele o Postgres não
          // encontra o índice e o comando levanta erro.
          targetWhere: sql.raw(`${canal} is not null and is_deleted = false`),
          set: { ultimo_contato_em: agora },
        })
        .returning(),
    );
    return (linha ?? null) as Linha | null;
  };

  try {
    const criado = await porCanal();
    if (criado) return criado;
  } catch (erro) {
    if (!violacaoDeTelefone(erro)) throw erro;
  }

  if (telefone) {
    const [porTelefone] = await tx
      .update(contatos)
      .set({ [canal]: valor, ultimo_contato_em: agora })
      .where(
        and(
          eq(contatos.loja_id, lojaId),
          eq(contatos.telefone, telefone),
          sql`${coluna} is null`,
          vivos(contatos),
        ),
      )
      .returning();
    if (porTelefone) return porTelefone as Linha;
  }

  // Corrida: outra transação carimbou o canal entre os dois passos.
  const segundaTentativa = await porCanal();
  if (!segundaTentativa) throw new ErroDeEscopo();
  return segundaTentativa;
}

function violacaoDeTelefone(erro: unknown): boolean {
  const e = erro as { code?: string; constraint?: string };
  return e?.code === "23505" && e?.constraint === "uq_contatos_telefone";
}

/**
 * Status de entrega MONOTÔNICO (01-dados-dominio.md §2.3): `delivered` atrasado
 * não rebaixa `lida` (01/D-26), e o recibo do provedor nunca sai de `falhou` —
 * essa transição é exclusiva do reenvio.
 */
export async function avancarStatusDeEntrega(
  tx: Transacao,
  mensagemId: string,
  novoStatus: (typeof STATUS_ENTREGA)[number],
  ocorridoEm: Date,
): Promise<boolean> {
  const escala = sql.raw(`array[${STATUS_ENTREGA.map((s) => `'${s}'`).join(", ")}]::text[]`);
  const linhas = await tx
    .update(conversas_mensagens)
    .set({ status_entrega: novoStatus, status_atualizado_em: ocorridoEm })
    .where(
      and(
        eq(conversas_mensagens.id, mensagemId),
        vivos(conversas_mensagens),
        sql`${conversas_mensagens.status_entrega} is distinct from 'falhou'`,
        sql`coalesce(array_position(${escala}, ${conversas_mensagens.status_entrega}), 0)
            < array_position(${escala}, ${novoStatus})`,
      ),
    )
    .returning({ id: conversas_mensagens.id });
  return linhas.length > 0;
}

/**
 * Reenvio: a ÚNICA transição que sai de `falhou`, e é um claim atômico. Zero
 * linhas = alguém já reenviou e nada acontece (409 na action).
 */
export async function reivindicarReenvio(tx: Transacao, mensagemId: string): Promise<boolean> {
  const linhas = await tx
    .update(conversas_mensagens)
    .set({ status_entrega: "pendente", falha_motivo: null, status_atualizado_em: new Date() })
    .where(
      and(
        eq(conversas_mensagens.id, mensagemId),
        eq(conversas_mensagens.status_entrega, "falhou"),
        vivos(conversas_mensagens),
      ),
    )
    .returning({ id: conversas_mensagens.id });
  return linhas.length > 0;
}

/**
 * Reserva de destinatários por lote: `FOR UPDATE SKIP LOCKED` para dois workers
 * não pegarem a mesma cliente, e `reservado_em` é o lease que devolve a linha à
 * fila se o worker morrer (03/A2).
 */
export async function reservarDestinatarios(
  tx: Transacao,
  campanhaId: string,
  lote: number,
): Promise<string[]> {
  const resultado = await tx.execute<{ id: string }>(sql`
    update ${campanhas_destinatarios} as d
       set status = 'reservado', reservado_em = now()
      from (select id from ${campanhas_destinatarios}
             where campanha_id = ${campanhaId}
               and status = 'pendente'
               and is_deleted = false
             order by created_at
             limit ${lote}
               for update skip locked) as s
     where d.id = s.id
    returning d.id`);
  return resultado.rows.map((linha) => linha.id);
}
