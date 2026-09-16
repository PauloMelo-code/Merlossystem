import "server-only";
import { sql } from "drizzle-orm";
import { TIPO_AVISO_SEGURANCA } from "@/lib/alertas/visibilidade";
import { abrirAlerta, emTransacao } from "@/lib/db/mutacoes";
import { contextoDeSistema } from "@/lib/db/sistema";
import { logger } from "@/lib/logger";
import type { AssuntoDeSeguranca } from "./emails";

/**
 * E-mail desligado (ADR 0062): o aviso de conta vira alerta no sino de dono e
 * admin, que falam com a pessoa por outro canal. Assunto que leva LINK (convite,
 * reset, código de troca de e-mail) não vira alerta: o token não sai da
 * memória de quem o gerou.
 */

export type AvisoSemLink = Exclude<AssuntoDeSeguranca, "convite" | "reset" | "email-troca-codigo">;

const FRASES: Record<AvisoSemLink, string> = {
  "senha-alterada": "a senha foi alterada",
  "fator-adicionado": "um segundo fator foi adicionado",
  "fator-removido": "um segundo fator foi removido",
  "passkey-adicionada": "uma chave de acesso foi adicionada",
  "passkey-removida": "uma chave de acesso foi removida",
  "email-trocado": "o e-mail da conta foi alterado",
  "email-troca-solicitada": "pediram a troca do e-mail da conta",
  "conta-bloqueada": "a conta foi bloqueada temporariamente",
  "recuperacao-assistida": "o acesso foi recuperado por um administrador",
};

export function ehAvisoSemLink(assunto: AssuntoDeSeguranca): assunto is AvisoSemLink {
  return assunto in FRASES;
}

/**
 * Abre o alerta (dedupe pela referência do job: a retentativa não duplica).
 * Loja-âncora: a da pessoa ou, para quem não tem loja, a primeira loja viva.
 * Devolve `false` quando não há loja nenhuma (instalação sem loja ainda).
 */
export async function avisarNoSino(aviso: {
  usuarioId: string;
  assunto: AvisoSemLink;
  referencia: string;
}): Promise<boolean> {
  const ctx = contextoDeSistema({ origem: "worker" });
  const aberto = await emTransacao(ctx, async (tx) => {
    const linhas = await tx.execute<{ loja_id: string | null; nome: string | null }>(sql`
      select coalesce(
               u.loja_id,
               (select l.id from lojas l where l.is_deleted = false order by l.created_at, l.id limit 1)
             ) as loja_id,
             u.nome
        from usuarios u
       where u.id = ${aviso.usuarioId}::uuid and u.is_deleted = false
    `);
    const alvo = linhas.rows[0];
    if (!alvo?.loja_id) return false;
    await abrirAlerta(tx, {
      lojaId: alvo.loja_id,
      tipo: TIPO_AVISO_SEGURANCA,
      severidade: aviso.assunto === "conta-bloqueada" || aviso.assunto === "fator-removido" ? "alta" : "media",
      mensagem: `Conta de ${alvo.nome ?? "uma pessoa da equipe"}: ${FRASES[aviso.assunto]}. Confirme com ela por outro canal.`,
      chave: `${TIPO_AVISO_SEGURANCA}:${aviso.assunto}:${aviso.usuarioId}:${aviso.referencia}`,
    });
    return true;
  });
  if (!aberto) logger.warn({ assunto: aviso.assunto }, "aviso de segurança sem loja para ancorar");
  return aberto;
}
