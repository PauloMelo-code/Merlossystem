import "server-only";
import type { ContextoDeGravacao } from "@/lib/db/mutacoes";
import type { StatusTemplate } from "@/lib/db/schema/_enums/plataforma";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: M5, consumida por M6 (botão "Enviar para aprovação" de
 * `/modelos`, permissão `modelos:enviar_aprovacao`). Assinatura final criada
 * pela integração (D11).
 *
 * Abre as PRÓPRIAS transações: a chamada à Graph não pode segurar conexão do
 * banco. Grava `template_enviado` na trilha e o `externo_id` devolvido pela
 * Meta; modelo de outra loja ou excluído é `ErroDeEscopo`.
 */

export type ModeloEnviado = {
  templateId: string;
  externoId: string;
  status: StatusTemplate;
};

export async function enviarModeloParaAprovacao(
  ctx: ContextoDeGravacao,
  templateId: string,
): Promise<ModeloEnviado> {
  void ctx;
  void templateId;
  throw naoImplementado("envio de modelo para aprovação da Meta (M5)");
}
