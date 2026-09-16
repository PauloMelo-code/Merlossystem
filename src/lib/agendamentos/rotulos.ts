import { GATILHOS_PROMOCIONAIS, type GatilhoAgendamento } from "@/lib/db/schema/_enums/conversas";

/** Rótulos dos motivos de agendamento (módulo PURO, lido pela tela). */
export const ROTULO_GATILHO: Readonly<Record<GatilhoAgendamento, string>> = {
  manual: "Envio manual",
  follow_up: "Retorno combinado",
  pos_venda: "Pós-venda",
  aniversario: "Aniversário",
  promocao: "Promoção",
  reativacao: "Reativação",
  abandono: "Carrinho abandonado",
};

export function respeitaOptOut(gatilho: string): boolean {
  return (GATILHOS_PROMOCIONAIS as readonly string[]).includes(gatilho);
}

/**
 * `datetime-local` não tem fuso: "14:30" é a hora de QUEM digitou. Converter no
 * navegador evita que o servidor (em UTC) leia 14:30 UTC.
 */
export function localParaIso(valor: string): string {
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? "" : data.toISOString();
}

/** O inverso, para preencher o campo com o horário atual da linha. */
export function isoParaLocal(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
