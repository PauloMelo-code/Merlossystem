import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { ErroDoAplicativo } from "@/lib/erros";

/**
 * Cofre de credenciais de integracao (02-seguranca.md §13, REQ-K2/K3;
 * 03-arquitetura.md §12.3 — este e o caminho unico).
 *
 * AES-256-GCM, IV de 12 bytes ALEATORIO por operacao, tag de autenticacao,
 * AAD = `lojas_integracoes.id` (coluna `credenciais_aad`), envelope versionado
 * `v1:<iv>:<tag>:<cifrado>` em base64url, gravado em `credenciais_cifradas`.
 *
 * A chave e DEDICADA (`INTEGRATIONS_KEY`), nunca derivada do segredo de auth:
 * girar o segredo de auth invalidaria todas as credenciais de uma vez.
 */

export class ErroDoCofre extends ErroDoAplicativo {
  constructor(mensagem = "Nao foi possivel abrir a credencial guardada.") {
    // 503, nunca 500: e falta de configuracao ou envelope invalido, e a rota
    // precisa dizer "tente de novo depois", nao "quebrou".
    super("COFRE", mensagem, 503);
  }
}

const VERSAO = "v1";
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;

/**
 * `INTEGRATIONS_KEY` chega como texto (>= 32 caracteres, garantido em
 * `env.ts`). O SHA-256 dele da os 32 bytes exatos que o AES-256 exige, sem
 * obrigar o operador a gerar base64 de tamanho certo — o que na pratica vira
 * chave curta colada de qualquer lugar. A derivacao e deste segredo e so dele.
 */
function chave(): Buffer {
  const bruta = env.INTEGRATIONS_KEY;
  if (typeof bruta !== "string" || bruta.length < 32) {
    throw new ErroDoCofre("INTEGRATIONS_KEY ausente ou curta demais.");
  }
  return createHash("sha256").update(bruta, "utf8").digest();
}

/** Boot / sonda: confere que a chave existe e tem tamanho, sem cifrar nada. */
export function conferirCofre(): void {
  chave();
}

export function cifrar(valor: string, aad: string): string {
  if (aad.length === 0) throw new ErroDoCofre("AAD obrigatorio: e o id da integracao.");
  const iv = randomBytes(TAMANHO_IV);
  const cifra = createCipheriv("aes-256-gcm", chave(), iv);
  cifra.setAAD(Buffer.from(aad, "utf8"));
  const cifrado = Buffer.concat([cifra.update(valor, "utf8"), cifra.final()]);
  const tag = cifra.getAuthTag();
  return [
    VERSAO,
    iv.toString("base64url"),
    tag.toString("base64url"),
    cifrado.toString("base64url"),
  ].join(":");
}

/**
 * Adulteracao de texto, tag, IV ou versao cai toda no MESMO erro generico:
 * dizer qual parte quebrou entrega um oraculo de graca.
 */
export function decifrar(envelope: string, aad: string): string {
  const partes = envelope.split(":");
  if (partes.length !== 4 || partes[0] !== VERSAO) throw new ErroDoCofre();
  const [, ivTexto = "", tagTexto = "", cifradoTexto = ""] = partes;
  try {
    const iv = Buffer.from(ivTexto, "base64url");
    const tag = Buffer.from(tagTexto, "base64url");
    if (iv.length !== TAMANHO_IV || tag.length !== TAMANHO_TAG) throw new ErroDoCofre();
    const decifra = createDecipheriv("aes-256-gcm", chave(), iv);
    decifra.setAAD(Buffer.from(aad, "utf8"));
    decifra.setAuthTag(tag);
    const claro = Buffer.concat([
      decifra.update(Buffer.from(cifradoTexto, "base64url")),
      decifra.final(),
    ]);
    return claro.toString("utf8");
  } catch (erro) {
    if (erro instanceof ErroDoCofre) throw erro;
    throw new ErroDoCofre();
  }
}

/**
 * A tela ve so as chaves e os 4 ultimos caracteres (§13). Credencial ilegivel
 * vira `{ erro: "ilegivel" }` e NAO derruba a listagem inteira.
 */
export type CredencialVisivel = { [chave: string]: string } | { erro: "ilegivel" };

export function mascarar(valor: string): string {
  const fim = valor.slice(-4);
  return `${"*".repeat(Math.max(0, Math.min(8, valor.length - 4)))}${fim}`;
}

/** Abre o envelope e devolve so o que pode aparecer na tela. */
export function credenciaisVisiveis(
  envelope: string | null,
  aad: string | null,
): CredencialVisivel {
  if (!envelope || !aad) return { erro: "ilegivel" };
  try {
    const bruto: unknown = JSON.parse(decifrar(envelope, aad));
    if (typeof bruto !== "object" || bruto === null) return { erro: "ilegivel" };
    const visivel: { [chave: string]: string } = {};
    for (const [nome, valor] of Object.entries(bruto as Record<string, unknown>)) {
      visivel[nome] = mascarar(String(valor));
    }
    return visivel;
  } catch {
    return { erro: "ilegivel" };
  }
}
