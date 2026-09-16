import "server-only";
import { atualizarComTrava, type Transacao } from "@/lib/db/mutacoes";
import { lojas_integracoes } from "@/lib/db/schema/integracoes";
import type { Contexto } from "@/lib/auth/guard";
import { ErroDeEscopo, ErroDeIntegracao } from "@/lib/erros";
import type { StatusIntegracao } from "@/lib/db/schema/_enums/plataforma";
import { contaComCredencial } from "./_consultas";
import { registrarEstadoDoSistema } from "./contas";
import { estadoDaSessao, iniciarPareamento, VALIDADE_QR_S, type EstadoDaSessao } from "./uazapi";

/**
 * Sessão do uazapi vista pelo domínio: parear (ação humana, com block) e
 * conferir (tela e job `conferir-sessao-uazapi`).
 */

async function contaUazapi(id: string) {
  const conta = await contaComCredencial(id);
  if (!conta || conta.provedor !== "uazapi") throw new ErroDeEscopo();
  const token = conta.credencial.token;
  if (!token) throw new ErroDeIntegracao("Conta do uazapi sem token. Reautentique a conta.", true);
  return { conta, token };
}

export type Pareamento = { estado: EstadoDaSessao["estado"]; qr: string | null; validadeS: number; updatedAt: Date };

/**
 * "Parear novo aparelho": pede um QR e derruba a sessão atual do aparelho.
 * A conta fica `desconectado` até a leitura do QR ser confirmada.
 */
export async function parearUazapi(
  tx: Transacao,
  dados: { id: string; updatedAt: Date },
  ctx: Contexto,
): Promise<Pareamento> {
  const { conta, token } = await contaUazapi(dados.id);
  if (ctx.escopo.tipo === "uma" && conta.lojaId !== ctx.escopo.lojaId) throw new ErroDeEscopo();
  const estado = await iniciarPareamento(token);
  const linha = await atualizarComTrava(
    tx,
    lojas_integracoes,
    {
      id: dados.id,
      escopo: ctx.escopo,
      updatedAtOriginal: dados.updatedAt,
      dados: { status: estado.estado === "conectada" ? "conectado" : "desconectado" },
    },
    ctx,
    "integracao_pareada",
  );
  return { estado: estado.estado, qr: estado.qr ?? null, validadeS: VALIDADE_QR_S, updatedAt: linha.updated_at as Date };
}

export function statusDaSessao(estado: EstadoDaSessao["estado"]): StatusIntegracao {
  return estado === "conectada" ? "conectado" : "desconectado";
}

/**
 * Pergunta ao uazapi e grava o que mudou, como SISTEMA. Token recusado vira
 * `erro` com o motivo; falha de rede sobe (a fila retenta, a tela oferece
 * "Tentar de novo").
 */
export async function conferirSessao(integracaoId: string): Promise<EstadoDaSessao["estado"] | "erro"> {
  const { token } = await contaUazapi(integracaoId);
  try {
    const estado = await estadoDaSessao(token);
    await registrarEstadoDoSistema(integracaoId, {
      status: statusDaSessao(estado.estado),
      ultimoErro: estado.estado === "conectada" ? null : "Sessão do aparelho desconectada.",
    });
    return estado.estado;
  } catch (erro) {
    if (erro instanceof ErroDeIntegracao && erro.permanente) {
      await registrarEstadoDoSistema(integracaoId, { status: "erro", ultimoErro: erro.message });
      return "erro";
    }
    throw erro;
  }
}
