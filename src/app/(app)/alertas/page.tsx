import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { EstadoErro } from "@/components/comum/estado-erro";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { PaginacaoCursor } from "@/components/comum/paginacao-cursor";
import { centralDeAlertas } from "@/lib/actions/alertas";
import { SEVERIDADES, TIPOS_ALERTA } from "@/lib/db/schema/_enums/plataforma";
import { tomDe } from "@/lib/ui/tons";
import { FormularioFiltros } from "../auditoria/_components/formulario-filtros";
import { ListaAlertas } from "./_components/lista-alertas";

export const metadata: Metadata = { title: "Alertas" };

type Parametros = Promise<Record<string, string | string[] | undefined>>;

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/alertas` — central de alertas (04-ui.md §5.5). Chave `alertas:ler`;
 * `alertas:reconhecer` para agir.
 *
 * Sem botão "verificar agora": quem verifica é o job `gerar-alertas`, a cada
 * 15 min. Os prazos de SLA aparecem como TEXTO, porque são constante no código
 * — `/configuracoes/sla` não existe (U8).
 */
export default async function PaginaAlertas({ searchParams }: { searchParams: Parametros }) {
  const p = await searchParams;
  const filtros = { tipo: um(p.tipo), severidade: um(p.severidade), reconhecido: um(p.reconhecido) };
  const resultado = await centralDeAlertas({
    ...filtros,
    cursor: um(p.cursor),
    direcao: um(p.direcao),
    porPagina: um(p.porPagina),
  });

  if (!resultado.ok) {
    return (
      <div className="p-4 md:p-6">
        <EstadoErro titulo="Não foi possível abrir os alertas." descricao={resultado.mensagem} />
      </div>
    );
  }
  const { pagina, contadores, porPagina, podeReconhecer, prazosSla } = resultado.dados;

  return (
    <div className="flex w-full flex-col gap-6 p-4 md:p-6">
      <CabecalhoPagina
        titulo="Alertas"
        descricao={`${contadores.abertos} abertos · ${contadores.naoReconhecidos} sem ciência · ${contadores.criticos} críticos`}
      />

      <FaixaAviso
        tom="info"
        titulo="Quem resolve o alerta é o sistema."
        descricao={`"Reconhecer" só registra que você viu. O alerta some sozinho quando o problema deixa de existir (conversa respondida, número reconectado, agendada enviada). Prazos de primeira resposta: ${prazosSla}.`}
      />

      <FormularioFiltros
        destino="/alertas"
        campos={[
          {
            tipo: "lista",
            nome: "tipo",
            rotulo: "Tipo",
            vazio: "Todos os tipos",
            valor: filtros.tipo,
            opcoes: TIPOS_ALERTA.map((t) => ({ valor: t, rotulo: tomDe("tipo_alerta", t)?.rotulo ?? t })),
          },
          {
            tipo: "lista",
            nome: "severidade",
            rotulo: "Severidade",
            vazio: "Todas",
            valor: filtros.severidade,
            opcoes: SEVERIDADES.map((s) => ({ valor: s, rotulo: tomDe("severidade", s)?.rotulo ?? s })),
          },
          {
            tipo: "lista",
            nome: "reconhecido",
            rotulo: "Ciência",
            vazio: "Todos",
            valor: filtros.reconhecido,
            opcoes: [
              { valor: "nao", rotulo: "Sem ciência" },
              { valor: "sim", rotulo: "Reconhecidos" },
            ],
          },
          { tipo: "oculto", nome: "porPagina", valor: um(p.porPagina) },
        ]}
      />

      <ListaAlertas
        podeReconhecer={podeReconhecer}
        comFiltro={Boolean(filtros.tipo || filtros.severidade || filtros.reconhecido)}
        alertas={pagina.itens.map((a) => ({
          id: a.id,
          tipo: a.tipo,
          severidade: a.severidade,
          mensagem: a.mensagem,
          rota: a.rota,
          criadoEm: a.criadoEm.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
          reconhecidoEm: a.reconhecidoEm?.toISOString() ?? null,
          reconhecidoPor: a.reconhecidoPor,
        }))}
      />

      <PaginacaoCursor
        cursorAnterior={pagina.cursorAnterior}
        cursorProximo={pagina.cursorProximo}
        porPagina={porPagina}
      />
    </div>
  );
}
