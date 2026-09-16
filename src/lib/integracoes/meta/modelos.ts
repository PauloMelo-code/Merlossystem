import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { vivosE } from "@/lib/db/consultas";
import { atualizarComTrava, contextoDeSistema, emTransacao } from "@/lib/db/mutacoes";
import { lojas_integracoes_templates } from "@/lib/db/schema/integracoes";
import type { AcaoAuditada } from "@/lib/db/schema/_enums/auditoria";
import type { StatusTemplate } from "@/lib/db/schema/_enums/plataforma";
import { logger } from "@/lib/logger";
import { contaComCredencial } from "../_consultas";
import { listarModelosDaMeta, type ModeloDaMeta } from "./graph";

/**
 * `sincronizar-templates` (03-arquitetura.md §12.2): mantém `status`,
 * `meta_template_id`, `motivo_rejeicao` e `aprovado_em` em dia. Sem isso o
 * status nunca sai de `enviado` e a campanha oficial nasce morta — a tela,
 * corretamente, não oferece "aprovar" à mão.
 *
 * Só ATUALIZA modelo que já existe aqui (casando por nome + idioma). Criar
 * modelo é da tela `/modelos` (pacote M6).
 */

/** Cada status que a Meta devolve tem a sua ação de trilha. Rascunho é só daqui. */
const ACAO_POR_STATUS: Partial<Record<StatusTemplate, AcaoAuditada>> = {
  enviado: "template_enviado",
  aprovado: "template_aprovado",
  rejeitado: "template_rejeitado",
  pausado: "template_pausado",
};

export type ResumoModelos = { lidos: number; alterados: number; ignorados: number };

type Local = {
  id: string;
  lojaId: string;
  nome: string;
  idioma: string;
  status: string;
  metaId: string | null;
  motivo: string | null;
  updatedAt: Date;
};

/** O que muda numa linha, ou `null` quando nada muda. Puro. */
export function mudancaDoModelo(
  local: Pick<Local, "status" | "metaId" | "motivo">,
  remoto: ModeloDaMeta,
  agora: Date,
): Record<string, unknown> | null {
  const status = remoto.status;
  if (status === null || ACAO_POR_STATUS[status] === undefined) return null;
  const motivo = status === "rejeitado" ? remoto.motivo : null;
  if (local.status === status && local.metaId === remoto.id && local.motivo === motivo) return null;
  return {
    status,
    meta_template_id: remoto.id,
    motivo_rejeicao: motivo,
    ...(status === "aprovado" && local.status !== "aprovado" ? { aprovado_em: agora } : {}),
  };
}

export async function sincronizarModelosDaConta(integracaoId: string): Promise<ResumoModelos> {
  const resumo: ResumoModelos = { lidos: 0, alterados: 0, ignorados: 0 };
  const conta = await contaComCredencial(integracaoId);
  if (!conta || conta.provedor !== "whatsapp_oficial" || !conta.lojaId) return resumo;

  const waba = conta.credencial.waba_id;
  const token = conta.credencial.access_token;
  if (!waba || !token) {
    logger.warn({ integracaoId }, "conta oficial sem waba_id ou access_token: modelos não sincronizados");
    return resumo;
  }

  const remotos = await listarModelosDaMeta(waba, token);
  resumo.lidos = remotos.length;
  const porChave = new Map(remotos.map((m) => [`${m.nome}|${m.idioma}`, m]));

  const locais: Local[] = await db
    .select({
      id: lojas_integracoes_templates.id,
      lojaId: lojas_integracoes_templates.loja_id,
      nome: lojas_integracoes_templates.nome,
      idioma: lojas_integracoes_templates.idioma,
      status: lojas_integracoes_templates.status,
      metaId: lojas_integracoes_templates.meta_template_id,
      motivo: lojas_integracoes_templates.motivo_rejeicao,
      updatedAt: lojas_integracoes_templates.updated_at,
    })
    .from(lojas_integracoes_templates)
    .where(vivosE(lojas_integracoes_templates, eq(lojas_integracoes_templates.integracao_id, integracaoId)));

  const ctx = contextoDeSistema({ origem: "worker", lojaId: conta.lojaId });
  const agora = new Date();
  for (const local of locais) {
    // Rascunho nunca foi enviado: o que a Meta tem com esse nome é outra coisa.
    if (local.status === "rascunho") continue;
    const remoto = porChave.get(`${local.nome}|${local.idioma}`);
    if (!remoto) continue;
    const dados = mudancaDoModelo(local, remoto, agora);
    if (!dados) continue;
    // Linha editada por gente no meio do caminho: a colisão derruba só esta
    // linha, e a próxima rodada tenta de novo com o `updated_at` novo.
    try {
      await emTransacao(ctx, (tx) =>
        atualizarComTrava(
          tx,
          lojas_integracoes_templates,
          { id: local.id, escopo: ctx.escopo, updatedAtOriginal: local.updatedAt, dados },
          ctx,
          ACAO_POR_STATUS[remoto.status!]!,
        ),
      );
      resumo.alterados += 1;
    } catch (erro) {
      logger.warn({ templateId: local.id, erro: String(erro) }, "modelo não atualizado nesta rodada");
      resumo.ignorados += 1;
    }
  }
  return resumo;
}
