"use server";

import { z } from "zod";
import { executarAcao } from "./_base";
import type { Resultado } from "@/lib/erros";
import * as dominio from "@/lib/lojas";
import {
  criarLojaSchema,
  desativarLojaSchema,
  editarLojaSchema,
} from "@/lib/validadores/lojas";

/**
 * Cadastro de lojas (04-ui.md §5.6; 02-seguranca.md §2.2).
 *
 * `loja: "nenhuma"`: a tabela `lojas` não tem `loja_id`, e quem grava aqui é
 * papel de ADMINISTRAÇÃO (escopo `todas`). Criar, editar e desativar passam
 * pelo block de 3 s na tela (§9.1, item 9).
 */

const REVALIDAR = ["/configuracoes/lojas"] as const;
const VAZIO = z.object({});

export async function listarLojas(): Promise<Resultado<dominio.LojaNaTela[]>> {
  return executarAcao(
    { permissao: "lojas:ler", entrada: VAZIO, loja: "nenhuma", executar: () => dominio.listarLojas() },
    {},
  );
}

export async function criarLoja(
  _anterior: Resultado<{ id: string }>,
  form: FormData,
): Promise<Resultado<{ id: string }>> {
  return executarAcao(
    {
      permissao: "lojas:criar",
      entrada: criarLojaSchema,
      loja: "nenhuma",
      revalidar: REVALIDAR,
      executar: (dados, ctx, tx) => dominio.criarLoja(tx, dados, ctx),
    },
    form,
  );
}

export async function editarLoja(
  _anterior: Resultado<{ id: string; updatedAt: Date }>,
  form: FormData,
): Promise<Resultado<{ id: string; updatedAt: Date }>> {
  return executarAcao(
    {
      permissao: "lojas:editar",
      entrada: editarLojaSchema,
      loja: "nenhuma",
      revalidar: REVALIDAR,
      executar: (dados, ctx, tx) => dominio.editarLoja(tx, dados, ctx),
    },
    form,
  );
}

export async function desativarLoja(entrada: { id: string; updatedAt: string }): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: "lojas:excluir",
      entrada: desativarLojaSchema,
      loja: "nenhuma",
      revalidar: REVALIDAR,
      executar: async (dados, ctx, tx) => {
        await dominio.desativarLoja(tx, dados, ctx);
        return null;
      },
    },
    entrada,
  );
}
