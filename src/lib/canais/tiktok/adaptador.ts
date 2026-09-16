import { naoImplementado } from "@/lib/erros";
import type { AdaptadorDeCanal, ContaDeCanal } from "../tipos";

/** COSTURA — dono: R2-D. Fábrica do adaptador do TikTok (ADR 0055). */
export function criarAdaptadorTiktok(_conta: ContaDeCanal): AdaptadorDeCanal {
  throw naoImplementado("adaptador do TikTok (pacote R2-D)");
}
