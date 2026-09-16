import type { Job } from "bullmq";
import { gerarAlertas as gerarNoDominio, reconciliar } from "@/lib/alertas";
import { anonimizarEventosAntigos, contarConvitesVencidos } from "@/lib/auditoria";
import { logger } from "@/lib/logger";
import { limparMidiasExpiradas, removerBinarios } from "@/lib/midias";
import { resumirDiaAnterior } from "@/lib/relatorios";

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
 *   expirarConvites   conta os convites vencidos que ainda seguram o e-mail
 *   reconciliacao     acha espelho divergente e NÃO corrige
 *   resumoDiario      números do dia anterior
 */

export type DadosManutencao = {
  /** Nulo = varre a rede inteira. Presente = só aquela loja. */
  lojaId?: string;
  /** Só em `limpar-midia` vindo da anonimização LGPD. */
  solicitacaoId?: string;
  midiaIds?: string[];
};

type JobManutencao = Job<DadosManutencao>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Carga de fila é entrada externa ao processo: confere antes de usar. */
function lojaDo(job: JobManutencao): string | null {
  const lojaId = job.data?.lojaId;
  return typeof lojaId === "string" && UUID.test(lojaId) ? lojaId : null;
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
    const removidos = await removerBinarios(ids);
    // `lgpd_solicitacoes.resultado.objetos_removidos` é do módulo LGPD, que
    // ainda não expõe a gravação (bloqueio registrado): fica o log.
    logger.info({ solicitacaoId: job.data.solicitacaoId, removidos }, "limpar-midia (LGPD)");
    return;
  }
  const removidos = await limparMidiasExpiradas(lojaDo(job) ?? undefined);
  logger.info({ removidos }, "limpar-midia (90 dias)");
}

export async function expirarConvites(): Promise<void> {
  await contarConvitesVencidos();
}

export async function reconciliacao(job: JobManutencao): Promise<void> {
  await reconciliar(lojaDo(job));
}

export async function resumoDiario(job: JobManutencao): Promise<void> {
  await resumirDiaAnterior(lojaDo(job));
}
