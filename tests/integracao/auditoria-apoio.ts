import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Contexto } from "@/lib/auth/guard";
import type { EscopoLoja } from "@/lib/auth/loja";
import { db } from "@/lib/db/client";
import type { Transacao } from "@/lib/db/mutacoes";

/**
 * Apoio dos testes de integração do pacote M8 (alertas, auditoria e
 * relatórios). Não termina em `.test.ts`: o Vitest não o coleta.
 *
 * Leitura: transação com ROLLBACK e `set local role merlo_app`.
 * Gerador, reconciliação e jobs de manutenção abrem as próprias transações:
 * a massa é GRAVADA e cada teste usa lojas novas (o filtro por loja isola um
 * teste do outro).
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
/**
 * Loja com sigla LIVRE (`^[A-Z]{3}$`, única na rede). Sorteada no próprio
 * banco entre as que ninguém usa: as lojas dos testes ficam gravadas e um
 * sorteio no cliente colide cedo ou tarde (e aborta a transação do teste).
 */
function novaLoja(ex: Executor, nome: string, slug: string) {
  return umaLinha(ex, sql`
    insert into lojas (nome, slug, sigla)
    select ${nome}, ${slug}, c.s
      from (select chr(65 + floor(random() * 26)::int) || chr(65 + floor(random() * 26)::int)
                   || chr(65 + floor(random() * 26)::int) as s
              from generate_series(1, 200)) c
     where not exists (select 1 from lojas l where l.sigla = c.s)
     limit 1
    returning id`);
}

export type Cenario = { lojaId: string; outraLojaId: string; usuarioId: string; integracaoId: string };

/** Duas lojas, uma pessoa e um número de WhatsApp oficial na primeira loja. */
export async function cenario(ex: Executor, provedor = "whatsapp_oficial"): Promise<Cenario> {
  const s = sufixo();
  const loja = await novaLoja(ex, `Centro ${s}`, `centro-${s}`);
  const outra = await novaLoja(ex, `Sul ${s}`, `sul-${s}`);
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

export async function alertasDaLoja(lojaId: string) {
  const r = await db.execute<{
    id: string;
    tipo: string;
    chave_deduplicacao: string;
    severidade: string;
    contato_id: string | null;
    modified_by: string | null;
    reconhecido_em: Date | null;
    reconhecido_por: string | null;
    resolvido_em: Date | null;
    updated_at: Date;
  }>(sql`
    select id, tipo, chave_deduplicacao, severidade, contato_id, modified_by, reconhecido_em,
           reconhecido_por, resolvido_em, updated_at
      from alertas where loja_id = ${lojaId} order by created_at, id`);
  return r.rows;
}
