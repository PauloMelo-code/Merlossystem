import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { condicaoDeLoja, vivosE } from "@/lib/db/consultas";
import { atualizarComTrava, emTransacao, type ContextoDeGravacao } from "@/lib/db/mutacoes";
import { lojas_integracoes_templates, type BotaoTemplate } from "@/lib/db/schema/integracoes";
import type { StatusTemplate } from "@/lib/db/schema/_enums/plataforma";
import { ErroDeEscopo, ErroDeIntegracao, ErroDeValidacao } from "@/lib/erros";
import { contaComCredencial } from "../_consultas";
import { submeterModeloNaMeta } from "./graph";

/**
 * COSTURA — dono: M5, consumida por M6 (botão "Enviar para aprovação" de
 * `/modelos`, permissão `modelos:enviar_aprovacao`, conferida pela action).
 *
 * Abre as PRÓPRIAS transações: a chamada à Graph não pode segurar conexão do
 * banco. Grava `template_enviado` na trilha e o `meta_template_id` devolvido
 * pela Meta; modelo de outra loja ou excluído é `ErroDeEscopo`.
 */

export type ModeloEnviado = {
  templateId: string;
  externoId: string;
  status: StatusTemplate;
};

/** Só sai daqui o que ainda não está com a Meta (a mesma regra da tela). */
const ENVIAVEIS: readonly string[] = ["rascunho", "rejeitado"];

type Objeto = Record<string, unknown>;

export type ModeloLocal = {
  categoria: string;
  cabecalhoTipo: string | null;
  cabecalho: string | null;
  corpo: string;
  rodape: string | null;
  botoes: BotaoTemplate[];
  variaveisContagem: number;
};

/** O motivo vai no campo E na mensagem: o botão de envio fica fora do formulário. */
function recusar(campo: string, motivo: string): never {
  throw new ErroDeValidacao({ [campo]: [motivo] }, undefined, motivo);
}

const exemplos = (n: number) => Array.from({ length: n }, (_, i) => `exemplo ${i + 1}`);

function botaoDaMeta(b: BotaoTemplate): Objeto {
  if (b.tipo === "url") return { type: "URL", text: b.texto, url: b.valor ?? "" };
  if (b.tipo === "telefone") return { type: "PHONE_NUMBER", text: b.texto, phone_number: b.valor ?? "" };
  return { type: "QUICK_REPLY", text: b.texto };
}

/**
 * Componentes no formato da Graph. Puro. A Meta exige um exemplo por variável;
 * como o modelo não guarda exemplo, vai `exemplo N`.
 *
 * ponytail: cabeçalho de mídia e categoria `authentication` (OTP) ficam de
 * fora — exigem upload por handle e botão de código; a tela de `/modelos` só
 * cria cabeçalho de texto.
 */
export function componentesDoModelo(m: ModeloLocal): Objeto[] {
  if (m.categoria === "authentication") recusar("categoria", "Modelo de autenticação não é enviado pelo sistema.");
  if (m.cabecalhoTipo !== null && m.cabecalhoTipo !== "texto") {
    recusar("cabecalho_conteudo", "Cabeçalho de mídia não é enviado pelo sistema. Use texto.");
  }
  const componentes: Objeto[] = [];
  if (m.cabecalho) {
    componentes.push({
      type: "HEADER",
      format: "TEXT",
      text: m.cabecalho,
      ...(/\{\{\s*1\s*\}\}/.test(m.cabecalho) ? { example: { header_text: exemplos(1) } } : {}),
    });
  }
  componentes.push({
    type: "BODY",
    text: m.corpo,
    ...(m.variaveisContagem > 0 ? { example: { body_text: [exemplos(m.variaveisContagem)] } } : {}),
  });
  if (m.rodape) componentes.push({ type: "FOOTER", text: m.rodape });
  if (m.botoes.length > 0) componentes.push({ type: "BUTTONS", buttons: m.botoes.map(botaoDaMeta) });
  return componentes;
}

async function carregar(ctx: ContextoDeGravacao, templateId: string) {
  const t = lojas_integracoes_templates;
  const [linha] = await db
    .select({
      id: t.id,
      integracaoId: t.integracao_id,
      nome: t.nome,
      idioma: t.idioma,
      categoria: t.categoria,
      cabecalhoTipo: t.cabecalho_tipo,
      cabecalho: t.cabecalho_conteudo,
      corpo: t.corpo,
      rodape: t.rodape,
      botoes: t.botoes,
      variaveisContagem: t.variaveis_contagem,
      status: t.status,
      metaId: t.meta_template_id,
      updatedAt: t.updated_at,
    })
    .from(t)
    .where(vivosE(t, eq(t.id, templateId), condicaoDeLoja(t, ctx.escopo)))
    .limit(1);
  if (!linha) throw new ErroDeEscopo();
  return linha;
}

export async function enviarModeloParaAprovacao(
  ctx: ContextoDeGravacao,
  templateId: string,
): Promise<ModeloEnviado> {
  if (ctx.escopo.tipo === "nenhuma") throw new ErroDeEscopo();
  const modelo = await carregar(ctx, templateId);
  if (!ENVIAVEIS.includes(modelo.status)) recusar("status", "Este modelo já está com a Meta.");
  const conta = await contaComCredencial(modelo.integracaoId);
  const waba = conta?.credencial.waba_id;
  const token = conta?.credencial.access_token;
  if (!conta || conta.provedor !== "whatsapp_oficial" || !waba || !token) {
    throw new ErroDeIntegracao("A conta do modelo não é um número oficial conectado. Reconecte o número.", true);
  }

  // Rejeitado com id da Meta é EDITADO lá; sem id, nunca chegou: cria.
  const remoto = await submeterModeloNaMeta(
    waba,
    token,
    {
      nome: modelo.nome,
      idioma: modelo.idioma,
      categoria: modelo.categoria.toUpperCase(),
      componentes: componentesDoModelo(modelo),
    },
    modelo.status === "rejeitado" ? modelo.metaId : null,
  );

  // Se alguém editou o modelo durante a chamada, a trava recusa: o que a Meta
  // recebeu não é o que está salvo, e a pessoa precisa ver isso.
  const agora = new Date();
  await emTransacao(ctx, (tx) =>
    atualizarComTrava(
      tx,
      lojas_integracoes_templates,
      {
        id: modelo.id,
        escopo: ctx.escopo,
        updatedAtOriginal: modelo.updatedAt,
        dados: {
          status: remoto.status,
          meta_template_id: remoto.id,
          motivo_rejeicao: null,
          enviado_em: agora,
          ...(remoto.status === "aprovado" ? { aprovado_em: agora } : {}),
        },
      },
      ctx,
      "template_enviado",
    ),
  );
  return { templateId: modelo.id, externoId: remoto.id, status: remoto.status };
}
