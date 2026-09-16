import type { Metadata } from "next";
import { EstadoErro } from "@/components/comum/estado-erro";
import { PaginacaoCursor } from "@/components/comum/paginacao-cursor";
import { eventoDaTrilha, trilhaDeNegocio } from "@/lib/actions/auditoria";
import { DetalheEvento } from "./_components/detalhe-evento";
import { FormularioFiltros } from "./_components/formulario-filtros";
import { TabelaTrilha } from "./_components/tabela-trilha";
import { um, urlCom, type Parametros } from "./_components/url";

export const metadata: Metadata = { title: "Auditoria" };

/**
 * `/auditoria` — trilha de negócio (`auditoria_eventos`), chave `trilha:ler`
 * (04-ui.md §5.5). Página por cursor `(criado_em, id)`, filtros por pessoa,
 * ação, período e registro. O detalhe abre por `?evento=` com o diff campo a
 * campo; campo PII aparece como "(alterado)".
 */
export default async function PaginaTrilha({ searchParams }: { searchParams: Promise<Parametros> }) {
  const p = await searchParams;
  const filtros = {
    pessoa: um(p.pessoa),
    acao: um(p.acao),
    entidade: um(p.entidade),
    entidadeId: um(p.entidadeId),
    de: um(p.de),
    ate: um(p.ate),
  };
  const eventoId = um(p.evento);
  const [resultado, detalhe] = await Promise.all([
    trilhaDeNegocio({ ...filtros, cursor: um(p.cursor), direcao: um(p.direcao), porPagina: um(p.porPagina) }),
    eventoId ? eventoDaTrilha({ id: eventoId }) : Promise.resolve(null),
  ]);

  if (!resultado.ok) {
    return <EstadoErro titulo="Não foi possível abrir a trilha." descricao={resultado.mensagem} />;
  }
  const { pagina, pessoas, acoes, porPagina } = resultado.dados;
  const pessoaDe = (atorTipo: string, atorNome: string | null) =>
    atorNome ?? (atorTipo === "usuario" ? "Pessoa sem cadastro" : atorTipo === "integracao" ? "Integração" : "Sistema");
  const comFiltro = Object.values(filtros).some(Boolean);

  return (
    <>
      <FormularioFiltros
        destino="/auditoria"
        campos={[
          {
            tipo: "lista",
            nome: "pessoa",
            rotulo: "Pessoa",
            vazio: "Todas",
            valor: filtros.pessoa,
            opcoes: pessoas.map((pessoa) => ({ valor: pessoa.id, rotulo: pessoa.nome })),
          },
          { tipo: "lista", nome: "acao", rotulo: "Ação", vazio: "Todas", valor: filtros.acao, opcoes: acoes },
          { tipo: "data", nome: "de", rotulo: "De", valor: filtros.de },
          { tipo: "data", nome: "ate", rotulo: "Até", valor: filtros.ate },
          { tipo: "oculto", nome: "entidade", valor: filtros.entidade },
          { tipo: "oculto", nome: "entidadeId", valor: filtros.entidadeId },
        ]}
      />

      {filtros.entidadeId ? (
        <p className="text-denso text-muted-foreground">
          Mostrando só o histórico de um registro ({filtros.entidade ?? "registro"}{" "}
          <code className="font-mono">{filtros.entidadeId.slice(0, 8)}</code>).
        </p>
      ) : null}

      {detalhe && !detalhe.ok ? (
        <EstadoErro titulo="Evento não encontrado." descricao={detalhe.mensagem} />
      ) : null}
      {detalhe?.ok ? (
        <DetalheEvento
          titulo={detalhe.dados.acaoRotulo}
          quando={detalhe.dados.criadoEm.toISOString()}
          hrefFechar={urlCom("/auditoria", p, { evento: undefined })}
          linhas={[
            { rotulo: "Pessoa", valor: pessoaDe(detalhe.dados.atorTipo, detalhe.dados.atorNome) },
            { rotulo: "Registro", valor: `${detalhe.dados.entidadeRotulo} ${detalhe.dados.entidadeId ?? ""}`.trim() },
            { rotulo: "Motivo", valor: detalhe.dados.motivo },
            ...Object.entries(detalhe.dados.detalhes).map(([chave, valor]) => ({
              rotulo: chave,
              valor: valor === null ? null : String(valor),
            })),
          ]}
          diff={detalhe.dados.diff}
        />
      ) : null}

      <TabelaTrilha
        comFiltro={comFiltro}
        eventos={pagina.itens.map((e) => ({
          id: e.id,
          criadoEm: e.criadoEm.toISOString(),
          pessoa: pessoaDe(e.atorTipo, e.atorNome),
          acao: e.acaoRotulo,
          entidade: e.entidadeRotulo,
          entidadeId: e.entidadeId,
          hrefDetalhe: urlCom("/auditoria", p, { evento: e.id }),
        }))}
      />

      <PaginacaoCursor cursorAnterior={pagina.cursorAnterior} cursorProximo={pagina.cursorProximo} porPagina={porPagina} />
    </>
  );
}
