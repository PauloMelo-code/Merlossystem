import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { EscopoLoja } from "@/lib/auth/loja";
import { condicaoDeLoja, vivos, vivosE } from "@/lib/db/consultas";
import { contatos } from "@/lib/db/schema/contatos";
import { conversas } from "@/lib/db/schema/conversas/conversas";
import { conversas_mensagens } from "@/lib/db/schema/conversas/mensagens";
import { conversas_mensagens_midias } from "@/lib/db/schema/conversas/mensagens-midias";
import { lojas_integracoes, lojas_integracoes_eventos, lojas_integracoes_templates } from "@/lib/db/schema/integracoes";
import { lojas_midias } from "@/lib/db/schema/midias";
import type { Leitor } from "./_consultas";

/**
 * Leituras do CAMINHO DE MÁQUINA (entrada e envio) e das pontas de escrita.
 * Separadas das leituras de tela para cada arquivo caber em 499 linhas.
 */

/** Conta de canal VIVA. A credencial sai cifrada; quem abre é `canais/registro.ts`. */
export async function lerConta(leitor: Leitor, integracaoId: string) {
  const [linha] = await leitor
    .select({
      id: lojas_integracoes.id,
      lojaId: lojas_integracoes.loja_id,
      provedor: lojas_integracoes.provedor,
      rotulo: lojas_integracoes.rotulo,
      status: lojas_integracoes.status,
      referenciaExterna: lojas_integracoes.referencia_externa,
      segredoWebhookHash: lojas_integracoes.segredo_webhook_hash,
      credenciaisCifradas: lojas_integracoes.credenciais_cifradas,
      credenciaisAad: lojas_integracoes.credenciais_aad,
      revogadaEm: lojas_integracoes.revogada_em,
    })
    .from(lojas_integracoes)
    .where(vivosE(lojas_integracoes, eq(lojas_integracoes.id, integracaoId)))
    .limit(1);
  return linha ?? null;
}

export async function lerContaPorReferencia(leitor: Leitor, provedor: string, referencia: string) {
  const [linha] = await leitor
    .select({ id: lojas_integracoes.id })
    .from(lojas_integracoes)
    .where(
      vivosE(
        lojas_integracoes,
        eq(lojas_integracoes.provedor, provedor),
        eq(lojas_integracoes.referencia_externa, referencia),
      ),
    )
    .limit(1);
  return linha?.id ?? null;
}

export async function lerEvento(leitor: Leitor, eventoId: string) {
  const [linha] = await leitor
    .select({
      id: lojas_integracoes_eventos.id,
      provedor: lojas_integracoes_eventos.provedor,
      integracaoId: lojas_integracoes_eventos.integracao_id,
      lojaId: lojas_integracoes_eventos.loja_id,
      tipo: lojas_integracoes_eventos.tipo,
      corpo: lojas_integracoes_eventos.corpo,
      processadoEm: lojas_integracoes_eventos.processado_em,
    })
    .from(lojas_integracoes_eventos)
    .where(vivosE(lojas_integracoes_eventos, eq(lojas_integracoes_eventos.id, eventoId)))
    .limit(1);
  return linha ?? null;
}

export async function mensagemPorExterno(leitor: Leitor, lojaId: string, externoId: string) {
  const [linha] = await leitor
    .select({
      id: conversas_mensagens.id,
      conversaId: conversas_mensagens.conversa_id,
      status: conversas_mensagens.status_entrega,
    })
    .from(conversas_mensagens)
    .where(
      vivosE(
        conversas_mensagens,
        eq(conversas_mensagens.loja_id, lojaId),
        eq(conversas_mensagens.externo_id, externoId),
      ),
    )
    .limit(1);
  return linha ?? null;
}

/** Aberta/pendente do par — o único parcial garante no máximo uma. */
export async function conversaDoPar(leitor: Leitor, lojaId: string, contatoId: string, integracaoId: string) {
  const [linha] = await leitor
    .select({
      id: conversas.id,
      status: conversas.status,
      updatedAt: conversas.updated_at,
      responsavelId: conversas.responsavel_id,
      ultimaMensagemEm: conversas.ultima_mensagem_em,
      primeiraRespostaEm: conversas.primeira_resposta_em,
    })
    .from(conversas)
    .where(
      vivosE(
        conversas,
        eq(conversas.loja_id, lojaId),
        eq(conversas.contato_id, contatoId),
        eq(conversas.integracao_id, integracaoId),
        inArray(conversas.status, ["aberta", "pendente"]),
      ),
    )
    .limit(1);
  return linha ?? null;
}

/** Última conversa encerrada do par: resolvida REABRE, arquivada não. */
export async function ultimaEncerradaDoPar(leitor: Leitor, lojaId: string, contatoId: string, integracaoId: string) {
  const [linha] = await leitor
    .select({
      id: conversas.id,
      status: conversas.status,
      updatedAt: conversas.updated_at,
      ultimaMensagemEm: conversas.ultima_mensagem_em,
      primeiraRespostaEm: conversas.primeira_resposta_em,
    })
    .from(conversas)
    .where(
      vivosE(
        conversas,
        eq(conversas.loja_id, lojaId),
        eq(conversas.contato_id, contatoId),
        eq(conversas.integracao_id, integracaoId),
        inArray(conversas.status, ["resolvida", "arquivada"]),
      ),
    )
    .orderBy(desc(conversas.updated_at))
    .limit(1);
  return linha ?? null;
}

/** Mensagem para o envio (worker) — com o destino do contato. */
export async function lerMensagemParaEnvio(leitor: Leitor, lojaId: string, mensagemId: string) {
  const [linha] = await leitor
    .select({
      id: conversas_mensagens.id,
      conversaId: conversas_mensagens.conversa_id,
      conteudo: conversas_mensagens.conteudo,
      tipo: conversas_mensagens.tipo_conteudo,
      status: conversas_mensagens.status_entrega,
      externoId: conversas_mensagens.externo_id,
      notaInterna: conversas_mensagens.nota_interna,
      metadados: conversas_mensagens.metadados,
      updatedAt: conversas_mensagens.updated_at,
      integracaoId: conversas.integracao_id,
      ultimaEntradaEm: conversas.ultima_entrada_em,
      telefone: contatos.telefone,
      whatsappId: contatos.whatsapp_id,
      instagramId: contatos.instagram_id,
    })
    .from(conversas_mensagens)
    .innerJoin(conversas, eq(conversas.id, conversas_mensagens.conversa_id))
    .innerJoin(contatos, eq(contatos.id, conversas.contato_id))
    .where(
      vivosE(
        conversas_mensagens,
        eq(conversas_mensagens.id, mensagemId),
        eq(conversas_mensagens.loja_id, lojaId),
      ),
    )
    .limit(1);
  return linha ?? null;
}

export async function lerModelo(leitor: Leitor, lojaId: string, templateId: string) {
  const [linha] = await leitor
    .select({
      id: lojas_integracoes_templates.id,
      nome: lojas_integracoes_templates.nome,
      idioma: lojas_integracoes_templates.idioma,
      corpo: lojas_integracoes_templates.corpo,
      integracaoId: lojas_integracoes_templates.integracao_id,
      status: lojas_integracoes_templates.status,
      variaveis: lojas_integracoes_templates.variaveis_contagem,
    })
    .from(lojas_integracoes_templates)
    .where(
      vivosE(
        lojas_integracoes_templates,
        eq(lojas_integracoes_templates.id, templateId),
        eq(lojas_integracoes_templates.loja_id, lojaId),
      ),
    )
    .limit(1);
  return linha ?? null;
}

/** Mensagem da loja para reenvio/nota (confere escopo). */
export async function lerMensagemDoEscopo(leitor: Leitor, escopo: EscopoLoja, mensagemId: string) {
  const [linha] = await leitor
    .select({
      id: conversas_mensagens.id,
      lojaId: conversas_mensagens.loja_id,
      conversaId: conversas_mensagens.conversa_id,
      status: conversas_mensagens.status_entrega,
      integracaoId: conversas.integracao_id,
    })
    .from(conversas_mensagens)
    .innerJoin(conversas, eq(conversas.id, conversas_mensagens.conversa_id))
    .where(
      and(
        vivos(conversas_mensagens),
        eq(conversas_mensagens.id, mensagemId),
        condicaoDeLoja(conversas_mensagens, escopo),
      ),
    )
    .limit(1);
  return linha ?? null;
}

/** O contato é desta loja? (a FK composta é a segunda linha, INV-10). */
export async function contatoDaLoja(leitor: Leitor, lojaId: string, contatoId: string): Promise<boolean> {
  const [linha] = await leitor
    .select({ id: contatos.id })
    .from(contatos)
    .where(vivosE(contatos, eq(contatos.id, contatoId), eq(contatos.loja_id, lojaId)))
    .limit(1);
  return Boolean(linha);
}

/** Mensagem já registrada com a mesma chave (envio repetido pela tela ou pelo lote). */
export async function mensagemPorChave(leitor: Leitor, conversaId: string, chave: string) {
  const [linha] = await leitor
    .select({ id: conversas_mensagens.id })
    .from(conversas_mensagens)
    .where(
      and(
        eq(conversas_mensagens.conversa_id, conversaId),
        eq(conversas_mensagens.chave_idempotencia, chave),
      ),
    )
    .limit(1);
  return linha?.id ?? null;
}

/**
 * Mídia VIVA da galeria da loja, para anexar a uma mensagem de saída. Só os
 * metadados: o binário é da costura do M3 (`midias/leitura.ts`), lido no envio.
 */
export async function midiaDaLoja(leitor: Leitor, lojaId: string, midiaId: string) {
  const [linha] = await leitor
    .select({
      id: lojas_midias.id,
      tipo: lojas_midias.tipo_arquivo,
      mime: lojas_midias.mime_type,
      tamanhoBytes: lojas_midias.tamanho_bytes,
      nomeOriginal: lojas_midias.nome_original,
    })
    .from(lojas_midias)
    .where(vivosE(lojas_midias, eq(lojas_midias.id, midiaId), eq(lojas_midias.loja_id, lojaId)))
    .limit(1);
  return linha ?? null;
}

/** Anexos guardados de uma mensagem (envio): nunca a URL externa. */
export async function anexosDaMensagem(leitor: Leitor, lojaId: string, mensagemId: string) {
  return leitor
    .select({
      midiaId: conversas_mensagens_midias.midia_id,
      tipo: conversas_mensagens_midias.tipo_arquivo,
      legenda: conversas_mensagens_midias.legenda,
    })
    .from(conversas_mensagens_midias)
    .where(
      vivosE(
        conversas_mensagens_midias,
        eq(conversas_mensagens_midias.mensagem_id, mensagemId),
        eq(conversas_mensagens_midias.loja_id, lojaId),
        isNotNull(conversas_mensagens_midias.midia_id),
      ),
    )
    .orderBy(asc(conversas_mensagens_midias.created_at));
}
