import { OPERACAO, type MapaPermissao } from "./_papeis";

/**
 * Cobrança por Pix e link (R2-B, ADRs 0040–0045).
 *
 * NÃO existe `pagamentos:marcar_pago`: só o provedor confirma (ADR 0042).
 * `cancelar_cobranca` é exceção escrita de INV-20: cancelar cobrança pendente
 * não move dinheiro, consulta o provedor antes e é o caminho para trocar de
 * método (ADR 0043).
 */
export const PAGAMENTOS: MapaPermissao = {
  "pagamentos:ler": OPERACAO,
  "pagamentos:gerar_cobranca": OPERACAO,
  "pagamentos:cancelar_cobranca": OPERACAO,
};
