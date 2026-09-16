"use server";

import { executarAcao } from "./_base";
import type { Resultado } from "@/lib/erros";
import { logger } from "@/lib/logger";
import {
  abrirAtendimento,
  agendarEnvio,
  arquivarConversa as arquivarNoDominio,
  avisarConversa,
  enviarPelaTela,
  marcarComoLida,
  marcarFalhaDeEnvio,
  mudarPrioridade,
  opcoesDeFiltro,
  paginaDeConversas,
  paginaDeMensagens,
  reabrirConversa as reabrirNoDominio,
  reenviarMensagem,
  resolverConversa as resolverNoDominio,
  transferirConversa as transferirNoDominio,
  type AtendimentoAberto,
  type OpcoesDeFiltro,
  type PaginaDeConversas,
  type PaginaDeMensagens,
  type ResultadoDeGestao,
  type RespostaDoEnvio,
} from "@/lib/conversas";
import {
  abrirConversaSchema,
  alvoDeConversaSchema,
  enviarMensagemSchema,
  filtrosDaListaSchema,
  marcarLidaSchema,
  paginaDeMensagensSchema,
  prioridadeSchema,
  reenviarSchema,
  resumoSchema,
  semEntrada,
  transferirSchema,
} from "@/lib/validadores/conversas";

/**
 * Actions da tela de atendimento (04-ui.md §5.2; 02-seguranca.md §2.2).
 *
 *   ler      `conversas:ler`       lista, conversa, histórico, resumo
 *   escrever `conversas:escrever`  enviar, nota interna, reenviar, marcar lida
 *   gerir    `conversas:gerir`     transferir, resolver, reabrir, arquivar, prioridade
 *
 * A loja de quem grava é a da PRÓPRIA conversa, conferida pelo escopo da
 * pessoa (o domínio prende o contexto nela). O envio ao provedor é da fila e
 * é enfileirado DEPOIS do commit — o job nunca procura linha que ainda não existe.
 */

type Enviado = { mensagemId: string; conversaId: string };

/** Depois do commit: fila + tempo real. Fila fora = a mensagem vira `falhou` com motivo. */
async function depoisDoEnvio(r: RespostaDoEnvio, tipo: "mensagem-nova" | "mensagem-atualizada"): Promise<void> {
  if (r.envio) {
    const id = await agendarEnvio(r.envio);
    if (id === null) {
      logger.error({ mensagemId: r.mensagemId }, "envio não entrou na fila");
      await marcarFalhaDeEnvio(r.lojaId, r.mensagemId, "A fila de envio está fora do ar. Tente de novo.").catch(
        () => undefined,
      );
    }
  }
  avisarConversa(r.lojaId, tipo, { conversaId: r.conversaId, mensagemId: r.mensagemId });
}

export async function listarConversas(filtros: unknown): Promise<Resultado<PaginaDeConversas>> {
  return executarAcao(
    {
      permissao: "conversas:ler",
      entrada: filtrosDaListaSchema,
      loja: "le",
      executar: (f, ctx, tx) => paginaDeConversas(tx, ctx.escopo, ctx.autorId, f, f.cursor ?? null),
    },
    filtros,
  );
}

export async function opcoesDosFiltros(): Promise<Resultado<OpcoesDeFiltro>> {
  return executarAcao(
    {
      permissao: "conversas:ler",
      entrada: semEntrada,
      loja: "le",
      executar: (_d, ctx, tx) => opcoesDeFiltro(tx, ctx.escopo),
    },
    {},
  );
}

export async function abrirConversa(dados: unknown): Promise<Resultado<AtendimentoAberto>> {
  return executarAcao(
    {
      permissao: "conversas:ler",
      entrada: abrirConversaSchema,
      loja: "le",
      executar: (d, ctx, tx) => abrirAtendimento(tx, ctx, d.conversaId),
    },
    dados,
  );
}

export async function carregarMensagensAnteriores(dados: unknown): Promise<Resultado<PaginaDeMensagens>> {
  return executarAcao(
    {
      permissao: "conversas:ler",
      entrada: paginaDeMensagensSchema,
      loja: "le",
      executar: (d, ctx, tx) => paginaDeMensagens(tx, ctx.escopo, d.conversaId, d.cursor),
    },
    dados,
  );
}

/**
 * Reconciliação e polling de degradação (03-arquitetura.md §9): a lista e,
 * quando há conversa aberta, as últimas mensagens dela — de uma vez.
 */
export async function resumoDoAtendimento(
  dados: unknown,
): Promise<Resultado<{ lista: PaginaDeConversas; mensagens: PaginaDeMensagens | null }>> {
  return executarAcao(
    {
      permissao: "conversas:ler",
      entrada: resumoSchema,
      loja: "le",
      executar: async (d, ctx, tx) => ({
        lista: await paginaDeConversas(tx, ctx.escopo, ctx.autorId, d, null),
        mensagens: d.conversaId ? await paginaDeMensagens(tx, ctx.escopo, d.conversaId, null) : null,
      }),
    },
    dados,
  );
}

export async function enviarMensagem(dados: unknown): Promise<Resultado<Enviado>> {
  const r = await executarAcao(
    {
      permissao: "conversas:escrever",
      entrada: enviarMensagemSchema,
      loja: "le",
      executar: (d, ctx, tx) => enviarPelaTela(d, ctx, tx),
    },
    dados,
  );
  if (!r.ok) return r;
  await depoisDoEnvio(r.dados, "mensagem-nova");
  return { ok: true, dados: { mensagemId: r.dados.mensagemId, conversaId: r.dados.conversaId } };
}

export async function reenviarMensagemFalha(dados: unknown): Promise<Resultado<Enviado>> {
  const r = await executarAcao(
    {
      permissao: "conversas:escrever",
      entrada: reenviarSchema,
      loja: "le",
      executar: (d, ctx, tx) => reenviarMensagem(d, ctx, tx),
    },
    dados,
  );
  if (!r.ok) return r;
  await depoisDoEnvio(r.dados, "mensagem-atualizada");
  return { ok: true, dados: { mensagemId: r.dados.mensagemId, conversaId: r.dados.conversaId } };
}

export async function marcarConversaComoLida(dados: unknown): Promise<Resultado<{ conversaId: string }>> {
  return executarAcao(
    {
      permissao: "conversas:escrever",
      entrada: marcarLidaSchema,
      loja: "le",
      executar: (d, ctx, tx) => marcarComoLida(d, ctx, tx),
    },
    dados,
  );
}

/** Gestão reversível: executa já e avisa as outras abas da loja. */
async function comAviso(r: Promise<Resultado<ResultadoDeGestao>>): Promise<Resultado<ResultadoDeGestao>> {
  const resultado = await r;
  if (resultado.ok) {
    avisarConversa(resultado.dados.lojaId, "conversa-atualizada", { conversaId: resultado.dados.conversaId });
  }
  return resultado;
}

export async function transferirConversa(dados: unknown): Promise<Resultado<ResultadoDeGestao>> {
  return comAviso(
    executarAcao(
      { permissao: "conversas:gerir", entrada: transferirSchema, loja: "le", executar: transferirNoDominio },
      dados,
    ),
  );
}

export async function resolverConversa(dados: unknown): Promise<Resultado<ResultadoDeGestao>> {
  return comAviso(
    executarAcao({ permissao: "conversas:gerir", entrada: alvoDeConversaSchema, loja: "le", executar: resolverNoDominio }, dados),
  );
}

export async function reabrirConversa(dados: unknown): Promise<Resultado<ResultadoDeGestao>> {
  return comAviso(
    executarAcao({ permissao: "conversas:gerir", entrada: alvoDeConversaSchema, loja: "le", executar: reabrirNoDominio }, dados),
  );
}

export async function arquivarConversa(dados: unknown): Promise<Resultado<ResultadoDeGestao>> {
  return comAviso(
    executarAcao({ permissao: "conversas:gerir", entrada: alvoDeConversaSchema, loja: "le", executar: arquivarNoDominio }, dados),
  );
}

export async function mudarPrioridadeDaConversa(dados: unknown): Promise<Resultado<ResultadoDeGestao>> {
  return comAviso(
    executarAcao({ permissao: "conversas:gerir", entrada: prioridadeSchema, loja: "le", executar: mudarPrioridade }, dados),
  );
}
