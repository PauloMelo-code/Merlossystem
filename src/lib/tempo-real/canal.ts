/**
 * Nomes de canal e forma do evento de tempo real (03-arquitetura.md §9).
 *
 * Módulo PURO: sem I/O, sem `server-only`. É lido pelo publicador (worker e
 * action), pelo assinante (`src/server/sse.ts`) e pela trava de fonte.
 *
 * O SSE NÃO CARREGA CONTEÚDO. O evento leva `{ tipo, lojaId, versao, … }` e a
 * tela busca o dado pela action, que reaplica o portão. Mandar a mensagem pelo
 * stream entregaria conteúdo de conversa a quem perdeu a permissão entre a
 * abertura do stream e o evento — e o portão da action é justamente o que
 * reconfere isso.
 */

export const EVENTOS = [
  "mensagem-nova",
  "mensagem-atualizada",
  "conversa-atualizada",
  "integracao-atualizada",
  "alerta-novo",
  "campanha-progresso",
  "sessao-invalidada",
] as const;

export type TipoDeEvento = (typeof EVENTOS)[number];

export type EventoTempoReal = {
  tipo: TipoDeEvento;
  /** Nulo só em evento de usuário (`sessao-invalidada`), que não é de loja. */
  lojaId: string | null;
  /** Monotônico por objeto: a tela descarta o que chegou fora de ordem. */
  versao: number;
  conversaId?: string;
  mensagemId?: string;
  integracaoId?: string;
  campanhaId?: string;
  alertaId?: string;
  /** Só em `sessao-invalidada`: por que o stream está sendo fechado. */
  motivo?: string;
};

/** Todo mundo com escopo naquela loja. */
export function canalDaLoja(lojaId: string): string {
  return `loja:${lojaId}`;
}

/** Abas de uma pessoa só (aviso pessoal). */
export function canalDoUsuario(usuarioId: string): string {
  return `usuario:${usuarioId}`;
}

/**
 * Canal de revogação: `auth/sessoes.ts` publica aqui ao desativar a conta,
 * trocar o papel ou encerrar as sessões, e o handler fecha na hora — sem
 * esperar o heartbeat de 25 s.
 */
export function canalDeRevogacao(usuarioId: string): string {
  return `usuario:${usuarioId}:revogar`;
}

/**
 * Os dois padrões que o assinante único do processo escuta. `usuario:*` casa
 * também `usuario:<id>:revogar`, então não existe um terceiro `psubscribe`.
 */
export const PADROES_ASSINADOS = ["loja:*", "usuario:*"] as const;

export function ehCanalDeRevogacao(canal: string): boolean {
  return canal.startsWith("usuario:") && canal.endsWith(":revogar");
}

/** Extrai o id da ponta do canal. `null` quando o nome não bate com o padrão. */
export function idDoCanal(canal: string): string | null {
  const partes = canal.split(":");
  const id = partes[1];
  return partes[0] === "loja" || partes[0] === "usuario" ? (id ?? null) : null;
}
