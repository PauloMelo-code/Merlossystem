/**
 * COSTURA — dono: R2-B; renderizada por M4 em /pedidos/[id]. Ilha de
 * servidor: busca a própria seção pela action (portão reaplicado). Até o R2-B
 * preencher, não mostra nada — mostrar cobrança sem backend seria fachada.
 */
export async function SecaoPagamento(_props: { pedidoId: string }) {
  return null;
}

/** Fallback do `Suspense` que M4 usa em volta da seção. */
export function EsqueletoSecaoPagamento() {
  return null;
}
