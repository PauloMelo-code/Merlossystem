"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { executarAcao } from "./_base";
import {
  agendarLimpezaDeMidia,
  anonimizarContato,
  iniciarExportacao,
  lerDossie,
  lerHistoricoLgpd,
  registrarConsentimento,
  registrarSolicitacao,
} from "@/lib/lgpd";
import { ipDoCliente } from "@/lib/seguranca/ip";
import { uuidSchema } from "@/lib/validadores/comum";
import {
  anonimizarContatoSchema,
  iniciarExportacaoSchema,
  lerDossieSchema,
  registrarConsentimentoSchema,
  registrarSolicitacaoSchema,
} from "@/lib/validadores/lgpd";

/**
 * Consentimento, dossiê e eliminação de dados do titular (02-seguranca.md §16;
 * 01-dados-dominio.md §7 e §8).
 *
 * Permissões `lgpd:*` só para dono, admin e gerente — viewer nunca (S-15). O
 * consentimento usa `contatos:optout`, que a vendedora tem: é ela quem ouve o
 * "não quero mais receber promoção".
 *
 * Nada aqui é otimista (04-ui.md §10): a tela espera o servidor.
 */

/** O IP da prova vem do SERVIDOR (02/L-08). O corpo nem tem campo para isso. */
async function ipDaRequisicao(): Promise<string | null> {
  return ipDoCliente(await headers());
}

/** Consentimentos recentes e solicitações, para a ficha — quem lê o contato, lê isto. */
export async function historicoDoTitular(entrada: unknown) {
  return executarAcao(
    {
      permissao: "contatos:ler",
      entrada: z.object({ contatoId: uuidSchema, loja: uuidSchema.optional() }),
      loja: "le",
      executar: (dados, ctx, tx) => lerHistoricoLgpd(tx, ctx, dados.contatoId),
    },
    entrada,
  );
}

export async function registrarConsentimentoDoContato(entrada: unknown) {
  const ip = await ipDaRequisicao();
  return executarAcao(
    {
      permissao: "contatos:optout",
      entrada: registrarConsentimentoSchema,
      loja: "grava",
      revalidar: ["/contatos"],
      executar: (dados, ctx, tx) =>
        registrarConsentimento(tx, ctx, {
          contatoId: dados.contatoId,
          tipo: dados.tipo,
          concedido: dados.concedido,
          origem: "tela",
          ip,
        }),
    },
    entrada,
  );
}

/**
 * Item 20 da lista de block (§9.1). A limpeza do binário é enfileirada DEPOIS
 * do commit: `executarAcao` só devolve depois que a transação fechou.
 */
export async function eliminarDadosDoTitular(entrada: unknown) {
  const resultado = await executarAcao(
    {
      permissao: "lgpd:anonimizar",
      entrada: anonimizarContatoSchema,
      loja: "grava",
      revalidar: ["/contatos"],
      executar: (dados, ctx, tx) => anonimizarContato(tx, ctx, dados),
    },
    entrada,
  );
  if (!resultado.ok) return resultado;
  await agendarLimpezaDeMidia(resultado.dados);
  const { solicitacaoId, resultado: contagem } = resultado.dados;
  return { ok: true as const, dados: { solicitacaoId, resultado: contagem } };
}

/** Item 19 da lista de block (§9.1): abre a exportação e grava a trilha. */
export async function iniciarExportacaoDoDossie(entrada: unknown) {
  return executarAcao(
    {
      permissao: "lgpd:exportar",
      entrada: iniciarExportacaoSchema,
      loja: "grava",
      executar: (dados, ctx, tx) => iniciarExportacao(tx, ctx, dados),
    },
    entrada,
  );
}

export async function lerPaginaDoDossie(entrada: unknown) {
  return executarAcao(
    {
      permissao: "lgpd:exportar",
      entrada: lerDossieSchema,
      loja: "le",
      executar: (dados, ctx, tx) => lerDossie(tx, ctx, dados),
    },
    entrada,
  );
}

export async function registrarPedidoDeCorrecao(entrada: unknown) {
  return executarAcao(
    {
      permissao: "lgpd:registrar_solicitacao",
      entrada: registrarSolicitacaoSchema,
      loja: "grava",
      revalidar: ["/contatos"],
      executar: (dados, ctx, tx) => registrarSolicitacao(tx, ctx, dados),
    },
    entrada,
  );
}
