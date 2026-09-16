import type { Job } from "bullmq";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: M8 (05-plano-construcao.md §5).
 *
 * Fila `manutencao`, concorrência 1, tudo agendado por `fila/agendamentos.ts`.
 *
 * NENHUM JOB DESTA FILA APAGA LINHA (02-seguranca.md §21, S-09). A tabela de
 * `03-arquitetura.md §8.1` cita um `limpeza-auth`; ele não existe, porque quem
 * apaga linha de sessão, verificação, fator e passkey é a própria biblioteca,
 * por dentro. A única exclusão física do sistema é de ARQUIVO, em `limparMidia`.
 *
 *   `gerarAlertas`      número caído, mensagem sem resposta, campanha parada.
 *   `retencaoEventos`   diário: ANONIMIZA `corpo`, `cabecalhos` e `ip` de
 *                       `lojas_integracoes_eventos` com mais de 30 dias, por
 *                       `UPDATE`. Nenhuma linha some, nenhum papel extra de banco.
 *   `limparMidia`       remove do MinIO o objeto de linha excluída há mais de
 *                       90 dias; chama `src/lib/midias/limpeza.ts` (M3). Objeto
 *                       ausente = sucesso.
 *   `expirarConvites`   convite vencido deixa de ser aceitável.
 *   `reconciliacao`     noturno: confere o espelho `contatos.opt_out` × última
 *                       linha de `consentimentos` e os contadores de `contatos`
 *                       × `pedidos`. GERA ALERTA quando diverge; NÃO corrige em
 *                       silêncio — correção automática esconde o defeito que a
 *                       divergência denuncia.
 *   `resumoDiario`      números do dia anterior para o dono.
 */

export type DadosManutencao = {
  /** Nulo = varre a rede inteira. Presente = só aquela loja. */
  lojaId?: string;
};

type JobManutencao = Job<DadosManutencao>;

export async function gerarAlertas(job: JobManutencao): Promise<void> {
  throw naoImplementado(`gerarAlertas [${job.name} #${job.id}] (fila manutencao, pacote M8)`);
}

export async function retencaoEventos(job: JobManutencao): Promise<void> {
  throw naoImplementado(`retencaoEventos [${job.name} #${job.id}] (fila manutencao, pacote M8)`);
}

export async function limparMidia(job: JobManutencao): Promise<void> {
  throw naoImplementado(`limparMidia [${job.name} #${job.id}] (fila manutencao, pacote M8 com M3)`);
}

export async function expirarConvites(job: JobManutencao): Promise<void> {
  throw naoImplementado(`expirarConvites [${job.name} #${job.id}] (fila manutencao, pacote M8)`);
}

export async function reconciliacao(job: JobManutencao): Promise<void> {
  throw naoImplementado(`reconciliacao [${job.name} #${job.id}] (fila manutencao, pacote M8)`);
}

export async function resumoDiario(job: JobManutencao): Promise<void> {
  throw naoImplementado(`resumoDiario [${job.name} #${job.id}] (fila manutencao, pacote M8)`);
}
