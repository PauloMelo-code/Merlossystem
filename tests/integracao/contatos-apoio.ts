import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Contexto } from "@/lib/auth/guard";
import { db } from "@/lib/db/client";
import type { Transacao } from "@/lib/db/mutacoes";

/**
 * Apoio dos testes de integração de contatos e LGPD (pacote M2).
 *
 * Isolamento POR TRANSAÇÃO COM ROLLBACK (05-plano §3.3), e dentro dela
 * `set local role merlo_app` — é o papel da aplicação que grava, e é ele que
 * prova que o caminho funciona sem privilégio de dono. Nenhuma linha fica.
 *
 * Não termina em `.test.ts`: o Vitest não o coleta.
 */

export function exigirBancoDeTeste(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!/\/[^/]*test[^/]*$/.test(new URL(url).pathname)) {
    throw new Error(`Banco "${url}" não parece de teste: o nome precisa conter "test".`);
  }
}

class Desfazer extends Error {}

/** Roda `fn` numa transação que SEMPRE volta atrás. */
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

/** Uma linha só, pelo SQL cru — preparo de massa, não caminho da aplicação. */
export async function umaLinha<T = Record<string, unknown>>(tx: Transacao, consulta: ReturnType<typeof sql>) {
  const r = await tx.execute(consulta);
  return r.rows[0] as T;
}

export type Cenario = { lojaId: string; outraLojaId: string; usuarioId: string; integracaoId: string };

let contador = 0;
const sufixo = () => `${Date.now().toString(36)}${(contador++).toString(36)}`;
/** Sigla é única: três letras sorteadas para dois arquivos não colidirem. */
const sigla = () =>
  Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");

/** Duas lojas, uma pessoa dona e uma conta de WhatsApp na primeira loja. */
export async function cenario(tx: Transacao): Promise<Cenario> {
  const s = sufixo();
  const loja = await umaLinha<{ id: string }>(tx, sql`
    insert into lojas (nome, slug, sigla) values (${`Centro ${s}`}, ${`centro-${s}`}, ${sigla()}) returning id`);
  const outra = await umaLinha<{ id: string }>(tx, sql`
    insert into lojas (nome, slug, sigla) values (${`Sul ${s}`}, ${`sul-${s}`}, ${sigla()}) returning id`);
  const usuario = await umaLinha<{ id: string }>(tx, sql`
    insert into usuarios (nome, email, papel) values ('Dona de Teste', ${`dona-${s}@exemplo.invalido`}, 'dono')
    returning id`);
  const integracao = await umaLinha<{ id: string }>(tx, sql`
    insert into lojas_integracoes (loja_id, provedor, rotulo)
    values (${loja.id}, 'whatsapp_oficial', 'Número do balcão') returning id`);
  return { lojaId: loja.id, outraLojaId: outra.id, usuarioId: usuario.id, integracaoId: integracao.id };
}

/** Contexto de quem está na tela, com a loja resolvida. */
export function contexto(c: Cenario, lojaId: string = c.lojaId): Contexto {
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
    escopo: { tipo: "uma", lojaId },
    autorId: c.usuarioId,
    origem: "ui",
  };
}

export function contextoTodas(c: Cenario): Contexto {
  return { ...contexto(c), escopo: { tipo: "todas" } };
}

export async function novoContato(
  tx: Transacao,
  lojaId: string,
  campos: { nome?: string; telefone?: string | null; ultimoContatoEm?: Date | null } = {},
): Promise<{ id: string; updatedAt: Date }> {
  const linha = await umaLinha<{ id: string; updated_at: Date }>(tx, sql`
    insert into contatos (loja_id, nome, telefone, ultimo_contato_em)
    values (${lojaId}, ${campos.nome ?? "Cliente"}, ${campos.telefone ?? null}, ${campos.ultimoContatoEm ?? null})
    returning id, updated_at`);
  return { id: linha.id, updatedAt: new Date(linha.updated_at) };
}

export async function novaEtiqueta(tx: Transacao, lojaId: string, nome: string): Promise<string> {
  const linha = await umaLinha<{ id: string }>(tx, sql`
    insert into lojas_etiquetas (loja_id, nome, slug) values (${lojaId}, ${nome}, ${`${nome.toLowerCase()}-${sufixo()}`})
    returning id`);
  return linha.id;
}
