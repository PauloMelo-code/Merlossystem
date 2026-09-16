import "server-only";
import { eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { vivosE } from "@/lib/db/consultas";
import { lojas_integracoes } from "@/lib/db/schema/integracoes";
import { ErroDeIntegracao } from "@/lib/erros";
import { buscarExterno } from "@/lib/rede/buscarExterno";
import { decifrar } from "@/lib/seguranca/cofre";
import { consumir } from "@/lib/seguranca/limite";
import {
  BLING_API,
  CAMPO_TOKEN,
  ESPERA_MS,
  ESPERAS_MAXIMAS,
  LIMITE_BLING,
  TETO_RESPOSTA,
  chaveDoLimitador,
} from "./config";

/**
 * O ÚNICO lugar que fala HTTP com o Bling (03-arquitetura.md §12.1).
 *
 * SOMENTE LEITURA: este arquivo só conhece `GET` (trava T26). O `POST` do
 * OAuth mora em `integracoes/oauth.ts`, do pacote M5.
 *
 * A saída passa por `buscarExterno()` (allowlist + anti-SSRF) e cada chamada
 * consome o balde de 3 req/s da conta ANTES de sair — o mesmo balde para a
 * tela e para o job.
 */

export type ContaBling = { id: string; token: string };

/** A conta da rede: provedor `bling`, viva, não revogada. */
export async function contaBling(): Promise<ContaBling> {
  const [linha] = await db
    .select({
      id: lojas_integracoes.id,
      status: lojas_integracoes.status,
      cifradas: lojas_integracoes.credenciais_cifradas,
      aad: lojas_integracoes.credenciais_aad,
    })
    .from(lojas_integracoes)
    .where(
      vivosE(
        lojas_integracoes,
        eq(lojas_integracoes.provedor, "bling"),
        // Conta da REDE: sem loja (CHECK `lojas_integracoes_rede`).
        isNull(lojas_integracoes.loja_id),
        isNull(lojas_integracoes.revogada_em),
      ),
    )
    .limit(1);

  if (!linha || linha.status !== "conectado" || !linha.cifradas || !linha.aad) {
    throw new ErroDeIntegracao("O Bling não está conectado. Avise o administrador.", true);
  }
  let credenciais: unknown;
  try {
    credenciais = JSON.parse(decifrar(linha.cifradas, linha.aad));
  } catch {
    throw new ErroDeIntegracao("A credencial do Bling está ilegível. Reconecte a conta.", true);
  }
  const token =
    typeof credenciais === "object" && credenciais !== null
      ? (credenciais as Record<string, unknown>)[CAMPO_TOKEN]
      : undefined;
  if (typeof token !== "string" || token === "") {
    throw new ErroDeIntegracao("A credencial do Bling está incompleta. Reconecte a conta.", true);
  }
  return { id: linha.id, token };
}

const dormir = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

/**
 * Espera a vez no balde da conta. Passou do teto de esperas: erro NÃO
 * permanente — a fila tenta de novo e a tela mostra "Tentar de novo".
 */
async function aguardarVez(integracaoId: string): Promise<void> {
  for (let i = 0; i < ESPERAS_MAXIMAS; i += 1) {
    const veredito = await consumir(chaveDoLimitador(integracaoId), LIMITE_BLING);
    if (veredito.permitido) return;
    await dormir(ESPERA_MS);
  }
  throw new ErroDeIntegracao("O Bling está ocupado agora. Tente de novo em instantes.", false);
}

export type Consulta = Record<string, string | number | readonly (string | number)[]>;

export function montarUrl(caminho: string, consulta: Consulta = {}): string {
  const url = new URL(`${BLING_API}${caminho}`);
  for (const [chave, valor] of Object.entries(consulta)) {
    if (Array.isArray(valor)) {
      for (const item of valor) url.searchParams.append(`${chave}[]`, String(item));
    } else {
      url.searchParams.set(chave, String(valor));
    }
  }
  return url.toString();
}

/** `GET` autenticado. Devolve o JSON cru; quem interpreta é `leitura.ts`. */
export async function lerDoBling(
  conta: ContaBling,
  caminho: string,
  consulta: Consulta = {},
): Promise<unknown> {
  await aguardarVez(conta.id);
  const resposta = await buscarExterno(montarUrl(caminho, consulta), {
    provedor: "bling",
    metodo: "GET",
    cabecalhos: { Authorization: `Bearer ${conta.token}`, Accept: "application/json" },
    maxBytes: TETO_RESPOSTA,
  });

  if (resposta.status === 401 || resposta.status === 403) {
    throw new ErroDeIntegracao("O Bling recusou a credencial. Reconecte a conta.", true);
  }
  if (resposta.status === 404) return null;
  if (resposta.status === 429 || resposta.status >= 500) {
    throw new ErroDeIntegracao("O Bling não respondeu agora. Tente de novo em instantes.", false);
  }
  if (resposta.status >= 400) {
    throw new ErroDeIntegracao(`O Bling recusou a consulta (HTTP ${resposta.status}).`, true);
  }
  try {
    return JSON.parse(resposta.bytes.toString("utf8")) as unknown;
  } catch {
    throw new ErroDeIntegracao("O Bling devolveu uma resposta ilegível.", false);
  }
}

