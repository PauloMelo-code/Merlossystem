"use server";

// TEMPLATE — copie para `src/lib/actions/<dominio>.ts` e ajuste.
//
// Regras que a trava T1 cobra neste arquivo:
//   - TODO export passa por `executarAcao()`/`acao()` ou por
//     `executarAcaoPublica()`/`acaoPublica()`. Sem excecao.
//   - `export const` e PROIBIDO em arquivo "use server": ele nao aparece para
//     o `project-map.mjs` e escapa da varredura de portao. Use
//     `export async function` chamando `executarAcao` no corpo.
//
// A ordem de `executarAcao` nao muda e voce nao precisa repeti-la:
//   sessao -> permissao -> validacao -> escopo de loja -> TRANSACAO ->
//   traducao do erro -> revalidacao.
// A transacao ja vem aberta no terceiro argumento de `executar`.

import { z } from "zod";
import { executarAcao } from "@/lib/actions/_base";
import { atualizarComTrava, excluirLogico, inserirAuditado } from "@/lib/db/mutacoes";
import { exemplo } from "@/lib/db/schema/exemplo";
import type { Resultado } from "@/lib/erros";
import { uuidSchema } from "@/lib/validadores/comum";

/**
 * A validacao mora em `src/lib/validadores/<dominio>.ts` quando for reusada;
 * aqui, so quando for exclusiva desta action.
 *
 * `updated_at` e obrigatorio em toda edicao: e ele que a trava de colisao
 * compara. Sem ele, duas pessoas salvando ao mesmo tempo sobrescrevem uma a
 * outra em silencio.
 */
const criarEntrada = z.object({
  nome: z.string().trim().min(2).max(120),
  valor: z.string().regex(/^\d+\.\d{2}$/, "use o formato 1234.56"),
});

/** `updated_at` chega como string ISO do campo oculto do formulario. */
const alvoExistente = z.object({ id: uuidSchema, updated_at: z.coerce.date() });

const editarEntrada = criarEntrada.extend(alvoExistente.shape);

export async function criarExemplo(bruto: unknown): Promise<Resultado<{ id: string }>> {
  return executarAcao(
    {
      // Chave da matriz de `02-seguranca.md` secao 2.2. Chave que nao existe na
      // matriz reprova em T12; entrada da matriz que nenhuma tela usa, tambem.
      permissao: "exemplo:criar",
      entrada: criarEntrada,
      // "grava" exige uma loja RESOLVIDA; "le" aceita `todas`; "nenhuma"
      // ignora o escopo (so para o que nao pertence a loja).
      loja: "grava",
      revalidar: ["/exemplo"],
      executar: async (dados, ctx, tx) => {
        const linha = await inserirAuditado(
          tx,
          exemplo,
          // Campo por campo. NUNCA `...dados`: um `papel` ou um `loja_id` vindo
          // do formulario entraria direto na linha.
          {
            loja_id: ctx.escopo.tipo === "uma" ? ctx.escopo.lojaId : null,
            nome: dados.nome,
            valor: dados.valor,
          },
          ctx,
          "exemplo_criado",
        );
        return { id: String(linha.id) };
      },
    },
    bruto,
  );
}

export async function editarExemplo(bruto: unknown): Promise<Resultado<{ id: string }>> {
  return executarAcao(
    {
      permissao: "exemplo:editar",
      entrada: editarEntrada,
      loja: "grava",
      revalidar: ["/exemplo"],
      executar: async (dados, ctx, tx) => {
        await atualizarComTrava(
          tx,
          exemplo,
          {
            id: dados.id,
            escopo: ctx.escopo,
            // Zero linhas aqui vira `ErroDeColisao`, com quem gravou e quando.
            updatedAtOriginal: dados.updated_at,
            dados: { nome: dados.nome, valor: dados.valor },
          },
          ctx,
          "exemplo_editado",
        );
        return { id: dados.id };
      },
    },
    bruto,
  );
}

/**
 * Exclusao e SEMPRE logica: `excluirLogico()` marca `is_deleted`, carimba
 * `deleted_at` e grava a trilha. Nenhum `DELETE` de linha existe no sistema.
 *
 * Acao critica: a tela chama isto de dentro do `ModalConfirmacaoBlock` (3 s), e
 * o identificador da tela entra em `ACOES_COM_BLOCK`.
 */
export async function excluirExemplo(bruto: unknown): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: "exemplo:excluir",
      entrada: alvoExistente,
      loja: "grava",
      revalidar: ["/exemplo"],
      executar: async (dados, ctx, tx) => {
        await excluirLogico(
          tx,
          exemplo,
          { id: dados.id, escopo: ctx.escopo, updatedAtOriginal: dados.updated_at },
          ctx,
          "exemplo_excluido",
        );
        return null;
      },
    },
    bruto,
  );
}

/**
 * Acao ANONIMA (login, convite, reset) usa `executarAcaoPublica`, que confere a
 * ORIGEM primeiro e aplica teto por IP. `motivo` e obrigatorio: e ele que entra
 * no manifesto de rotas publicas e na trava T2.
 */
