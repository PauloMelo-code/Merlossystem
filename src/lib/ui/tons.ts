import { PAPEIS } from "@/lib/db/schema/_enums/auth";
import type { Papel } from "@/lib/db/schema/_enums/auth";
import { STATUS_CAMPANHA, STATUS_DESTINATARIO } from "@/lib/db/schema/_enums/catalogo";
import type { StatusCampanha, StatusDestinatario } from "@/lib/db/schema/_enums/catalogo";
import { PRIORIDADES, STATUS_CONVERSA, STATUS_ENTREGA, STATUS_AGENDAMENTO } from "@/lib/db/schema/_enums/conversas";
import type { Prioridade, StatusAgendamento, StatusConversa, StatusEntrega } from "@/lib/db/schema/_enums/conversas";
import { MASC_STATUS, STATUS_PEDIDO } from "@/lib/db/schema/_enums/pedidos";
import type { MascStatus, StatusPedido } from "@/lib/db/schema/_enums/pedidos";
import { SEVERIDADES, STATUS_INTEGRACAO, STATUS_TEMPLATE, TIPOS_ALERTA } from "@/lib/db/schema/_enums/plataforma";
import type { Severidade, StatusIntegracao, StatusTemplate, TipoAlerta } from "@/lib/db/schema/_enums/plataforma";

/**
 * Mapa enum -> rótulo PT-BR + tom (04-ui.md §2.4).
 *
 * Os VALORES vêm de `src/lib/db/schema/_enums/` e nunca são redigitados: cada
 * mapa é tipado como `Record<TipoDoEnum, Entrada>`, então valor novo no enum
 * quebra o build aqui em vez de aparecer cru na tela. `selo-status.tsx` é o
 * único componente que renderiza este par — foi assim que os 9 mapas
 * duplicados do sistema antigo morreram.
 *
 * Enums fora do R1 (`ESTAGIOS_NEGOCIO`, `STATUS_DEVOLUCAO`, `STATUS_PAGAMENTO`,
 * `GATILHOS_PESQUISA`) NÃO entram aqui agora: entram no commit que liga a tela.
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
