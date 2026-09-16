// TEMPLATE — copie para `src/server/processadores/<assunto>.ts`.
//
// Para o job existir de verdade, TRES coisas:
//   1. o nome da fila e do job em `src/lib/fila/filas.ts` (`FILAS`);
//   2. a funcao registrada em `PROCESSADORES`, em `src/server/worker.ts`;
//   3. quem enfileira chamando `enfileirar()`.
//
// O worker confere a cobertura no boot: job declarado em `FILAS` sem funcao
// derruba o processo na hora de subir, nao de madrugada.

import type { Job } from "bullmq";
import { emTransacao } from "@/lib/db/mutacoes";
import { ErroDeIntegracao } from "@/lib/erros";
import { logComContexto } from "@/lib/logger";
import { publicarNaLoja } from "@/lib/tempo-real/publicar";

export type DadosExemplo = {
  lojaId: string;
  registroId: string;
};

/**
 * Um job precisa ser IDEMPOTENTE: a fila reentrega, o provedor reentrega e o
 * worker pode morrer no meio. Reprocessar nao pode duplicar nada.
 *
 * Quem garante isso nao e uma flag na memoria: e um indice unico que ja existe
 * no modelo, mais o `jobId` deterministico de quem enfileirou
 * (`jobId("envio", mensagemId)` — sem ':' , sem vazio, sem marcador de
 * pendencia; `assertJobIdPart` reprova).
 */
export async function processarExemplo(job: Job<DadosExemplo>): Promise<void> {
  const { lojaId, registroId } = job.data;

  // Todo log de job carrega os mesmos campos fixos. E o que permite seguir uma
  // conversa inteira pelo `requisicaoId`.
  const log = logComContexto({
    requisicaoId: job.id ?? "sem-id",
    origem: "worker",
    lojaId,
  });

  // Ritmo POR CONTA, quando houver: o limitador do BullMQ e por FILA. O teto
  // por numero (1 msg/s na conta nao oficial, 10 na oficial) e aplicado aqui,
  // com `consumir()` de `src/lib/seguranca/limite.ts`. Sem isso, uma campanha
  // derruba o numero da rede em horario de pico.

  const contexto = {
    // O worker nao tem sessao. O `Contexto` de sistema tem `origem: "worker"` e
    // `autorId` nulo — a trilha grava `ator_tipo = 'sistema'`.
    sessao: undefined as never,
    escopo: { tipo: "uma" as const, lojaId },
    autorId: null,
    origem: "worker" as const,
  };

  try {
    await emTransacao(contexto, async (tx, ctx) => {
      void tx;
      void ctx;
      void registroId;
      throw new Error("faca o trabalho aqui, por mutacoes.ts");
    });
  } catch (erro) {
    // ERRO PERMANENTE NAO RETENTA. Credencial invalida, contato sem
    // identificador e payload irrecuperavel nao melhoram na quinta tentativa;
    // insistir so empurra o job para a DLQ cinco vezes mais devagar.
    if (erro instanceof ErroDeIntegracao && erro.permanente) {
      log.error({ registroId, erro: erro.message }, "falha permanente: nao retenta");
      return;
    }
    throw erro;
  }

  // Tempo real DEPOIS do commit, e nunca com `await` dentro da transacao. O
  // evento nao carrega conteudo: a tela busca o dado pela action, que reaplica
  // o portao.
  publicarNaLoja(lojaId, { tipo: "conversa-atualizada", versao: Date.now() });

  log.info({ registroId }, "exemplo processado");
}
