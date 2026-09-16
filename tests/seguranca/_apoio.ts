import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { GET, POST } from "@/app/api/auth/[...all]/route";
import { kdf } from "@/lib/auth/kdf";
import { hashToken, novoToken } from "@/lib/auth/tokens";
import { redisDoLimitador } from "@/lib/seguranca/limite";
import { ATOR_SISTEMA, type Papel } from "@/lib/db/schema/_enums/auth";

/**
 * Apoio dos testes de EFEITO de segurança (02-seguranca.md §4.4, §20).
 *
 * Os testes desta pasta chamam o Route Handler de verdade — `GET`/`POST` de
 * `src/app/api/auth/[...all]/route.ts` — com uma `Request` montada à mão. É a
 * única forma de provar EFEITO: `auth.options` devolve o que nós escrevemos, e
 * uma opção com nome errado passaria em qualquer comparação de literais.
 *
 * Não termina em `.test.ts`, então o Vitest não o coleta como suíte.
 */

export const ORIGEM = "http://localhost:3005";

function urlDoBanco(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não está definida para os testes.");
  // A mesma guarda de `scripts/db-teste.mjs`: nunca rodar no banco de dev.
  if (!/\/[^/]*test[^/]*$/.test(new URL(url).pathname)) {
    throw new Error(`Banco "${url}" não parece de teste: o nome precisa conter "test".`);
  }
  return url;
}

/** Conexão de DONO: só os testes usam, e só para preparar e limpar. */
export const poolDeTeste = new Pool({ connectionString: urlDoBanco(), max: 4 });

/**
 * Tabelas que todo teste de auth suja. `TRUNCATE`, nunca `delete` (T25).
 *
 * SEM `usuarios` e SEM `CASCADE`: todas as tabelas de domínio apontam para
 * `usuarios` (`modified_by`), e o `TRUNCATE usuarios CASCADE` apagava
 * `contatos` das outras suítes, deixava `consentimentos` órfão e levava junto o
 * ATOR_SISTEMA semeado pela migração 0018. Nenhuma tabela aponta para estas.
 */
const TABELAS = [
  "auth_eventos",
  "auditoria_eventos",
  "usuarios_senhas_historico",
  "usuarios_sessoes",
  "usuarios_verificacoes",
  "usuarios_totp",
  "usuarios_passkeys",
  "usuarios_convites",
  "usuarios_trocas_email",
  "usuarios_contas",
].join(", ");

/**
 * `usuarios` não é truncável sem cascata: a pessoa de teste de um arquivo
 * anterior é APOSENTADA — e-mail único em domínio reservado, inativa, sem loja
 * e sem papel de posse — e deixa de colidir com o e-mail, a contagem de donos e
 * a lista de ativos do arquivo seguinte. A linha fica (as FKs a exigem).
 */
const APOSENTAR_USUARIOS = `
  update usuarios set
    email = 'aposentado-' || id || '@teste.invalid',
    papel = 'gerente', loja_id = null, ativo = false,
    two_factor_enabled = false, precisa_trocar_senha = false,
    precisa_configurar_fator = false
  where id <> '${ATOR_SISTEMA}' and email not like 'aposentado-%'`;

export async function limparAuth(): Promise<void> {
  await poolDeTeste.query(`truncate table ${TABELAS} restart identity`);
  await poolDeTeste.query(APOSENTAR_USUARIOS);
  // Sem o flush, o teto do arquivo anterior vazaria para este e o teste
  // falharia por 429 que não é do caso em prova.
  await redisDoLimitador().flushdb().catch(() => undefined);
}

export async function fecharApoio(): Promise<void> {
  await poolDeTeste.end().catch(() => undefined);
  await redisDoLimitador().quit().catch(() => undefined);
}

export type UsuarioDeTeste = {
  id: string;
  email: string;
  senha: string;
  papel: Papel;
};

export type OpcoesDeUsuario = {
  papel?: Papel;
  lojaId?: string | null;
  ativo?: boolean;
  precisaConfigurarFator?: boolean;
  precisaTrocarSenha?: boolean;
  isDeleted?: boolean;
  senha?: string;
};

/** Senha longa o bastante para a política e sem nenhum valor real. */
export const SENHA_PADRAO = "frase-de-teste-sem-valor-real-01";

/**
 * Cria identidade direto no banco com o MESMO `kdf.hash` do
 * `emailAndPassword.password.hash` — se o formato divergir, `signInEmail` não
 * autentica e o teste acusa (é a mesma prova de T28).
 */
export async function criarUsuario(
  email: string,
  opcoes: OpcoesDeUsuario = {},
): Promise<UsuarioDeTeste> {
  const id = randomUUID();
  const papel = opcoes.papel ?? "admin";
  const senha = opcoes.senha ?? SENHA_PADRAO;
  const precisaFator = opcoes.precisaConfigurarFator ?? false;
  const ativo = opcoes.ativo ?? true;

  await poolDeTeste.query(
    `insert into usuarios
       (id, nome, email, email_verificado, papel, loja_id, ativo,
        precisa_trocar_senha, precisa_configurar_fator, is_deleted,
        created_at, updated_at)
     values ($1, 'Pessoa de Teste', $2, true, $3, $4, $5, $6, $7, $8, now(), now())`,
    [
      id,
      email.toLowerCase(),
      papel,
      opcoes.lojaId ?? null,
      ativo,
      opcoes.precisaTrocarSenha ?? false,
      precisaFator,
      opcoes.isDeleted ?? false,
    ],
  );
  await poolDeTeste.query(
    `insert into usuarios_contas
       (id, usuario_id, conta_id, provedor_id, senha_hash, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $1::text, 'credential', $2, now(), now())`,
    [id, await kdf.hash(senha)],
  );

  return { id, email: email.toLowerCase(), senha, papel };
}

/** Emite um convite pronto para consumo, devolvendo o token em claro. */
export async function criarConvite(
  email: string,
  opcoes: { papel?: Papel; lojaId?: string | null; bootstrap?: boolean; criadoPor?: string } = {},
): Promise<{ id: string; token: string }> {
  const { token, hash } = novoToken();
  const papel = opcoes.papel ?? "gerente";
  const bootstrap = opcoes.bootstrap ?? false;
  const { rows } = await poolDeTeste.query<{ id: string }>(
    `insert into usuarios_convites
       (email, papel, loja_id, token_hash, expira_em, criado_por, ciencia_versao,
        bootstrap, created_at, updated_at)
     values ($1, $2, $3, $4, now() + interval '24 hours', $5, $6, $7, now(), now())
     returning id`,
    [
      email.toLowerCase(),
      papel,
      opcoes.lojaId ?? null,
      hash,
      opcoes.criadoPor ?? null,
      papel === "admin" ? "CIENCIA_ADMIN_V1" : null,
      bootstrap,
    ],
  );
  return { id: rows[0]!.id, token };
}

export function hashDeToken(token: string): string {
  return hashToken(token);
}

export type Extras = {
  origem?: string | null;
  cookie?: string;
  xff?: string;
  agente?: string;
};

function cabecalhos(extras: Extras, comCorpo: boolean): Headers {
  const h = new Headers();
  if (comCorpo) h.set("content-type", "application/json");
  if (extras.origem !== null) h.set("origin", extras.origem ?? ORIGEM);
  if (extras.cookie) h.set("cookie", extras.cookie);
  if (extras.xff) h.set("x-forwarded-for", extras.xff);
  h.set("user-agent", extras.agente ?? "vitest");
  return h;
}

export type RespostaDeTeste = {
  status: number;
  corpo: string;
  headers: Headers;
  ms: number;
};

async function medir(resposta: Promise<Response>, inicio: number): Promise<RespostaDeTeste> {
  const r = await resposta;
  const corpo = await r.text();
  return { status: r.status, corpo, headers: r.headers, ms: Date.now() - inicio };
}

export async function postar(
  caminho: string,
  corpo: unknown = {},
  extras: Extras = {},
): Promise<RespostaDeTeste> {
  const inicio = Date.now();
  const req = new Request(`${ORIGEM}/api/auth${caminho}`, {
    method: "POST",
    headers: cabecalhos(extras, true),
    body: JSON.stringify(corpo),
  });
  return medir(POST(req), inicio);
}

export async function obter(caminho: string, extras: Extras = {}): Promise<RespostaDeTeste> {
  const inicio = Date.now();
  const req = new Request(`${ORIGEM}/api/auth${caminho}`, {
    method: "GET",
    headers: cabecalhos(extras, false),
  });
  return medir(GET(req), inicio);
}

/** O cookie de sessão que o BA devolveu, pronto para a próxima requisição. */
export function cookieDaResposta(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

export async function contarEventos(tipo: string): Promise<number> {
  const { rows } = await poolDeTeste.query<{ n: string }>(
    "select count(*)::text as n from auth_eventos where tipo = $1",
    [tipo],
  );
  return Number(rows[0]?.n ?? "0");
}

export async function lerUsuario(id: string): Promise<Record<string, unknown>> {
  const { rows } = await poolDeTeste.query("select * from usuarios where id = $1", [id]);
  return (rows[0] ?? {}) as Record<string, unknown>;
}
