"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { COOKIE_LOJA, executarAcao } from "@/lib/actions/_base";
import { env } from "@/lib/env";
import { ipDaRequisicao } from "@/lib/auth/guard";
import { conferirLojaViva, ehPapelDeGestao } from "@/lib/auth/loja";
import { encerrarSessaoDoUsuario } from "@/lib/auth/sessoes";
import { registrarEventoAuth } from "@/lib/auth/trilha";

/**
 * As DUAS actions da casca (04-ui.md §4.3). Ficam coladas no layout de `(app)`
 * porque nenhuma TELA é dona delas: quem as usa é o cabeçalho, em toda página.
 *
 * Sair é POST de Server Action, nunca `<a href>`: encerrar sessão é efeito, e
 * um pré-carregador de link derrubaria a sessão de quem só passou o mouse.
 *
 * As duas usam `conta:gerir` (ADR 0030): sair e escolher a loja ativa do
 * seletor são efeitos sobre a PRÓPRIA sessão, que toda sessão ativa alcança.
 */

const TROCA = z.object({ lojaId: z.string().trim().max(64) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valor que o seletor manda para dizer "sem loja escolhida". */
const TODAS = "todas";

export async function trocarLojaAtiva(lojaId: string): Promise<void> {
  await executarAcao(
    {
      permissao: "conta:gerir",
      entrada: TROCA,
      // O cookie é PREFERÊNCIA de UI; quem autoriza é o escopo, a cada
      // requisição. Por isso esta action não resolve loja nenhuma.
      loja: "nenhuma",
      executar: async (dados, ctx) => {
        // `vendedor`/`viewer` não escolhem loja: a deles vem do cadastro
        // (INV-02). O pedido é descartado, não recusado — não há o que negociar.
        if (!ehPapelDeGestao(ctx.sessao.papel)) return null;

        const jarra = await cookies();
        if (dados.lojaId === TODAS) {
          jarra.delete(COOKIE_LOJA);
          return null;
        }

        // Formato ANTES do banco: `${valor}::uuid` com lixo é erro do Postgres,
        // não recusa da aplicação.
        if (!UUID.test(dados.lojaId)) return null;
        // Existe e está viva? Lança `ErroDeEscopo` (404), nunca 403.
        await conferirLojaViva(dados.lojaId);

        jarra.set(COOKIE_LOJA, dados.lojaId, {
          httpOnly: true,
          sameSite: "lax",
          secure: env.NODE_ENV === "production",
          path: "/",
        });
        return null;
      },
    },
    { lojaId },
  );
}

export async function sair(): Promise<void> {
  await executarAcao(
    {
      permissao: "conta:gerir",
      entrada: z.object({}),
      loja: "nenhuma",
      // Quem está com a senha vencida também precisa poder sair (§9.4).
      trocaDeSenha: true,
      executar: async (_dados, ctx) => {
        await encerrarSessaoDoUsuario(ctx.sessao.usuarioId, ctx.sessao.sessaoId);
        await registrarEventoAuth({
          tipo: "logout",
          usuarioId: ctx.sessao.usuarioId,
          sessaoId: ctx.sessao.sessaoId,
          ip: await ipDaRequisicao(),
          agente: (await headers()).get("user-agent"),
        });
        (await cookies()).delete(COOKIE_LOJA);
        return null;
      },
    },
    {},
  );

  // Fora do `executarAcao`: `redirect` lança, e lançar dentro da transação a
  // desfaria antes de a sessão ser encerrada de verdade.
  redirect("/entrar");
}
