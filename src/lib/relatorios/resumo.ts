import "server-only";
import { logger } from "@/lib/logger";
import { diaDe, inicioDoDia } from "@/lib/validadores/auditoria";
import { calcularIndicadores } from "./_consultas";
import type { Indicadores } from "./definicoes";

/**
 * Job `resumo-diario` (7h, fila `manutencao`): os números do DIA ANTERIOR, com
 * as mesmas definições da tela `/relatorios`.
 *
 * ponytail: sai no log do worker. Não há provedor de e-mail escolhido ainda
 * (decisão do orquestrador: sem provedor por enquanto); quando houver, o envio
 * ao dono entra aqui, reusando o adaptador de `src/lib/auth/emails.ts`.
 */

const DIA_MS = 86_400_000;

/** Meia-noite de ontem e de hoje, no dia de São Paulo. */
export function ontem(agora = new Date()): { de: Date; ate: Date; dia: string } {
  const ate = inicioDoDia(diaDe(agora))!;
  const de = new Date(ate.getTime() - DIA_MS);
  return { de, ate, dia: diaDe(de) };
}

export async function resumirDiaAnterior(
  lojaId: string | null = null,
  agora = new Date(),
): Promise<{ dia: string; indicadores: Indicadores }> {
  const periodo = ontem(agora);
  const indicadores = await calcularIndicadores(
    lojaId ? { tipo: "uma", lojaId } : { tipo: "todas" },
    periodo,
  );
  logger.info({ dia: periodo.dia, lojaId, ...indicadores }, "resumo-diario");
  return { dia: periodo.dia, indicadores };
}
