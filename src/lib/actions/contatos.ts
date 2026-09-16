"use server";

import { z } from "zod";
import { executarAcao } from "./_base";
import type { Resultado } from "@/lib/erros";
import { pode } from "@/lib/auth/permissoes";
import * as contatos from "@/lib/contatos";
import { uuidSchema } from "@/lib/validadores/comum";
import {
  criarContatoSchema,
  editarContatoSchema,
  etiquetarEmMassaSchema,
  etiquetasDoContatoSchema,
  excluirContatoSchema,
  filtrosContatosSchema,
} from "@/lib/validadores/contatos";

/**
 * Carteira de contatos (04-ui.md §5.3; 01-dados-dominio.md §2.1 e §2.6).
 *
 * As leituras também são actions: a página chama a action, a action chama o
 * portão e o domínio (03-arquitetura.md §4.1 — `app/**` não importa `db`).
 *
 * Toda escrita é `loja: "grava"`. O formulário manda a loja DO CONTATO no campo
 * `loja`; para vendedora e viewer esse campo é ignorado e vale o cadastro.
 *
 * NÃO EXISTE exclusão em massa (§15, R-03): a única action em lote é
 * `etiquetarContatos`, que só acrescenta etiqueta.
 */

const FICHA = z.object({ id: uuidSchema, loja: uuidSchema.optional() });

export async function listarContatos(filtros: unknown) {
  return executarAcao(
    {
      permissao: "contatos:ler",
      entrada: filtrosContatosSchema,
      loja: "le",
      executar: (dados, ctx, tx) => contatos.buscarCarteira(tx, ctx, dados),
    },
    filtros,
  );
}

/** "Exportar CSV da lista filtrada" — o MESMO filtro da tela, com teto. */
export async function exportarContatosCsv(filtros: unknown) {
  return executarAcao(
    {
      permissao: "contatos:ler",
      entrada: filtrosContatosSchema,
      loja: "le",
      executar: (dados, ctx, tx) => contatos.exportarCsv(tx, ctx, dados),
    },
    filtros,
  );
}

/** Ficha + o que a pessoa pode fazer nela (menu já filtrado). O histórico LGPD é de `actions/lgpd.ts`. */
export async function abrirFicha(entrada: unknown) {
  return executarAcao(
    {
      permissao: "contatos:ler",
      entrada: FICHA,
      loja: "le",
      executar: async (dados, ctx, tx) => {
        const ficha = await contatos.lerFicha(tx, ctx, dados.id);
        if (!ficha) return null;
        const papel = ctx.sessao.papel;
        return {
          ...ficha,
          permissoes: {
            editar: pode(papel, "contatos", "editar"),
            excluir: pode(papel, "contatos", "excluir"),
            optout: pode(papel, "contatos", "optout"),
            exportar: pode(papel, "lgpd", "exportar"),
            anonimizar: pode(papel, "lgpd", "anonimizar"),
            registrarSolicitacao: pode(papel, "lgpd", "registrar_solicitacao"),
          },
        };
      },
    },
    entrada,
  );
}

type Criado = { id: string; existeExcluido: boolean };

export async function criarContato(_anterior: Resultado<Criado>, form: FormData) {
  return executarAcao(
    {
      permissao: "contatos:criar",
      entrada: criarContatoSchema,
      loja: "grava",
      revalidar: ["/contatos"],
      executar: (dados, ctx, tx) => contatos.criarContato(tx, ctx, dados),
    },
    form,
  );
}

type Salvo = { id: string; atualizadoEm: Date };

export async function salvarContato(_anterior: Resultado<Salvo>, form: FormData) {
  return executarAcao(
    {
      permissao: "contatos:editar",
      entrada: editarContatoSchema,
      loja: "grava",
      revalidar: ["/contatos"],
      executar: (dados, ctx, tx) => contatos.editarContato(tx, ctx, dados),
    },
    form,
  );
}

/** Item 5 da lista de block (§9.1). Exclusão LÓGICA, uma por vez. */
export async function excluirContato(entrada: unknown) {
  return executarAcao(
    {
      permissao: "contatos:excluir",
      entrada: excluirContatoSchema,
      loja: "grava",
      revalidar: ["/contatos"],
      executar: (dados, ctx, tx) => contatos.excluirContato(tx, ctx, dados),
    },
    entrada,
  );
}

export async function definirEtiquetasDoContato(entrada: unknown) {
  return executarAcao(
    {
      permissao: "contatos:editar",
      entrada: etiquetasDoContatoSchema,
      loja: "grava",
      revalidar: ["/contatos"],
      executar: (dados, ctx, tx) => contatos.definirEtiquetas(tx, ctx, dados),
    },
    entrada,
  );
}

export async function etiquetarContatos(entrada: unknown) {
  return executarAcao(
    {
      permissao: "contatos:editar",
      entrada: etiquetarEmMassaSchema,
      loja: "grava",
      revalidar: ["/contatos"],
      executar: (dados, ctx, tx) => contatos.etiquetarEmMassa(tx, ctx, dados),
    },
    entrada,
  );
}
