import type { StatusCampanha } from "@/lib/db/schema/_enums/catalogo";
import type { Provedor } from "@/lib/db/schema/_enums/plataforma";

/**
 * Regras puras de campanha (01-dados-dominio.md §5.4, 03-arquitetura.md §8.4).
 * Sem I/O: a tela e o servidor leem daqui.
 */

/** Só WhatsApp dispara campanha no R1. */
export const PROVEDORES_DE_CAMPANHA = ["whatsapp_oficial", "uazapi"] as const satisfies readonly Provedor[];
export type ProvedorDeCampanha = (typeof PROVEDORES_DE_CAMPANHA)[number];

export function ehProvedorDeCampanha(provedor: string): provedor is ProvedorDeCampanha {
  return (PROVEDORES_DE_CAMPANHA as readonly string[]).includes(provedor);
}

/**
 * Ritmo por CONTA (03-arquitetura.md §8.4): 1 msg/s no uazapi, 10 msg/s no
 * número oficial. O lote reserva exatamente isto e o próximo lote sai 1 s
 * depois — uma campanha nunca passa do ritmo da conta por conta própria.
 *
 * ponytail: constante por provedor; "configurável por integração" pede coluna
 * em `lojas_integracoes`, que o modelo fechado não tem (bloqueio registrado).
 */
export const RITMO_POR_SEGUNDO: Readonly<Record<ProvedorDeCampanha, number>> = {
  uazapi: 1,
  whatsapp_oficial: 10,
};

export const INTERVALO_ENTRE_LOTES_MS = 1_000;

/**
 * Lease da reserva (corrige 03/A2): linha `reservado` há mais que isto volta a
 * `pendente`, porque o worker que a pegou morreu no meio.
 */
export const LEASE_MS = 5 * 60_000;

/** Oficial dispara por MODELO (fora da janela de 24 h); uazapi, por texto. */
export function conteudoDoProvedor(provedor: ProvedorDeCampanha): "modelo" | "texto" {
  return provedor === "whatsapp_oficial" ? "modelo" : "texto";
}

/** Quem pode sair de onde. `agendada` e `cancelada` não têm tela no R1. */
export const PODE_INICIAR: readonly StatusCampanha[] = ["rascunho"];
export const PODE_RETOMAR: readonly StatusCampanha[] = ["pausada"];
export const PODE_PAUSAR: readonly StatusCampanha[] = ["enviando"];
/** Excluir campanha em andamento deixaria destinatário reservado sem dono. */
export const PODE_EXCLUIR: readonly StatusCampanha[] = ["rascunho", "pausada", "concluida", "cancelada"];
/** Reenviar falhas reabre o disparo; em rascunho não existe destinatário. */
export const PODE_REENVIAR: readonly StatusCampanha[] = ["enviando", "pausada", "concluida"];

export function podeSair(de: string, lista: readonly StatusCampanha[]): boolean {
  return (lista as readonly string[]).includes(de);
}

/** Chave de idempotência da mensagem: uma por destinatário e tentativa. */
export function chaveDoEnvio(campanhaId: string, contatoId: string, tentativa: number): string {
  return `campanha-${campanhaId}-${contatoId}-${tentativa}`;
}
