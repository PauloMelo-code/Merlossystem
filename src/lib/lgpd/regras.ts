import type { TipoConsentimento } from "@/lib/db/schema/_enums/auditoria";

/**
 * Regras PURAS de consentimento (01-dados-dominio.md §7.2). Sem banco, sem
 * `server-only`: a unidade testa direto.
 */

/**
 * Versão do texto que a pessoa aceitou/recusou. Trocar o texto = trocar esta
 * constante: é ela que prova O QUE foi aceito.
 */
export const TERMO_VIGENTE = "marketing-v1";

/**
 * O espelho em função da linha nova. Opt-out é de MARKETING: só os tipos de
 * marketing mexem nele; `tratamento_dados` não (devolve `null` = não muda).
 *
 *   marketing  concedido=true  -> aceita promoção   -> opt_out = false
 *   marketing  concedido=false -> recusa promoção   -> opt_out = true
 *   opt_out    concedido=true  -> pediu para sair   -> opt_out = true
 *   opt_in     concedido=true  -> pediu para voltar -> opt_out = false
 *   (opt_out/opt_in com concedido=false invertem o próprio pedido)
 */
export function optOutDe(tipo: TipoConsentimento, concedido: boolean): boolean | null {
  switch (tipo) {
    case "marketing":
    case "opt_in":
      return !concedido;
    case "opt_out":
      return concedido;
    case "tratamento_dados":
      return null;
  }
}

