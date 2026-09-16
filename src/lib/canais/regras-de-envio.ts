import type { Provedor } from "@/lib/db/schema/_enums/plataforma";

/**
 * Regras de envio por provedor (ADR 0056). PURO: sem I/O e sem `server-only`.
 * Fonte ÚNICA da janela de resposta e dos tetos de texto e mídia dos canais do
 * R2: o registro do envio, o processador de saída e o DTO da conversa leem
 * daqui. Nenhum outro arquivo compara `ultima_entrada_em` com o relógio para
 * decidir se pode enviar. Dono: FUNDAÇÃO; o R2-D só lê.
 */

export type SituacaoDaJanela = "aberta" | "so_agente_humano" | "so_modelo" | "fechada";

/** `pessoa` = digitada por alguém da equipe (ação com sessão); o resto é `automatica`. */
export type OrigemDoEnvio = "pessoa" | "automatica";

type Regra = {
  /** Horas desde a última entrada da cliente; `null` = sem janela. */
  horas: number | null;
  /** Depois de `horas` e até este limite, só resposta de pessoa (Messenger). */
  horasAgenteHumano?: number;
  /** O que vale depois da janela e quando a cliente nunca escreveu. */
  depois: "so_modelo" | "fechada";
  /** Nome do canal na frase ("O Messenger só deixa..."). */
  nome: string;
};

export const JANELAS: Readonly<Partial<Record<Provedor, Regra>>> = {
  whatsapp_oficial: { horas: 24, depois: "so_modelo", nome: "O WhatsApp" },
  uazapi: { horas: null, depois: "fechada", nome: "O WhatsApp" },
  instagram: { horas: 24, depois: "fechada", nome: "O Instagram" },
  // CONFIRMADO: 24 h + HUMAN_AGENT até 7 dias (Meta, send-messages, 16/09/2026).
  facebook: { horas: 24, horasAgenteHumano: 168, depois: "fechada", nome: "O Messenger" },
  // CONFERIR-TIKTOK: 48 h (SleekFlow, Qiscus, Chatwoot; doc oficial ilegível em 16/09/2026).
  tiktok: { horas: 48, depois: "fechada", nome: "O TikTok" },
};

const HORA_MS = 3_600_000;

function horasDesde(ultimaEntradaEm: Date, agora: Date): number {
  return (agora.getTime() - ultimaEntradaEm.getTime()) / HORA_MS;
}

/** Provedor fora de `JANELAS` FECHA: canal sem regra não envia. */
export function situacaoDaJanela(
  provedor: string,
  ultimaEntradaEm: Date | null,
  origem: OrigemDoEnvio,
  agora: Date,
): SituacaoDaJanela {
  const regra = JANELAS[provedor as Provedor];
  if (!regra) return "fechada";
  if (regra.horas === null) return "aberta";
  if (!ultimaEntradaEm) return regra.depois;
  const horas = horasDesde(ultimaEntradaEm, agora);
  if (horas <= regra.horas) return "aberta";
  if (regra.horasAgenteHumano !== undefined && horas <= regra.horasAgenteHumano) {
    return origem === "pessoa" ? "so_agente_humano" : "fechada";
  }
  return regra.depois;
}

/** Texto para o composer e para `falha_motivo`. `null` quando a janela está aberta. */
export function mensagemDaJanela(
  provedor: string,
  ultimaEntradaEm: Date | null,
  origem: OrigemDoEnvio,
  agora: Date,
): string | null {
  const situacao = situacaoDaJanela(provedor, ultimaEntradaEm, origem, agora);
  const regra = JANELAS[provedor as Provedor];
  if (situacao === "aberta") return null;
  if (!regra) return "Este canal não permite enviar mensagem.";
  if (situacao === "so_modelo") {
    return "Passaram 24h desde a última mensagem da cliente. Só dá para enviar um modelo aprovado.";
  }
  if (situacao === "so_agente_humano") {
    return "Passaram 24 horas desde a última mensagem da cliente. Sua resposta vai marcada como atendimento humano e só vale até 7 dias depois dela.";
  }
  if (!ultimaEntradaEm) {
    return `A cliente ainda não escreveu por este canal. ${regra.nome} só deixa responder depois que ela escrever.`;
  }
  const horas = horasDesde(ultimaEntradaEm, agora);
  if (regra.horasAgenteHumano !== undefined && horas <= regra.horasAgenteHumano) {
    return `Passaram ${regra.horas} horas desde a última mensagem da cliente. Agora ${regra.nome.replace(/^O /, "o ")} só aceita resposta digitada por alguém da equipe.`;
  }
  const prazo = regra.horasAgenteHumano !== undefined ? "7 dias" : `${regra.horas} horas`;
  return `Passaram ${prazo} desde a última mensagem da cliente. ${regra.nome} só deixa responder quando ela escrever de novo.`;
}

type MidiaAceita = {
  /** `null` = qualquer MIME que a casa aceita. */
  mimes: readonly string[] | null;
  maxBytes: number;
  maxArquivos: number;
  semLegenda: boolean;
  recusa: string;
};

const MB = 1024 * 1024;

export const MIDIA_ACEITA: Readonly<Partial<Record<Provedor, MidiaAceita>>> = {
  // CONFERIR-MESSENGER: 25 MB por anexo (CM.com, 16/09/2026); os tetos da casa cortam antes.
  facebook: {
    mimes: null,
    maxBytes: 25 * MB,
    maxArquivos: 10,
    semLegenda: false,
    recusa: "O Messenger aceita anexos de até 25 MB.",
  },
  // CONFERIR-TIKTOK: uma imagem JPG/PNG de até 3 MB, sem legenda (Chatwoot, 16/09/2026).
  tiktok: {
    mimes: ["image/jpeg", "image/png"],
    maxBytes: 3 * MB,
    maxArquivos: 1,
    semLegenda: true,
    recusa: "O TikTok só aceita uma imagem JPG ou PNG de até 3 MB por mensagem, sem texto junto.",
  },
};

/** Texto da recusa, ou `null`. Provedor fora da tabela: vale só o teto da casa. */
export function recusaDeMidia(
  provedor: string,
  anexos: readonly { mime: string; bytes: number }[],
  temLegenda: boolean,
): string | null {
  const regra = MIDIA_ACEITA[provedor as Provedor];
  if (!regra || anexos.length === 0) return null;
  if (anexos.length > regra.maxArquivos || (regra.semLegenda && temLegenda)) return regra.recusa;
  const invalido = anexos.some(
    (a) => a.bytes > regra.maxBytes || (regra.mimes !== null && !regra.mimes.includes(a.mime.toLowerCase())),
  );
  return invalido ? regra.recusa : null;
}

// CONFERIR-MESSENGER: 2.000 (CM.com). CONFERIR-TIKTOK: sem fonte; 1.000 é baixo de propósito.
export const TEXTO_MAX: Readonly<Partial<Record<Provedor, number>>> = { facebook: 2000, tiktok: 1000 };

/** Recusa de texto longo, ou `null`. Provedor fora da tabela: vale o limite de M1. */
export function recusaDeTexto(provedor: string, texto: string): string | null {
  const max = TEXTO_MAX[provedor as Provedor];
  if (max === undefined || texto.length <= max) return null;
  const regra = JANELAS[provedor as Provedor];
  return `${regra?.nome ?? "Este canal"} aceita até ${max.toLocaleString("pt-BR")} caracteres por mensagem.`;
}
