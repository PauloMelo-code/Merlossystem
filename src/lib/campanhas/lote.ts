import "server-only";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { vivosE } from "@/lib/db/consultas";
import {
  atualizarComTrava,
  atualizarEstado,
  contextoDeSistema,
  emTransacao,
  reservarDestinatarios,
} from "@/lib/db/mutacoes";
import { campanhas, campanhas_destinatarios } from "@/lib/db/schema/campanhas";
import { contatos } from "@/lib/db/schema/contatos";
import { lojas_integracoes_templates } from "@/lib/db/schema/integracoes";
import { registrarEnvio } from "@/lib/conversas/saida";
import { renderizarCorpo, resolverVariaveis } from "@/lib/conteudo/variaveis";
import { enfileirar } from "@/lib/fila/filas";
import { jobId } from "@/lib/fila/idempotencia";
import { publicarNaLoja } from "@/lib/tempo-real/publicar";
import { chaveDoEnvio, INTERVALO_ENTRE_LOTES_MS, LEASE_MS } from "./regras";
import { ehPermanente, motivoDoErro } from "./sistema";

/**
 * Um lote da fila `campanhas` (03-arquitetura.md §8, 01-dados-dominio.md §5.5).
 *
 * 1. devolve à fila o que ficou `reservado` além do lease (worker que morreu);
 * 2. reserva o lote com `FOR UPDATE SKIP LOCKED` — dois workers nunca pegam a
 *    mesma cliente;
 * 3. para cada reservado, NUMA transação: trava a linha conferindo que a
 *    reserva ainda é ESTA (`reservado_em` igual ao lido), registra a mensagem
 *    na conversa da cliente pela costura `registrarEnvio` e marca `enviado`
 *    com o `mensagem_id`. Lease perdido = outra reserva é a dona; pula;
 * 4. encadeia o próximo lote 1 s depois (ritmo da conta) ou conclui.
 *
 * Pausar é só mudar o status: o próximo lote lê e para. Nada é reenviado,
 * porque o que já saiu não está mais `pendente`.
 */

export type DadosLote = {
  lojaId: string;
  campanhaId: string;
  /** Tamanho do lote = ritmo por segundo da conta. */
  tamanho: number;
  /** Carimbo da rodada (início ou retomada): separa as cadeias de jobs. */
  rodada?: string;
  sequencia?: number;
};

export type ResultadoLote = {
  enviados: number;
  falhas: number;
  desfecho: "parada" | "continua" | "concluida";
};

type Reserva = { id: string; reservadoEm: Date };

export async function processarLoteDeCampanha(dados: DadosLote): Promise<ResultadoLote> {
  const { lojaId, campanhaId } = dados;
  const [c] = await db
    .select({
      status: campanhas.status,
      integracaoId: campanhas.integracao_id,
      templateId: campanhas.template_id,
      texto: campanhas.conteudo_texto,
      variaveis: campanhas.variaveis,
    })
    .from(campanhas)
    .where(vivosE(campanhas, eq(campanhas.loja_id, lojaId), eq(campanhas.id, campanhaId)))
    .limit(1);
  if (!c || c.status !== "enviando") return { enviados: 0, falhas: 0, desfecho: "parada" };

  const ctx = contextoDeSistema({ origem: "worker", lojaId });
  const escopo = ctx.escopo;

  let corpo = c.texto ?? "";
  if (c.templateId) {
    const [modelo] = await db
      .select({ corpo: lojas_integracoes_templates.corpo })
      .from(lojas_integracoes_templates)
      .where(vivosE(lojas_integracoes_templates, eq(lojas_integracoes_templates.id, c.templateId)))
      .limit(1);
    corpo = modelo?.corpo ?? "";
  }

  // 1. lease vencido volta a pendente
  await emTransacao(ctx, async (tx) => {
    const vencidos = await tx
      .select({ id: campanhas_destinatarios.id })
      .from(campanhas_destinatarios)
      .where(
        vivosE(
          campanhas_destinatarios,
          eq(campanhas_destinatarios.campanha_id, campanhaId),
          eq(campanhas_destinatarios.status, "reservado"),
          lt(campanhas_destinatarios.reservado_em, new Date(Date.now() - LEASE_MS)),
        ),
      )
      .for("update", { skipLocked: true });
    for (const v of vencidos) {
      await atualizarEstado(tx, campanhas_destinatarios, { id: v.id, escopo }, { status: "pendente", reservado_em: null });
    }
  });

  // 2. reserva
  const reservas: Reserva[] = await emTransacao(ctx, async (tx) => {
    const ids = await reservarDestinatarios(tx, campanhaId, dados.tamanho);
    if (ids.length === 0) return [];
    const linhas = await tx
      .select({ id: campanhas_destinatarios.id, reservadoEm: campanhas_destinatarios.reservado_em })
      .from(campanhas_destinatarios)
      .where(vivosE(campanhas_destinatarios, inArray(campanhas_destinatarios.id, ids)));
    return linhas.flatMap((l) => (l.reservadoEm ? [{ id: l.id, reservadoEm: l.reservadoEm }] : []));
  });

  // 3. envio, um destinatário por transação
  let enviados = 0;
  let falhas = 0;
  for (const reserva of reservas) {
    await emTransacao(ctx, async (tx) => {
      const [linha] = await tx
        .select({
          id: campanhas_destinatarios.id,
          contatoId: campanhas_destinatarios.contato_id,
          tentativas: campanhas_destinatarios.tentativas,
          nome: contatos.nome,
        })
        .from(campanhas_destinatarios)
        .innerJoin(contatos, eq(contatos.id, campanhas_destinatarios.contato_id))
        .where(
          vivosE(
            campanhas_destinatarios,
            eq(campanhas_destinatarios.id, reserva.id),
            eq(campanhas_destinatarios.status, "reservado"),
            eq(campanhas_destinatarios.reservado_em, reserva.reservadoEm),
          ),
        )
        .for("update", { of: campanhas_destinatarios });
      if (!linha) return;

      const tentativa = linha.tentativas + 1;
      const valores = resolverVariaveis(c.variaveis, linha.nome).sort((a, b) => a.indice - b.indice);
      const conteudo = c.templateId ? renderizarCorpo(corpo, valores) : corpo;
      try {
        // SAVEPOINT: a falha da costura não pode abortar a transação que
        // ainda precisa gravar o `falhou`.
        const { mensagemId } = await tx.transaction((sp) =>
          registrarEnvio(
            sp,
            {
              lojaId,
              contatoId: linha.contatoId,
              integracaoId: c.integracaoId,
              conteudo,
              chaveIdempotencia: chaveDoEnvio(campanhaId, linha.contatoId, tentativa),
              ...(c.templateId
                ? { modelo: { templateId: c.templateId, variaveis: valores.map((v) => v.valor) } }
                : {}),
            },
            ctx,
          ),
        );
        await atualizarEstado(tx, campanhas_destinatarios, { id: linha.id, escopo }, {
          status: "enviado",
          mensagem_id: mensagemId,
          enviado_em: new Date(),
          tentativas: tentativa,
          erro: null,
        });
        enviados++;
      } catch (erro) {
        if (!ehPermanente(erro)) throw erro;
        await atualizarEstado(tx, campanhas_destinatarios, { id: linha.id, escopo }, {
          status: "falhou",
          erro: motivoDoErro(erro),
          tentativas: tentativa,
        });
        falhas++;
      }
    });
  }

  // 4. próximo lote ou conclusão
  const [fila] = await db
    .select({
      pendentes: sql<number>`count(*) filter (where ${campanhas_destinatarios.status} = 'pendente')`.mapWith(Number),
      reservados: sql<number>`count(*) filter (where ${campanhas_destinatarios.status} = 'reservado')`.mapWith(Number),
    })
    .from(campanhas_destinatarios)
    .where(vivosE(campanhas_destinatarios, eq(campanhas_destinatarios.campanha_id, campanhaId)));
  const pendentes = fila?.pendentes ?? 0;
  const reservados = fila?.reservados ?? 0;

  let desfecho: ResultadoLote["desfecho"] = "continua";
  if (pendentes + reservados === 0) {
    const concluiu = await emTransacao(ctx, async (tx) => {
      const [atual] = await tx
        .select({ status: campanhas.status, atualizadoEm: campanhas.updated_at })
        .from(campanhas)
        .where(and(vivosE(campanhas, eq(campanhas.id, campanhaId))))
        .for("update");
      if (atual?.status !== "enviando") return false;
      await atualizarComTrava(
        tx,
        campanhas,
        {
          id: campanhaId,
          escopo,
          updatedAtOriginal: atual.atualizadoEm,
          dados: { status: "concluida", concluida_em: new Date() },
        },
        ctx,
        "campanha_concluida",
      );
      return true;
    });
    desfecho = concluiu ? "concluida" : "parada";
  } else {
    const rodada = dados.rodada ?? "0";
    const sequencia = (dados.sequencia ?? 0) + 1;
    // Só sobrou reserva em voo: espera o lease vencer em vez de girar em vão.
    const atraso = pendentes > 0 ? INTERVALO_ENTRE_LOTES_MS : LEASE_MS;
    await enfileirar(
      "campanhas",
      "processar-lote",
      { ...dados, rodada, sequencia },
      { jobId: jobId("lote", campanhaId, rodada, String(sequencia)), delay: atraso },
    );
  }

  publicarNaLoja(lojaId, { tipo: "campanha-progresso", campanhaId, versao: Date.now() });
  return { enviados, falhas, desfecho };
}
