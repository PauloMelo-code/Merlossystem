import type { Metadata } from "next";
import { EstadoErro } from "@/components/comum/estado-erro";
import { PaginacaoCursor } from "@/components/comum/paginacao-cursor";
import { eventoDeAcesso, trilhaDeAcesso } from "@/lib/actions/auditoria";
import { TIPOS_AUTH_EVENTO } from "@/lib/db/schema/_enums/auth";
import { DetalheEvento } from "../_components/detalhe-evento";
import { FormularioFiltros } from "../_components/formulario-filtros";
import { TabelaAcessos } from "../_components/tabela-acessos";
import { humanizar, um, urlCom, type Parametros } from "../_components/url";

export const metadata: Metadata = { title: "Acessos · Auditoria" };

/**
 * `/auditoria/seguranca` — trilha de ACESSO (`auth_eventos`), chave
 * `seguranca:ler_eventos` (04-ui.md §5.5, 02-seguranca.md §17.8). O gerente
 * não alcança: a action recusa e grava a recusa.
 *
 * E-mail só como hash; IP e navegador só no detalhe.
 */
export default async function PaginaAcessos({ searchParams }: { searchParams: Promise<Parametros> }) {
  const p = await searchParams;
  const filtros = { pessoa: um(p.pessoa), tipo: um(p.tipo), de: um(p.de), ate: um(p.ate) };
  const eventoId = um(p.evento);
  const [resultado, detalhe] = await Promise.all([
    trilhaDeAcesso({ ...filtros, cursor: um(p.cursor), direcao: um(p.direcao), porPagina: um(p.porPagina) }),
    eventoId ? eventoDeAcesso({ id: eventoId }) : Promise.resolve(null),
  ]);

  if (!resultado.ok) {
    return <EstadoErro titulo="Não foi possível abrir a trilha de acesso." descricao={resultado.mensagem} />;
  }
  const { pagina, pessoas, porPagina } = resultado.dados;
  const d = detalhe?.ok ? detalhe.dados : null;

  return (
    <>
      <FormularioFiltros
        destino="/auditoria/seguranca"
        campos={[
          {
            tipo: "lista",
            nome: "pessoa",
            rotulo: "Pessoa",
            vazio: "Todas",
            valor: filtros.pessoa,
            opcoes: pessoas.map((pessoa) => ({ valor: pessoa.id, rotulo: pessoa.nome })),
          },
          {
            tipo: "lista",
            nome: "tipo",
            rotulo: "Evento",
            vazio: "Todos",
            valor: filtros.tipo,
            opcoes: TIPOS_AUTH_EVENTO.map((t) => ({ valor: t, rotulo: humanizar(t) })),
          },
          { tipo: "data", nome: "de", rotulo: "De", valor: filtros.de },
          { tipo: "data", nome: "ate", rotulo: "Até", valor: filtros.ate },
        ]}
      />

      {detalhe && !detalhe.ok ? (
        <EstadoErro titulo="Evento não encontrado." descricao={detalhe.mensagem} />
      ) : null}
      {d ? (
        <DetalheEvento
          titulo={humanizar(d.tipo)}
          quando={d.criadoEm.toISOString()}
          hrefFechar={urlCom("/auditoria/seguranca", p, { evento: undefined })}
          linhas={[
            { rotulo: "Resultado", valor: humanizar(d.resultado) },
            { rotulo: "Meio", valor: d.meio },
            { rotulo: "Pessoa", valor: d.usuarioNome ?? d.usuarioId },
            { rotulo: "E-mail (hash)", valor: d.emailHash },
            { rotulo: "Executado por", valor: d.atorNome ?? d.atorId ?? (d.atorTipo === "usuario" ? null : humanizar(d.atorTipo)) },
            { rotulo: "Alvo", valor: d.alvoNome ?? d.alvoId },
            { rotulo: "Motivo", valor: d.motivo },
            { rotulo: "IP", valor: d.ip },
            { rotulo: "Navegador", valor: d.agente },
            { rotulo: "Sessão", valor: d.sessaoId },
            ...Object.entries(d.detalhes).map(([chave, valor]) => ({
              rotulo: chave,
              valor: valor === null ? null : String(valor),
            })),
          ]}
        />
      ) : null}

      <TabelaAcessos
        comFiltro={Object.values(filtros).some(Boolean)}
        eventos={pagina.itens.map((e) => ({
          id: e.id,
          criadoEm: e.criadoEm.toISOString(),
          tipo: humanizar(e.tipo),
          resultado: e.resultado,
          pessoa: e.usuarioNome ?? (e.emailHash ? `hash ${e.emailHash.slice(0, 12)}…` : humanizar(e.atorTipo)),
          hrefDetalhe: urlCom("/auditoria/seguranca", p, { evento: e.id }),
        }))}
      />

      <PaginacaoCursor cursorAnterior={pagina.cursorAnterior} cursorProximo={pagina.cursorProximo} porPagina={porPagina} />
    </>
  );
}
