import type { EscopoLoja } from "@/lib/auth/loja";
import { ATOR_SISTEMA } from "./schema/_enums/auth";

/**
 * Contexto de gravação SEM pessoa: webhook e worker (03-arquitetura.md §6.4).
 *
 * `mutacoes.ts` e o gravador da trilha só leem `escopo`, `autorId` e `origem`
 * — é o `ContextoDeGravacao`. O `Contexto` do portão (com sessão) e o
 * `ContextoDeSistema` abaixo satisfazem os dois, sem `null as unknown as
 * string` e sem sessão sintética. O contexto de sistema NÃO tem sessão: nunca
 * passa por `pode()`, e código que exigir `ctx.sessao` não compila com ele.
 *
 * `autorId` é o ATOR_SISTEMA, uuid fixo com linha semeada em `usuarios`
 * (migração 0018): satisfaz a FK de `modified_by` e a trilha grava
 * `ator_tipo = 'sistema'` com `ator_id` preenchido.
 */

export { ATOR_SISTEMA };

export type OrigemDeGravacao = "ui" | "webhook" | "worker";

export type ContextoDeGravacao = {
  escopo: EscopoLoja;
  autorId: string;
  origem: OrigemDeGravacao;
};

export type ContextoDeSistema = {
  readonly sistema: true;
  escopo: EscopoLoja;
  autorId: typeof ATOR_SISTEMA;
  origem: Exclude<OrigemDeGravacao, "ui">;
};

/**
 * Sem `lojaId`, o escopo é `todas`: só serve para o que nasce antes de a loja
 * ser resolvida (o diário de ingestão) e para job de rede (sincronização do
 * Bling). Gravação de domínio de loja passa o `lojaId`.
 */
export function contextoDeSistema(opcoes: {
  origem: ContextoDeSistema["origem"];
  lojaId?: string | null;
}): ContextoDeSistema {
  return {
    sistema: true,
    escopo: opcoes.lojaId ? { tipo: "uma", lojaId: opcoes.lojaId } : { tipo: "todas" },
    autorId: ATOR_SISTEMA,
    origem: opcoes.origem,
  };
}
