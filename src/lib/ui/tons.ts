import { PAPEIS } from "@/lib/db/schema/_enums/auth";
import type { Papel } from "@/lib/db/schema/_enums/auth";
import { STATUS_CAMPANHA, STATUS_DESTINATARIO } from "@/lib/db/schema/_enums/catalogo";
import type { StatusCampanha, StatusDestinatario } from "@/lib/db/schema/_enums/catalogo";
import { CATEGORIAS_ARTIGO } from "@/lib/db/schema/_enums/catalogo";
import type { CategoriaArtigo } from "@/lib/db/schema/_enums/catalogo";
import {
  PRIORIDADES,
  STATUS_AGENDAMENTO,
  STATUS_CONVERSA,
  STATUS_ENTREGA,
  STATUS_TRANSCRICAO,
} from "@/lib/db/schema/_enums/conversas";
import type {
  Prioridade,
  StatusAgendamento,
  StatusConversa,
  StatusEntrega,
  StatusTranscricao,
} from "@/lib/db/schema/_enums/conversas";
import { FUNCOES_IA, INTENCOES_IA, RESULTADOS_IA, SENTIMENTOS_IA } from "@/lib/db/schema/_enums/inteligencia";
import type { FuncaoIa, IntencaoIa, ResultadoIa, SentimentoIa } from "@/lib/db/schema/_enums/inteligencia";
import {
  ESTAGIOS_NEGOCIO,
  MASC_STATUS,
  STATUS_DEVOLUCAO,
  STATUS_PAGAMENTO,
  STATUS_PAGAMENTO_PEDIDO,
  STATUS_PEDIDO,
  TIPOS_DEVOLUCAO,
} from "@/lib/db/schema/_enums/pedidos";
import type {
  EstagioNegocio,
  MascStatus,
  StatusDevolucao,
  StatusPagamento,
  StatusPagamentoPedido,
  StatusPedido,
  TipoDevolucao,
} from "@/lib/db/schema/_enums/pedidos";
import { SEVERIDADES, STATUS_INTEGRACAO, STATUS_TEMPLATE, TIPOS_ALERTA } from "@/lib/db/schema/_enums/plataforma";
import type {
  ProvedorDeConversa,
  Severidade,
  StatusIntegracao,
  StatusTemplate,
  TipoAlerta,
} from "@/lib/db/schema/_enums/plataforma";

/**
 * Mapa enum -> rótulo PT-BR + tom (04-ui.md §2.4).
 *
 * Os VALORES vêm de `src/lib/db/schema/_enums/` e nunca são redigitados: cada
 * mapa é tipado como `Record<TipoDoEnum, Entrada>`, então valor novo no enum
 * quebra o build aqui em vez de aparecer cru na tela. `selo-status.tsx` é o
 * único componente que renderiza este par — foi assim que os 9 mapas
 * duplicados do sistema antigo morreram.
 *
 * Gatilho de pesquisa não ganha selo: o rótulo dele mora em
 * `pesquisas/_regras.ts` (R2-A).
 */

export const TONS = ["sucesso", "aviso", "perigo", "info", "neutro", "marca"] as const;
export type Tom = (typeof TONS)[number];

/** `null` = o valor não ganha selo nenhum (o normal não precisa de rótulo). */
export type Entrada = { rotulo: string; tom: Tom } | null;

const STATUS_CONVERSA_TONS: Record<StatusConversa, Entrada> = {
  aberta: { rotulo: "Aberta", tom: "info" },
  pendente: { rotulo: "Aguardando", tom: "aviso" },
  resolvida: { rotulo: "Resolvida", tom: "sucesso" },
  arquivada: { rotulo: "Arquivada", tom: "neutro" },
};

/** `baixa` e `media` não ganham selo: prioridade normal não é informação. */
const PRIORIDADE_TONS: Record<Prioridade, Entrada> = {
  baixa: null,
  media: null,
  alta: { rotulo: "Alta", tom: "aviso" },
  urgente: { rotulo: "Urgente", tom: "perigo" },
};

const STATUS_ENTREGA_TONS: Record<StatusEntrega, Entrada> = {
  pendente: { rotulo: "Enviando", tom: "neutro" },
  enviada: { rotulo: "Enviada", tom: "neutro" },
  entregue: { rotulo: "Entregue", tom: "neutro" },
  lida: { rotulo: "Lida", tom: "marca" },
  falhou: { rotulo: "Não entregue", tom: "perigo" },
};

/** O número da venda no Masc é do chamador: aqui só o rótulo fixo. */
const MASC_STATUS_TONS: Record<MascStatus, Entrada> = {
  pendente: { rotulo: "Falta lançar no Masc", tom: "aviso" },
  lancado: { rotulo: "Lançado", tom: "sucesso" },
  dispensado: { rotulo: "Dispensado", tom: "neutro" },
};

const STATUS_PEDIDO_TONS: Record<StatusPedido, Entrada> = {
  confirmado: { rotulo: "Confirmado", tom: "info" },
  preparando: { rotulo: "Preparando", tom: "info" },
  enviado: { rotulo: "Enviado", tom: "info" },
  entregue: { rotulo: "Entregue", tom: "sucesso" },
  devolvido: { rotulo: "Devolvido", tom: "neutro" },
  cancelado: { rotulo: "Cancelado", tom: "perigo" },
};

const STATUS_INTEGRACAO_TONS: Record<StatusIntegracao, Entrada> = {
  conectado: { rotulo: "Conectado", tom: "sucesso" },
  desconectado: { rotulo: "Desconectado", tom: "neutro" },
  expirado: { rotulo: "Expirado", tom: "aviso" },
  erro: { rotulo: "Com erro", tom: "perigo" },
};

const STATUS_CAMPANHA_TONS: Record<StatusCampanha, Entrada> = {
  rascunho: { rotulo: "Rascunho", tom: "neutro" },
  agendada: { rotulo: "Agendada", tom: "info" },
  enviando: { rotulo: "Enviando", tom: "info" },
  pausada: { rotulo: "Pausada", tom: "aviso" },
  concluida: { rotulo: "Concluída", tom: "sucesso" },
  cancelada: { rotulo: "Cancelada", tom: "neutro" },
};

const STATUS_DESTINATARIO_TONS: Record<StatusDestinatario, Entrada> = {
  pendente: { rotulo: "Na fila", tom: "neutro" },
  reservado: { rotulo: "Na fila", tom: "neutro" },
  enviado: { rotulo: "Enviado", tom: "info" },
  entregue: { rotulo: "Entregue", tom: "info" },
  lido: { rotulo: "Lido", tom: "sucesso" },
  respondido: { rotulo: "Respondeu", tom: "sucesso" },
  falhou: { rotulo: "Falhou", tom: "perigo" },
};

const STATUS_TEMPLATE_TONS: Record<StatusTemplate, Entrada> = {
  rascunho: { rotulo: "Rascunho", tom: "neutro" },
  enviado: { rotulo: "Em análise", tom: "info" },
  aprovado: { rotulo: "Aprovado", tom: "sucesso" },
  rejeitado: { rotulo: "Rejeitado", tom: "perigo" },
  pausado: { rotulo: "Pausado", tom: "aviso" },
};

const STATUS_AGENDAMENTO_TONS: Record<StatusAgendamento, Entrada> = {
  agendada: { rotulo: "Agendada", tom: "info" },
  enviada: { rotulo: "Enviada", tom: "sucesso" },
  cancelada: { rotulo: "Cancelada", tom: "neutro" },
  falhou: { rotulo: "Falhou", tom: "perigo" },
};

const SEVERIDADE_TONS: Record<Severidade, Entrada> = {
  baixa: { rotulo: "Baixa", tom: "neutro" },
  media: { rotulo: "Média", tom: "info" },
  alta: { rotulo: "Alta", tom: "aviso" },
  critica: { rotulo: "Crítica", tom: "perigo" },
};

/**
 * O tipo do alerta é ROTULO; a cor vem da severidade, que é o campo que
 * gradua. Dois tons na mesma linha competiriam e nenhum seria lido.
 */
const TIPO_ALERTA_TONS: Record<TipoAlerta, Entrada> = {
  sla_estourado: { rotulo: "SLA estourado", tom: "neutro" },
  risco_avaliacao: { rotulo: "Risco de avaliação ruim", tom: "neutro" },
  negocio_parado: { rotulo: "Negócio parado", tom: "neutro" },
  pagamento_pendente: { rotulo: "Pagamento pendente", tom: "neutro" },
  primeiro_contato: { rotulo: "Primeiro contato", tom: "neutro" },
  cliente_retornando: { rotulo: "Cliente retornando", tom: "neutro" },
  follow_up_atrasado: { rotulo: "Retorno atrasado", tom: "neutro" },
  sessao_uazapi_caiu: { rotulo: "Sessão do uazapi caiu", tom: "neutro" },
  integracao_com_erro: { rotulo: "Integração com erro", tom: "neutro" },
  espelho_divergente: { rotulo: "Dados divergentes", tom: "neutro" },
  pagamento_conferir: { rotulo: "Pagamento para conferir", tom: "neutro" },
  aviso_seguranca: { rotulo: "Aviso de segurança", tom: "neutro" },
};

const ESTAGIO_NEGOCIO_TONS: Record<EstagioNegocio, Entrada> = {
  lead: { rotulo: "Lead", tom: "neutro" },
  interessada: { rotulo: "Interessada", tom: "info" },
  negociando: { rotulo: "Negociando", tom: "info" },
  fechando: { rotulo: "Fechando", tom: "marca" },
  ganho: { rotulo: "Ganho", tom: "sucesso" },
  perdido: { rotulo: "Perdido", tom: "neutro" },
};

const STATUS_DEVOLUCAO_TONS: Record<StatusDevolucao, Entrada> = {
  solicitada: { rotulo: "Solicitada", tom: "aviso" },
  aprovada: { rotulo: "Aprovada", tom: "info" },
  em_transito: { rotulo: "A caminho da loja", tom: "info" },
  recebida: { rotulo: "Recebida na loja", tom: "aviso" },
  concluida: { rotulo: "Concluída", tom: "sucesso" },
  negada: { rotulo: "Negada", tom: "neutro" },
};

/** Tipo é rótulo, não estado: tom neutro. */
const TIPO_DEVOLUCAO_TONS: Record<TipoDevolucao, Entrada> = {
  troca: { rotulo: "Troca", tom: "neutro" },
  devolucao: { rotulo: "Devolução", tom: "neutro" },
  reembolso: { rotulo: "Reembolso", tom: "neutro" },
};

const STATUS_PAGAMENTO_TONS: Record<StatusPagamento, Entrada> = {
  pendente: { rotulo: "Aguardando pagamento", tom: "aviso" },
  aprovado: { rotulo: "Pago", tom: "sucesso" },
  recusado: { rotulo: "Recusado", tom: "perigo" },
  expirado: { rotulo: "Vencida", tom: "neutro" },
  cancelado: { rotulo: "Cancelada", tom: "neutro" },
  estornado: { rotulo: "Estornado", tom: "neutro" },
};

/** `pendente` sem selo: a maioria das vendas é paga no balcão e registrada no Masc. */
const STATUS_PAGAMENTO_PEDIDO_TONS: Record<StatusPagamentoPedido, Entrada> = {
  pendente: null,
  pago: { rotulo: "Pago", tom: "sucesso" },
  estornado: { rotulo: "Estornado", tom: "aviso" },
  cancelado: { rotulo: "Pagamento cancelado", tom: "neutro" },
};

const INTENCAO_IA_TONS: Record<IntencaoIa, Entrada> = {
  interesse_compra: { rotulo: "Quer comprar", tom: "info" },
  pergunta_preco: { rotulo: "Pergunta preço", tom: "info" },
  pergunta_tamanho: { rotulo: "Pergunta tamanho", tom: "info" },
  pergunta_disponibilidade: { rotulo: "Pergunta estoque", tom: "info" },
  pergunta_frete: { rotulo: "Pergunta frete", tom: "info" },
  pedido_troca: { rotulo: "Quer trocar", tom: "aviso" },
  reclamacao: { rotulo: "Reclamação", tom: "perigo" },
  elogio: { rotulo: "Elogio", tom: "sucesso" },
  duvida_geral: { rotulo: "Dúvida", tom: "neutro" },
  saudacao: null,
  outro: null,
};

/** Só o negativo vira selo: sentimento neutro não é informação. */
const SENTIMENTO_IA_TONS: Record<SentimentoIa, Entrada> = {
  positivo: null,
  neutro: null,
  negativo: { rotulo: "Insatisfeita", tom: "aviso" },
};

const STATUS_TRANSCRICAO_TONS: Record<StatusTranscricao, Entrada> = {
  pendente: { rotulo: "Na fila", tom: "neutro" },
  processando: { rotulo: "Transcrevendo", tom: "info" },
  concluida: { rotulo: "Transcrição automática", tom: "neutro" },
  falhou: { rotulo: "Não transcrito", tom: "perigo" },
};

const FUNCAO_IA_TONS: Record<FuncaoIa, Entrada> = {
  sugestao: { rotulo: "Sugestão", tom: "neutro" },
  resumo: { rotulo: "Resumo", tom: "neutro" },
  classificacao: { rotulo: "Classificação", tom: "neutro" },
  transcricao: { rotulo: "Transcrição", tom: "neutro" },
};

const RESULTADO_IA_TONS: Record<ResultadoIa, Entrada> = {
  sucesso: { rotulo: "Concluído", tom: "sucesso" },
  falha: { rotulo: "Falhou", tom: "perigo" },
  descartada: { rotulo: "Descartada", tom: "aviso" },
  recusada_limite: { rotulo: "Limite atingido", tom: "aviso" },
};

const CATEGORIA_ARTIGO_TONS: Record<CategoriaArtigo, Entrada> = {
  medidas: { rotulo: "Medidas", tom: "neutro" },
  frete: { rotulo: "Frete", tom: "neutro" },
  troca: { rotulo: "Troca", tom: "neutro" },
  pagamento: { rotulo: "Pagamento", tom: "neutro" },
  tecidos: { rotulo: "Tecidos", tom: "neutro" },
  combinacoes: { rotulo: "Combinações", tom: "neutro" },
  procedimentos: { rotulo: "Procedimentos", tom: "neutro" },
};

/**
 * Papel também é lista fechada, e a tela nunca mostra `viewer` cru. Os rótulos
 * são os do glossário de §2.9 — um termo por conceito, igual em tela, doc e
 * conversa com o cliente.
 */
const PAPEL_TONS: Record<Papel, { rotulo: string; tom: Tom }> = {
  dono: { rotulo: "Dono", tom: "marca" },
  admin: { rotulo: "Administrador", tom: "info" },
  gerente: { rotulo: "Gerente", tom: "info" },
  vendedor: { rotulo: "Vendedora", tom: "neutro" },
  viewer: { rotulo: "Somente leitura", tom: "neutro" },
};

export const TONS_POR_DOMINIO = {
  papel: PAPEL_TONS,
  status_conversa: STATUS_CONVERSA_TONS,
  prioridade: PRIORIDADE_TONS,
  status_entrega: STATUS_ENTREGA_TONS,
  masc_status: MASC_STATUS_TONS,
  status_pedido: STATUS_PEDIDO_TONS,
  status_integracao: STATUS_INTEGRACAO_TONS,
  status_campanha: STATUS_CAMPANHA_TONS,
  status_destinatario: STATUS_DESTINATARIO_TONS,
  status_template: STATUS_TEMPLATE_TONS,
  status_agendamento: STATUS_AGENDAMENTO_TONS,
  severidade: SEVERIDADE_TONS,
  tipo_alerta: TIPO_ALERTA_TONS,
  estagio_negocio: ESTAGIO_NEGOCIO_TONS,
  status_devolucao: STATUS_DEVOLUCAO_TONS,
  tipo_devolucao: TIPO_DEVOLUCAO_TONS,
  status_pagamento: STATUS_PAGAMENTO_TONS,
  status_pagamento_pedido: STATUS_PAGAMENTO_PEDIDO_TONS,
  intencao_ia: INTENCAO_IA_TONS,
  sentimento_ia: SENTIMENTO_IA_TONS,
  status_transcricao: STATUS_TRANSCRICAO_TONS,
  funcao_ia: FUNCAO_IA_TONS,
  resultado_ia: RESULTADO_IA_TONS,
  categoria_artigo: CATEGORIA_ARTIGO_TONS,
} as const;

export type Dominio = keyof typeof TONS_POR_DOMINIO;

/** Os valores de cada domínio, para a trava provar cobertura sem redigitar. */
export const VALORES_POR_DOMINIO: Readonly<Record<Dominio, readonly string[]>> = {
  papel: PAPEIS,
  status_conversa: STATUS_CONVERSA,
  prioridade: PRIORIDADES,
  status_entrega: STATUS_ENTREGA,
  masc_status: MASC_STATUS,
  status_pedido: STATUS_PEDIDO,
  status_integracao: STATUS_INTEGRACAO,
  status_campanha: STATUS_CAMPANHA,
  status_destinatario: STATUS_DESTINATARIO,
  status_template: STATUS_TEMPLATE,
  status_agendamento: STATUS_AGENDAMENTO,
  severidade: SEVERIDADES,
  tipo_alerta: TIPOS_ALERTA,
  estagio_negocio: ESTAGIOS_NEGOCIO,
  status_devolucao: STATUS_DEVOLUCAO,
  tipo_devolucao: TIPOS_DEVOLUCAO,
  status_pagamento: STATUS_PAGAMENTO,
  status_pagamento_pedido: STATUS_PAGAMENTO_PEDIDO,
  intencao_ia: INTENCOES_IA,
  sentimento_ia: SENTIMENTOS_IA,
  status_transcricao: STATUS_TRANSCRICAO,
  funcao_ia: FUNCOES_IA,
  resultado_ia: RESULTADOS_IA,
  categoria_artigo: CATEGORIAS_ARTIGO,
};

/**
 * Valor fora da lista devolve `null` (sem selo) em vez de vazar o valor cru na
 * tela — o antigo mostrava `awaiting_reply` para a vendedora.
 */
export function tomDe(dominio: Dominio, valor: string): Entrada {
  const mapa: Record<string, Entrada> = TONS_POR_DOMINIO[dominio];
  return mapa[valor] ?? null;
}

/** O papel por extenso, para o menu do usuário e a lista de colegas. */
export function rotuloDePapel(papel: Papel): string {
  return PAPEL_TONS[papel].rotulo;
}

/** Prioridade por extenso para formulário e texto (o selo omite baixa e média de propósito). */
export const ROTULO_PRIORIDADE: Readonly<Record<Prioridade, string>> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  urgente: "Urgente",
};

/** Canal por extenso, distinguindo os dois WhatsApp (tela e texto de SLA). */
export const ROTULO_PROVEDOR_CONVERSA: Readonly<Record<ProvedorDeConversa, string>> = {
  whatsapp_oficial: "WhatsApp (oficial)",
  uazapi: "WhatsApp (não oficial)",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};

/**
 * Disponibilidade derivada de `01-dados-dominio.md §4.2` (nunca persistida).
 * Saldo desconhecido NÃO vira zero: vira "não sabemos", em tom `aviso`.
 */
export function tomDeDisponibilidade(
  disponivel: number | null,
  limiarBaixo = 3,
): { rotulo: string; tom: Tom } {
  if (disponivel === null) return { rotulo: "Não sabemos", tom: "aviso" };
  if (disponivel <= 0) return { rotulo: "Sem estoque", tom: "perigo" };
  if (disponivel <= limiarBaixo) return { rotulo: `Últimas ${disponivel}`, tom: "aviso" };
  return { rotulo: "Disponível", tom: "sucesso" };
}
