import type { Provedor } from "@/lib/db/schema/_enums/plataforma";
import type { Severidade, TipoAlerta } from "@/lib/db/schema/_enums/plataforma";

/**
 * Regras PURAS dos alertas (01-dados.md §6.6, 04-ui.md §5.5). Sem banco, sem
 * `server-only`: a tela importa daqui o texto dos prazos de SLA.
 *
 * SLA é CONSTANTE NO CÓDIGO nesta entrega (não há tabela de configuração e
 * `/configuracoes/sla` não existe). Os valores são os do sistema antigo
 * (`levantamento/04 §9.2`): WhatsApp 5, Instagram 15, Facebook 30, TikTok 60.
 * Os dois WhatsApp (oficial e uazapi) são o mesmo canal para quem responde.
 */

export const SLA_MINUTOS: Readonly<Record<Exclude<Provedor, "bling">, number>> = {
  whatsapp_oficial: 5,
  uazapi: 5,
  instagram: 15,
  facebook: 30,
  tiktok_shop: 60,
};

/** O texto somente leitura de `/alertas` (04-ui.md §5.5). */
export const PRAZOS_SLA_TEXTO: readonly { canal: string; minutos: number }[] = [
  { canal: "WhatsApp", minutos: SLA_MINUTOS.whatsapp_oficial },
  { canal: "Instagram", minutos: SLA_MINUTOS.instagram },
  { canal: "Facebook", minutos: SLA_MINUTOS.facebook },
  { canal: "TikTok", minutos: SLA_MINUTOS.tiktok_shop },
];

/** Rede social pública: resposta que demora vira avaliação ruim. */
export const PROVEDORES_COM_RISCO_DE_AVALIACAO = ["instagram", "facebook"] as const;
export const RISCO_AVALIACAO_MINUTOS = 120;

/** Janela em que um contato ou uma conversa ainda é "novo". */
export const JANELA_NOVIDADE_HORAS = 24;
/** Cliente com compra que some por mais do que isto e volta é "retornando". */
export const AUSENCIA_RETORNO_DIAS = 30;
/** Tolerância do worker antes de chamar a agendada de atrasada. */
export const TOLERANCIA_AGENDADA_MINUTOS = 15;

/**
 * Tipos que o gerador do R1 produz. `negocio_parado` e `pagamento_pendente`
 * ficam no CHECK, mas funil e pagamentos estão FORA do R1 (01-dados.md §13.4):
 * gerar alerta de módulo que não tem tela é alerta que ninguém consegue tratar.
 */
export const TIPOS_GERADOS_R1 = [
  "sla_estourado",
  "risco_avaliacao",
  "primeiro_contato",
  "cliente_retornando",
  "follow_up_atrasado",
  "sessao_uazapi_caiu",
  "integracao_com_erro",
] as const satisfies readonly TipoAlerta[];

export type TipoGerado = (typeof TIPOS_GERADOS_R1)[number];

export const SEVERIDADE_POR_TIPO: Readonly<Record<TipoGerado, Severidade>> = {
  sla_estourado: "alta",
  risco_avaliacao: "critica",
  primeiro_contato: "media",
  cliente_retornando: "media",
  follow_up_atrasado: "alta",
  sessao_uazapi_caiu: "critica",
  integracao_com_erro: "alta",
};

/** O objeto que dá identidade ao alerta e que a tela abre. */
export type AlvoDoAlerta =
  | { tipo: "conversa"; id: string }
  | { tipo: "contato"; id: string }
  | { tipo: "agendamento"; id: string }
  | { tipo: "integracao"; id: string };

/** De que objeto cada tipo fala. */
export const ALVO_POR_TIPO: Readonly<Record<TipoGerado, AlvoDoAlerta["tipo"]>> = {
  sla_estourado: "conversa",
  risco_avaliacao: "conversa",
  primeiro_contato: "contato",
  cliente_retornando: "conversa",
  follow_up_atrasado: "agendamento",
  sessao_uazapi_caiu: "integracao",
  integracao_com_erro: "integracao",
};

/**
 * Chave de deduplicação: UMA por (tipo, objeto). O único parcial
 * `(loja_id, chave_deduplicacao) WHERE resolvido_em IS NULL` garante no banco
 * que o mesmo problema aberto não vira duas linhas; depois de resolvido, a
 * mesma chave pode abrir um alerta novo — é a reincidência honesta.
 */
export function chaveDeDeduplicacao(tipo: TipoGerado, alvo: AlvoDoAlerta): string {
  return `${tipo}|${alvo.tipo}|${alvo.id}`;
}

/** Lê de volta a chave; `null` quando não é uma chave deste gerador. */
export function lerChave(chave: string): { tipo: TipoGerado; alvo: AlvoDoAlerta } | null {
  const [tipo, alvoTipo, id] = chave.split("|");
  if (!tipo || !alvoTipo || !id) return null;
  if (!(TIPOS_GERADOS_R1 as readonly string[]).includes(tipo)) return null;
  if (!["conversa", "contato", "agendamento", "integracao"].includes(alvoTipo)) return null;
  return { tipo: tipo as TipoGerado, alvo: { tipo: alvoTipo, id } as AlvoDoAlerta };
}

/**
 * Mensagem curta e sem PII: nome e telefone da cliente NÃO entram, porque a
 * mensagem aparece no sino de toda a equipe da loja. Quem abre o objeto vê o
 * resto com o escopo dele.
 */
export function mensagemDoAlerta(tipo: TipoGerado, detalhe: { minutos?: number; rotulo?: string }): string {
  switch (tipo) {
    case "sla_estourado":
      return `Conversa sem resposta há mais de ${detalhe.minutos ?? 0} min.`;
    case "risco_avaliacao":
      return `Conversa em rede social sem resposta há mais de ${Math.round(RISCO_AVALIACAO_MINUTOS / 60)} h.`;
    case "primeiro_contato":
      return "Contato novo, ainda sem compra, aguardando o primeiro atendimento.";
    case "cliente_retornando":
      return `Cliente com compra voltou a escrever depois de mais de ${AUSENCIA_RETORNO_DIAS} dias.`;
    case "follow_up_atrasado":
      return "Mensagem agendada passou do horário e não foi enviada.";
    case "sessao_uazapi_caiu":
      return `A sessão do número "${detalhe.rotulo ?? "sem nome"}" caiu. Pareie o aparelho de novo.`;
    case "integracao_com_erro":
      return `A integração "${detalhe.rotulo ?? "sem nome"}" está com erro. Reconecte a conta.`;
  }
}

/** Para onde o alerta leva (04-ui.md §5.5: "cada alerta abre o objeto"). */
export function rotaDoAlerta(alerta: {
  tipo: string;
  conversaId: string | null;
  contatoId: string | null;
  pedidoId: string | null;
  chave: string;
}): string | null {
  if (alerta.conversaId) return `/conversas/${alerta.conversaId}`;
  if (alerta.pedidoId) return `/pedidos/${alerta.pedidoId}`;
  const lida = lerChave(alerta.chave);
  if (lida?.alvo.tipo === "integracao") return `/configuracoes/integracoes/${lida.alvo.id}`;
  if (lida?.alvo.tipo === "agendamento") return "/agendadas";
  if (alerta.contatoId) return `/contatos/${alerta.contatoId}`;
  return null;
}
