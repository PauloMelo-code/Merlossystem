"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { executarAcao } from "./_base";
import { env } from "@/lib/env";
import { ErroDeEscopo, type Resultado } from "@/lib/erros";
import * as integracoes from "@/lib/integracoes";
import { listarLojas as lojasVivas, type LojaNaTela } from "@/lib/lojas";
import {
  alvoContaSchema,
  conectarPorTokenSchema,
  desconectarContaSchema,
  editarContaSchema,
  parearSchema,
  substituirCredencialSchema,
} from "@/lib/validadores/integracoes";

/**
 * Contas conectadas (04-ui.md §5.6; 02-seguranca.md §2.2, §12, §13).
 *
 * Tudo aqui é `integracoes:*`, que só `dono` e `admin` alcançam — inclusive a
 * LEITURA e a sessão do uazapi (INV-22): elas expõem estado de credencial.
 *
 * `loja: "nenhuma"` nas escritas: a loja da conta é CAMPO do formulário,
 * conferido contra `lojas` vivas, e nunca vem do cookie (§5.6).
 */

const TELA = "/configuracoes/integracoes";
const VAZIO = z.object({});

export type PainelDeIntegracoes = {
  contas: integracoes.ContaNaTela[];
  lojas: LojaNaTela[];
  blingConfigurado: boolean;
};

export async function listarIntegracoes(): Promise<Resultado<PainelDeIntegracoes>> {
  return executarAcao(
    {
      permissao: "integracoes:ler",
      entrada: VAZIO,
      loja: "le",
      executar: async (_dados, ctx) => ({
        contas: await integracoes.listarContas(ctx.escopo),
        lojas: await lojasVivas(),
        blingConfigurado: integracoes.blingConfigurado(),
      }),
    },
    {},
  );
}

export type DetalheDeIntegracao = {
  conta: integracoes.ContaNaTela;
  eventos: integracoes.EventoNaTela[];
  lojas: LojaNaTela[];
  urlDoWebhook: string | null;
};

export async function detalharIntegracao(id: string): Promise<Resultado<DetalheDeIntegracao>> {
  return executarAcao(
    {
      permissao: "integracoes:ler",
      entrada: alvoContaSchema,
      loja: "le",
      executar: async (dados, ctx) => {
        const detalhe = await integracoes.detalheDaConta(dados.id, ctx.escopo);
        if (!detalhe) throw new ErroDeEscopo();
        return {
          ...detalhe,
          lojas: await lojasVivas(),
          urlDoWebhook:
            detalhe.conta.provedor === "uazapi"
              ? new URL(`/api/webhooks/uazapi/${detalhe.conta.id}`, env.APP_URL).toString()
              : null,
        };
      },
    },
    { id },
  );
}

export type Conectada = integracoes.ContaConectada & { urlDoWebhook: string | null };

export async function conectarContaPorToken(
  _anterior: Resultado<Conectada>,
  form: FormData,
): Promise<Resultado<Conectada>> {
  return executarAcao(
    {
      permissao: "integracoes:conectar",
      entrada: conectarPorTokenSchema,
      loja: "nenhuma",
      revalidar: [TELA],
      executar: async (dados, ctx, tx) => {
        const conta = await integracoes.conectarPorToken(tx, dados, ctx);
        return {
          ...conta,
          urlDoWebhook:
            dados.provedor === "uazapi"
              ? new URL(`/api/webhooks/uazapi/${conta.id}`, env.APP_URL).toString()
              : null,
        };
      },
    },
    form,
  );
}

export async function editarIntegracao(
  _anterior: Resultado<{ updatedAt: Date }>,
  form: FormData,
): Promise<Resultado<{ updatedAt: Date }>> {
  return executarAcao(
    {
      permissao: "integracoes:editar",
      entrada: editarContaSchema,
      loja: "nenhuma",
      revalidar: [TELA],
      executar: (dados, ctx, tx) => integracoes.editarConta(tx, dados, ctx),
    },
    form,
  );
}

export async function reautenticarIntegracao(
  _anterior: Resultado<{ updatedAt: Date }>,
  form: FormData,
): Promise<Resultado<{ updatedAt: Date }>> {
  return executarAcao(
    {
      permissao: "integracoes:editar",
      entrada: substituirCredencialSchema,
      loja: "nenhuma",
      revalidar: [TELA],
      executar: (dados, ctx, tx) => integracoes.substituirCredencial(tx, dados, ctx),
    },
    form,
  );
}

export async function desconectarIntegracao(entrada: {
  id: string;
  updatedAt: string;
}): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: "integracoes:desconectar",
      entrada: desconectarContaSchema,
      loja: "nenhuma",
      revalidar: [TELA],
      executar: async (dados, ctx, tx) => {
        await integracoes.desconectarConta(tx, dados, ctx);
        return null;
      },
    },
    entrada,
  );
}

export async function parearAparelho(entrada: {
  id: string;
  updatedAt: string;
}): Promise<Resultado<integracoes.Pareamento>> {
  return executarAcao(
    {
      permissao: "integracoes:conectar",
      entrada: parearSchema,
      loja: "nenhuma",
      executar: (dados, ctx, tx) => integracoes.parearUazapi(tx, dados, ctx),
    },
    entrada,
  );
}

export async function consultarSessaoDoAparelho(id: string): Promise<Resultado<{ estado: string }>> {
  return executarAcao(
    {
      permissao: "integracoes:ler",
      entrada: alvoContaSchema,
      loja: "nenhuma",
      executar: async (dados) => ({ estado: await integracoes.conferirSessao(dados.id) }),
    },
    { id },
  );
}

/**
 * Passo 1 do OAuth do Bling: grava o nonce no cookie `__Host-` e devolve a URL
 * do Bling. O navegador vai para lá; o retorno é o Route Handler de callback.
 */
export async function iniciarConexaoBling(): Promise<Resultado<{ url: string }>> {
  return executarAcao(
    {
      permissao: "integracoes:conectar",
      entrada: VAZIO,
      loja: "nenhuma",
      executar: async (_dados, ctx) => {
        const { url, nonce } = integracoes.iniciarAutorizacaoBling(ctx.sessao);
        (await cookies()).set(integracoes.COOKIE_NONCE, nonce, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: integracoes.VALIDADE_COOKIE_S,
        });
        return { url };
      },
    },
    {},
  );
}
