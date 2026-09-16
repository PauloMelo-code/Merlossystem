import { z } from "zod";
import { ACOES_AUDITADAS } from "@/lib/db/schema/_enums/auditoria";
import { TIPOS_AUTH_EVENTO } from "@/lib/db/schema/_enums/auth";
import { paginacaoSchema } from "./alertas";
import { uuidSchema } from "./comum";

/**
 * Entradas das abas de `/auditoria` e o PERÍODO que `/relatorios` também usa
 * (04-ui.md §5.5). Módulo PURO.
 *
 * O dia é o de São Paulo. ponytail: deslocamento fixo -03:00 (o Brasil não tem
 * horário de verão desde 2019); se voltar a ter, trocar por `Intl` com fuso.
 */

export const DESLOCAMENTO_SP = "-03:00";
const DIA_MS = 86_400_000;
/** Um ano cabe; mais que isso vira consulta cara e gráfico ilegível. */
export const MAX_DIAS_PERIODO = 366;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** `"2026-09-01"` -> meia-noite de São Paulo. `null` quando não é data real. */
export function inicioDoDia(texto: string): Date | null {
  if (!DATA.test(texto)) return null;
  const data = new Date(`${texto}T00:00:00${DESLOCAMENTO_SP}`);
  if (Number.isNaN(data.getTime())) return null;
  // `2026-02-31` vira março no `Date`: devolver o dia pedido ou nada.
  return diaDe(data) === texto ? data : null;
}

/** O dia (YYYY-MM-DD) de São Paulo de um instante. */
export function diaDe(instante: Date): string {
  return new Date(instante.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

export type Periodo = {
  /** Inclusivo. */
  de: Date;
  /** EXCLUSIVO: meia-noite do dia seguinte ao último dia pedido. */
  ate: Date;
  deTexto: string;
  ateTexto: string;
};

/** Últimos `dias` dias, terminando hoje (inclusive). */
export function periodoPadrao(dias: number, agora = new Date()): Periodo {
  const ateTexto = diaDe(agora);
  const fim = inicioDoDia(ateTexto)!;
  const inicio = new Date(fim.getTime() - (dias - 1) * DIA_MS);
  return { de: inicio, ate: new Date(fim.getTime() + DIA_MS), deTexto: diaDe(inicio), ateTexto };
}

type ContextoZod = { addIssue: (issue: { code: "custom"; path: string[]; message: string }) => void };

/**
 * Período vindo da URL. Faltando uma ponta ou vindo lixo, cai no padrão; vindo
 * invertido ou longo demais, é RECUSADO com mensagem (a pessoa pediu algo que
 * não faz sentido e precisa saber).
 */
export function lerPeriodo(
  deTexto: string | undefined,
  ateTexto: string | undefined,
  diasPadrao: number,
  ctx: ContextoZod,
): Periodo | typeof z.NEVER {
  const de = deTexto ? inicioDoDia(deTexto) : null;
  const ate = ateTexto ? inicioDoDia(ateTexto) : null;
  if (!de || !ate) return periodoPadrao(diasPadrao);
  if (ate < de) {
    ctx.addIssue({ code: "custom", path: ["ate"], message: "A data final vem antes da inicial." });
    return z.NEVER;
  }
  const dias = Math.round((ate.getTime() - de.getTime()) / DIA_MS) + 1;
  if (dias > MAX_DIAS_PERIODO) {
    ctx.addIssue({ code: "custom", path: ["de"], message: "Escolha um período de até um ano." });
    return z.NEVER;
  }
  return { de, ate: new Date(ate.getTime() + DIA_MS), deTexto: deTexto!, ateTexto: ateTexto! };
}

const textoOpcional = z.string().max(20).optional().catch(undefined);

/** Período OPCIONAL da trilha: sem as duas pontas, a trilha é a inteira. */
const periodoOpcional = z
  .object({
    de: z.string().optional().catch(undefined),
    ate: z.string().optional().catch(undefined),
  })
  .transform((v) => {
    const de = v.de ? inicioDoDia(v.de) : null;
    const ate = v.ate ? inicioDoDia(v.ate) : null;
    return {
      de: de ?? undefined,
      ate: ate ? new Date(ate.getTime() + DIA_MS) : undefined,
    };
  });

const uuidOpcional = uuidSchema.optional().catch(undefined);

export const filtrosTrilhaSchema = paginacaoSchema
  .extend({
    pessoa: uuidOpcional,
    acao: z.enum(ACOES_AUDITADAS).optional().catch(undefined),
    entidade: z.string().regex(/^[a-z_]{1,60}$/).optional().catch(undefined),
    entidadeId: z.string().regex(/^[0-9A-Za-z-]{1,64}$/).optional().catch(undefined),
    de: textoOpcional,
    ate: textoOpcional,
  })
  .transform((v) => ({ ...v, periodo: periodoOpcional.parse({ de: v.de, ate: v.ate }) }));

export const filtrosSegurancaSchema = paginacaoSchema
  .extend({
    pessoa: uuidOpcional,
    tipo: z.enum(TIPOS_AUTH_EVENTO).optional().catch(undefined),
    de: textoOpcional,
    ate: textoOpcional,
  })
  .transform((v) => ({ ...v, periodo: periodoOpcional.parse({ de: v.de, ate: v.ate }) }));

export const detalheSchema = z.object({ id: uuidSchema });

export const INDICADORES_QUALIDADE = [
  "falhas_envio",
  "dispensas_masc",
  "voltou_fila_masc",
  "recusas_403",
] as const;
export type IndicadorQualidade = (typeof INDICADORES_QUALIDADE)[number];

export const filtrosQualidadeSchema = z
  .object({
    de: textoOpcional,
    ate: textoOpcional,
    indicador: z.enum(INDICADORES_QUALIDADE).optional().catch(undefined),
    pessoa: uuidOpcional,
  })
  .transform((v, ctx) => ({
    indicador: v.indicador,
    pessoa: v.pessoa,
    periodo: lerPeriodo(v.de, v.ate, 30, ctx),
  }));

/** As entidades que `/auditoria/excluidos` sabe listar (lista fechada). */
export const ENTIDADES_EXCLUIVEIS = [
  "contatos",
  "pedidos",
  "campanhas",
  "respostas_rapidas",
  "conversas_agendamentos",
  "lojas_midias",
  "lojas_etiquetas",
  "lojas_integracoes",
] as const;
export type EntidadeExcluivel = (typeof ENTIDADES_EXCLUIVEIS)[number];

export const filtrosExcluidosSchema = paginacaoSchema
  .extend({
    entidade: z.enum(ENTIDADES_EXCLUIVEIS).catch("contatos"),
    de: textoOpcional,
    ate: textoOpcional,
  })
  .transform((v) => ({ ...v, periodo: periodoOpcional.parse({ de: v.de, ate: v.ate }) }));
