"use server";

import { executarAcao } from "@/lib/actions/_base";
import type { Resultado } from "@/lib/erros";
import { agendarEnvio, cancelar, criarAgendamento, reagendar } from "@/lib/agendamentos/gravacao";
import { alvoSchema } from "@/lib/validadores/conteudo";
import { agendamentoSchema, reagendarSchema } from "@/lib/validadores/campanhas";

/**
 * Actions de `/agendadas` (04-ui.md §5.4). O job de envio é enfileirado DEPOIS
 * do commit, com `delay` até o horário escolhido.
 */

const ROTA = ["/agendadas"];

export async function agendarMensagem(bruto: unknown): Promise<Resultado<{ id: string }>> {
  const r = await executarAcao(
    {
      permissao: "agendamentos:criar",
      entrada: agendamentoSchema,
      loja: "grava",
      revalidar: ROTA,
      executar: (dados, ctx, tx) => criarAgendamento(tx, ctx, dados),
    },
    bruto,
  );
  if (!r.ok) return r;
  await agendarEnvio(r.dados);
  return { ok: true, dados: { id: r.dados.id } };
}

export async function reagendarMensagem(bruto: unknown): Promise<Resultado<null>> {
  const r = await executarAcao(
    {
      permissao: "agendamentos:editar",
      entrada: reagendarSchema,
      loja: "grava",
      revalidar: ROTA,
      executar: (dados, ctx, tx) => reagendar(tx, ctx, dados),
    },
    bruto,
  );
  if (!r.ok) return r;
  await agendarEnvio(r.dados);
  return { ok: true, dados: null };
}

export async function cancelarMensagem(bruto: unknown): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: "agendamentos:cancelar",
      entrada: alvoSchema,
      loja: "grava",
      revalidar: ROTA,
      executar: async (dados, ctx, tx) => {
        await cancelar(tx, ctx, dados);
        return null;
      },
    },
    bruto,
  );
}
