import { db } from "@/lib/db/client";
import {
  atualizarComTrava,
  atualizarEstado,
  avancarStatusDeEntrega,
  emTransacao,
  type Transacao,
} from "@/lib/db/mutacoes";
import { conversas_mensagens } from "@/lib/db/schema/conversas/mensagens";
import { ErroDeIntegracao } from "@/lib/erros";
import { consumir } from "@/lib/seguranca/limite";
import { abrirCredenciais, configDoAmbiente, criarAdaptador, ehProvedorDeCanal } from "@/lib/canais/registro";
import type { AdaptadorDeCanal, ClienteHttp, ResultadoEnvio } from "@/lib/canais/tipos";
import { lerConta, lerMensagemParaEnvio, lerModelo } from "./_consultas-canal";
import { emSavepoint } from "./_gravacao";
import { ACAO, contextoDoSistema } from "./_sistema";
import { janelaFechada } from "./regras";
import type { DadosDoEnvio } from "./saida";

/**
 * ENVIO pela fila `mensagens-saida` (03-arquitetura.md §8, §10).
 *
 * `integracao_id` DA CONVERSA decide a conta de saída — nunca o dado do job,
 * nunca o ambiente (A-12). Ritmo por CONTA aplicado aqui (§8.4): 1 msg/s no
 * uazapi, 10 msg/s no oficial. Erro classificado: permanente não retenta; o
 * transitório sobe como exceção e a fila tenta de novo. Na última tentativa, a
 * mensagem vai para `falhou` com o motivo em texto — é o que a bolha mostra.
 */

export type DesfechoDoEnvio = { desfecho: "enviada" | "falhou" | "ignorada"; conversaId: string | null };

export const RITMO_POR_PROVEDOR: Readonly<Record<string, number>> = { uazapi: 1, whatsapp_oficial: 10, instagram: 10 };

/** Erro que a fila deve retentar. */
export class ErroTransitorioDeEnvio extends ErroDeIntegracao {
  constructor(motivo: string) {
    super(motivo, false);
  }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera a vez da conta no balde de 1 s. Passou de 5 s: retenta pela fila. */
async function aguardarRitmo(contaId: string, porSegundo: number): Promise<void> {
  const limite = Date.now() + 5_000;
  for (;;) {
    const v = await consumir(`ritmo:conta:${contaId}`, { janela: 1, max: porSegundo });
    if (v.permitido) return;
    if (Date.now() > limite) throw new ErroTransitorioDeEnvio("Número no limite de envio; nova tentativa em instantes.");
    await esperar(250);
  }
}

export async function marcarFalhaDeEnvio(lojaId: string, mensagemId: string, motivo: string): Promise<void> {
  const ctx = contextoDoSistema(lojaId);
  await emTransacao(ctx, async (tx) => {
    const avancou = await avancarStatusDeEntrega(tx, mensagemId, "falhou", new Date());
    if (!avancou) return;
    await atualizarEstado(
      tx,
      conversas_mensagens,
      { id: mensagemId, escopo: ctx.escopo },
      { falha_motivo: motivo.slice(0, 500) },
    );
  });
}

/**
 * Guarda o id externo e avança para `enviada`. PENDÊNCIA DA FUNDAÇÃO:
 * `externo_id` não está em `ESTADOS_DE_SISTEMA.conversas_mensagens`; até
 * estar, ele é gravado por `atualizarComTrava` (trilha `mensagem_enviada`).
 */
async function marcarEnviada(lojaId: string, mensagemId: string, updatedAt: Date, externoId: string): Promise<void> {
  const ctx = contextoDoSistema(lojaId);
  await emTransacao(ctx, async (tx: Transacao) => {
    await emSavepoint(tx, (sp) =>
      atualizarComTrava(
        sp,
        conversas_mensagens,
        { id: mensagemId, escopo: ctx.escopo, updatedAtOriginal: updatedAt, dados: { externo_id: externoId } },
        ctx,
        ACAO.mensagemEnviada,
      ),
    ).catch(() => null);
    await avancarStatusDeEntrega(tx, mensagemId, "enviada", new Date());
  });
}

type Mensagem = NonNullable<Awaited<ReturnType<typeof lerMensagemParaEnvio>>>;

function destinoDe(provedor: string, m: Mensagem): string | null {
  if (provedor === "instagram") return m.instagramId;
  const bruto = m.telefone ?? m.whatsappId;
  return bruto ? bruto.replace(/@.*$/, "").replace(/\D/g, "") || null : null;
}

async function despachar(adaptador: AdaptadorDeCanal, lojaId: string, m: Mensagem, destino: string): Promise<ResultadoEnvio> {
  if (m.tipo === "texto") return adaptador.enviarTexto(destino, m.conteudo ?? "");
  if (m.tipo === "template") {
    const meta = (m.metadados as { modelo?: { template_id?: string; variaveis?: string[] } }).modelo;
    if (!adaptador.enviarModelo || !meta?.template_id) {
      return { ok: false, motivo: "Este número não envia modelo aprovado.", permanente: true };
    }
    const modelo = await lerModelo(db, lojaId, meta.template_id);
    if (!modelo || modelo.status !== "aprovado") {
      return { ok: false, motivo: "O modelo não está mais aprovado.", permanente: true };
    }
    return adaptador.enviarModelo(destino, { nome: modelo.nome, idioma: modelo.idioma, variaveis: meta.variaveis ?? [] });
  }
  // Mídia de saída: o binário mora no MinIO (pacote M3) e não há costura de
  // leitura dele para o M1 no R1. Falha explícita, nunca silêncio.
  return { ok: false, motivo: "Envio de mídia por este canal ainda não está disponível.", permanente: true };
}

/**
 * `ultimaTentativa`: esgotou a fila — o transitório também vira `falhou`.
 * Devolve o desfecho para o processador publicar o tempo real. `http` só é
 * trocado no teste (dublê do provedor); em produção é `buscarExterno`.
 */
export async function enviarDaFila(
  dados: DadosDoEnvio,
  ultimaTentativa: boolean,
  http?: ClienteHttp,
): Promise<DesfechoDoEnvio> {
  const m = await lerMensagemParaEnvio(db, dados.lojaId, dados.mensagemId);
  if (!m) {
    // A transação de quem registrou pode não ter feito commit ainda.
    if (ultimaTentativa) return { desfecho: "ignorada", conversaId: null };
    throw new ErroTransitorioDeEnvio("Mensagem ainda não visível.");
  }
  if (m.notaInterna || m.status !== "pendente") return { desfecho: "ignorada", conversaId: m.conversaId };

  const falhar = async (motivo: string): Promise<DesfechoDoEnvio> => {
    await marcarFalhaDeEnvio(dados.lojaId, m.id, motivo);
    return { desfecho: "falhou", conversaId: m.conversaId };
  };

  const conta = await lerConta(db, m.integracaoId);
  if (!conta || conta.lojaId !== dados.lojaId || !ehProvedorDeCanal(conta.provedor)) {
    return falhar("A conta desta conversa não existe mais.");
  }
  if (conta.status !== "conectado") return falhar(`O número ${conta.rotulo} está desconectado.`);

  const destino = destinoDe(conta.provedor, m);
  if (!destino) return falhar("A cliente não tem identificador neste canal.");

  let adaptador: AdaptadorDeCanal;
  try {
    adaptador = criarAdaptador({
      id: conta.id,
      lojaId: dados.lojaId,
      provedor: conta.provedor,
      referenciaExterna: conta.referenciaExterna,
      segredoWebhookHash: conta.segredoWebhookHash,
      credenciais: abrirCredenciais(conta.credenciaisCifradas, conta.credenciaisAad),
    }, configDoAmbiente(), http);
  } catch {
    return falhar("A credencial do número não pôde ser lida. Reconecte a conta.");
  }

  if (adaptador.exigeJanela24h && m.tipo !== "template" && janelaFechada(conta.provedor, m.ultimaEntradaEm)) {
    return falhar("Passaram 24h desde a última mensagem da cliente. Só dá para enviar um modelo aprovado.");
  }

  await aguardarRitmo(conta.id, RITMO_POR_PROVEDOR[conta.provedor] ?? 1);
  const resultado = await despachar(adaptador, dados.lojaId, m, destino);
  if (resultado.ok) {
    await marcarEnviada(dados.lojaId, m.id, m.updatedAt, resultado.externoId);
    return { desfecho: "enviada", conversaId: m.conversaId };
  }
  if (resultado.permanente || ultimaTentativa) return falhar(resultado.motivo);
  throw new ErroTransitorioDeEnvio(resultado.motivo);
}
