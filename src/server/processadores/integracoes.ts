import type { Job } from "bullmq";
import { emTransacao } from "@/lib/db/mutacoes";
import { ErroDeIntegracao } from "@/lib/erros";
import { enfileirar, type JobDaFila } from "@/lib/fila/filas";
import { jobId } from "@/lib/fila/idempotencia";
import { logger } from "@/lib/logger";
import { sincronizarCatalogoBling } from "@/lib/catalogo/sincronizacao";
import {
  conferirSessao,
  contaDaRede,
  contasDoProvedor,
  contextoDoSistema,
  marcarSincronizacao,
  registrarEstadoDoSistema,
  registrarProcessamentoEvento,
  renovarTokenBling,
  sincronizarModelosDaConta,
} from "@/lib/integracoes";

/**
 * Fila `integracoes` (03-arquitetura.md §8.1), concorrência 2. Dono: M5.
 *
 * Os agendadores (`fila/agendamentos.ts`) disparam SEM carga: nesse caso o job
 * faz o FAN-OUT — um job por conta, com `jobId` determinístico por janela, para
 * um agendamento repetido não empilhar trabalho. Com `integracaoId`, trabalha
 * uma conta só.
 *
 * `sincronizarBling` chama o catálogo de M4 (`src/lib/catalogo/sincronizacao.ts`,
 * costura de `05-plano §5`): a conexão é daqui, o catálogo é de lá. O limitador
 * de 3 req/s por conta Bling é o do cliente de M4, o mesmo da tela.
 */

export type DadosIntegracao = {
  lojaId?: string | null;
  integracaoId?: string;
  /** Linha do diário que motivou o job (webhook de modelo ou de sessão). */
  eventoId?: string;
};

type JobIntegracao = Job<DadosIntegracao>;

/** Janela do `jobId` do fan-out: um por conta a cada 10 minutos. */
function janela(): string {
  return String(Math.floor(Date.now() / 600_000));
}

async function espalhar(
  nome: JobDaFila<"integracoes">,
  provedor: string,
  prefixo: string,
): Promise<number> {
  const contas = await contasDoProvedor(provedor);
  for (const conta of contas) {
    await enfileirar(
      "integracoes",
      nome,
      { integracaoId: conta.id, lojaId: conta.lojaId },
      { jobId: jobId(prefixo, conta.id, janela()) },
    );
  }
  return contas.length;
}

/** Fecha a linha do diário, com o corpo trocado pela projeção mascarada. */
async function concluirEvento(eventoId: string | undefined, tipo: string): Promise<void> {
  if (!eventoId) return;
  const ctx = contextoDoSistema("worker");
  await emTransacao(ctx, (tx) =>
    registrarProcessamentoEvento(tx, eventoId, {
      tipo: "processado",
      corpo: { mascarado: true, tipo },
    }),
  );
}

/** Erro permanente vira estado da conta; o transitório sobe e a fila retenta. */
async function tratar(integracaoId: string, erro: unknown): Promise<void> {
  if (erro instanceof ErroDeIntegracao && erro.permanente) {
    logger.warn({ integracaoId, erro: erro.message }, "integração com erro permanente");
    await registrarEstadoDoSistema(integracaoId, { status: "erro", ultimoErro: erro.message });
    return;
  }
  throw erro;
}

export async function sincronizarBling(job: JobIntegracao): Promise<void> {
  const integracaoId = job.data?.integracaoId ?? (await contaDaRede("bling"))?.id;
  if (!integracaoId) {
    logger.info({ job: job.id }, "sem conta do Bling conectada: nada a sincronizar");
    return;
  }
  const resumo = await sincronizarCatalogoBling({
    integracaoId,
    ...(job.data?.lojaId ? { lojaId: job.data.lojaId } : {}),
  });
  logger.info({ integracaoId, ...resumo }, "catálogo do Bling sincronizado");
}

export async function sincronizarTemplates(job: JobIntegracao): Promise<void> {
  const { integracaoId, eventoId } = job.data ?? {};
  if (!integracaoId) {
    const n = await espalhar("sincronizar-templates", "whatsapp_oficial", "modelos");
    await concluirEvento(eventoId, "modelo");
    logger.info({ contas: n }, "sincronização de modelos distribuída");
    return;
  }
  try {
    const resumo = await sincronizarModelosDaConta(integracaoId);
    await marcarSincronizacao(integracaoId, job.data.lojaId ?? null);
    logger.info({ integracaoId, ...resumo }, "modelos sincronizados");
  } catch (erro) {
    await tratar(integracaoId, erro);
  }
}

export async function renovarToken(job: JobIntegracao): Promise<void> {
  const integracaoId = job.data?.integracaoId;
  if (!integracaoId) {
    const n = await espalhar("renovar-token", "bling", "renovar");
    logger.info({ contas: n }, "renovação de token distribuída");
    return;
  }
  const resultado = await renovarTokenBling(integracaoId);
  logger.info({ integracaoId, resultado }, "renovação de token");
}

export async function conferirSessaoUazapi(job: JobIntegracao): Promise<void> {
  const { integracaoId, eventoId } = job.data ?? {};
  if (!integracaoId) {
    const n = await espalhar("conferir-sessao-uazapi", "uazapi", "sessao");
    logger.info({ contas: n }, "conferência de sessão distribuída");
    return;
  }
  try {
    const estado = await conferirSessao(integracaoId);
    logger.info({ integracaoId, estado }, "sessão do uazapi conferida");
  } catch (erro) {
    await tratar(integracaoId, erro);
  }
  await concluirEvento(eventoId, "sessao");
}
