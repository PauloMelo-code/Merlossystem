"use server";

import type { z } from "zod";
import { executarAcao } from "./_base";
import { enviarConvite } from "@/lib/auth/convites";
import type { Resultado } from "@/lib/erros";
import {
  convidarUsuario as convidar,
  reenviarConvite as reenviar,
  type ConviteDaTela,
} from "@/lib/usuarios/convites";
import { convidarSchema, reenviarConviteSchema } from "@/lib/validadores/usuarios";

/**
 * Convites (02-seguranca.md §9.2 e §2.3 item 4; 04-ui.md §5.6).
 *
 * Quem convida NUNCA escolhe a senha: a pessoa define a própria no primeiro
 * acesso. O link volta para quem emitiu — enquanto não há provedor de e-mail,
 * é o único caminho de entrega (README) — e nunca vai para o log.
 *
 * O e-mail sai SÓ depois do commit: `executarAcao` devolve depois de fechar a
 * transação, e é aí que `entregar` enfileira. Um rollback não manda link morto.
 *
 * `dono` não é convidável (CHECK do banco); `admin` só pelo `dono`, com a
 * ciência versionada digitada.
 */

type Emitido = Resultado<{ link: string; expiraEm: Date }>;
type Gravado = { convite: ConviteDaTela; autorId: string };

function entregar(resultado: Resultado<Gravado>): Emitido {
  if (!resultado.ok) return resultado;
  const { convite, autorId } = resultado.dados;
  enviarConvite(convite, autorId);
  return { ok: true, dados: { link: convite.link, expiraEm: convite.expiraEm } };
}

export async function convidarUsuario(entrada: z.input<typeof convidarSchema>): Promise<Emitido> {
  const resultado = await executarAcao(
    {
      permissao: "usuarios:convidar",
      entrada: convidarSchema,
      loja: "nenhuma",
      fresca: true,
      revalidar: ["/configuracoes/usuarios"],
      executar: async (dados, ctx, tx): Promise<Gravado> => ({
        convite: await convidar(tx, ctx, {
          email: dados.email,
          papel: dados.papel,
          lojaId: dados.lojaId,
          motivo: dados.motivo,
        }),
        autorId: ctx.autorId,
      }),
    },
    entrada,
  );
  return entregar(resultado);
}

/** Aposenta o convite aberto e emite outro, com token e validade novos. */
export async function reenviarConvite(
  entrada: z.input<typeof reenviarConviteSchema>,
): Promise<Emitido> {
  const resultado = await executarAcao(
    {
      permissao: "usuarios:convidar",
      entrada: reenviarConviteSchema,
      loja: "nenhuma",
      fresca: true,
      revalidar: ["/configuracoes/usuarios"],
      executar: async (dados, ctx, tx): Promise<Gravado> => ({
        convite: await reenviar(tx, ctx, dados),
        autorId: ctx.autorId,
      }),
    },
    entrada,
  );
  return entregar(resultado);
}
