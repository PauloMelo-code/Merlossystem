import "server-only";
import { env } from "@/lib/env";
import { ErroDeConfiguracao } from "@/lib/erros";
import { buscarExterno } from "@/lib/rede/buscarExterno";
import { conferirAssinaturaMeta, conferirSegredoPorHash } from "@/lib/seguranca/assinaturas";
import { decifrar } from "@/lib/seguranca/cofre";
import { criarInstagram, interpretarInstagram } from "./instagram";
import { criarUazapi, interpretarUazapi } from "./uazapi";
import { criarWhatsappOficial, interpretarWhatsappOficial } from "./whatsapp-oficial";
import type {
  AdaptadorDeCanal,
  ClienteHttp,
  ConfigDoCanal,
  ContaDeCanal,
  InterpretacaoDeWebhook,
  Provedor,
} from "./tipos";

/**
 * Fábrica ÚNICA de adaptador (03-arquitetura.md §10.1).
 *
 * Recebe a conta com a credencial JÁ decifrada. Nenhum adaptador lê
 * `process.env` e NÃO existe fallback de ambiente (A-12): conta sem credencial
 * falha fechado, com `ErroDeConfiguracao` (503 na tela, permanente na fila).
 *
 * CHAVES DA CREDENCIAL (o JSON cifrado em `lojas_integracoes`):
 *   whatsapp_oficial → `access_token` (o número é a `referencia_externa`,
 *                      o `phone_number_id`);
 *   instagram        → `page_access_token`;
 *   uazapi           → `token`.
 * Quem grava é a tela de integrações (pacote M5, `catalogo-provedores.ts`).
 */

export const PROVEDORES_DE_CANAL = ["whatsapp_oficial", "uazapi", "instagram"] as const;
export type ProvedorDeCanal = (typeof PROVEDORES_DE_CANAL)[number];

export function ehProvedorDeCanal(provedor: string): provedor is ProvedorDeCanal {
  return (PROVEDORES_DE_CANAL as readonly string[]).includes(provedor);
}

/** Cabeçalho do segredo POR INTEGRAÇÃO do uazapi (nunca query string). */
export const CABECALHO_SEGREDO_UAZAPI = "x-uazapi-secret";

const httpDeProducao: ClienteHttp = (url, opcoes) => buscarExterno(url, opcoes);

function exigir(valor: string | undefined, oQue: string): string {
  if (!valor) throw new ErroDeConfiguracao(`Conta de canal sem ${oQue}. Reconecte a conta.`);
  return valor;
}

export function configDoAmbiente(): ConfigDoCanal {
  return { versaoGraph: env.META_GRAPH_VERSION, baseUazapi: env.UAZAPI_BASE_URL };
}

export function criarAdaptador(
  conta: ContaDeCanal,
  config: ConfigDoCanal = configDoAmbiente(),
  http: ClienteHttp = httpDeProducao,
): AdaptadorDeCanal {
  const cred = conta.credenciais;
  const assinaturaMeta = (corpoCru: string, cabecalhos: Headers) =>
    conferirAssinaturaMeta(corpoCru, cabecalhos.get("x-hub-signature-256"));

  switch (conta.provedor) {
    case "whatsapp_oficial":
      return criarWhatsappOficial({
        accessToken: exigir(cred.access_token, "token de acesso"),
        phoneNumberId: exigir(cred.phone_number_id ?? conta.referenciaExterna ?? undefined, "id do número"),
        versaoGraph: exigir(config.versaoGraph, "META_GRAPH_VERSION no ambiente"),
        http,
        conferirAssinatura: assinaturaMeta,
      });
    case "instagram":
      return criarInstagram({
        accessToken: exigir(cred.page_access_token, "token da página"),
        versaoGraph: exigir(config.versaoGraph, "META_GRAPH_VERSION no ambiente"),
        http,
        conferirAssinatura: assinaturaMeta,
      });
    case "uazapi":
      return criarUazapi({
        token: exigir(cred.token, "token da instância"),
        base: exigir(config.baseUazapi, "UAZAPI_BASE_URL no ambiente"),
        http,
        conferirAssinatura: (_corpo, cabecalhos) =>
          conferirSegredoPorHash(cabecalhos.get(CABECALHO_SEGREDO_UAZAPI), conta.segredoWebhookHash),
      });
    default:
      throw new ErroDeConfiguracao("provedor não habilitado");
  }
}

/**
 * Interpretar NÃO precisa de credencial: o processador de entrada lê o evento
 * já autenticado pela borda. Assim um evento de conta cuja credencial ficou
 * ilegível ainda é registrado, em vez de se perder.
 */
export function interpretarPorProvedor(provedor: Provedor, corpoCru: string): InterpretacaoDeWebhook | null {
  switch (provedor) {
    case "whatsapp_oficial":
      return interpretarWhatsappOficial(corpoCru);
    case "instagram":
      return interpretarInstagram(corpoCru);
    case "uazapi":
      return interpretarUazapi(corpoCru);
    default:
      return null;
  }
}

/** A credencial é JSON cifrado com AAD = id da linha (cofre, REQ-K2). */
export function abrirCredenciais(envelope: string | null, aad: string | null): Record<string, string> {
  if (!envelope || !aad) throw new ErroDeConfiguracao("Conta de canal sem credencial. Reconecte a conta.");
  const bruto: unknown = JSON.parse(decifrar(envelope, aad));
  if (typeof bruto !== "object" || bruto === null) {
    throw new ErroDeConfiguracao("Credencial da conta ilegível. Reconecte a conta.");
  }
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (typeof valor === "string") saida[chave] = valor;
  }
  return saida;
}
