import type { AcaoAuditada } from "@/lib/db/schema/_enums/auditoria";

/**
 * Ação da trilha por operação do atendimento (lista fechada `ACOES_AUDITADAS`,
 * migração 0018). Quem grava sem pessoa (webhook, worker) usa
 * `contextoDeSistema()` de `@/lib/db/mutacoes`: o autor é o `ATOR_SISTEMA`.
 */
export const ACAO = {
  mensagemEnviada: "mensagem_enviada",
  mensagemRecebida: "mensagem_recebida",
  notaInterna: "mensagem_nota_interna",
  reenvio: "mensagem_reenviada",
  midiaEnviada: "midia_enviada",
  midiaRecebida: "midia_recebida",
  conversaCriada: "conversa_criada",
  conversaReaberta: "conversa_reaberta",
  conversaResolvida: "conversa_resolvida",
  conversaArquivada: "conversa_arquivada",
  conversaTransferida: "conversa_transferida",
  prioridade: "conversa_prioridade_alterada",
} as const satisfies Record<string, AcaoAuditada>;
