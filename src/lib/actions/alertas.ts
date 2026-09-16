"use server";

import { executarAcao } from "@/lib/actions/_base";
import {
  contarAlertas,
  listarAlertas,
  reconhecerAlerta as reconhecerNoDominio,
  rotaDoAlerta,
  type AlertaNaLista,
  type ContadoresAlertas,
} from "@/lib/alertas";
import { decodificarCursor, type Pagina } from "@/lib/auditoria/cursor";
import { pode } from "@/lib/auth/guard";
import { lerPrazosVigentes, textoDosPrazos } from "@/lib/sla/prazo";
import type { Resultado } from "@/lib/erros";
import { filtrosAlertasSchema, reconhecerAlertaSchema } from "@/lib/validadores/alertas";

/**
 * Actions de `/alertas` (04-ui.md §5.5). A página chama `centralDeAlertas`
 * direto no servidor — é o caminho página -> action -> domínio de
 * 03-arquitetura.md §4.1, e é o que resolve a loja escolhida no cabeçalho.
 */

export type CentralDeAlertas = {
  pagina: Pagina<AlertaNaLista & { rota: string | null }>;
  /** Texto dos prazos vigentes por loja (`lojas_sla`). */
  prazosSla: string;
  contadores: ContadoresAlertas;
  porPagina: number;
  /** Botão "Reconhecer": só com a chave `alertas:reconhecer`. */
  podeReconhecer: boolean;
};

export async function centralDeAlertas(bruto: unknown): Promise<Resultado<CentralDeAlertas>> {
  return executarAcao(
    {
      permissao: "alertas:ler",
      entrada: filtrosAlertasSchema,
      loja: "le",
      executar: async (dados, ctx, tx) => {
        const [pagina, contadores] = await Promise.all([
          listarAlertas(
            ctx.escopo,
            {
              papel: ctx.sessao.papel,
              tipo: dados.tipo,
              severidade: dados.severidade,
              reconhecido: dados.reconhecido,
              cursor: decodificarCursor(dados.cursor),
              direcao: dados.direcao,
              porPagina: dados.porPagina,
            },
            tx,
          ),
          contarAlertas(ctx.escopo, ctx.sessao.papel, tx),
        ]);
        return {
          pagina: { ...pagina, itens: pagina.itens.map((a) => ({ ...a, rota: rotaDoAlerta(a) })) },
          prazosSla: textoDosPrazos(await lerPrazosVigentes(tx, ctx.escopo)),
          contadores,
          porPagina: dados.porPagina,
          podeReconhecer: pode(ctx.sessao.papel, "alertas", "reconhecer"),
        };
      },
    },
    bruto,
  );
}

/** Marca ciência. Resolver é do gerador (01-dados.md §6.6). */
export async function reconhecerAlerta(bruto: unknown): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: "alertas:reconhecer",
      entrada: reconhecerAlertaSchema,
      loja: "le",
      revalidar: ["/alertas"],
      executar: async (dados, ctx, tx) => {
        await reconhecerNoDominio({ id: dados.id, updatedAt: dados.updated_at }, ctx, tx);
        return null;
      },
    },
    bruto,
  );
}
