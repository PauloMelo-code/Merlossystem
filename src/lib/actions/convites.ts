"use server";

import type { z } from "zod";
import { executarAcao } from "./_base";
import type { Resultado } from "@/lib/erros";
import { convidarUsuario as convidar, reenviarConvite as reenviar } from "@/lib/usuarios/convites";
import { convidarSchema, reenviarConviteSchema } from "@/lib/validadores/usuarios";

/**
 * Convites (02-seguranca.md §9.2 e §2.3 item 4; 04-ui.md §5.6).
 *
 * Quem convida NUNCA escolhe a senha: a pessoa define a própria no primeiro
 * acesso. O link volta para quem emitiu — enquanto não há provedor de e-mail,
 * é o único caminho de entrega (README) — e nunca vai para o log.
 *
 * `dono` não é convidável (CHECK do banco); `admin` só pelo `dono`, com a
 * ciência versionada digitada.
 */

type Emitido = Resultado<{ link: string; expiraEm: Date }>;

export async function convidarUsuario(entrada: z.input<typeof convidarSchema>): Promise<Emitido> {
  return executarAcao(
    {
      permissao: "usuarios:convidar",
      entrada: convidarSchema,
      loja: "nenhuma",
      fresca: true,
      revalidar: ["/configuracoes/usuarios"],
      executar: async (dados, ctx, tx) => {
        const { link, expiraEm } = await convidar(tx, ctx, {
          email: dados.email,
          papel: dados.papel,
          lojaId: dados.lojaId,
          motivo: dados.motivo,
        });
        return { link, expiraEm };
      },
    },
    entrada,
  );
}

/** Aposenta o convite aberto e emite outro, com token e validade novos. */
export async function reenviarConvite(
  entrada: z.input<typeof reenviarConviteSchema>,
): Promise<Emitido> {
  return executarAcao(
    {
      permissao: "usuarios:convidar",
      entrada: reenviarConviteSchema,
      loja: "nenhuma",
      fresca: true,
      revalidar: ["/configuracoes/usuarios"],
      executar: async (dados, ctx, tx) => {
        const { link, expiraEm } = await reenviar(tx, ctx, dados);
        return { link, expiraEm };
      },
    },
    entrada,
  );
}
