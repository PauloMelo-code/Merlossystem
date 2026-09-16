import type { Metadata } from "next";
import { BarraFerramentas } from "@/components/comum/barra-ferramentas";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { EstadoErro } from "@/components/comum/estado-erro";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { PaginacaoCursor } from "@/components/comum/paginacao-cursor";
import { listarContatos } from "@/lib/actions/contatos";
import { exigirSessao, pode } from "@/lib/auth/guard";
import { FiltrosContatos } from "./_components/filtros-contatos";
import { ListaContatos, type ItemCarteira } from "./_components/lista-contatos";
import { PainelContato } from "./_components/painel-contato";

export const metadata: Metadata = { title: "Contatos" };

/**
 * `/contatos` — a carteira da loja (04-ui.md §5.3). Permissão `contatos:ler`,
 * conferida DENTRO da action (o layout não cobre action nenhuma).
 *
 * Filtros, busca e cursor vêm da URL; o servidor busca já filtrado. A escrita
 * (`contatos:criar|editar`) só aparece para quem pode. O contato novo nasce na
 * loja resolvida pela action (cookie de gestão, ou o cadastro da vendedora);
 * em "Todas as lojas" o botão some, porque não existe gravação sem loja.
 */

type Busca = Promise<Record<string, string | string[] | undefined>>;

function simples(bruto: Record<string, string | string[] | undefined>): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(bruto)) {
    if (typeof valor === "string") saida[chave] = valor;
  }
  return saida;
}

export default async function PaginaContatos({ searchParams }: { searchParams: Busca }) {
  const sessao = await exigirSessao();
  const parametros = simples(await searchParams);
  const resultado = await listarContatos(parametros);

  if (!resultado.ok) {
    return (
      <div className="p-4 md:p-6">
        <EstadoErro
          titulo={
            resultado.codigo === "SEM_PERMISSAO"
              ? "Você não tem acesso a esta área. Fale com o administrador."
              : "Não foi possível carregar os contatos."
          }
          descricao={resultado.codigo === "SEM_PERMISSAO" ? "" : "Recarregue a página em instantes."}
        />
      </div>
    );
  }

  const pagina = resultado.dados;
  const itens: ItemCarteira[] = pagina.itens.map((c) => ({
    id: c.id,
    lojaId: c.lojaId,
    lojaNome: c.lojaNome,
    nome: c.nome,
    telefone: c.telefone,
    email: c.email,
    canal: c.whatsappId ? "whatsapp" : c.instagramId ? "instagram" : null,
    optOut: c.optOut,
    ultimoContatoEm: c.ultimoContatoEm ? c.ultimoContatoEm.toISOString() : null,
    pedidosContagem: c.pedidosContagem,
    anonimizado: c.anonimizadoEm !== null,
  }));

  const podeCriar = pode(sessao.papel, "contatos", "criar");
  const filtrou = Boolean(parametros.busca || parametros.etiqueta || parametros.optOut);
  const porPagina = Number(parametros.porPagina) || 50;
  const contagem = `${pagina.total} ${pagina.total === 1 ? "contato" : "contatos"}${
    pagina.variasLojas ? " em todas as lojas" : ""
  }`;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <CabecalhoPagina
        titulo="Contatos"
        descricao="A carteira é de cada loja: a mesma cliente nas duas lojas aparece como dois contatos."
        acoes={podeCriar && !pagina.variasLojas ? <PainelContato /> : undefined}
      />

      <BarraFerramentas
        busca={{ parametro: "busca", placeholder: "Buscar nome ou telefone" }}
        filtros={<FiltrosContatos etiquetas={pagina.etiquetas} />}
        contagem={contagem}
      />

      <ListaContatos
        itens={itens}
        variasLojas={pagina.variasLojas}
        etiquetas={pagina.etiquetas}
        podeEtiquetar={pode(sessao.papel, "contatos", "editar")}
        vazio={
          filtrou ? (
            <EstadoVazio
              titulo="Nenhum contato com esses filtros."
              descricao="Confira a grafia ou busque pelo telefone, com DDD."
            />
          ) : (
            <EstadoVazio
              titulo="Nenhum contato nesta loja ainda."
              descricao="Os contatos aparecem sozinhos quando alguém escreve para a loja."
            />
          )
        }
      />

      <PaginacaoCursor
        cursorAnterior={pagina.cursorAnterior}
        cursorProximo={pagina.cursorProximo}
        porPagina={porPagina}
      />
    </div>
  );
}
