import type { CredencialVisivel } from "@/lib/seguranca/cofre";

/**
 * Texto da credencial na tela: só as chaves e os 4 últimos caracteres
 * (02-seguranca.md §13). Ilegível não derruba a lista (§5.6).
 */
export function textoDaCredencial(c: CredencialVisivel): string {
  if ("erro" in c && Object.keys(c).length === 1) return "não foi possível ler esta credencial";
  const partes = Object.entries(c).map(([chave, valor]) => `${chave} ${valor}`);
  return partes.length > 0 ? partes.join(" · ") : "sem credencial";
}
