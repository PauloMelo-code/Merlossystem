import type { AcaoAuditada } from "@/lib/db/schema/_enums/auditoria";

/**
 * Ações da trilha de negócio para o que o M6 grava FORA de campanha
 * (01-dados.md §7.4, migração 0018). A coluna `entidade` diz a tabela; a ação
 * diz o que aconteceu.
 */
export const TRILHA_RESPOSTA = {
  criado: "resposta_rapida_criada",
  alterado: "resposta_rapida_alterada",
  excluido: "resposta_rapida_excluida",
} as const satisfies Record<string, AcaoAuditada>;

export const TRILHA_MODELO = {
  criado: "template_criado",
  alterado: "template_alterado",
  excluido: "template_excluido",
} as const satisfies Record<string, AcaoAuditada>;

export const TRILHA_AGENDAMENTO = {
  criado: "agendamento_criado",
  reagendado: "agendamento_reagendado",
  cancelado: "agendamento_cancelado",
  /** O worker enviou: a trilha registra a mensagem que saiu (`mensagem_id` no diff). */
  enviado: "mensagem_enviada",
} as const satisfies Record<string, AcaoAuditada>;
