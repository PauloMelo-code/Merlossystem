import { logger } from "@/lib/logger";
import { fila, OPCOES_PADRAO, type JobDaFila, type NomeDeFila } from "./filas";

/**
 * Trabalhos periódicos (03-arquitetura.md §8.1 e §8.2).
 *
 * O BullMQ 6 REMOVEU `repeat`: quem agenda é `upsertJobScheduler`. O nome do
 * agendador é a chave — chamar de novo com o mesmo nome ATUALIZA o cron em vez
 * de criar um segundo. É o que permite o worker registrar tudo a cada boot sem
 * acumular agendadores fantasmas a cada deploy.
 *
 * `tz` explícito e SEMPRE `America/Sao_Paulo`: sem ele o BullMQ usa UTC, e o
 * "resumo diário das 7h" chegaria às 4h da manhã — no horário de verão, em duas
 * horas diferentes conforme o mês.
 */

export const FUSO = "America/Sao_Paulo";

export type Agendamento = {
  [F in NomeDeFila]: {
    /** Nome do agendador: é a chave do upsert. Estável para sempre. */
    nome: string;
    fila: F;
    job: JobDaFila<F>;
    /** Cron de 5 campos, no fuso de São Paulo. */
    padrao: string;
    porque: string;
  };
}[NomeDeFila];

/**
 * Horários espalhados de propósito: seis jobs pesados na mesma marca de meia
 * noite disputariam o mesmo pool do Postgres e o `manutencao` tem concorrência 1
 * — o último da fila só rodaria de manhã.
 */
export const AGENDAMENTOS: readonly Agendamento[] = [
  {
    nome: "expirar-convites-hora",
    fila: "manutencao",
    job: "expirar-convites",
    padrao: "7 * * * *",
    porque: "convite vencido que continua aceitável é porta de entrada aberta (§9.2)",
  },
  {
    nome: "gerar-alertas-15min",
    fila: "manutencao",
    job: "gerar-alertas",
    padrao: "*/15 * * * *",
    porque: "número caído e mensagem sem resposta precisam aparecer no mesmo turno",
  },
  {
    nome: "conferir-sessao-uazapi-10min",
    fila: "integracoes",
    job: "conferir-sessao-uazapi",
    padrao: "*/10 * * * *",
    porque: "sessão não oficial cai sozinha; sem sonda, ninguém descobre até a campanha falhar",
  },
  {
    nome: "sincronizar-templates-30min",
    fila: "integracoes",
    job: "sincronizar-templates",
    padrao: "23,53 * * * *",
    porque: "modelo reprovado pela Meta faz a campanha por número oficial nascer morta (§8.1)",
  },
  {
    nome: "renovar-token-hora",
    fila: "integracoes",
    job: "renovar-token",
    padrao: "40 * * * *",
    porque: "o token de acesso do Bling vale 6 h; de hora em hora sobra folga para falha transitória",
  },
  {
    nome: "sincronizar-bling-hora",
    fila: "integracoes",
    job: "sincronizar-bling",
    padrao: "17 * * * *",
    porque: "catálogo e saldo são espelho do Bling; sem agendador ninguém atualiza o espelho",
  },
  {
    nome: "retencao-eventos-diario",
    fila: "manutencao",
    job: "retencao-eventos",
    padrao: "10 4 * * *",
    porque: "anonimiza corpo, cabeçalhos e ip com mais de 30 dias — por UPDATE, sem apagar linha",
  },
  {
    nome: "limpar-midia-diario",
    fila: "manutencao",
    job: "limpar-midia",
    padrao: "30 4 * * *",
    porque: "objeto do MinIO de linha excluída há mais de 90 dias (§8.1)",
  },
  {
    nome: "reconciliacao-diario",
    fila: "manutencao",
    job: "reconciliacao",
    padrao: "50 4 * * *",
    porque: "espelho opt_out e contadores divergem em silêncio; gera alerta, não corrige sozinho",
  },
  {
    nome: "resumo-diario",
    fila: "manutencao",
    job: "resumo-diario",
    padrao: "0 7 * * *",
    porque: "o dono quer o número do dia anterior antes de abrir a loja",
  },
];

/**
 * Nomes que já foram publicados e mudaram de cadência. O upsert pelo nome novo
 * NÃO apaga o antigo: sem removê-lo, o job rodaria nas duas cadências.
 */
export const AGENDADORES_APOSENTADOS: readonly { nome: string; fila: NomeDeFila }[] = [
  { nome: "sincronizar-templates-hora", fila: "integracoes" },
  { nome: "renovar-token-diario", fila: "integracoes" },
];

/**
 * Registra (ou atualiza) todos os agendadores. Chamado UMA vez, no boot do
 * worker: quem agenda é quem processa, senão um app sem worker encheria a fila
 * de trabalho que ninguém consome.
 */
export async function registrarAgendamentos(): Promise<void> {
  for (const a of AGENDADORES_APOSENTADOS) {
    await fila(a.fila).removeJobScheduler(a.nome);
  }
  for (const a of AGENDAMENTOS) {
    // As `defaultJobOptions` da fila NÃO alcançam o job produzido pelo
    // agendador: o BullMQ usa o `opts` do template. Sem repeti-las aqui, todo
    // job periódico nasceria com `attempts: 1` e uma falha transitória de rede
    // mandaria o job direto para a DLQ, sem nenhuma retentativa.
    await fila(a.fila).upsertJobScheduler(
      a.nome,
      { pattern: a.padrao, tz: FUSO },
      { name: a.job, opts: { ...OPCOES_PADRAO } },
    );
    logger.info({ agendador: a.nome, fila: a.fila, padrao: a.padrao }, "agendamento registrado");
  }
}
