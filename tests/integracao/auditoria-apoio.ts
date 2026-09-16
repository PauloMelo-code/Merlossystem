import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Contexto } from "@/lib/auth/guard";
import type { EscopoLoja } from "@/lib/auth/loja";
import { db } from "@/lib/db/client";
import type { Transacao } from "@/lib/db/mutacoes";
import type { EscritaDeAlertas } from "@/lib/alertas/escrita";

/**
 * Apoio dos testes de integração do pacote M8 (alertas, auditoria e
 * relatórios). Não termina em `.test.ts`: o Vitest não o coleta.
 *
 * Leitura: transação com ROLLBACK e `set local role merlo_app`.
 * Gerador: ele abre as próprias transações, então a massa é GRAVADA e cada
 * teste usa lojas novas (o filtro por loja isola um teste do outro).
 */

export function exigirBancoDeTeste(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!/\/[^/]*test[^/]*$/.test(new URL(url).pathname)) {
    throw new Error(`Banco "${url}" não parece de teste: o nome precisa conter "test".`);
  }
}

class Desfazer extends Error {}

export async function emRollback(fn: (tx: Transacao) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local role merlo_app`);
      await fn(tx);
      throw new Desfazer("rollback do teste");
    });
  } catch (erro) {
    if (!(erro instanceof Desfazer)) throw erro;
  }
}

type Executor = Transacao | typeof db;

export async function umaLinha<T = { id: string }>(ex: Executor, consulta: ReturnType<typeof sql>): Promise<T> {
  const r = await ex.execute(consulta);
  return r.rows[0] as T;
}

let contador = 0;
const sufixo = () => `${Date.now().toString(36)}${(contador++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const sigla = () =>
  Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");

export type Cenario = { lojaId: string; outraLojaId: string; usuarioId: string; integracaoId: string };

/** Duas lojas, uma pessoa e um número de WhatsApp oficial na primeira loja. */
export async function cenario(ex: Executor, provedor = "whatsapp_oficial"): Promise<Cenario> {
  const s = sufixo();
  const loja = await umaLinha(ex, sql`
    insert into lojas (nome, slug, sigla) values (${`Centro ${s}`}, ${`centro-${s}`}, ${sigla()}) returning id`);
  const outra = await umaLinha(ex, sql`
    insert into lojas (nome, slug, sigla) values (${`Sul ${s}`}, ${`sul-${s}`}, ${sigla()}) returning id`);
  const usuario = await umaLinha(ex, sql`
    insert into usuarios (nome, email, papel) values ('Bia de Teste', ${`bia-${s}@exemplo.invalido`}, 'dono')
    returning id`);
  const integracao = await umaLinha(ex, sql`
    insert into lojas_integracoes (loja_id, provedor, rotulo)
    values (${loja.id}, ${provedor}, 'Número do balcão') returning id`);
  return { lojaId: loja.id, outraLojaId: outra.id, usuarioId: usuario.id, integracaoId: integracao.id };
}

export function contexto(c: Cenario, escopo: EscopoLoja = { tipo: "uma", lojaId: c.lojaId }): Contexto {
  return {
    sessao: {
      usuarioId: c.usuarioId,
      sessaoId: randomUUID(),
      papel: "dono",
      lojaId: null,
      ativo: true,
      precisaTrocarSenha: false,
      precisaConfigurarFator: false,
    },
    escopo,
    autorId: c.usuarioId,
    origem: "ui",
  };
}

/** Contato + conversa na loja do cenário. */
export async function conversaCom(
  ex: Executor,
  c: Cenario,
  opcoes: { telefone?: string; criadaHaMin?: number; pedidos?: number } = {},
): Promise<{ contatoId: string; conversaId: string }> {
  const telefone = opcoes.telefone ?? `5551${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`;
  const criada = `${opcoes.criadaHaMin ?? 0} minutes`;
  const contato = await umaLinha(ex, sql`
    insert into contatos (loja_id, nome, telefone, pedidos_contagem, created_at)
    values (${c.lojaId}, 'Cliente de Teste', ${telefone}, ${opcoes.pedidos ?? 0}, now() - ${criada}::interval)
    returning id`);
  const conversa = await umaLinha(ex, sql`
    insert into conversas (loja_id, contato_id, integracao_id, created_at)
    values (${c.lojaId}, ${contato.id}, ${c.integracaoId}, now() - ${criada}::interval) returning id`);
  return { contatoId: contato.id, conversaId: conversa.id };
}

/** Mensagem numa conversa. `haMin` = quantos minutos atrás. Entrada também move `ultima_entrada_em`. */
export async function mensagem(
  ex: Executor,
  c: Cenario,
  conversaId: string,
  direcao: "entrada" | "saida",
  haMin: number,
  extra: { status?: string; autor?: string; falha?: string } = {},
): Promise<string> {
  const quando = sql`now() - ${`${haMin} minutes`}::interval`;
  const linha = await umaLinha(ex, sql`
    insert into conversas_mensagens
      (loja_id, conversa_id, direcao, autor_tipo, autor_usuario_id, conteudo, ocorrida_em,
       status_entrega, falha_motivo, created_at)
    values (${c.lojaId}, ${conversaId}, ${direcao}, ${direcao === "entrada" ? "contato" : "usuario"},
            ${extra.autor ?? null}, 'oi', ${quando}, ${extra.status ?? null}, ${extra.falha ?? null}, ${quando})
    returning id`);
  if (direcao === "entrada") {
    await ex.execute(sql`update conversas set ultima_entrada_em = ${quando} where id = ${conversaId}`);
  }
  return linha.id;
}

/**
 * A gravação de alertas que a fundação ainda não entregou, escrita aqui SÓ
 * para provar as regras do gerador. SQL cru, no formato que o pedido de
 * bloqueio descreve para `mutacoes.ts`.
 */
export const escritaDeTeste: EscritaDeAlertas = {
  async abrir(tx, a) {
    const r = await tx.execute(sql`
      insert into alertas (loja_id, tipo, severidade, mensagem, chave_deduplicacao, conversa_id, contato_id)
      values (${a.lojaId}, ${a.tipo}, ${a.severidade}, ${a.mensagem}, ${a.chave}, ${a.conversaId}, ${a.contatoId})
      on conflict (loja_id, chave_deduplicacao) where resolvido_em is null and is_deleted = false
      do nothing
      returning id`);
    return r.rows.length > 0;
  },
  async resolver(tx, alvo, quando) {
    await tx.execute(sql`
      update alertas set resolvido_em = ${quando.toISOString()}::timestamptz
       where id = ${alvo.id} and loja_id = ${alvo.lojaId} and resolvido_em is null`);
  },
  async reconhecer(tx, alvo, ctx) {
    await tx.execute(sql`
      update alertas set reconhecido_em = now(), reconhecido_por = ${ctx.autorId}, updated_at = now()
       where id = ${alvo.id} and updated_at = ${alvo.updatedAtOriginal.toISOString()}::timestamptz`);
  },
};

export async function alertasDaLoja(lojaId: string) {
  const r = await db.execute<{
    id: string;
    tipo: string;
    chave_deduplicacao: string;
    reconhecido_em: Date | null;
    resolvido_em: Date | null;
    updated_at: Date;
  }>(sql`
    select id, tipo, chave_deduplicacao, reconhecido_em, resolvido_em, updated_at
      from alertas where loja_id = ${lojaId} order by created_at, id`);
  return r.rows;
}
