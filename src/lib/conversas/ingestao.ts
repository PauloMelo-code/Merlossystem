import { db } from "@/lib/db/client";
import {
  atualizarEstado,
  avancarStatusDeEntrega,
  contextoDeSistema,
  emTransacao,
  inserirAuditado,
  registrarProcessamentoEvento,
  upsertContatoPorCanal,
  type ContextoDeGravacao,
  type Transacao,
} from "@/lib/db/mutacoes";
import { conversas_mensagens } from "@/lib/db/schema/conversas/mensagens";
import { conversas_mensagens_midias } from "@/lib/db/schema/conversas/mensagens-midias";
import { logger } from "@/lib/logger";
import { guardarMidiaRecebida } from "@/lib/midias/ingestao";
import { mimePadrao, telefoneDoRemetente, tipoDeArquivo } from "@/lib/canais/normalizacao";
import { abrirCredenciais, criarAdaptador, ehProvedorDeCanal, interpretarPorProvedor } from "@/lib/canais/registro";
import type { AtualizacaoDeStatus, InterpretacaoDeWebhook, MensagemNormalizada } from "@/lib/canais/tipos";
import { lerConta, lerContaPorReferencia, lerEvento, mensagemPorExterno } from "./_consultas-canal";
import { atualizarCacheDaConversa, inserirMensagem, obterConversa } from "./_gravacao";
import { ACAO } from "./_sistema";
import { colunaDoCanal } from "./regras";

/**
 * ENTRADA de mensagem ponta a ponta (03-arquitetura.md §8.1 e §11;
 * 01-dados-dominio.md §2). Roda no worker, fila `mensagens-entrada`.
 *
 * A borda (pacote M5) já autenticou, gravou o evento cru e respondeu 200. Aqui:
 * conta → loja → contato (3 passos) → conversa → mensagem, numa transação;
 * depois do commit, o tempo real e o download das mídias.
 *
 * Idempotente por construção: reprocessar bate no único `(loja_id, externo_id)`.
 * Descarte (grupo, eco, tipo não suportado) NÃO vira contato nem conversa: fica
 * registrado no próprio evento (`tipo = 'descartado'` e o motivo na projeção).
 */

export type ResultadoDaEntrada = {
  lojaId: string | null;
  provedor: string | null;
  novas: { mensagemId: string; conversaId: string }[];
  atualizadas: { mensagemId: string; conversaId: string }[];
  conversasTocadas: string[];
  /** `conversas_mensagens_midias.id` à espera do job de download. */
  anexosParaBaixar: string[];
  descartado: string | null;
};

const NADA = (motivo: string | null, lojaId: string | null = null, provedor: string | null = null): ResultadoDaEntrada => ({
  lojaId,
  provedor,
  novas: [],
  atualizadas: [],
  conversasTocadas: [],
  anexosParaBaixar: [],
  descartado: motivo,
});

type Conta = NonNullable<Awaited<ReturnType<typeof lerConta>>>;

/** Projeção mascarada que substitui o corpo cru (01-dados.md §6.4). */
function projecao(provedor: string, i: InterpretacaoDeWebhook, motivo: string | null) {
  const primeira = i.mensagens[0];
  const telefone = primeira ? telefoneDoRemetente(primeira.remetenteId) : undefined;
  return {
    mascarado: true,
    provedor,
    tipo: primeira?.tipo ?? (i.status.length > 0 ? "status" : i.sessao ? "sessao" : "vazio"),
    externo_ids: i.mensagens.map((m) => m.externoId).slice(0, 20),
    telefone_final: telefone ? `…${telefone.slice(-4)}` : null,
    tamanho_texto: primeira?.texto?.length ?? 0,
    mensagens: i.mensagens.length,
    status: i.status.length,
    descartados: i.descartados,
    ...(i.sessao ? { sessao: i.sessao.estado } : {}),
    ...(motivo ? { motivo } : {}),
  };
}

async function descartarEvento(eventoId: string, provedor: string, i: InterpretacaoDeWebhook, motivo: string) {
  // Sem loja: o evento é descartado antes de a conta ser resolvida.
  await emTransacao(contextoDeSistema({ origem: "worker" }), (tx) =>
    registrarProcessamentoEvento(tx, eventoId, { tipo: "descartado", erro: motivo, projecao: projecao(provedor, i, motivo) }),
  );
}

/**
 * WhatsApp oficial manda só o id da mídia, que exige a credencial para virar
 * binário. Baixa FORA da transação (rede não segura trava de banco); falha
 * aqui não perde a mensagem — a mídia fica "indisponível".
 */
async function baixarMidiasDaMeta(conta: Conta, mensagens: MensagemNormalizada[]): Promise<Map<string, { bytes: Buffer; mime: string }>> {
  const baixadas = new Map<string, { bytes: Buffer; mime: string }>();
  const refs = mensagens.flatMap((m) => (m.midias ?? []).map((x) => x.idExterno).filter((x): x is string => !!x));
  if (refs.length === 0 || conta.provedor !== "whatsapp_oficial" || !conta.lojaId) return baixadas;
  try {
    const adaptador = criarAdaptador({
      id: conta.id,
      lojaId: conta.lojaId,
      provedor: "whatsapp_oficial",
      referenciaExterna: conta.referenciaExterna,
      segredoWebhookHash: conta.segredoWebhookHash,
      credenciais: abrirCredenciais(conta.credenciaisCifradas, conta.credenciaisAad),
    });
    for (const ref of refs) {
      try {
        if (adaptador.baixarMidia) baixadas.set(ref, await adaptador.baixarMidia(ref));
      } catch (erro) {
        logger.warn({ contaId: conta.id, erro: String(erro) }, "mídia da Meta indisponível");
      }
    }
  } catch (erro) {
    logger.warn({ contaId: conta.id, erro: String(erro) }, "sem credencial para baixar mídia");
  }
  return baixadas;
}

/**
 * Costura de M3 (`midias/ingestao.ts`): binário vira `lojas_midias` na hora;
 * falha (tipo recusado, MinIO fora) não derruba a mensagem — a mídia fica
 * "indisponível" na tela.
 */
async function guardarBinario(
  tx: Transacao,
  ctx: ContextoDeGravacao,
  entrada: Parameters<typeof guardarMidiaRecebida>[1],
): Promise<string | null> {
  try {
    const r = await tx.transaction((sp) => guardarMidiaRecebida(sp, entrada, ctx));
    return r.midiaId;
  } catch (erro) {
    logger.warn({ lojaId: entrada.lojaId, erro: String(erro) }, "mídia recebida não foi guardada");
    return null;
  }
}

/**
 * Uma linha de anexo por mídia. Com binário: `midia_id` já preenchido. Com
 * URL: o anexo nasce com `url_externa` (coluna de TRABALHO) e o job
 * `midia/baixar-de-url`, agendado depois do commit, preenche `midia_id` e limpa
 * a URL no mesmo UPDATE. A URL nunca é endereço de leitura.
 */
async function gravarMidias(
  tx: Transacao,
  ctx: ContextoDeGravacao,
  conta: Conta & { lojaId: string },
  mensagemId: string,
  m: MensagemNormalizada,
  baixadas: Map<string, { bytes: Buffer; mime: string }>,
): Promise<string[]> {
  const paraBaixar: string[] = [];
  for (const midia of m.midias ?? []) {
    const binario = midia.idExterno ? baixadas.get(midia.idExterno) : undefined;
    const mime = binario?.mime ?? midia.mime ?? mimePadrao(m.tipo);
    const url = midia.url && /^https:\/\//.test(midia.url) ? midia.url : undefined;

    const midiaId = binario
      ? await guardarBinario(tx, ctx, {
          lojaId: conta.lojaId,
          origem: conta.provedor,
          bytes: binario.bytes,
          tipoMime: mime,
          ...(midia.nome ? { nomeOriginal: midia.nome } : {}),
        })
      : null;
    // CHECK `midias_origem`: sem mídia guardada e sem endereço, não há linha.
    if (!midiaId && !url) continue;

    const anexo = await inserirAuditado(
      tx,
      conversas_mensagens_midias,
      {
        loja_id: conta.lojaId,
        mensagem_id: mensagemId,
        midia_id: midiaId,
        url_externa: midiaId ? null : url,
        externo_id: midia.idExterno ?? null,
        tipo_arquivo: tipoDeArquivo(m.tipo, mime),
        mime_type: mime,
        tamanho_bytes: binario?.bytes.byteLength ?? null,
        legenda: midia.legenda ?? null,
        baixada: Boolean(midiaId),
      },
      ctx,
      ACAO.midiaRecebida,
    );
    if (!midiaId) paraBaixar.push(String(anexo.id));
  }
  return paraBaixar;
}

async function gravarMensagemRecebida(
  tx: Transacao,
  ctx: ContextoDeGravacao,
  conta: Conta & { lojaId: string },
  m: MensagemNormalizada,
  baixadas: Map<string, { bytes: Buffer; mime: string }>,
  saida: ResultadoDaEntrada,
): Promise<void> {
  const lojaId = conta.lojaId;
  if (await mensagemPorExterno(tx, lojaId, m.externoId)) return; // idempotência

  const coluna = colunaDoCanal(conta.provedor);
  if (!coluna) return;
  const agora = new Date();
  const telefone = coluna === "whatsapp_id" ? telefoneDoRemetente(m.remetenteId) : undefined;
  // Os 3 passos (canal → contato do CRM pelo telefone → canal de novo) são da
  // fundação: uma regra de casamento só (01-dados-dominio.md §2.1).
  const contato = await upsertContatoPorCanal(
    tx,
    lojaId,
    {
      canal: coluna,
      valor: m.remetenteId,
      ...(telefone ? { telefone } : {}),
      ...(m.remetenteNome && !m.deMim ? { nome: m.remetenteNome } : {}),
    },
    agora,
  );

  const conversa = await obterConversa(tx, ctx, {
    lojaId,
    contatoId: String(contato.id),
    integracaoId: conta.id,
    agora: m.ocorridoEm,
  });
  const citada = m.respondendoA ? await mensagemPorExterno(tx, lojaId, m.respondendoA) : null;

  const direcao = m.deMim ? "saida" : "entrada";
  const mensagemId = await inserirMensagem(tx, ctx, {
    lojaId,
    conversaId: conversa.id,
    direcao,
    // `deMim`: quem digitou no aparelho é desconhecido — usuário sem id.
    autorTipo: m.deMim ? "usuario" : "contato",
    autorUsuarioId: null,
    conteudo: m.texto ?? null,
    tipo: m.tipo,
    externoId: m.externoId,
    statusEntrega: m.deMim ? "enviada" : null,
    notaInterna: false,
    chaveIdempotencia: null,
    respondeAId: citada?.id ?? null,
    ocorridaEm: m.ocorridoEm,
    metadados: {
      ...(m.deMim ? { enviada_pelo_aparelho: true } : {}),
      ...(m.respondendoA && !citada ? { citacao_externa_id: m.respondendoA } : {}),
    },
  });
  if (!mensagemId) return; // corrida com outra entrega do mesmo id

  saida.anexosParaBaixar.push(...(await gravarMidias(tx, ctx, conta, mensagemId, m, baixadas)));
  await atualizarCacheDaConversa(
    tx,
    { lojaId, conversaId: conversa.id, ultimaMensagemEm: conversa.ultimaMensagemEm },
    { direcao, tipo: m.tipo, conteudo: m.texto ?? null, notaInterna: false, ocorridaEm: m.ocorridoEm },
    { primeiraResposta: m.deMim && !conversa.primeiraRespostaEm },
  );
  saida.novas.push({ mensagemId, conversaId: conversa.id });
  saida.conversasTocadas.push(conversa.id);
}

/** Recibo do provedor: monotônico, e nunca tira a mensagem de `falhou`. */
async function aplicarStatus(tx: Transacao, lojaId: string, s: AtualizacaoDeStatus, saida: ResultadoDaEntrada) {
  const mensagem = await mensagemPorExterno(tx, lojaId, s.externoId);
  if (!mensagem) return;
  const avancou = await avancarStatusDeEntrega(tx, mensagem.id, s.status, s.ocorridoEm);
  if (!avancou) return;
  if (s.status === "falhou") {
    await atualizarEstado(
      tx,
      conversas_mensagens,
      { id: mensagem.id, escopo: { tipo: "uma", lojaId } },
      { falha_motivo: (s.motivo ?? "O provedor recusou a mensagem.").slice(0, 500) },
    );
  }
  saida.atualizadas.push({ mensagemId: mensagem.id, conversaId: mensagem.conversaId });
}

export type PedidoDeProcessamento = { eventoId: string; integracaoId?: string | undefined };

export async function processarEventoDeCanal(pedido: PedidoDeProcessamento): Promise<ResultadoDaEntrada> {
  const evento = await lerEvento(db, pedido.eventoId);
  if (!evento) return NADA("evento inexistente");
  if (evento.processadoEm && evento.tipo !== "falhou") return NADA(null, evento.lojaId);

  const provedor = evento.provedor;
  const interpretacao =
    (ehProvedorDeCanal(provedor) ? interpretarPorProvedor(provedor, JSON.stringify(evento.corpo)) : null) ?? {
      mensagens: [],
      status: [],
      descartados: [],
    };

  let integracaoId = pedido.integracaoId ?? evento.integracaoId;
  const referencia = interpretacao.mensagens[0]?.contaExterna;
  if (!integracaoId && referencia && provedor !== "uazapi") {
    integracaoId = await lerContaPorReferencia(db, provedor, referencia);
  }
  const conta = integracaoId ? await lerConta(db, integracaoId) : null;

  const motivo = !ehProvedorDeCanal(provedor)
    ? "provedor sem canal"
    : !conta
      ? "conta desconhecida"
      : !conta.lojaId
        ? "conta sem loja"
        : conta.status === "erro" || conta.revogadaEm
          ? "conta com erro"
          : null;
  if (motivo || !conta?.lojaId) {
    await descartarEvento(evento.id, provedor, interpretacao, motivo ?? "conta sem loja");
    return NADA(motivo, conta?.lojaId ?? null);
  }
  const contaDaLoja = { ...conta, lojaId: conta.lojaId };

  // Lote com contas diferentes: cada mensagem é da SUA conta (§11).
  const mensagens = interpretacao.mensagens.filter(
    (m) => provedor === "uazapi" || !conta.referenciaExterna || m.contaExterna === conta.referenciaExterna,
  );
  const baixadas = await baixarMidiasDaMeta(conta, mensagens);

  const saida = NADA(null, conta.lojaId, provedor);
  const ctx = contextoDeSistema({ origem: "worker", lojaId: conta.lojaId });
  await emTransacao(ctx, async (tx) => {
    for (const m of mensagens) await gravarMensagemRecebida(tx, ctx, contaDaLoja, m, baixadas, saida);
    for (const s of interpretacao.status) await aplicarStatus(tx, contaDaLoja.lojaId, s, saida);

    const soDescarte =
      mensagens.length === 0 && interpretacao.status.length === 0 && !interpretacao.sessao && interpretacao.descartados.length > 0;
    await registrarProcessamentoEvento(tx, evento.id, {
      tipo: soDescarte ? "descartado" : "processado",
      erro: soDescarte ? interpretacao.descartados.map((d) => d.motivo).join(",") : null,
      projecao: projecao(provedor, interpretacao, null),
    });
  });
  saida.conversasTocadas = [...new Set(saida.conversasTocadas)];
  return saida;
}

/** Última tentativa esgotada: o corpo cru fica (é a prova), marcado `falhou`. */
export async function marcarEventoComoFalho(eventoId: string, erro: string): Promise<void> {
  await emTransacao(contextoDeSistema({ origem: "worker" }), (tx) =>
    registrarProcessamentoEvento(tx, eventoId, { tipo: "falhou", erro: erro.slice(0, 500) }),
  );
}

