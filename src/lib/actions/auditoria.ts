"use server";

import { z } from "zod";
import { executarAcao } from "@/lib/actions/_base";
import {
  decodificarCursor,
  detalheDoEvento,
  detalheDoEventoDeAcesso,
  listarEventosDeAcesso,
  listarExcluidos,
  listarTrilha,
  ocorrenciasDe,
  painelDeQualidade,
  pessoasDaEquipe,
  rotuloDaAcao,
  rotuloDaEntidade,
  type EventoDeAcesso,
  type EventoDeAcessoDetalhado,
  type EventoDetalhado,
  type EventoNaLista,
  type LinhaQualidade,
  type Ocorrencia,
  type Pagina,
  type RegistroExcluido,
} from "@/lib/auditoria";
import { ACOES_AUDITADAS } from "@/lib/db/schema/_enums/auditoria";
import type { Resultado } from "@/lib/erros";
import { uuidSchema } from "@/lib/validadores/comum";
import {
  detalheSchema,
  filtrosExcluidosSchema,
  filtrosQualidadeSchema,
  filtrosSegurancaSchema,
  filtrosTrilhaSchema,
  INDICADORES_QUALIDADE,
  lerPeriodo,
  type Periodo,
} from "@/lib/validadores/auditoria";

/**
 * Actions das quatro abas de `/auditoria` (04-ui.md §5.5). TODAS são leitura:
 * não existe action de exclusão, edição ou restauração da trilha em lugar
 * nenhum (R-01). As páginas chamam estas funções no servidor.
 */

type Pessoa = { id: string; nome: string };
type Rotulado = { acaoRotulo: string; entidadeRotulo: string };

const rotular = <E extends { acao: string; entidade: string }>(e: E): E & Rotulado => ({
  ...e,
  acaoRotulo: rotuloDaAcao(e.acao),
  entidadeRotulo: rotuloDaEntidade(e.entidade),
});

/** As ações do filtro, já com rótulo (a tela não importa o domínio). */
const OPCOES_DE_ACAO = ACOES_AUDITADAS.map((valor) => ({ valor, rotulo: rotuloDaAcao(valor) }));

export type TelaTrilha = {
  pagina: Pagina<EventoNaLista & Rotulado>;
  pessoas: Pessoa[];
  acoes: typeof OPCOES_DE_ACAO;
  porPagina: number;
};

export async function trilhaDeNegocio(bruto: unknown): Promise<Resultado<TelaTrilha>> {
  return executarAcao(
    {
      permissao: "trilha:ler",
      entrada: filtrosTrilhaSchema,
      loja: "le",
      executar: async (d, ctx, tx) => {
        const [pagina, pessoas] = await Promise.all([
          listarTrilha(
            ctx.escopo,
            {
              pessoa: d.pessoa,
              acao: d.acao,
              entidade: d.entidade,
              entidadeId: d.entidadeId,
              de: d.periodo.de,
              ate: d.periodo.ate,
              cursor: decodificarCursor(d.cursor),
              direcao: d.direcao,
              porPagina: d.porPagina,
            },
            tx,
          ),
          pessoasDaEquipe(ctx.escopo, tx),
        ]);
        return {
          pagina: { ...pagina, itens: pagina.itens.map(rotular) },
          pessoas,
          acoes: OPCOES_DE_ACAO,
          porPagina: d.porPagina,
        };
      },
    },
    bruto,
  );
}

export async function eventoDaTrilha(bruto: unknown): Promise<Resultado<EventoDetalhado & Rotulado>> {
  return executarAcao(
    {
      permissao: "trilha:ler",
      entrada: detalheSchema,
      loja: "le",
      executar: async (d, ctx, tx) => rotular(await detalheDoEvento(ctx.escopo, d.id, tx)),
    },
    bruto,
  );
}

export type TelaQualidade = { linhas: LinhaQualidade[]; periodo: Periodo };

export async function qualidadePorPessoa(bruto: unknown): Promise<Resultado<TelaQualidade>> {
  return executarAcao(
    {
      permissao: "trilha:ler",
      entrada: filtrosQualidadeSchema,
      loja: "le",
      executar: async (d, ctx, tx) => ({
        linhas: await painelDeQualidade(ctx.escopo, d.periodo, tx),
        periodo: d.periodo,
      }),
    },
    bruto,
  );
}

const ocorrenciasSchema = z
  .object({
    indicador: z.enum(INDICADORES_QUALIDADE),
    pessoa: uuidSchema,
    de: z.string().max(20).optional(),
    ate: z.string().max(20).optional(),
  })
  .transform((v, ctx) => ({ ...v, periodo: lerPeriodo(v.de, v.ate, 30, ctx) }));

export async function ocorrenciasDaPessoa(bruto: unknown): Promise<Resultado<Ocorrencia[]>> {
  return executarAcao(
    {
      permissao: "trilha:ler",
      entrada: ocorrenciasSchema,
      loja: "le",
      executar: (d, ctx, tx) => ocorrenciasDe(ctx.escopo, d.indicador, d.pessoa, d.periodo, tx),
    },
    bruto,
  );
}

export type TelaExcluidos = { pagina: Pagina<RegistroExcluido>; porPagina: number };

export async function registrosExcluidos(bruto: unknown): Promise<Resultado<TelaExcluidos>> {
  return executarAcao(
    {
      permissao: "trilha:ler",
      entrada: filtrosExcluidosSchema,
      loja: "le",
      executar: async (d, ctx, tx) => ({
        pagina: await listarExcluidos(
          ctx.escopo,
          {
            entidade: d.entidade,
            de: d.periodo.de,
            ate: d.periodo.ate,
            cursor: decodificarCursor(d.cursor),
            direcao: d.direcao,
            porPagina: d.porPagina,
          },
          tx,
        ),
        porPagina: d.porPagina,
      }),
    },
    bruto,
  );
}

export type TelaSeguranca = { pagina: Pagina<EventoDeAcesso>; pessoas: Pessoa[]; porPagina: number };

/** `seguranca:ler_eventos`: gerente recebe SEM_PERMISSAO e a recusa vai para a trilha. */
export async function trilhaDeAcesso(bruto: unknown): Promise<Resultado<TelaSeguranca>> {
  return executarAcao(
    {
      permissao: "seguranca:ler_eventos",
      entrada: filtrosSegurancaSchema,
      loja: "nenhuma",
      executar: async (d, ctx, tx) => {
        const [pagina, pessoas] = await Promise.all([
          listarEventosDeAcesso(
            {
              pessoa: d.pessoa,
              tipo: d.tipo,
              de: d.periodo.de,
              ate: d.periodo.ate,
              cursor: decodificarCursor(d.cursor),
              direcao: d.direcao,
              porPagina: d.porPagina,
            },
            tx,
          ),
          pessoasDaEquipe(ctx.escopo, tx),
        ]);
        return { pagina, pessoas, porPagina: d.porPagina };
      },
    },
    bruto,
  );
}

export async function eventoDeAcesso(bruto: unknown): Promise<Resultado<EventoDeAcessoDetalhado>> {
  return executarAcao(
    {
      permissao: "seguranca:ler_eventos",
      entrada: detalheSchema,
      loja: "nenhuma",
      executar: (d, _ctx, tx) => detalheDoEventoDeAcesso(d.id, tx),
    },
    bruto,
  );
}
