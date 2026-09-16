import { cookies } from "next/headers";
import { env } from "@/lib/env";
import {
  ErroNaoAutenticado,
  contextoDe,
  exigirPermissao,
  exigirSessao,
  ipDaRequisicao,
} from "@/lib/auth/guard";
import { ErroDoAplicativo } from "@/lib/erros";
import { logger } from "@/lib/logger";
import { COOKIE_NONCE, concluirAutorizacaoBling } from "@/lib/integracoes";
import { chaveDeIp } from "@/lib/seguranca/ip";
import { limitarPorIp } from "@/lib/seguranca/limite";
import { callbackOAuthSchema } from "@/lib/validadores/integracoes";

/**
 * Retorno do OAuth do Bling (02-seguranca.md §12; 03-arquitetura.md §5).
 *
 * Portão próprio: sessão viva de quem PODE conectar, `state` assinado, de uso
 * único, com prazo de 5 min e amarrado ao cookie `__Host-merlo.oauth_nonce`.
 * O `code` nunca sai do servidor. Toda saída é redirecionamento para a tela,
 * com um código curto — nunca o motivo técnico.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TELA = "/configuracoes/integracoes";

function voltar(caminho: string, resultado: string): Response {
  const destino = new URL(caminho, env.APP_URL);
  if (resultado) destino.searchParams.set("bling", resultado);
  return new Response(null, {
    status: 303,
    headers: { location: destino.toString(), "cache-control": "no-store" },
  });
}

export async function GET(req: Request): Promise<Response> {
  const ip = await ipDaRequisicao();
  const veredito = await limitarPorIp("oauth-bling", chaveDeIp(ip), { janela: 60, max: 20 });
  if (!veredito.permitido) return new Response(null, { status: 429, headers: { "cache-control": "no-store" } });

  const jarra = await cookies();
  const nonce = jarra.get(COOKIE_NONCE)?.value ?? null;
  // O cookie é de uso único, dê certo ou não.
  jarra.delete(COOKIE_NONCE);

  let sessao;
  try {
    sessao = await exigirSessao();
    exigirPermissao(sessao, "integracoes:conectar");
  } catch (erro) {
    if (erro instanceof ErroNaoAutenticado) return voltar("/entrar", "");
    return voltar(TELA, "sem-permissao");
  }

  const q = new URL(req.url).searchParams;
  if (q.get("error")) return voltar(TELA, "negado");
  const entrada = callbackOAuthSchema.safeParse({ code: q.get("code"), state: q.get("state") });
  if (!entrada.success) return voltar(TELA, "invalido");

  try {
    await concluirAutorizacaoBling({
      sessao,
      ctx: contextoDe(sessao),
      code: entrada.data.code,
      state: entrada.data.state,
      nonceDoCookie: nonce,
    });
    return voltar(TELA, "conectado");
  } catch (erro) {
    const codigo = erro instanceof ErroDoAplicativo ? erro.codigo : "INESPERADO";
    if (!(erro instanceof ErroDoAplicativo)) logger.error({ erro: String(erro) }, "callback do Bling falhou");
    return voltar(TELA, codigo === "OAUTH_RECUSADO" ? "expirado" : "falhou");
  }
}
