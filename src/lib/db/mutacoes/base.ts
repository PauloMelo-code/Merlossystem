import { and, eq, getTableName, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { diffAuditado, registrarAuditoria } from "@/lib/auditoria/gravador";
import type { EscopoLoja } from "@/lib/auth/loja";
import { ErroDeColisao, ErroDeEscopo } from "@/lib/erros";
import { db } from "../client";
import { condicaoDeLoja, marcaDeExclusao, travaDeColisao, vivos } from "../consultas";
import { CONTADORES, ESTADOS_DE_SISTEMA } from "../listas-fechadas";
import { usuarios } from "../schema/auth/usuarios";
import { type AcaoAuditada } from "../schema/_enums/auditoria";
import type { TipoEventoIntegracao } from "../schema/_enums/plataforma";
import { lojas_integracoes_eventos } from "../schema/integracoes";
import type { ContextoDeGravacao } from "../sistema";

/**
 * Helpers genéricos da porta única de escrita (03-arquitetura.md §6.4).
 * Reexportado por `src/lib/db/mutacoes.ts`; importe sempre de
 * `@/lib/db/mutacoes`. Os demais arquivos da pasta importam daqui (`./base`),
 * nunca de `../mutacoes` (sem ciclo). Não existe `delete` em lugar nenhum.
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

// A trilha de negócio (diff sem PII + o INSERT append-only) mora em
// `src/lib/auditoria/gravador.ts`. Reexportada aqui para quem grava a trilha
// ANTES do efeito (ação administrativa destrutiva) importar de um lugar só.
export { diffAuditado, registrarAuditoria };

/**
 * Abre a transação. É o que a action importa.
 *
 * `escopo.tipo === "nenhuma"` é fail-closed: `condicaoDeLoja` devolveria
 * `false` e a gravação passaria em silêncio sem tocar em linha nenhuma.
 */
export async function emTransacao<C extends ContextoDeGravacao, T>(
  ctx: C,
  fn: (tx: Transacao, ctx: C) => Promise<T>,
): Promise<T> {
  if (ctx.escopo.tipo === "nenhuma") throw new ErroDeEscopo();
  return db.transaction((tx) => fn(tx, ctx));
}

export async function inserirAuditado(
  tx: Transacao,
  tabela: TabelaDominio,
  dados: Linha,
  ctx: ContextoDeGravacao,
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
 *
 * `opcoes.trilhaAntes`: a trilha é gravada ANTES do UPDATE, na mesma
 * transação (01-dados.md §7.4 — cancelamento, dispensa do Masc, ação
 * administrativa destrutiva). Se o UPDATE colidir, o erro derruba a
 * transação e a linha da trilha vai junto. `opcoes.motivo` vai para a
 * coluna `motivo` da trilha nos dois modos.
 */
export type OpcoesDeTrava = { trilhaAntes?: boolean; motivo?: string };

export async function atualizarComTrava(
  tx: Transacao,
  tabela: TabelaDominio,
  alvo: Alvo & { dados: Linha },
  ctx: ContextoDeGravacao,
  acao: AcaoAuditada,
  opcoes: OpcoesDeTrava = {},
): Promise<Linha> {
  const antes = await lerAtual(tx, tabela, alvo.id, alvo.escopo);
  const nome = getTableName(tabela);
  const gravarTrilha = () =>
    registrarAuditoria(tx, ctx, acao, nome, alvo.id, diffAuditado(nome, antes, alvo.dados), opcoes.motivo);
  // Sem a linha atual não há o que auditar: segue para o UPDATE, que devolve
  // zero linhas e vira colisão ou escopo.
  if (opcoes.trilhaAntes && antes) await gravarTrilha();
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
  if (!opcoes.trilhaAntes) await gravarTrilha();
  return linha as Linha;
}

/** Exclusão é SEMPRE lógica. Nenhum `DELETE` de linha existe no sistema. */
export async function excluirLogico(
  tx: Transacao,
  tabela: TabelaDominio,
  alvo: Alvo,
  ctx: ContextoDeGravacao,
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

export function exigirPares(mapa: Readonly<Record<string, readonly string[]>>, nome: string, campos: string[]) {
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
 * Diário de ingestão depois do INSERT (01-dados.md §6.4): o MESMO `UPDATE`
 * carimba `processado_em` e mascara o corpo. O cru só sobrevive em `falhou`.
 */
export async function registrarProcessamentoEvento(
  tx: Transacao,
  eventoId: string,
  resultado: {
    tipo: Extract<TipoEventoIntegracao, "processado" | "descartado" | "falhou">;
    erro?: string | null;
    /** Projeção mascarada. Ausente = `{ mascarado: true }`. */
    projecao?: Record<string, unknown>;
  },
): Promise<void> {
  const estado: Linha = {
    tipo: resultado.tipo,
    processado_em: new Date(),
    erro: resultado.erro ?? null,
  };
  if (resultado.tipo !== "falhou") estado.corpo = resultado.projecao ?? { mascarado: true };
  await atualizarEstado(tx, lojas_integracoes_eventos, { id: eventoId, escopo: { tipo: "todas" } }, estado);
}
