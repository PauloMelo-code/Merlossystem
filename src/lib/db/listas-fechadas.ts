/**
 * As duas listas fechadas de `01-dados.md §4.7`, num módulo SEM `server-only`.
 *
 * Elas são lidas em dois lugares: em tempo de execução, por
 * `atualizarContador()` e `atualizarEstado()` (`src/lib/db/mutacoes.ts`), e
 * pela trava de fonte `tests/travas/mutacoes.test.ts`. `mutacoes.ts` importa
 * `client.ts`, que importa `server-only` e estoura fora do runtime do Next —
 * por isso as constantes moram aqui, e não lá.
 */

/**
 * Contadores e caches: RELÓGIO SEPARADO do relógio da trava de colisão.
 * `atualizarContador()` nunca escreve `updated_at`, `modified_by` nem trilha.
 */
export const CONTADORES: Readonly<Record<string, readonly string[]>> = {
  conversas: [
    "ultima_mensagem_em",
    "ultima_mensagem_previa",
    "ultima_entrada_em",
    "nao_lidas",
    "primeira_resposta_em",
    "sla_estourado_em",
    // cache de sistema da classificação (R2-C, ADR 0050)
    "ia_intencao",
    "ia_urgencia",
    "ia_sentimento",
    "ia_classificada_ate",
  ],
  contatos: ["ultimo_contato_em", "ultima_compra_em", "pedidos_contagem", "pedidos_valor_total"],
  negocios: ["ultima_atividade_em"],
  lojas_integracoes: ["ultima_sincronizacao", "ultimo_erro"],
};

/** Máquinas de estado escritas pelo provedor ou pelo worker, nunca por uma pessoa. */
export const ESTADOS_DE_SISTEMA: Readonly<Record<string, readonly string[]>> = {
  /** `externo_id`: o id do provedor chega DEPOIS do envio (worker). */
  conversas_mensagens: ["status_entrega", "status_atualizado_em", "falha_motivo", "externo_id"],
  /**
   * O job `baixar-de-url` preenche a mídia e LIMPA a URL no mesmo UPDATE
   * (01-dados-dominio.md §2.4). O vínculo continua "ligação pura" para
   * pessoas; só o worker o completa. Transcrição sob demanda (R2-C, ADR 0049):
   * `transcricao_status` e `transcricao` só por `transicionarTranscricao()`.
   */
  conversas_mensagens_midias: ["midia_id", "baixada", "url_externa", "transcricao_status", "transcricao"],
  /** Quem resolve é o gerador, nunca a pessoa (01-dados.md §6.6). */
  alertas: ["resolvido_em"],
  campanhas_destinatarios: [
    "status",
    "mensagem_id",
    "externo_id",
    "erro",
    "tentativas",
    "reservado_em",
    "enviado_em",
    "entregue_em",
    "lido_em",
    "respondido_em",
  ],
  /** `ip`: a retenção de 30 dias o zera (01-dados.md §6.4). */
  lojas_integracoes_eventos: ["tipo", "processado_em", "erro", "corpo", "cabecalhos", "ip"],
};
