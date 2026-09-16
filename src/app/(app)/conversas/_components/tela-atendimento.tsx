import { Suspense, type ReactNode } from "react";
import { EsqueletoListaConversas } from "@/components/comum/esqueletos/esqueleto-lista-conversas";
import { EstadoErro } from "@/components/comum/estado-erro";
import { listarConversas, opcoesDosFiltros } from "@/lib/actions/conversas";
import { cn } from "cn";
import { FiltrosConversas } from "./filtros-conversas";
import { ListaConversas } from "./lista-conversas";
import { ProvedorTempoReal } from "./tempo-real";

/**
 * Casca das duas rotas de conversas (04-ui.md §5.2): lista | conversa | painel,
 * com `Suspense` independentes — nunca tela em branco. No celular, com
 * conversa aberta, só a conversa aparece (a lista volta pelo botão do topo).
 */

export type ParametrosDaLista = Record<string, string | string[] | undefined>;

export function filtrosDaUrl(sp: ParametrosDaLista): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(sp)) {
    const v = Array.isArray(valor) ? valor[0] : valor;
    if (typeof v === "string") saida[chave] = v;
  }
  return saida;
}

export function mensagemDeFalha(codigo: string, mensagem: string): { titulo: string; descricao: string } {
  if (codigo === "SEM_PERMISSAO") {
    return { titulo: "Você não tem acesso a esta área.", descricao: "Fale com o administrador." };
  }
  return { titulo: "Não foi possível carregar as conversas.", descricao: mensagem };
}

async function ColunaLista({ filtros, selecionadaId }: { filtros: Record<string, string>; selecionadaId: string | null }) {
  const [pagina, opcoes] = await Promise.all([listarConversas(filtros), opcoesDosFiltros()]);
  if (!pagina.ok) {
    const f = mensagemDeFalha(pagina.codigo, pagina.mensagem);
    return <EstadoErro titulo={f.titulo} descricao={f.descricao} />;
  }
  const chave = new URLSearchParams(filtros).toString();
  return (
    <>
      <FiltrosConversas
        opcoes={opcoes.ok ? opcoes.dados : { contas: [], etiquetas: [] }}
        semResposta={pagina.dados.semResposta}
      />
      <ListaConversas key={chave} inicial={pagina.dados} selecionadaId={selecionadaId} />
    </>
  );
}

export function TelaAtendimento({
  filtros,
  selecionadaId,
  children,
}: {
  filtros: Record<string, string>;
  selecionadaId: string | null;
  children: ReactNode;
}) {
  return (
    <ProvedorTempoReal>
      <div className="flex h-full min-h-0">
        <div
          className={cn(
            "min-h-0 w-full flex-col border-r border-border bg-card md:flex md:w-88 md:shrink-0",
            selecionadaId ? "hidden" : "flex",
          )}
        >
          <Suspense fallback={<EsqueletoListaConversas />}>
            <ColunaLista filtros={filtros} selecionadaId={selecionadaId} />
          </Suspense>
        </div>
        <div className={cn("min-h-0 min-w-0 flex-1 flex-col", selecionadaId ? "flex" : "hidden md:flex")}>
          {children}
        </div>
      </div>
    </ProvedorTempoReal>
  );
}
