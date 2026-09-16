import { logger } from "@/lib/logger";
import { rotaPublica } from "@/lib/seguranca/maquina";

/**
 * Coletor do `Content-Security-Policy-Report-Only` (02-seguranca.md §14.2).
 *
 * A CSP em ENFORCE ja vale desde a primeira entrega; a Report-Only roda em
 * paralelo so para endurecer (`strict-dynamic` e `style-src` sem inline). Este
 * coletor existe para essa prova e por isso NAO persiste nada: relatorio de
 * CSP vem do navegador de qualquer pessoa da internet, e virar tabela e virar
 * superficie de escrita anonima.
 */

const coletar = rotaPublica({
  motivo: "coletor do Content-Security-Policy-Report-Only, sem persistencia longa",
  limite: { janela: 60, max: 60 },
  maxBytes: 16 * 1024,
  handler: (_req, corpoCru) => {
    // So o que serve para endurecer a politica. Nada do corpo vai para banco.
    logger.info({ relatorio: corpoCru.slice(0, 2_000) }, "violacao de CSP (report-only)");
    return new Response(null, { status: 204 });
  },
});

export async function POST(req: Request): Promise<Response> {
  return coletar(req);
}
