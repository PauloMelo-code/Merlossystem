import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { Contexto } from "@/lib/auth/guard";
import type { Papel } from "@/lib/db/schema/_enums/auth";
import { hashDeSegredo } from "@/lib/seguranca/assinaturas";
import { cifrar } from "@/lib/seguranca/cofre";

/**
 * Apoio dos testes do pacote M5 (integrações e lojas). Não termina em
 * `.test.ts`: o Vitest não o coleta.
 *
 * Nada aqui apaga linha: cada teste nasce com ids, siglas e referências
 * aleatórios, e o banco de teste é recriado por `scripts/db-teste.mjs`.
 */

function urlDoBanco(): string {
  const url = process.env.DATABASE_URL_TESTE ?? process.env.DATABASE_URL;
  if (!url || !/\/[^/]*test[^/]*$/.test(new URL(url).pathname)) {
    throw new Error("Os testes de integração exigem um banco cujo nome contenha \"test\".");
  }
  return url;
}

/** Conexão de preparo: só para semear e conferir. */
export const banco = new Pool({ connectionString: urlDoBanco(), max: 3 });

export const aleatorio = (n = 8) => randomBytes(n).toString("hex");

const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export async function semearLoja(nome = `Loja ${aleatorio(3)}`): Promise<{ id: string; sigla: string }> {
  for (let tentativa = 0; tentativa < 20; tentativa += 1) {
    const sigla = Array.from({ length: 3 }, () => LETRAS[randomBytes(1)[0]! % 26]).join("");
    const { rows } = await banco.query<{ id: string }>(
      `insert into lojas (nome, slug, sigla, created_at, updated_at)
       values ($1, $2, $3, now(), now())
       on conflict do nothing
       returning id`,
      [nome, `loja-${aleatorio(4)}`, sigla],
    );
    if (rows[0]) return { id: rows[0].id, sigla };
  }
  throw new Error("não achei sigla livre para a loja de teste");
}

export async function semearUsuario(papel: Papel = "admin", lojaId: string | null = null): Promise<string> {
  const id = randomUUID();
  await banco.query(
    `insert into usuarios (id, nome, email, email_verificado, papel, loja_id, ativo, created_at, updated_at)
     values ($1, 'Pessoa de Teste M5', $2, true, $3, $4, true, now(), now())`,
    [id, `m5-${aleatorio(4)}@exemplo.invalido`, papel, lojaId],
  );
  return id;
}

export type ContaSemeada = { id: string; referencia: string; segredo: string };

export async function semearConta(opcoes: {
  provedor: "whatsapp_oficial" | "uazapi" | "instagram" | "bling";
  lojaId: string | null;
  status?: string;
  credencial?: Record<string, string>;
}): Promise<ContaSemeada> {
  const id = randomUUID();
  const referencia = opcoes.provedor === "bling" ? null : `ref-${aleatorio(6)}`;
  const segredo = `segredo-de-teste-${aleatorio(12)}`;
  const credencial = opcoes.credencial ?? { token: `tok-${aleatorio(8)}` };
  await banco.query(
    `insert into lojas_integracoes
       (id, loja_id, provedor, rotulo, status, credenciais_cifradas, credenciais_aad,
        referencia_externa, segredo_webhook_hash, created_at, updated_at)
     values ($1::uuid, $2, $3, 'Conta de teste', $4, $5, $8, $6, $7, now(), now())`,
    [
      id,
      opcoes.lojaId,
      opcoes.provedor,
      opcoes.status ?? "conectado",
      cifrar(JSON.stringify(credencial), id),
      referencia,
      hashDeSegredo(segredo),
      id,
    ],
  );
  return { id, referencia: referencia ?? "", segredo };
}

export function contextoDe(usuarioId: string, papel: Papel = "admin"): Contexto {
  return {
    sessao: {
      usuarioId,
      sessaoId: randomUUID(),
      papel,
      lojaId: null,
      ativo: true,
      precisaTrocarSenha: false,
      precisaConfigurarFator: false,
    },
    escopo: { tipo: "todas" },
    autorId: usuarioId,
    origem: "ui",
  };
}

export async function eventosDa(integracaoId: string): Promise<{ id: string; tipo: string; evento_externo_id: string; corpo: unknown }[]> {
  const { rows } = await banco.query(
    `select id, tipo, evento_externo_id, corpo from lojas_integracoes_eventos
      where integracao_id = $1 order by created_at`,
    [integracaoId],
  );
  return rows;
}

export async function linhaDaConta(id: string): Promise<Record<string, unknown>> {
  const { rows } = await banco.query("select * from lojas_integracoes where id = $1", [id]);
  return (rows[0] ?? {}) as Record<string, unknown>;
}

export async function trilhaDe(
  entidadeId: string,
): Promise<{ acao: string; ator_tipo: string; ator_id: string | null; depois: unknown }[]> {
  const { rows } = await banco.query(
    `select acao, ator_tipo, ator_id, depois from auditoria_eventos where entidade_id = $1 order by criado_em, id`,
    [entidadeId],
  );
  return rows;
}
