import { logger } from "@/lib/logger";
import { redisPublicador } from "@/lib/fila/conexao";
import {
  canalDaLoja,
  canalDeRevogacao,
  canalDoUsuario,
  type EventoTempoReal,
} from "./canal";

/**
 * Publicação de eventos de tempo real (03-arquitetura.md §9).
 *
 * Quem publica: o worker (mensagem que chegou, status de entrega, progresso de
 * campanha) e as actions (conversa transferida, alerta novo). Quem consome é
 * `src/server/sse.ts`, que mantém UM assinante por processo.
 *
 * NUNCA LANÇA e nunca é esperado com `await` dentro de transação. Tempo real é
 * conforto: se o Redis está fora, a mensagem já está no banco e a tela a
 * encontra na próxima leitura. Derrubar a gravação porque o `PUBLISH` falhou
 * seria trocar durabilidade por notificação.
 */

function publicar(canal: string, evento: EventoTempoReal): void {
  void redisPublicador()
    .publish(canal, JSON.stringify(evento))
    .catch((erro: unknown) => {
      logger.warn({ canal, tipo: evento.tipo, erro: String(erro) }, "falha ao publicar evento");
    });
}

/** Para todo mundo com escopo naquela loja. */
export function publicarNaLoja(lojaId: string, evento: Omit<EventoTempoReal, "lojaId">): void {
  publicar(canalDaLoja(lojaId), { ...evento, lojaId });
}

/** Para as abas de uma pessoa só. */
export function publicarParaUsuario(
  usuarioId: string,
  evento: Omit<EventoTempoReal, "lojaId">,
): void {
  publicar(canalDoUsuario(usuarioId), { ...evento, lojaId: null });
}

/**
 * Fecha os streams da pessoa AGORA. Chamado por `auth/sessoes.ts` ao desativar
 * a conta, trocar o papel ou encerrar as sessões: sem isto, o stream só cairia
 * no heartbeat seguinte e a aba ficaria até 25 s recebendo evento de uma loja
 * que a pessoa não alcança mais.
 */
export function revogarSessoes(usuarioId: string, motivo: string): void {
  publicar(canalDeRevogacao(usuarioId), {
    tipo: "sessao-invalidada",
    lojaId: null,
    versao: Date.now(),
    motivo,
  });
}
