import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { env } from "@/lib/env";
import type { Contexto, Sessao } from "@/lib/auth/guard";
import { atualizarComTrava, emTransacao, inserirAuditado } from "@/lib/db/mutacoes";
import { lojas_integracoes } from "@/lib/db/schema/integracoes";
import { ErroDeConfiguracao, ErroDeIntegracao, ErroDoAplicativo } from "@/lib/erros";
import { enfileirar } from "@/lib/fila/filas";
import { jobId } from "@/lib/fila/idempotencia";
import { logger } from "@/lib/logger";
import { buscarExterno } from "@/lib/rede/buscarExterno";
import { assinarEstado, compararEmTempoConstante, conferirEstado } from "@/lib/seguranca/assinaturas";
import { cifrar, conferirCofre } from "@/lib/seguranca/cofre";
import { marcarUmaVez } from "@/lib/seguranca/limite";
import { contaComCredencial, contaDaRede } from "./_consultas";
import { registrarEstadoDoSistema } from "./contas";
import { contextoDoSistema } from "./_sistema";

/**
 * OAuth do Bling — o sistema como CLIENTE (02-seguranca.md §12, D-11).
 *
 *   - `state` = HMAC(`INTEGRATIONS_STATE_KEY`, `nonce.expira.usuarioId`),
 *     5 minutos, USO ÚNICO (`SET NX`) e amarrado ao cookie
 *     `__Host-merlo.oauth_nonce` (HttpOnly, SameSite=Lax);
 *   - `redirect_uri` fixo, do ambiente;
 *   - troca do `code` só no servidor, com `client_id:client_secret` em Basic
 *     (o Bling proíbe no corpo);
 *   - o callback reconfere que quem iniciou ainda é admin ativo.
 *
 * PKCE: o Bling v3 não documenta suporte ("PKCE S256 onde houver"), então não
 * entra. A amarra do `state` com o cookie é o que fecha o login CSRF.
 *
 * Os dois POST ficam aqui e não em `integracoes/bling/` (pacote M4): o plano
 * dá a conexão a este pacote. Host `www.bling.com.br`, que é o documentado
 * para o OAuth e está na allowlist de `buscarExterno`.
 */

export const COOKIE_NONCE = "__Host-merlo.oauth_nonce";
export const VALIDADE_COOKIE_S = 5 * 60;

const AUTORIZAR = "https://www.bling.com.br/Api/v3/oauth/authorize";
const TROCAR = "https://www.bling.com.br/Api/v3/oauth/token";

export class ErroDeOAuth extends ErroDoAplicativo {
  constructor() {
    // Uma mensagem só para expirado, reusado, adulterado e de outra sessão.
    super("OAUTH_RECUSADO", "A autorização não vale mais. Comece a conexão de novo.", 400);
  }
}

function configuracao() {
  const { BLING_CLIENT_ID: id, BLING_CLIENT_SECRET: segredo, BLING_REDIRECT_URI: retorno } = env;
  if (!id || !segredo || !retorno) {
    throw new ErroDeConfiguracao("O Bling não está configurado neste ambiente. Avise o administrador.");
  }
  return { id, segredo, retorno };
}

export function blingConfigurado(): boolean {
  return Boolean(env.BLING_CLIENT_ID && env.BLING_CLIENT_SECRET && env.BLING_REDIRECT_URI);
}

/** Passo 1: URL do Bling + nonce que vai para o cookie. */
export function iniciarAutorizacaoBling(sessao: Sessao): { url: string; nonce: string } {
  const cfg = configuracao();
  conferirCofre();
  const { state, nonce } = assinarEstado(sessao.usuarioId);
  const url = new URL(AUTORIZAR);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.id);
  url.searchParams.set("redirect_uri", cfg.retorno);
  url.searchParams.set("state", state);
  return { url: url.toString(), nonce };
}

type Tokens = { access_token: string; refresh_token: string; expires_in: number };

function lerTokens(bytes: Buffer): Tokens {
  let corpo: unknown;
  try {
    corpo = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new ErroDeIntegracao("O Bling respondeu num formato inesperado.", false);
  }
  const c = (typeof corpo === "object" && corpo !== null ? corpo : {}) as Record<string, unknown>;
  if (typeof c.access_token !== "string" || typeof c.refresh_token !== "string") {
    throw new ErroDeIntegracao("O Bling não devolveu o token.", true);
  }
  const expira = Number(c.expires_in);
  return {
    access_token: c.access_token,
    refresh_token: c.refresh_token,
    expires_in: Number.isFinite(expira) && expira > 0 ? expira : 3600,
  };
}

async function pedirToken(corpo: URLSearchParams): Promise<Tokens> {
  const cfg = configuracao();
  const basico = Buffer.from(`${cfg.id}:${cfg.segredo}`, "utf8").toString("base64");
  const resposta = await buscarExterno(TROCAR, {
    provedor: "bling",
    metodo: "POST",
    corpo: corpo.toString(),
    cabecalhos: {
      authorization: `Basic ${basico}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    maxBytes: 64 * 1024,
  });
  if (resposta.status === 400 || resposta.status === 401 || resposta.status === 403) {
    throw new ErroDeIntegracao("O Bling recusou a autorização. Conecte a conta de novo.", true);
  }
  if (resposta.status < 200 || resposta.status >= 300) {
    throw new ErroDeIntegracao(`O Bling respondeu ${resposta.status}. Tente de novo em instantes.`, false);
  }
  return lerTokens(resposta.bytes);
}

export type EntradaDoCallback = {
  sessao: Sessao;
  ctx: Contexto;
  code: string;
  state: string;
  nonceDoCookie: string | null;
};

/**
 * Passo 2: prova o `state` (assinatura, prazo, dono, cookie, uso único) e só
 * então troca o código. Qualquer falha é a MESMA recusa.
 */
export async function concluirAutorizacaoBling(e: EntradaDoCallback): Promise<{ integracaoId: string }> {
  const estado = conferirEstado(e.state);
  if (!estado) throw new ErroDeOAuth();
  if (!compararEmTempoConstante(estado.usuarioId, e.sessao.usuarioId)) throw new ErroDeOAuth();
  if (!compararEmTempoConstante(estado.nonce, e.nonceDoCookie)) throw new ErroDeOAuth();
  if (!(await marcarUmaVez(`oauth:bling:${estado.nonce}`, VALIDADE_COOKIE_S))) throw new ErroDeOAuth();

  conferirCofre();
  const tokens = await pedirToken(new URLSearchParams({ grant_type: "authorization_code", code: e.code }));
  const integracaoId = await gravarTokens(tokens, e.ctx, "integracao_conectada");

  await enfileirar(
    "integracoes",
    "sincronizar-bling",
    { integracaoId },
    { jobId: jobId("bling", integracaoId, String(Date.now())) },
  );
  return { integracaoId };
}

/** Conta de rede é ÚNICA: reconectar atualiza a linha viva, não cria outra. */
async function gravarTokens(
  tokens: Tokens,
  ctx: Contexto,
  acao: "integracao_conectada" | "integracao_alterada",
): Promise<string> {
  const existente = await contaDaRede("bling");
  const id = existente?.id ?? randomUUID();
  const dados = {
    credenciais_cifradas: cifrar(
      JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token }),
      id,
    ),
    credenciais_aad: id,
    status: "conectado",
    expira_em: new Date(Date.now() + tokens.expires_in * 1000),
    ultimo_erro: null,
    revogada_em: null,
  };

  await emTransacao(ctx, async (tx) => {
    if (existente) {
      await atualizarComTrava(
        tx,
        lojas_integracoes,
        { id, escopo: ctx.escopo, updatedAtOriginal: existente.updatedAt, dados },
        ctx,
        acao,
      );
    } else {
      await inserirAuditado(
        tx,
        lojas_integracoes,
        { id, loja_id: null, provedor: "bling", rotulo: "Bling da rede", ...dados },
        ctx,
        "integracao_conectada",
      );
    }
  });
  return id;
}

/**
 * `renovar-token`: gira o refresh antes do vencimento, sob
 * `pg_advisory_xact_lock` por integração (03-arquitetura.md §6.5) — dois
 * workers renovando juntos queimariam o refresh um do outro.
 */
export async function renovarTokenBling(integracaoId: string): Promise<"renovado" | "expirado" | "ignorado"> {
  const ctx = contextoDoSistema("worker");
  try {
    return await emTransacao(ctx, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`renovar-${integracaoId}`}))`);
      const conta = await contaComCredencial(integracaoId);
      if (!conta || conta.provedor !== "bling") return "ignorado" as const;
      const refresh = conta.credencial.refresh_token;
      if (!refresh) throw new ErroDeIntegracao("Conta do Bling sem refresh token. Conecte de novo.", true);

      const tokens = await pedirToken(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }));
      await atualizarComTrava(
        tx,
        lojas_integracoes,
        {
          id: integracaoId,
          escopo: ctx.escopo,
          updatedAtOriginal: conta.updatedAt,
          dados: {
            credenciais_cifradas: cifrar(
              JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token }),
              integracaoId,
            ),
            credenciais_aad: integracaoId,
            status: "conectado",
            expira_em: new Date(Date.now() + tokens.expires_in * 1000),
          },
        },
        ctx,
        "integracao_alterada",
      );
      return "renovado" as const;
    });
  } catch (erro) {
    if (erro instanceof ErroDeIntegracao && erro.permanente) {
      logger.warn({ integracaoId, erro: erro.message }, "token do Bling não renovou: conta expirada");
      await registrarEstadoDoSistema(integracaoId, { status: "expirado", ultimoErro: erro.message });
      return "expirado";
    }
    throw erro;
  }
}
