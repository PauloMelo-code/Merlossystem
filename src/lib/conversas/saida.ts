import type { Contexto } from "@/lib/auth/guard";
import type { Transacao } from "@/lib/db/mutacoes";
import { ErroDeEscopo, ErroDeValidacao } from "@/lib/erros";
import { enfileirar } from "@/lib/fila/filas";
import { jobId } from "@/lib/fila/idempotencia";
import { contatoDaLoja, lerConta, lerModelo, mensagemPorChave } from "./_consultas-canal";
import { atualizarCacheDaConversa, inserirMensagem, obterConversa } from "./_gravacao";

/**
 * COSTURA — dono: M1, consumida por M6 (05-plano-construcao.md §5).
 *
 * Porta ÚNICA de saída de mensagem. Campanha e mensagem agendada não montam a
 * linha de `conversas_mensagens` por conta própria: chamam esta função. Duas
 * implementações dariam duas regras de mesclagem de conversa, e a campanha
 * abriria uma segunda conversa com a mesma cliente.
 *
 * Grava dentro da transação de quem chama (por isso recebe `tx`) e devolve o id
 * da mensagem. O ENVIO é da fila: `registrarEnvio` enfileira
 * `mensagens-saida/enviar-mensagem` com um pequeno atraso — o job que chega
 * antes do commit não acha a linha e retenta (erro transitório). A action da
 * tela, que conhece o instante do commit, usa `registrarSaida` + `agendarEnvio`.
 *
 * `chaveIdempotencia` casa com o único `(conversa_id, chave_idempotencia)`: é o
 * que impede a mesma cliente de receber a campanha duas vezes quando o lote é
 * reprocessado. A conta de saída é a `integracaoId` informada, e ela precisa
 * ser da MESMA loja. Não existe fallback de ambiente.
 */

export type EnvioParaRegistrar = {
  lojaId: string;
  contatoId: string;
  integracaoId: string;
  conteudo: string;
  chaveIdempotencia: string;
  /** Modelo aprovado (WhatsApp oficial). `conteudo` é o corpo já resolvido. */
  modelo?: { templateId: string; variaveis: string[] };
};

export type DadosDoEnvio = { lojaId: string; mensagemId: string; integracaoId: string };

export const ATRASO_DA_COSTURA_MS = 1_000;

/** Enfileira o envio. `jobId` determinístico: duas chamadas = um job só. */
export async function agendarEnvio(dados: DadosDoEnvio, atrasoMs = 0): Promise<string | null> {
  return enfileirar("mensagens-saida", "enviar-mensagem", dados, {
    jobId: jobId("envio", dados.mensagemId),
    ...(atrasoMs > 0 ? { delay: atrasoMs } : {}),
  });
}

/**
 * Reenvio: job `reenviar` com id PRÓPRIO por tentativa. Com o id do envio
 * original, o BullMQ reconhece o job já concluído e descarta o novo — a
 * mensagem ficaria em `pendente` para sempre. Quem impede reenvio duplo é o
 * claim atômico (`reivindicarReenvio`), não o id do job.
 */
export async function agendarReenvio(dados: DadosDoEnvio, tentativa: number): Promise<string | null> {
  return enfileirar("mensagens-saida", "reenviar", dados, {
    jobId: jobId("reenvio", dados.mensagemId, String(tentativa)),
  });
}

/** `{{1}}`, `{{2}}`… pelo valor da posição. Variável que falta fica visível. */
export function resolverCorpoDoModelo(corpo: string, variaveis: readonly string[]): string {
  return corpo.replace(/\{\{(\d+)\}\}/g, (marca, n: string) => variaveis[Number(n) - 1] ?? marca);
}

/** Registra a mensagem de saída. NÃO enfileira. */
export async function registrarSaida(
  tx: Transacao,
  envio: EnvioParaRegistrar,
  ctx: Contexto,
): Promise<{ mensagemId: string; conversaId: string; nova: boolean }> {
  const conta = await lerConta(tx, envio.integracaoId);
  if (!conta || conta.lojaId !== envio.lojaId) throw new ErroDeEscopo();
  if (!(await contatoDaLoja(tx, envio.lojaId, envio.contatoId))) throw new ErroDeEscopo();

  let metadados: Record<string, unknown> = {};
  if (envio.modelo) {
    const modelo = await lerModelo(tx, envio.lojaId, envio.modelo.templateId);
    if (!modelo || modelo.integracaoId !== conta.id || modelo.status !== "aprovado") {
      throw new ErroDeValidacao({ modeloId: ["Escolha um modelo aprovado deste número."] });
    }
    if (modelo.variaveis !== envio.modelo.variaveis.length) {
      throw new ErroDeValidacao({ variaveis: [`Este modelo pede ${modelo.variaveis} variável(is).`] });
    }
    // PENDÊNCIA: `MetadadosMensagem` (schema) não declara `modelo`; o jsonb
    // aceita, e é o único lugar em que o worker acha nome e variáveis.
    metadados = { modelo: { template_id: modelo.id, variaveis: envio.modelo.variaveis } };
  }

  const agora = new Date();
  const conversa = await obterConversa(tx, ctx, {
    lojaId: envio.lojaId,
    contatoId: envio.contatoId,
    integracaoId: conta.id,
    agora,
  });

  const daTela = ctx.origem === "ui";
  const tipo = envio.modelo ? "template" : "texto";
  const mensagemId = await inserirMensagem(tx, ctx, {
    lojaId: envio.lojaId,
    conversaId: conversa.id,
    direcao: "saida",
    autorTipo: daTela ? "usuario" : "campanha",
    // Da SESSÃO, nunca do corpo (06/INV-29).
    autorUsuarioId: daTela ? ctx.autorId : null,
    conteudo: envio.conteudo,
    tipo,
    externoId: null,
    statusEntrega: "pendente",
    notaInterna: false,
    chaveIdempotencia: envio.chaveIdempotencia,
    respondeAId: null,
    ocorridaEm: agora,
    metadados,
  });

  if (!mensagemId) {
    const existente = await mensagemPorChave(tx, conversa.id, envio.chaveIdempotencia);
    if (!existente) throw new Error("mensagem com a mesma chave não foi encontrada");
    return { mensagemId: existente, conversaId: conversa.id, nova: false };
  }

  await atualizarCacheDaConversa(
    tx,
    { lojaId: envio.lojaId, conversaId: conversa.id, ultimaMensagemEm: conversa.ultimaMensagemEm },
    { direcao: "saida", tipo, conteudo: envio.conteudo, notaInterna: false, ocorridaEm: agora },
    { primeiraResposta: !conversa.primeiraRespostaEm },
  );
  return { mensagemId, conversaId: conversa.id, nova: true };
}

export async function registrarEnvio(
  tx: Transacao,
  envio: EnvioParaRegistrar,
  ctx: Contexto,
): Promise<{ mensagemId: string; conversaId: string }> {
  const { mensagemId, conversaId, nova } = await registrarSaida(tx, envio, ctx);
  if (nova) {
    await agendarEnvio(
      { lojaId: envio.lojaId, mensagemId, integracaoId: envio.integracaoId },
      ATRASO_DA_COSTURA_MS,
    );
  }
  return { mensagemId, conversaId };
}
