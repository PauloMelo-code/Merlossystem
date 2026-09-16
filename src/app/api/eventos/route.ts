import { exigirSessao } from "@/lib/auth/guard";
import { escopoDoCookie } from "@/lib/auth/loja";
import { motivoParaFecharFluxo } from "@/lib/conversas";
import { ErroDoAplicativo } from "@/lib/erros";
import { abrirFluxo } from "@/server/sse";

/**
 * `GET /api/eventos` — stream SSE do atendimento (03-arquitetura.md §5, §9).
 *
 * Portão: `exigirSessao()` SEM renovar atividade (senão a inatividade de
 * 60 min nunca chegaria para quem só deixou a aba aberta), e a sessão é
 * reavaliada a cada heartbeat de 25 s por `motivoParaFecharFluxo`. O escopo de
 * loja é o mesmo das telas: vendedora recebe só a loja dela; gestão, a loja
 * escolhida no seletor ou todas.
 *
 * O evento não carrega conteúdo: a tela busca o dado pela action.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  let sessao;
  try {
    sessao = await exigirSessao({ renovaAtividade: false });
  } catch (erro) {
    if (erro instanceof ErroDoAplicativo) {
      return new Response(null, { status: erro.status, headers: { "cache-control": "no-store" } });
    }
    throw erro;
  }

  // Porta única do cookie de loja (T13): loja morta cai no escopo padrão do papel.
  const escopo = await escopoDoCookie(sessao);
  const abertaEm = new Date();

  return abrirFluxo(req, sessao, {
    escopo,
    reavaliar: () => motivoParaFecharFluxo(sessao, abertaEm),
  });
}
