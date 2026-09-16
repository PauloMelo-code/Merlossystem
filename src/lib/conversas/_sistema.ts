import type { Contexto } from "@/lib/auth/guard";
import type { AcaoAuditada } from "@/lib/db/schema/_enums/auditoria";

/**
 * Contexto de quem grava SEM pessoa: webhook e worker (03-arquitetura.md §6.4).
 *
 * PENDÊNCIA DA FUNDAÇÃO: a arquitetura manda gravar com
 * `ctx.autorId = ATOR_SISTEMA` (uuid fixo, com linha própria em `usuarios`),
 * mas essa linha e essa constante não existem no repositório. Até existirem,
 * o autor de sistema é NULO: `modified_by` aceita nulo e
 * `auditoria_eventos.ator_id` também, porque `ator_tipo = 'sistema'`
 * (CHECK `auditoria_eventos_ator_coerente`). Um uuid inventado aqui violaria a
 * FK de `modified_by` na primeira mensagem.
 *
 * A sessão sintética nunca passa por `pode()`: domínio não decide permissão.
 */
export function contextoDoSistema(lojaId: string | null, origem: "webhook" | "worker" = "worker"): Contexto {
  const autorNulo = null as unknown as string;
  return {
    sessao: {
      usuarioId: autorNulo,
      sessaoId: autorNulo,
      papel: "viewer",
      lojaId,
      ativo: true,
      precisaTrocarSenha: false,
      precisaConfigurarFator: false,
    },
    // Sem loja: só o diário de ingestão, que nasce antes de a conta ser resolvida.
    escopo: lojaId ? { tipo: "uma", lojaId } : { tipo: "todas" },
    autorId: autorNulo,
    origem,
  };
}

/**
 * Ação da trilha por operação do atendimento.
 *
 * PENDÊNCIA DA FUNDAÇÃO (lista fechada `ACOES_AUDITADAS` + CHECK da migração):
 * não existem `mensagem_recebida`, `conversa_criada` nem `conversa_arquivada`.
 * Até a lista ser ampliada, as três gravam com a ação mais próxima que existe,
 * e o `depois` da trilha carrega a verdade (`direcao: 'entrada'`,
 * `status: 'arquivada'`, `antes = null` na criação). Trocar aqui é a única
 * mudança quando a lista crescer.
 */
export const ACAO = {
  mensagemEnviada: "mensagem_enviada",
  mensagemRecebida: "mensagem_enviada",
  notaInterna: "mensagem_nota_interna",
  reenvio: "mensagem_reenviada",
  midiaDaMensagem: "midia_enviada",
  conversaCriada: "conversa_reaberta",
  conversaReaberta: "conversa_reaberta",
  conversaResolvida: "conversa_resolvida",
  conversaArquivada: "conversa_resolvida",
  conversaTransferida: "conversa_transferida",
  prioridade: "conversa_prioridade_alterada",
} as const satisfies Record<string, AcaoAuditada>;
