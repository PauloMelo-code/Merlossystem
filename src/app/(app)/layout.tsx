import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { vivos, vivosE } from "@/lib/db/consultas";
import { alertasVisiveis } from "@/lib/alertas/visibilidade";
import { alertas } from "@/lib/db/schema/alertas";
import { lojas } from "@/lib/db/schema/lojas";
import { usuarios } from "@/lib/db/schema/auth/usuarios";
import { COOKIE_LOJA } from "@/lib/actions/_base";
import {
  ErroFatorObrigatorio,
  ErroNaoAutenticado,
  ErroTrocaObrigatoria,
  exigirSessao,
  pode,
} from "@/lib/auth/guard";
import { ehPapelDeGestao, escopoDeLoja, resolverLojaPedida } from "@/lib/auth/loja";
import { itensVisiveis } from "@/lib/navegacao";
import { rotuloDePapel } from "@/lib/ui/tons";
import { Cabecalho } from "@/components/layout/cabecalho";
import { NavegacaoLateral } from "@/components/layout/navegacao-lateral";
import { TabBar } from "@/components/layout/tab-bar";
import { sair, trocarLojaAtiva } from "./_acoes";

/**
 * Casca do aplicativo (04-ui.md §4.1): skip-link, navegação lateral,
 * cabeçalho de 56 px e `<main id="conteudo">`.
 *
 * O portão roda AQUI e em cada página e action — layout que chama o portão NÃO
 * cobre Server Action nenhuma (N1/N5), porque a action é um POST para a rota
 * onde é usada e não passa por layout.
 *
 * A navegação é filtrada por `pode()` PURO. Nunca `exigirPermissao()` para
 * montar menu: ele grava `recusa_403` e inundaria `auth_eventos` a cada page
 * view.
 */

const LIMITE_DO_SINO = 5;

export default async function LayoutDoAplicativo({ children }: { children: ReactNode }) {
  let sessao;
  try {
    sessao = await exigirSessao();
  } catch (erro) {
    // O proxy já redireciona quem não tem cookie; aqui cai quem tem cookie
    // inválido, expirado ou de sessão encerrada em outro aparelho.
    if (erro instanceof ErroNaoAutenticado) redirect("/entrar?motivo=sessao");
    // Gates de sessão reduzida (02-seguranca.md §9.4): a sessão existe e é
    // válida, mas só alcança o fluxo que falta concluir. Sem estes dois
    // desvios a pessoa recebe a tela de erro em vez do caminho de saída
    // (04-ui.md §7.2).
    if (erro instanceof ErroFatorObrigatorio) redirect("/primeiro-acesso");
    if (erro instanceof ErroTrocaObrigatoria) redirect("/perfil/seguranca");
    throw erro;
  }

  const gestao = ehPapelDeGestao(sessao.papel);
  const pedida = (await cookies()).get(COOKIE_LOJA)?.value;
  const lojaResolvida = await resolverLojaPedida(sessao, pedida);
  const escopo = escopoDeLoja(sessao, lojaResolvida);
  const itens = itensVisiveis((recurso, acao) => pode(sessao.papel, recurso, acao));

  const filtroDoSino = vivosE(
    alertas,
    alertasVisiveis(escopo, sessao.papel),
    isNull(alertas.reconhecido_em),
    isNull(alertas.resolvido_em),
  );

  const [perfil, listaDeLojas, ultimos, contagem] = await Promise.all([
    db
      .select({ nome: usuarios.nome, avatarUrl: usuarios.avatar_url })
      .from(usuarios)
      .where(eq(usuarios.id, sessao.usuarioId))
      .limit(1),
    // Vendedor e viewer só enxergam a própria loja: o chip do cabeçalho mostra
    // o nome dela, e nunca a lista da rede.
    db
      .select({ id: lojas.id, nome: lojas.nome })
      .from(lojas)
      .where(gestao ? vivos(lojas) : vivosE(lojas, eq(lojas.id, sessao.lojaId ?? "")))
      .orderBy(lojas.nome),
    db
      .select({
        id: alertas.id,
        tipo: alertas.tipo,
        severidade: alertas.severidade,
        titulo: alertas.mensagem,
        conversaId: alertas.conversa_id,
        pedidoId: alertas.pedido_id,
        contatoId: alertas.contato_id,
        criadoEm: alertas.created_at,
      })
      .from(alertas)
      .where(filtroDoSino)
      .orderBy(desc(alertas.created_at))
      .limit(LIMITE_DO_SINO),
    db.select({ total: sql<number>`count(*)::int` }).from(alertas).where(filtroDoSino),
  ]);

  return (
    <div className="flex h-dvh flex-col">
      {/* Primeiro elemento focável da página (§11.1). */}
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
      >
        Ir para o conteúdo
      </a>

      <Cabecalho
        itens={itens}
        usuario={{
          nome: perfil[0]?.nome ?? "Sua conta",
          papelRotulo: rotuloDePapel(sessao.papel),
          avatarUrl: perfil[0]?.avatarUrl ?? null,
        }}
        lojas={listaDeLojas}
        lojaAtiva={escopo.tipo === "uma" ? escopo.lojaId : null}
        podeTrocarLoja={gestao}
        alertas={{
          contador: contagem[0]?.total ?? 0,
          ultimos: ultimos.map((alerta) => ({
            ...alerta,
            criadoEm: alerta.criadoEm.toISOString(),
          })),
        }}
        gravarLojaAtiva={trocarLojaAtiva}
        sair={sair}
      />

      <div className="flex min-h-0 flex-1">
        <NavegacaoLateral itens={itens} />
        <main id="conteudo" className="min-w-0 flex-1 overflow-y-auto pb-16 md:pb-0">
          {children}
        </main>
      </div>

      <TabBar itens={itens} />
    </div>
  );
}
