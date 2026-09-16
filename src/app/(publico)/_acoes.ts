"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { executarAcao, executarAcaoPublica } from "@/lib/actions/_base";
import { ErroDeValidacao, ErroDoAplicativo, type Resultado } from "@/lib/erros";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { auth } from "@/lib/auth/auth";
import { usarConvite } from "@/lib/auth/convites";
import { politicaDeSenha } from "@/lib/auth/politica-senha";
import {
  concluirProvisionamento,
  confirmarPasskey,
  confirmarTotp,
  iniciarTotp,
  opcoesDePasskey,
  type FatorQueFalta,
} from "@/lib/auth/fatores";
import {
  apelidoSchema,
  codigoTotpSchema,
  nomeSchema,
  respostaWebauthnSchema,
  senhaAtualSchema,
  senhaSchema,
  tokenSchema,
} from "@/lib/validadores/comum";

/**
 * Actions da área pública (04-ui.md §5.1; 02-seguranca.md §9.2 e §9.4).
 *
 * As duas anônimas usam `acaoPublica`: sem ela, escrita sem sessão ficaria sem
 * checagem de origem — o Next só AVISA quando `Origin` falta (N2) — e sem teto
 * por IP. As quatro do segundo passo usam `provisoria: true`, o sinalizador que
 * o portão aceita SÓ nesta pasta: a sessão do convite não alcança mais nada.
 *
 * O TOKEN chega no CORPO, sempre. Nenhuma destas rotas tem segmento `[token]` e
 * nenhum link de e-mail carrega `?token=` (U12, trava T27).
 */

/** Teto por IP: convite é raro e reset é ainda mais raro. */
const TETO_CONVITE = { janela: 600, max: 10 } as const;
const TETO_REDEFINICAO = { janela: 600, max: 10 } as const;

const PRIMEIRO_ACESSO = z
  .object({
    token: tokenSchema,
    nome: nomeSchema,
    senha: senhaSchema,
    confirmacao: z.string(),
  })
  .refine((dados) => dados.senha === dados.confirmacao, {
    path: ["confirmacao"],
    message: "As duas senhas precisam ser iguais.",
  });

/**
 * Passo 1: a pessoa convidada define A PRÓPRIA senha e ganha a sessão
 * provisória.
 *
 * A política de senha roda ANTES do consumo do token: erro depois do consumo
 * desfaria a transação, mas a ordem escrita em §9.2 item 4 existe para a senha
 * fraca nunca chegar perto do token.
 *
 * C11 — e-mail já existente: o token é queimado, NENHUMA coluna da identidade
 * existente é tocada e a resposta é a mesma do caso novo. A diferença só
 * aparece no passo 2, quando não há sessão e a tela manda entrar pelo caminho
 * normal — que é exatamente o que essa pessoa deve fazer.
 */
export async function definirSenhaDoConvite(
  _anterior: Resultado<null>,
  form: FormData,
): Promise<Resultado<null>> {
  return executarAcaoPublica(
    {
      motivo: "primeiro-acesso",
      limite: TETO_CONVITE,
      entrada: PRIMEIRO_ACESSO,
      executar: async (dados) => {
        await politicaDeSenha(dados.senha, {
          contexto: { nome: dados.nome },
          conferirHibp: env.AUTH_HIBP_HABILITADO,
        });

        const resultado = await usarConvite(dados.token, {
          nome: dados.nome,
          senha: dados.senha,
        });

        // Sessão provisória (§9.2 item 6): passa pelo item 3 de
        // `podeCriarSessao` porque a conta está em provisionamento.
        try {
          await auth.api.signInEmail({
            body: { email: resultado.email, password: dados.senha },
            headers: await headers(),
          });
        } catch (erro) {
          logger.warn({ erro: String(erro) }, "sessão provisória do convite não abriu");
        }
        return null;
      },
    },
    form,
  );
}

const REDEFINICAO = z
  .object({
    token: tokenSchema,
    senha: senhaSchema,
    confirmacao: z.string(),
  })
  .refine((dados) => dados.senha === dados.confirmacao, {
    path: ["confirmacao"],
    message: "As duas senhas precisam ser iguais.",
  });

/**
 * Redefinição por link. Vai por `auth.api.resetPassword` e não pelo Route
 * Handler porque é o único caminho em que a exceção da política de senha chega
 * inteira — com os motivos por campo — em vez de virar erro genérico no
 * roteador do Better Auth.
 *
 * `autoSignIn: false` e `revokeSessionsOnPasswordReset: true` estão em
 * `auth.ts`: redefinir NÃO cria sessão (pularia o 2º fator, G14) e derruba as
 * sessões antigas (G16).
 */
export async function redefinirSenha(
  _anterior: Resultado<null>,
  form: FormData,
): Promise<Resultado<null>> {
  return executarAcaoPublica(
    {
      motivo: "redefinir-senha",
      limite: TETO_REDEFINICAO,
      entrada: REDEFINICAO,
      executar: async (dados) => {
        try {
          await auth.api.resetPassword({
            body: { token: dados.token, newPassword: dados.senha },
            headers: await headers(),
          });
        } catch (erro) {
          if (erro instanceof ErroDoAplicativo) throw erro;
          // Vocabulário de E10: nada de "token", "inválido" ou "expirado".
          throw new ErroDeValidacao({
            senha: ["Este link não vale mais. Peça outro na tela de entrada."],
          });
        }
        return null;
      },
    },
    form,
  );
}

// ---------------------------------------------------------------------------
// Passo 2 — segundo fator, com a sessão PROVISÓRIA
// ---------------------------------------------------------------------------

/** `falta` diz à tela qual fator a política ainda pede (ADR 0029). */
type Conclusao = { concluido: boolean; falta: FatorQueFalta };

/** A própria conta, alcançável por qualquer sessão (ADR 0030). */
const CHAVE_DE_QUALQUER_SESSAO = "conta:gerir" as const;

const BASE_PROVISORIA = {
  permissao: CHAVE_DE_QUALQUER_SESSAO,
  loja: "nenhuma",
  provisoria: true,
  fresca: true,
} as const;

export async function prepararTotpDoPrimeiroAcesso(
  _anterior: Resultado<{ uri: string }>,
  form: FormData,
): Promise<Resultado<{ uri: string }>> {
  return executarAcao(
    {
      ...BASE_PROVISORIA,
      entrada: z.object({ senhaAtual: senhaAtualSchema }),
      executar: async (dados, ctx) => ({
        uri: await iniciarTotp(ctx.sessao, dados.senhaAtual),
      }),
    },
    form,
  );
}

/**
 * Confirmar o fator fecha o provisionamento: `ativo = true`,
 * `two_factor_enabled = true`, `precisa_configurar_fator = false` e a sessão
 * provisória morre — a pessoa entra de novo pelo caminho normal (REQ-F4).
 */
export async function confirmarTotpDoPrimeiroAcesso(
  _anterior: Resultado<Conclusao>,
  form: FormData,
): Promise<Resultado<Conclusao>> {
  return executarAcao(
    {
      ...BASE_PROVISORIA,
      entrada: z.object({ codigo: codigoTotpSchema }),
      executar: async (dados, ctx) => {
        await confirmarTotp(ctx.sessao, dados.codigo);
        return concluirProvisionamento(ctx.sessao);
      },
    },
    form,
  );
}

export async function prepararPasskeyDoPrimeiroAcesso(
  apelido: string,
): Promise<Resultado<{ opcoes: Record<string, unknown> }>> {
  return executarAcao(
    {
      ...BASE_PROVISORIA,
      entrada: z.object({ apelido: apelidoSchema }),
      executar: async (dados) => ({ opcoes: await opcoesDePasskey(dados.apelido) }),
    },
    { apelido },
  );
}

export async function confirmarPasskeyDoPrimeiroAcesso(entrada: {
  apelido: string;
  resposta: Record<string, unknown>;
}): Promise<Resultado<Conclusao>> {
  return executarAcao(
    {
      ...BASE_PROVISORIA,
      entrada: z.object({ apelido: apelidoSchema, resposta: respostaWebauthnSchema }),
      executar: async (dados, ctx) => {
        await confirmarPasskey(ctx.sessao, dados.resposta, dados.apelido);
        return concluirProvisionamento(ctx.sessao);
      },
    },
    entrada,
  );
}
