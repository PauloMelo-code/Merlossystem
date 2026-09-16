import type { AcaoAuditada } from "@/lib/db/schema/_enums/auditoria";

/**
 * Ação da trilha de negócio para o que o M6 grava FORA de campanha.
 *
 * PROVISÓRIO E DECLARADO (bloqueio registrado pelo pacote M6): a lista fechada
 * `ACOES_AUDITADAS` (01-dados.md §7.4) não tem `resposta_rapida_*`,
 * `agendamento_*` nem `template_criado|alterado|excluido`, e ampliá-la exige
 * migração do CHECK — que é da fundação. Até lá, a trilha grava a ação mais
 * próxima que o CHECK aceita, e a coluna `entidade` (nome da tabela) diz o que
 * foi tocado; o `antes`/`depois` diz se foi criação ou edição.
 *
 * Quando a migração entrar, só este arquivo muda.
 */
export const TRILHA_CONTEUDO = {
  criado: "campanha_criada",
  alterado: "campanha_criada",
  excluido: "campanha_excluida",
  /** Modelo pertence à conta: alterar o modelo é alterar a integração. */
  modeloAlterado: "integracao_alterada",
} as const satisfies Record<string, AcaoAuditada>;
