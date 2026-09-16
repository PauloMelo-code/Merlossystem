"use server";

import { z } from "zod";
import { executarAcao } from "./_base";
import type { Resultado } from "@/lib/erros";
import { ErroDeValidacao, ErroDoAplicativo } from "@/lib/erros";
import { auth } from "@/lib/auth/auth";
import {
  confirmarPasskey,
  confirmarTotp,
  iniciarTotp,
  opcoesDePasskey,
  reautenticarComSenha,
  removerPasskey,
  renomearPasskey,
} from "@/lib/auth/fatores";
import { encerrarSessaoDoUsuario, revogarSessoesDe } from "@/lib/auth/sessoes";
import { atualizarComTrava } from "@/lib/db/mutacoes";
import { usuarios } from "@/lib/db/schema/auth/usuarios";
import {
  apelidoSchema,
  codigoTotpSchema,
  nomeSchema,
  respostaWebauthnSchema,
  senhaAtualSchema,
  senhaSchema,
  uuidSchema,
} from "@/lib/validadores/comum";

/**
 * "Meu perfil" e "Meu perfil > Segurança" (02-seguranca.md §11.1, REQ-G1..G8;
 * 04-ui.md §5.1).
 *
 * REGRA DA ÁREA, conferida pela trava T11: NENHUMA action daqui recebe
 * identificador de outra pessoa. O alvo é SEMPRE a sessão corrente,
 * `ctx.sessao`. A CVE-2025-71400 era exatamente um IDOR no caminho de remover
 * passkey — aqui o id que chega é o da PASSKEY, e quem confere o dono é a
 * própria função de domínio, além do plugin.
 *
 * O que esta área NÃO tem (U13, G4/G5): desligar o 2º fator, remover o último
 * fator, gerar código de recuperação e ver a semente do TOTP.
 *
 * A chave é `conta:gerir` (ADR 0030): toda sessão ativa alcança a PRÓPRIA
 * conta, e só ela — o alvo nunca sai do pedido.
 */

const CHAVE_DE_QUALQUER_SESSAO = "conta:gerir" as const;

/** Ninguém aqui grava em loja: o registro é a própria pessoa. */
const SEM_LOJA = "nenhuma" as const;

// ---------------------------------------------------------------------------
// /perfil
// ---------------------------------------------------------------------------

const PERFIL = z.object({
  nome: nomeSchema,
  updatedAt: z.coerce.date(),
});

/**
 * Nome da própria conta. Avatar não entra no R1: o upload é da rota de mídia
 * (pacote M3) e uma caixa de seleção que não envia nada seria fachada (U8).
 */
export async function salvarPerfil(
  _anterior: Resultado<{ atualizadoEm: Date }>,
  form: FormData,
): Promise<Resultado<{ atualizadoEm: Date }>> {
  return executarAcao(
    {
      permissao: CHAVE_DE_QUALQUER_SESSAO,
      entrada: PERFIL,
      loja: SEM_LOJA,
      revalidar: ["/perfil"],
      executar: async (dados, ctx, tx) => {
        const linha = await atualizarComTrava(
          tx,
          usuarios,
          {
            id: ctx.sessao.usuarioId,
            escopo: ctx.escopo,
            updatedAtOriginal: dados.updatedAt,
            dados: { nome: dados.nome },
          },
          ctx,
          "usuario_alterado",
        );
        return { atualizadoEm: linha.updated_at as Date };
      },
    },
    form,
  );
}

// ---------------------------------------------------------------------------
// /perfil/seguranca — reautenticação e senha
// ---------------------------------------------------------------------------

const SENHA_ATUAL = z.object({ senhaAtual: senhaAtualSchema });

/** Prova de identidade do `ModalReautenticacao` (04-ui.md §7.3). */
export async function reautenticar(senhaAtual: string): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: CHAVE_DE_QUALQUER_SESSAO,
      entrada: SENHA_ATUAL,
      loja: SEM_LOJA,
      // Quem está com a senha vencida também precisa provar identidade.
      trocaDeSenha: true,
      executar: async (dados, ctx) => {
        await reautenticarComSenha(ctx.sessao, dados.senhaAtual);
        return null;
      },
    },
    { senhaAtual },
  );
}

const TROCA_DE_SENHA = z
  .object({
    senhaAtual: senhaAtualSchema,
    senha: senhaSchema,
    confirmacao: z.string(),
  })
  .refine((dados) => dados.senha === dados.confirmacao, {
    path: ["confirmacao"],
    message: "As duas senhas precisam ser iguais.",
  });

/**
 * A política de senha roda dentro do `hooks.before` do Better Auth, no caminho
 * `/change-password` (B9/E9) — e o histórico entra pelo
 * `databaseHooks.account.update.before`. Chamar `auth.api` aqui é o que faz os
 * dois acontecerem sem reimplementar nenhum deles.
 */
export async function trocarSenha(
  _anterior: Resultado<null>,
  form: FormData,
): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: CHAVE_DE_QUALQUER_SESSAO,
      entrada: TROCA_DE_SENHA,
      loja: SEM_LOJA,
      fresca: true,
      trocaDeSenha: true,
      executar: async (dados) => {
        const { headers } = await import("next/headers");
        try {
          await auth.api.changePassword({
            body: {
              currentPassword: dados.senhaAtual,
              newPassword: dados.senha,
              revokeOtherSessions: true,
            },
            headers: await headers(),
          });
        } catch (erro) {
          throw traduzir(erro, "senhaAtual", "Senha atual incorreta.");
        }
        return null;
      },
    },
    form,
  );
}

// ---------------------------------------------------------------------------
// /perfil/seguranca — segundo fator
// ---------------------------------------------------------------------------

export async function iniciarCadastroDeTotp(
  _anterior: Resultado<{ uri: string }>,
  form: FormData,
): Promise<Resultado<{ uri: string }>> {
  return executarAcao(
    {
      permissao: CHAVE_DE_QUALQUER_SESSAO,
      entrada: SENHA_ATUAL,
      loja: SEM_LOJA,
      fresca: true,
      executar: async (dados, ctx) => ({
        uri: await iniciarTotp(ctx.sessao, dados.senhaAtual),
      }),
    },
    form,
  );
}

export async function confirmarCadastroDeTotp(
  _anterior: Resultado<null>,
  form: FormData,
): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: CHAVE_DE_QUALQUER_SESSAO,
      entrada: z.object({ codigo: codigoTotpSchema }),
      loja: SEM_LOJA,
      fresca: true,
      revalidar: ["/perfil/seguranca"],
      executar: async (dados, ctx) => {
        await confirmarTotp(ctx.sessao, dados.codigo);
        return null;
      },
    },
    form,
  );
}

/** Devolve as opções do WebAuthn; quem cria a credencial é o navegador. */
export async function iniciarCadastroDePasskey(
  apelido: string,
): Promise<Resultado<{ opcoes: Record<string, unknown> }>> {
  return executarAcao(
    {
      permissao: CHAVE_DE_QUALQUER_SESSAO,
      entrada: z.object({ apelido: apelidoSchema }),
      loja: SEM_LOJA,
      fresca: true,
      executar: async (dados) => ({ opcoes: await opcoesDePasskey(dados.apelido) }),
    },
    { apelido },
  );
}

export async function confirmarCadastroDePasskey(entrada: {
  apelido: string;
  resposta: Record<string, unknown>;
}): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: CHAVE_DE_QUALQUER_SESSAO,
      entrada: z.object({ apelido: apelidoSchema, resposta: respostaWebauthnSchema }),
      loja: SEM_LOJA,
      fresca: true,
      revalidar: ["/perfil/seguranca"],
      executar: async (dados, ctx) => {
        await confirmarPasskey(ctx.sessao, dados.resposta, dados.apelido);
        return null;
      },
    },
    entrada,
  );
}

export async function renomearChave(entrada: {
  passkeyId: string;
  apelido: string;
}): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: CHAVE_DE_QUALQUER_SESSAO,
      entrada: z.object({ passkeyId: uuidSchema, apelido: apelidoSchema }),
      loja: SEM_LOJA,
      fresca: true,
      revalidar: ["/perfil/seguranca"],
      executar: async (dados) => {
        await renomearPasskey(dados.passkeyId, dados.apelido);
        return null;
      },
    },
    entrada,
  );
}

/** Recusa quando esta é a última prova de identidade da conta (§9.3). */
export async function removerChave(passkeyId: string): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: CHAVE_DE_QUALQUER_SESSAO,
      entrada: z.object({ passkeyId: uuidSchema }),
      loja: SEM_LOJA,
      fresca: true,
      revalidar: ["/perfil/seguranca"],
      executar: async (dados, ctx) => {
        await removerPasskey(ctx.sessao, dados.passkeyId);
        return null;
      },
    },
    { passkeyId },
  );
}

// ---------------------------------------------------------------------------
// /perfil/seguranca — sessões
// ---------------------------------------------------------------------------

export async function encerrarSessao(sessaoAlvoId: string): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: CHAVE_DE_QUALQUER_SESSAO,
      entrada: z.object({ sessaoAlvoId: uuidSchema }),
      loja: SEM_LOJA,
      fresca: true,
      revalidar: ["/perfil/seguranca"],
      executar: async (dados, ctx) => {
        // A função só alcança sessões da própria pessoa: o `where` casa os dois.
        await encerrarSessaoDoUsuario(ctx.sessao.usuarioId, dados.sessaoAlvoId);
        return null;
      },
    },
    { sessaoAlvoId },
  );
}

/**
 * "Encerrar todas as outras" derruba TUDO, inclusive a atual: a revogação em
 * massa do Better Auth é por pessoa (F5). A tela avisa e manda para `/entrar`.
 */
export async function encerrarTodasAsSessoes(): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: CHAVE_DE_QUALQUER_SESSAO,
      entrada: z.object({}),
      loja: SEM_LOJA,
      fresca: true,
      executar: async (_dados, ctx) => {
        await revogarSessoesDe(ctx.sessao.usuarioId);
        return null;
      },
    },
    {},
  );
}

/**
 * O Better Auth lança `APIError`, que não é `ErroDoAplicativo`: sem tradução a
 * tela receberia "INESPERADO" e a pessoa não saberia o que corrigir.
 *
 * O que vem da política de senha JÁ é `ErroDeValidacao` (o `hooks.before`
 * propaga a exceção como foi lançada) e passa direto, com os motivos por campo.
 */
function traduzir(erro: unknown, campo: string, mensagem: string): ErroDoAplicativo {
  if (erro instanceof ErroDoAplicativo) return erro;
  return new ErroDeValidacao({ [campo]: [mensagem] });
}
