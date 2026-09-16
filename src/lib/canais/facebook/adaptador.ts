import { naoImplementado } from "@/lib/erros";
import type { AdaptadorDeCanal, ContaDeCanal } from "../tipos";

/** COSTURA — dono: R2-D. Fábrica do adaptador do Messenger (ADR 0054). */
export function criarAdaptadorFacebook(_conta: ContaDeCanal): AdaptadorDeCanal {
  throw naoImplementado("adaptador do Messenger (pacote R2-D)");
}
