import type { Job } from "bullmq";
import { gerarAlertas as gerarNoDominio, reconciliar } from "@/lib/alertas";
import { anonimizarEventosAntigos, fecharConvitesVencidos } from "@/lib/auditoria";
import { registrarObjetosRemovidos } from "@/lib/lgpd/objetos-removidos";
import { logger } from "@/lib/logger";
import { limparMidiasExpiradas, removerBinarios } from "@/lib/midias";
import { resumirDiaAnterior } from "@/lib/relatorios";
import type { DadosManutencao } from "@/lib/fila/filas";

/**
 * Fila `manutencao` (dono: M8, 05-plano-construcao.md §5). Concorrência 1,
 * agendada por `fila/agendamentos.ts`.
 *
 * NENHUM JOB DESTA FILA APAGA LINHA (02-seguranca.md §21, S-09). A única
 * exclusão física do sistema é de ARQUIVO, em `limparMidia`, e mora em
 * `src/lib/midias/limpeza.ts` (M3). O processador só traduz o job para o
 * domínio: nada de SQL aqui (03-arquitetura.md §4.1).
 *
 *   gerarAlertas      abre e RESOLVE alertas (quem resolve é o gerador)
 *   retencaoEventos   anonimiza o diário de ingestão com mais de 30 dias
 *   limparMidia       varredura dos 90 dias, ou a lista de mídias de uma
 *                     anonimização LGPD (enfileirada depois do commit)
 *   expirarConvites   fecha (exclusão lógica) o convite vencido e libera o e-mail
 *   reconciliacao     acha espelho divergente, abre alerta e NÃO corrige
 *   resumoDiario      números do dia anterior
 */

/** A carga mora no catálogo de filas, para `enfileirar` conferir o tipo. */
export type { DadosManutencao };

type JobManutencao = Job<DadosManutencao>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuidOuNulo = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);

/** Carga de fila é entrada externa ao processo: confere antes de usar. */
function lojaDo(job: JobManutencao): string | null {
  return uuidOuNulo(job.data?.lojaId);
}

export async function gerarAlertas(job: JobManutencao): Promise<void> {
  await gerarNoDominio({ lojaId: lojaDo(job) });
}

export async function retencaoEventos(): Promise<void> {
  await anonimizarEventosAntigos();
}

export async function limparMidia(job: JobManutencao): Promise<void> {
  const ids = Array.isArray(job.data?.midiaIds)
    ? job.data.midiaIds.filter((id): id is string => typeof id === "string" && UUID.test(id))
    : [];
  if (ids.length > 0) {
    // Remoção na hora, sem esperar os 90 dias. Rodar de novo é seguro: a
    // remoção e o registro da contagem são idempotentes.
    const removidos = await removerBinarios(ids);
    const solicitacaoId = uuidOuNulo(job.data.solicitacaoId);
    if (solicitacaoId) await registrarObjetosRemovidos(solicitacaoId, removidos);
    logger.info({ solicitacaoId, removidos }, "limpar-midia (LGPD)");
    return;
  }
  const removidos = await limparMidiasExpiradas(lojaDo(job) ?? undefined);
  logger.info({ removidos }, "limpar-midia (90 dias)");
}

export async function expirarConvites(): Promise<void> {
  await fecharConvitesVencidos();
}

export async function reconciliacao(job: JobManutencao): Promise<void> {
  await reconciliar(lojaDo(job));
}

export async function resumoDiario(job: JobManutencao): Promise<void> {
  await resumirDiaAnterior(lojaDo(job));
}
