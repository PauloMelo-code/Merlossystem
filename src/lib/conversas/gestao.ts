import type { Contexto } from "@/lib/auth/guard";
import { pode } from "@/lib/auth/permissoes";
import {
  atualizarComTrava,
  atualizarContador,
  registrarAuditoria,
  reivindicarReenvio,
  type Transacao,
} from "@/lib/db/mutacoes";
import { conversas } from "@/lib/db/schema/conversas/conversas";
import { ErroDeColisao, ErroDeEscopo, ErroDeValidacao, ErroDoAplicativo } from "@/lib/erros";
import { colegaAtendeALoja, lerConversa } from "./_consultas";
import { lerMensagemDoEscopo, lerModelo, mensagemPorChave } from "./_consultas-canal";
import { atualizarCacheDaConversa, emSavepoint, inserirMensagem } from "./_gravacao";
import { ACAO } from "./_sistema";
import type { ResultadoDeGestao } from "./dto";
import { bloqueioDoComposer } from "./regras";
import { registrarSaida, resolverCorpoDoModelo, type DadosDoEnvio } from "./saida";

/**
 * Operações da TELA de atendimento (04-ui.md §5.2). Recebem `(dados, ctx, tx)`
 * de `executarAcao`, que já rodou sessão → permissão → validação → escopo.
 *
 * Reversíveis (resolver, reabrir, arquivar, transferir, prioridade) devolvem
 * o `updated_at` NOVO: é o que o "Desfazer" reenvia (§7.5).
 */

export class ErroReenvioEmAndamento extends ErroDoAplicativo {
  constructor() {
    super("COLISAO", "Esta mensagem já está sendo reenviada.", 409);
  }
}

/**
 * Lê a conversa no escopo da pessoa e devolve o contexto PRESO à loja dela.
 * Gestão em "todas as lojas" não escolhe loja nenhuma aqui: a loja é a do
 * próprio registro, já conferido pelo escopo — nada é chutado (INV-05), e a
 * trilha sai com a loja certa.
 */
async function conversaDoEscopo(tx: Transacao, ctx: Contexto, id: string) {
  const conversa = await lerConversa(tx, ctx.escopo, id);
  if (!conversa) throw new ErroDeEscopo();
  const daLoja: Contexto = { ...ctx, escopo: { tipo: "uma", lojaId: conversa.lojaId } };
  return { conversa, ctx: daLoja };
}

type Alvo = { conversaId: string; updatedAt: Date };

async function mudar(
  tx: Transacao,
  ctx: Contexto,
  alvo: Alvo,
  dados: Record<string, unknown>,
  acao: (typeof ACAO)[keyof typeof ACAO],
): Promise<ResultadoDeGestao> {
  const { conversa, ctx: daLoja } = await conversaDoEscopo(tx, ctx, alvo.conversaId);
  const linha = await emSavepoint(tx, (sp) =>
    atualizarComTrava(
      sp,
      conversas,
      { id: conversa.id, escopo: daLoja.escopo, updatedAtOriginal: alvo.updatedAt, dados },
      daLoja,
      acao,
    ),
  );
  if (!linha) {
    // Único parcial: já existe outra conversa aberta deste contato nesta conta.
    throw new ErroDeValidacao(
      { _: ["Já existe uma conversa aberta com esta cliente neste número."] },
      undefined,
      "Já existe uma conversa aberta com esta cliente neste número.",
    );
  }
  return { conversaId: conversa.id, lojaId: conversa.lojaId, updatedAt: (linha.updated_at as Date).toISOString() };
}

export function resolverConversa(dados: Alvo, ctx: Contexto, tx: Transacao) {
  return mudar(
    tx,
    ctx,
    dados,
    { status: "resolvida", resolvida_em: new Date(), resolvida_por: ctx.autorId },
    ACAO.conversaResolvida,
  );
}

/** Reabrir vale para resolvida e para arquivada (decisão explícita da pessoa). */
export function reabrirConversa(dados: Alvo, ctx: Contexto, tx: Transacao) {
  return mudar(tx, ctx, dados, { status: "aberta", resolvida_em: null, resolvida_por: null }, ACAO.conversaReaberta);
}

export function arquivarConversa(dados: Alvo, ctx: Contexto, tx: Transacao) {
  return mudar(tx, ctx, dados, { status: "arquivada" }, ACAO.conversaArquivada);
}

export function mudarPrioridade(dados: Alvo & { prioridade: string }, ctx: Contexto, tx: Transacao) {
  return mudar(tx, ctx, dados, { prioridade: dados.prioridade }, ACAO.prioridade);
}

/** Só para quem atende a loja; `null` devolve a conversa para "sem responsável". */
export async function transferirConversa(
  dados: Alvo & { responsavelId: string | null },
  ctx: Contexto,
  tx: Transacao,
) {
  const { conversa } = await conversaDoEscopo(tx, ctx, dados.conversaId);
  if (dados.responsavelId && !(await colegaAtendeALoja(tx, dados.responsavelId, conversa.lojaId))) {
    throw new ErroDeValidacao({ responsavelId: ["Escolha alguém que atende esta loja."] });
  }
  return mudar(tx, ctx, dados, { responsavel_id: dados.responsavelId }, ACAO.conversaTransferida);
}

/** Zera as não lidas. Contador: não mexe em `updated_at` nem grava trilha. */
export async function marcarComoLida(dados: { conversaId: string }, ctx: Contexto, tx: Transacao) {
  const { conversa } = await conversaDoEscopo(tx, ctx, dados.conversaId);
  if (conversa.naoLidas > 0) {
    await atualizarContador(tx, conversas, { id: conversa.id, escopo: ctx.escopo }, { nao_lidas: -conversa.naoLidas });
  }
  return { conversaId: conversa.id };
}

export type EnvioDaTela = {
  conversaId: string;
  conteudo: string;
  chaveIdempotencia: string;
  notaInterna: boolean;
  modeloId?: string | undefined;
  variaveis: string[];
};

export type RespostaDoEnvio = {
  mensagemId: string;
  conversaId: string;
  lojaId: string;
  /** Presente quando há algo para a fila levar ao provedor. */
  envio: DadosDoEnvio | null;
};

/**
 * Enviar ou salvar nota. O servidor refaz o veredito do composer: a tela
 * esconder o botão não basta. Arquivada responde abrindo conversa NOVA;
 * resolvida reabre (regra do gateway, em `obterConversa`).
 */
export async function enviarPelaTela(
  dados: EnvioDaTela,
  ctxDaPessoa: Contexto,
  tx: Transacao,
): Promise<RespostaDoEnvio> {
  const { conversa, ctx } = await conversaDoEscopo(tx, ctxDaPessoa, dados.conversaId);
  const lojaId = conversa.lojaId;

  if (dados.notaInterna) {
    const agora = new Date();
    const id = await inserirMensagem(tx, ctx, {
      lojaId,
      conversaId: conversa.id,
      direcao: "saida",
      autorTipo: "usuario",
      autorUsuarioId: ctx.autorId,
      conteudo: dados.conteudo,
      tipo: "texto",
      externoId: null,
      statusEntrega: null,
      notaInterna: true,
      chaveIdempotencia: dados.chaveIdempotencia,
      respondeAId: null,
      ocorridaEm: agora,
      metadados: {},
    });
    if (!id) {
      const repetida = await mensagemPorChave(tx, conversa.id, dados.chaveIdempotencia);
      if (!repetida) throw new ErroDeColisao();
      return { mensagemId: repetida, conversaId: conversa.id, lojaId, envio: null };
    }
    await atualizarCacheDaConversa(
      tx,
      { lojaId, conversaId: conversa.id, ultimaMensagemEm: null },
      { direcao: "saida", tipo: "texto", conteudo: dados.conteudo, notaInterna: true, ocorridaEm: agora },
    );
    return { mensagemId: id, conversaId: conversa.id, lojaId, envio: null };
  }

  const bloqueio = bloqueioDoComposer({
    podeEscrever: pode(ctx.sessao.papel, "conversas", "escrever"),
    provedor: conversa.provedor,
    statusConta: conversa.contaStatus,
    rotuloConta: conversa.contaRotulo,
    contaAlteradaEm: conversa.contaAlteradaEm,
    ultimaEntradaEm: conversa.ultimaEntradaEm,
    podeReconectar: false,
  });
  const comModelo = Boolean(dados.modeloId);
  if (bloqueio && !(bloqueio.caso === "janela_24h" && comModelo)) {
    const motivo =
      bloqueio.caso === "janela_24h"
        ? "Passaram 24h desde a última mensagem da cliente. Só dá para enviar um modelo aprovado."
        : bloqueio.caso === "desconectado"
          ? `O número ${conversa.contaRotulo} está desconectado. Mensagens não serão enviadas.`
          : "Você tem acesso só de leitura nesta loja.";
    throw new ErroDeValidacao({ conteudo: [motivo] }, undefined, motivo);
  }

  let conteudo = dados.conteudo;
  if (dados.modeloId) {
    const modelo = await lerModelo(tx, lojaId, dados.modeloId);
    if (!modelo) throw new ErroDeValidacao({ modeloId: ["Escolha um modelo aprovado deste número."] });
    conteudo = resolverCorpoDoModelo(modelo.corpo, dados.variaveis);
  }

  const registro = await registrarSaida(
    tx,
    {
      lojaId,
      contatoId: conversa.contatoId,
      integracaoId: conversa.integracaoId,
      conteudo,
      chaveIdempotencia: dados.chaveIdempotencia,
      ...(dados.modeloId ? { modelo: { templateId: dados.modeloId, variaveis: dados.variaveis } } : {}),
    },
    ctx,
  );

  // "Ao responder, a conversa fica com você." — sobre o `updated_at` ATUAL,
  // que a reabertura desta mesma transação pode ter mudado.
  const atual = await lerConversa(tx, ctx.escopo, registro.conversaId);
  if (atual && !atual.responsavelId) {
    await emSavepoint(tx, (sp) =>
      atualizarComTrava(
        sp,
        conversas,
        { id: atual.id, escopo: ctx.escopo, updatedAtOriginal: atual.updatedAt, dados: { responsavel_id: ctx.autorId } },
        ctx,
        ACAO.conversaTransferida,
      ),
    ).catch((erro: unknown) => {
      if (!(erro instanceof ErroDeColisao)) throw erro;
    });
  }
  if (atual && atual.naoLidas > 0) {
    await atualizarContador(tx, conversas, { id: atual.id, escopo: ctx.escopo }, { nao_lidas: -atual.naoLidas });
  }

  return {
    mensagemId: registro.mensagemId,
    conversaId: registro.conversaId,
    lojaId,
    envio: registro.nova
      ? { lojaId, mensagemId: registro.mensagemId, integracaoId: conversa.integracaoId }
      : null,
  };
}

/**
 * Reenvio: a ÚNICA transição que sai de `falhou`, por claim atômico. Zero
 * linhas = alguém já reenviou (409). A trilha registra a transição.
 */
export async function reenviarMensagem(
  dados: { mensagemId: string },
  ctx: Contexto,
  tx: Transacao,
): Promise<RespostaDoEnvio> {
  const mensagem = await lerMensagemDoEscopo(tx, ctx.escopo, dados.mensagemId);
  if (!mensagem) throw new ErroDeEscopo();
  if (!(await reivindicarReenvio(tx, mensagem.id))) throw new ErroReenvioEmAndamento();
  await registrarAuditoria(tx, ctx, ACAO.reenvio, "conversas_mensagens", mensagem.id, {
    antes: { status_entrega: "falhou" },
    depois: { status_entrega: "pendente" },
  });
  return {
    mensagemId: mensagem.id,
    conversaId: mensagem.conversaId,
    lojaId: mensagem.lojaId,
    envio: { lojaId: mensagem.lojaId, mensagemId: mensagem.id, integracaoId: mensagem.integracaoId },
  };
}
