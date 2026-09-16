import "server-only";
import { ErroDoAplicativo } from "@/lib/erros";
import { logger } from "@/lib/logger";

/**
 * Tradução de erro das duas rotas de mídia. Nada de detalhe interno na
 * resposta; `NAO_ENCONTRADO` (outra loja, inexistente, excluída) é sempre 404.
 */
export function respostaDeErro(erro: unknown, rota: string): Response {
  if (erro instanceof ErroDoAplicativo) {
    return Response.json(
      { codigo: erro.codigo, mensagem: erro.message },
      { status: erro.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  logger.error({ rota, erro: erro instanceof Error ? erro.message : String(erro) }, "rota de mídia falhou");
  return Response.json(
    { codigo: "INESPERADO", mensagem: "Não foi possível concluir. Tente de novo em instantes." },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

export function naoEncontrado(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}
