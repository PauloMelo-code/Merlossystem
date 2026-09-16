import { naoImplementado } from "@/lib/erros";
import type { Sessao } from "@/lib/auth/guard";
import type { EventoTempoReal } from "@/lib/tempo-real/canal";

/**
 * COSTURA — dono: M1 (05-plano-construcao.md §5). Contrato de
 * 03-arquitetura.md §9, que M1 implementa sem reabrir nenhuma destas regras:
 *
 *  1. UM SUBSCRIBER POR PROCESSO. `psubscribe` de `loja:*` e `usuario:*` numa
 *     conexão só (`redisAssinante()`), e fan-out em memória por
 *     `Map<lojaId, Set<conexao>>`. Um `createSubscriber()` por aba seriam 200
 *     conexões Redis por instância e o Redis cairia antes do teto de SSE.
 *  2. TETO POR USUÁRIO ANTES DO GLOBAL. `EVENTOS_MAX_POR_USUARIO` (3; 2 para
 *     `dono` e `admin`, alinhado ao limite de sessões). Ao exceder, fecha a
 *     conexão MAIS ANTIGA do mesmo usuário. Só então vale
 *     `EVENTOS_MAX_CONEXOES` por instância, que responde 503 e faz a UI degradar.
 *     Cada corte registra `sse_limite_atingido`.
 *  3. A SESSÃO É REAVALIADA NO LAÇO. O portão na abertura não basta: um stream
 *     vive horas. A cada heartbeat de 25 s (`: ping`) o handler reconsulta a
 *     sessão SEM renovar atividade e compara `sessaoId`, `ativo`, `papel` e
 *     `lojaId` com os do handshake. Divergiu, sumiu, expirou ou passou das 12 h
 *     → emite `sessao-invalidada` e fecha. `usuario:<id>:revogar` fecha na hora.
 *  4. `X-Accel-Buffering: no` e `Cache-Control: no-store`.
 *  5. Reconexão com `Last-Event-ID`; a UI SEMPRE reconcilia com leitura completa.
 *  6. O evento não carrega conteúdo: `{ tipo, conversaId, lojaId, versao }`.
 *
 * A limpeza acontece no `abort` do request — sem ela, o `Map` cresce a cada aba
 * fechada e o processo vaza memória até reiniciar.
 */

export type ConexaoSse = {
  usuarioId: string;
  sessaoId: string;
  lojaId: string | null;
  abertaEm: Date;
};

/** Handler de `GET /api/eventos` (Route Handler, runtime Node). */
export function abrirFluxo(req: Request, sessao: Sessao): Response {
  throw naoImplementado(`abrirFluxo [${sessao.usuarioId} em ${req.url}] (SSE, pacote M1)`);
}

/**
 * Fan-out EM MEMÓRIA para as conexões desta instância. Quem publica entre
 * processos é `src/lib/tempo-real/publicar.ts`; esta função é a outra ponta,
 * chamada pelo assinante único ao receber a mensagem do Redis.
 */
export function publicarParaLoja(lojaId: string, evento: EventoTempoReal): void {
  throw naoImplementado(`publicarParaLoja [${evento.tipo} na loja ${lojaId}] (fan-out do SSE, pacote M1)`);
}
