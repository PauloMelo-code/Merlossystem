import type { Metadata } from "next";
import { EstadoErro } from "@/components/comum/estado-erro";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { PaginacaoCursor } from "@/components/comum/paginacao-cursor";
import { registrosExcluidos } from "@/lib/actions/auditoria";
import { ENTIDADES_EXCLUIVEIS } from "@/lib/validadores/auditoria";
import { FormularioFiltros } from "../_components/formulario-filtros";
import { TabelaExcluidos } from "../_components/tabela-excluidos";
import { um, type Parametros } from "../_components/url";

export const metadata: Metadata = { title: "Excluídos · Auditoria" };

const ROTULOS: Readonly<Record<(typeof ENTIDADES_EXCLUIVEIS)[number], string>> = {
  contatos: "Contatos",
  pedidos: "Pedidos",
  campanhas: "Campanhas",
  respostas_rapidas: "Respostas rápidas",
  conversas_agendamentos: "Mensagens agendadas",
  lojas_midias: "Galeria",
  lojas_etiquetas: "Etiquetas",
  lojas_integracoes: "Integrações",
};

/**
 * `/auditoria/excluidos` — SOMENTE LEITURA (04-ui.md §5.5). Não existe
 * "restaurar" no R1 (R-01): a tela diz isso em vez de esconder.
 */
export default async function PaginaExcluidos({ searchParams }: { searchParams: Promise<Parametros> }) {
  const p = await searchParams;
  const filtros = { entidade: um(p.entidade), de: um(p.de), ate: um(p.ate) };
  const resultado = await registrosExcluidos({
    ...filtros,
    cursor: um(p.cursor),
    direcao: um(p.direcao),
    porPagina: um(p.porPagina),
  });

  if (!resultado.ok) {
    return <EstadoErro titulo="Não foi possível abrir os excluídos." descricao={resultado.mensagem} />;
  }
  const { pagina, porPagina } = resultado.dados;
  const entidade = pagina.itens[0]?.entidade ?? filtros.entidade ?? "contatos";

  return (
    <>
      <FaixaAviso
        tom="neutro"
        titulo="Registros excluídos não são restaurados por esta tela."
        descricao="Toda exclusão é lógica: o registro continua guardado, com quem excluiu e quando. Para recuperar algo, fale com o administrador."
      />

      <FormularioFiltros
        destino="/auditoria/excluidos"
        campos={[
          {
            tipo: "lista",
            nome: "entidade",
            rotulo: "Tipo de registro",
            vazio: "Contatos",
            valor: filtros.entidade === "contatos" ? undefined : filtros.entidade,
            opcoes: ENTIDADES_EXCLUIVEIS.filter((e) => e !== "contatos").map((e) => ({
              valor: e,
              rotulo: ROTULOS[e],
            })),
          },
          { tipo: "data", nome: "de", rotulo: "Excluído de", valor: filtros.de },
          { tipo: "data", nome: "ate", rotulo: "Até", valor: filtros.ate },
        ]}
      />

      <TabelaExcluidos
        rotuloDaEntidade={ROTULOS[entidade as keyof typeof ROTULOS] ?? "Registros"}
        comPeriodo={Boolean(filtros.de || filtros.ate)}
        registros={pagina.itens.map((r) => ({
          id: r.id,
          rotulo: r.rotulo,
          excluidoEm: r.excluidoEm.toISOString(),
          excluidoPor: r.excluidoPorNome ?? (r.excluidoPor ? "Pessoa sem cadastro" : "Sistema"),
          hrefTrilha: `/auditoria?entidade=${r.entidade}&entidadeId=${r.id}`,
        }))}
      />

      <PaginacaoCursor cursorAnterior={pagina.cursorAnterior} cursorProximo={pagina.cursorProximo} porPagina={porPagina} />
    </>
  );
}
