import type { Job } from "bullmq";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: M5 (05-plano-construcao.md §5).
 *
 * Fila `integracoes`, concorrência 2, limitador de 3 req/s por conta Bling.
 * Esse limitador é o MESMO objeto do caminho síncrono da tela de venda
 * (03-arquitetura.md §12.1): dois baldes separados dariam 6 req/s e a Bling
 * corta a integração da rede inteira em horário de pico.
 *
 * `sincronizarBling` é preenchido por M4, em `src/lib/catalogo/sincronizacao.ts`,
 * e chamado daqui — o catálogo é de M4, a conexão é de M5.
 *
 * `sincronizar-templates` mantém o status dos modelos do WhatsApp em dia: sem
 * ele, a campanha por número oficial nasce morta (§8.1).
 *
 * `renovar-token` gira o refresh do Bling ANTES do vencimento; `conferir-sessao-uazapi`
 * sonda o número não oficial, que cai sozinho, e publica `integracao-atualizada`.
 */

export type DadosIntegracao = {
  lojaId: string;
  integracaoId: string;
};

export async function sincronizarBling(job: Job<DadosIntegracao>): Promise<void> {
  throw naoImplementado(`sincronizarBling [${job.name} #${job.id}] (fila integracoes, pacote M5 com M4)`);
}

export async function sincronizarTemplates(job: Job<DadosIntegracao>): Promise<void> {
  throw naoImplementado(`sincronizarTemplates [${job.name} #${job.id}] (fila integracoes, pacote M5)`);
}

export async function renovarToken(job: Job<DadosIntegracao>): Promise<void> {
  throw naoImplementado(`renovarToken [${job.name} #${job.id}] (fila integracoes, pacote M5)`);
}

export async function conferirSessaoUazapi(job: Job<DadosIntegracao>): Promise<void> {
  throw naoImplementado(`conferirSessaoUazapi [${job.name} #${job.id}] (fila integracoes, pacote M5)`);
}
