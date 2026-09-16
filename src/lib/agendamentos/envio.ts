import "server-only";
import { eq } from "drizzle-orm";
import { vivosE } from "@/lib/db/consultas";
import { atualizarComTrava, contextoDeSistema, emTransacao } from "@/lib/db/mutacoes";
import type { AcaoAuditada } from "@/lib/db/schema/_enums/auditoria";
import { GATILHOS_PROMOCIONAIS } from "@/lib/db/schema/_enums/conversas";
import { contatos } from "@/lib/db/schema/contatos";
import { conversas_agendamentos } from "@/lib/db/schema/conversas/agendamentos";
import { registrarEnvio } from "@/lib/conversas/saida";
import { exigirVariaveisDoModelo, modeloDaConta } from "@/lib/campanhas/conta";
import { contatoSaiuDoMarketing } from "@/lib/campanhas/segmento";
import { ehPermanente, motivoDoErro } from "@/lib/campanhas/sistema";
import { TRILHA_AGENDAMENTO } from "@/lib/conteudo/trilha";
import { renderizarCorpo, resolverVariaveis } from "@/lib/conteudo/variaveis";
import { ErroDeValidacao } from "@/lib/erros";

/**
 * Envio de UMA mensagem agendada (01-dados-dominio.md §2.5, §7.2).
 *
 * Idempotente por três lados: o `jobId` leva o id e o horário; a linha é
 * travada e só sai de `agendada` aqui dentro; e a chave de idempotência da
 * mensagem é o id do agendamento. Reagendar troca o horário — o job antigo
 * chega, vê outro `agendada_para` e não faz nada.
 *
 * Opt-out é de MARKETING: só os gatilhos `promocao`, `reativacao` e
 * `abandono` são conferidos, contra a verdade (`consentimentos`). Os demais
 * saem mesmo com opt-out.
 */

export type DadosAgendada = {
  lojaId: string;
  agendamentoId: string;
  /** ISO do horário que o job carregou; diferente do banco = reagendado. */
  agendadaPara?: string;
};

export type Desfecho = "enviada" | "falhou" | "cancelada" | "ignorada";

const MOTIVO_OPT_OUT = "Não enviada: a cliente pediu para não receber promoções.";

function ehPromocional(gatilho: string): boolean {
  return (GATILHOS_PROMOCIONAIS as readonly string[]).includes(gatilho);
}

export async function enviarAgendamento(d: DadosAgendada): Promise<Desfecho> {
  const ctx = contextoDeSistema({ origem: "worker", lojaId: d.lojaId });

  return emTransacao(ctx, async (tx) => {
    const [a] = await tx
      .select({
        id: conversas_agendamentos.id,
        atualizadoEm: conversas_agendamentos.updated_at,
        status: conversas_agendamentos.status,
        agendadaPara: conversas_agendamentos.agendada_para,
        gatilho: conversas_agendamentos.gatilho,
        tipo: conversas_agendamentos.tipo_conteudo,
        conteudo: conversas_agendamentos.conteudo,
        templateId: conversas_agendamentos.template_id,
        variaveis: conversas_agendamentos.variaveis,
        integracaoId: conversas_agendamentos.integracao_id,
        contatoId: conversas_agendamentos.contato_id,
        nome: contatos.nome,
      })
      .from(conversas_agendamentos)
      .innerJoin(contatos, eq(contatos.id, conversas_agendamentos.contato_id))
      .where(
        vivosE(
          conversas_agendamentos,
          eq(conversas_agendamentos.loja_id, d.lojaId),
          eq(conversas_agendamentos.id, d.agendamentoId),
        ),
      )
      .for("update", { of: conversas_agendamentos });
    if (!a || a.status !== "agendada") return "ignorada";
    if (d.agendadaPara && new Date(d.agendadaPara).getTime() !== a.agendadaPara.getTime()) {
      return "ignorada";
    }

    const fechar = (dados: Record<string, unknown>, acao: AcaoAuditada, motivo?: string) =>
      atualizarComTrava(
        tx,
        conversas_agendamentos,
        { id: a.id, escopo: ctx.escopo, updatedAtOriginal: a.atualizadoEm, dados },
        ctx,
        acao,
        motivo ? { motivo } : {},
      );

    if (ehPromocional(a.gatilho) && (await contatoSaiuDoMarketing(tx, a.contatoId))) {
      await fechar({ status: "cancelada", erro: MOTIVO_OPT_OUT }, TRILHA_AGENDAMENTO.cancelado, "opt_out");
      return "cancelada";
    }

    try {
      let texto = a.conteudo ?? "";
      let modeloDoEnvio: { templateId: string; variaveis: string[] } | undefined;
      if (a.tipo === "template") {
        if (!a.templateId) throw new ErroDeValidacao({ template_id: ["Agendamento de modelo sem modelo."] });
        const modelo = await modeloDaConta(tx, a.integracaoId, a.templateId);
        exigirVariaveisDoModelo(a.variaveis, modelo);
        const valores = resolverVariaveis(a.variaveis, a.nome).sort((x, y) => x.indice - y.indice);
        texto = renderizarCorpo(modelo.corpo, valores);
        modeloDoEnvio = { templateId: modelo.id, variaveis: valores.map((v) => v.valor) };
      } else if (a.tipo !== "texto") {
        throw new ErroDeValidacao({ tipo_conteudo: ["Agendamento de mídia ainda não sai por aqui."] });
      }
      const { mensagemId } = await tx.transaction((sp) =>
        registrarEnvio(
          sp,
          {
            lojaId: d.lojaId,
            contatoId: a.contatoId,
            integracaoId: a.integracaoId,
            conteudo: texto,
            chaveIdempotencia: `agendada-${a.id}`,
            ...(modeloDoEnvio ? { modelo: modeloDoEnvio } : {}),
          },
          ctx,
        ),
      );
      await fechar({ status: "enviada", enviada_em: new Date(), mensagem_id: mensagemId, erro: null }, TRILHA_AGENDAMENTO.enviado);
      return "enviada";
    } catch (erro) {
      if (!ehPermanente(erro)) throw erro;
      const motivo = motivoDoErro(erro);
      // ponytail: a lista fechada não tem `agendamento_falhou`; a falha é um
      // cancelamento pelo sistema, com o status e o motivo no registro.
      await fechar({ status: "falhou", erro: motivo }, TRILHA_AGENDAMENTO.cancelado, motivo);
      return "falhou";
    }
  });
}
