import "server-only";
import { exigirPermissao, exigirSessao, pode, type Sessao } from "@/lib/auth/guard";
import type { ChavePermissao } from "@/lib/auth/permissoes";
import { escopoDoCookie, type EscopoLoja } from "@/lib/auth/loja";

/**
 * Abertura comum das páginas do M6: portão, permissão da tela e escopo de loja
 * (o layout de `(app)` não substitui o portão da página — N1/N5).
 *
 * A loja escolhida sai de `escopoDoCookie()`, a porta única de leitura do
 * cookie de preferência (T13). `lojaId` é `null` quando a gestão está em
 * "Todas as lojas": a tela lê a rede e esconde o que GRAVA, com o aviso para
 * escolher uma loja.
 */
export async function abrirPagina(chave: ChavePermissao): Promise<{
  sessao: Sessao;
  escopo: EscopoLoja;
  lojaId: string | null;
  permite: (chave: ChavePermissao) => boolean;
}> {
  const sessao = await exigirSessao();
  exigirPermissao(sessao, chave);
  const escopo = await escopoDoCookie(sessao);
  const permite = (c: ChavePermissao) => {
    const [recurso = "", acao = ""] = c.split(":", 2);
    return pode(sessao.papel, recurso, acao);
  };
  return { sessao, escopo, lojaId: escopo.tipo === "uma" ? escopo.lojaId : null, permite };
}

/** `searchParams` do Next chega como `string | string[] | undefined`. */
export function parametro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}
