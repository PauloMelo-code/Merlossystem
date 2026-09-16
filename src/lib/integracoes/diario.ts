import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { atualizarEstado, type Transacao } from "@/lib/db/mutacoes";
import { lojas_integracoes_eventos, type CabecalhosEvento } from "@/lib/db/schema/integracoes";
import type { Provedor } from "@/lib/db/schema/_enums/plataforma";
import type { TipoEventoIntegracao } from "@/lib/db/schema/_enums/plataforma";

/**
 * Diário de ingestão (01-dados.md §6.4, ADR 0017).
 *
 * Tabela normal, sem trilha e SEM `DELETE`. Duas escritas, e só estas:
 *
 *   1. `registrarEventoRecebido` — a linha nasce com o corpo cru, ANTES de
 *      enfileirar. É a persistência que decide o 500 (§11): se ela falha, o
 *      provedor reentrega.
 *   2. `registrarProcessamentoEvento` — via `atualizarEstado()`, só nos cinco
 *      campos da lista fechada.
 *
 * DIVERGÊNCIA REGISTRADA (bloqueio do pacote M5): `05-plano §6` diz que
 * `registrarProcessamentoEvento` mora em `src/lib/db/mutacoes.ts`, e a
 * fundação não a entregou; nem existe helper para o INSERT desta tabela, que
 * não é auditada (`inserirAuditado` grava trilha e exige ator humano). O
 * INSERT abaixo é `execute(sql…)`, o mesmo caminho de
 * `src/lib/auditoria/gravador.ts`, e deve migrar para `mutacoes.ts` na
 * integração.
 */

/** Lista branca de cabeçalhos guardados (01-dados.md §10). Nunca `authorization`. */
const CABECALHOS_GUARDADOS = ["content-type", "user-agent", "x-request-id"] as const;

export function cabecalhosDoDiario(h: Headers): CabecalhosEvento {
  const guardados: CabecalhosEvento = {};
  for (const nome of CABECALHOS_GUARDADOS) {
    const valor = h.get(nome);
    if (valor) guardados[nome] = valor.slice(0, 256);
  }
  // A assinatura em si nunca é gravada: só a PRESENÇA dela.
  if (h.get("x-hub-signature-256")) guardados["x-hub-signature-256"] = "presente";
  return guardados;
}

export type EventoRecebido = {
  provedor: Provedor;
  integracaoId: string | null;
  lojaId: string | null;
  tipo: TipoEventoIntegracao;
  eventoExternoId: string;
  assinaturaOk: boolean;
  ip: string | null;
  corpo: unknown;
  cabecalhos: CabecalhosEvento;
  erro?: string | null;
};

export type ResultadoDoRegistro = {
  id: string;
  /** `false` = o mesmo id de evento já estava no diário (reentrega). */
  novo: boolean;
  /** Ainda à espera de processamento: a reentrega pode reenfileirar. */
  pendente: boolean;
};

/**
 * `ON CONFLICT DO NOTHING` sobre o único parcial `(provedor,
 * evento_externo_id)`: a idempotência vale para sempre (06/INV-139). O
 * predicado repete o do índice, senão o Postgres não o encontra.
 */
export async function registrarEventoRecebido(e: EventoRecebido): Promise<ResultadoDoRegistro> {
  const inserido = await db.execute<{ id: string }>(sql`
    insert into lojas_integracoes_eventos
      (provedor, integracao_id, loja_id, tipo, evento_externo_id, assinatura_ok,
       ip, corpo, cabecalhos, erro, created_at, updated_at)
    values (${e.provedor}, ${e.integracaoId}, ${e.lojaId}, ${e.tipo}, ${e.eventoExternoId},
            ${e.assinaturaOk}, ${e.ip}, ${JSON.stringify(e.corpo ?? null)}::jsonb,
            ${JSON.stringify(e.cabecalhos)}::jsonb, ${e.erro ?? null}, now(), now())
    on conflict (provedor, evento_externo_id) where evento_externo_id is not null
    do nothing
    returning id
  `);
  const criado = inserido.rows[0];
  if (criado) return { id: criado.id, novo: true, pendente: e.tipo === "recebido" };

  const existente = await db.execute<{ id: string; tipo: string; processado_em: Date | null }>(sql`
    select id, tipo, processado_em from lojas_integracoes_eventos
    where provedor = ${e.provedor} and evento_externo_id = ${e.eventoExternoId}
    limit 1
  `);
  const linha = existente.rows[0];
  if (!linha) throw new Error("evento do diário sumiu entre o insert e a leitura");
  return { id: linha.id, novo: false, pendente: linha.tipo === "recebido" && linha.processado_em === null };
}

export type Processamento = {
  tipo: Extract<TipoEventoIntegracao, "processado" | "descartado" | "falhou">;
  erro?: string | null;
  /** Projeção mascarada. Ausente = o corpo cru fica (só em `falhou`). */
  corpo?: unknown;
};

/**
 * No MESMO `UPDATE`: carimba `processado_em` e troca o corpo pela projeção
 * mascarada. O corpo cru só sobrevive enquanto serve de prova (§6.4).
 */
export async function registrarProcessamentoEvento(
  tx: Transacao,
  eventoId: string,
  p: Processamento,
): Promise<void> {
  await atualizarEstado(
    tx,
    lojas_integracoes_eventos,
    { id: eventoId, escopo: { tipo: "todas" } },
    {
      tipo: p.tipo,
      processado_em: new Date(),
      erro: p.erro ?? null,
      ...(p.corpo === undefined || p.tipo === "falhou" ? {} : { corpo: p.corpo }),
    },
  );
}
