"use server";

import { z } from "zod";
import { executarAcao } from "@/lib/actions/_base";
import type { Resultado } from "@/lib/erros";

/**
 * COSTURA — dono: R2-A (funil). Nasce só com a leitura que o painel de venda
 * (M4) consome; o pacote acrescenta as demais actions do funil.
 */

export type NegocioAbertoDoContato = {
  id: string;
  loja_id: string;
  estagio: string;
  valor: string;
  updated_at: Date;
};

const entrada = z.object({ contatoId: z.uuid(), loja: z.uuid().optional() });

/** 0 ou 1 negócio aberto do contato no escopo. Até o R2-A: sempre `null`. */
export async function negocioAbertoDoContato(
  bruto: unknown,
): Promise<Resultado<NegocioAbertoDoContato | null>> {
  return executarAcao(
    {
      permissao: "negocios:ler",
      entrada,
      loja: "le",
      executar: async () => null,
    },
    bruto,
  );
}
