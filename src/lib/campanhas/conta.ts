import "server-only";
import { eq } from "drizzle-orm";
import { vivosE } from "@/lib/db/consultas";
import type { Transacao } from "@/lib/db/mutacoes";
import type { VariavelTemplate } from "@/lib/db/schema/integracoes";
import { lojas_integracoes, lojas_integracoes_templates } from "@/lib/db/schema/integracoes";
import { ErroDeEscopo, ErroDeValidacao } from "@/lib/erros";
import { conferirVariaveis } from "@/lib/conteudo/variaveis";
import { ehProvedorDeCampanha, type ProvedorDeCampanha } from "./regras";

/**
 * Conta de saída e modelo — conferidos no SERVIDOR, contra o banco, em toda
 * gravação e de novo no disparo. O cliente manda ids; quem diz se valem é aqui.
 */

type Leitor = Pick<Transacao, "select">;

export type Conta = { id: string; provedor: ProvedorDeCampanha; status: string; rotulo: string };
export type Modelo = { id: string; corpo: string; variaveisContagem: number; status: string };

/** Conta de WhatsApp DESTA loja; de outra loja ou de outro canal = 404. */
export async function contaDaLoja(tx: Leitor, lojaId: string, integracaoId: string): Promise<Conta> {
  const [conta] = await tx
    .select({
      id: lojas_integracoes.id,
      provedor: lojas_integracoes.provedor,
      status: lojas_integracoes.status,
      rotulo: lojas_integracoes.rotulo,
      lojaId: lojas_integracoes.loja_id,
    })
    .from(lojas_integracoes)
    .where(vivosE(lojas_integracoes, eq(lojas_integracoes.id, integracaoId)))
    .limit(1);
  if (!conta || conta.lojaId !== lojaId || !ehProvedorDeCampanha(conta.provedor)) {
    throw new ErroDeEscopo("Conta de WhatsApp não encontrada nesta loja.");
  }
  return { id: conta.id, provedor: conta.provedor, status: conta.status, rotulo: conta.rotulo };
}

/** Modelo aprovado DA CONTA escolhida — modelo de outro número a Meta recusa. */
export async function modeloDaConta(tx: Leitor, integracaoId: string, templateId: string): Promise<Modelo> {
  const [modelo] = await tx
    .select({
      id: lojas_integracoes_templates.id,
      integracaoId: lojas_integracoes_templates.integracao_id,
      corpo: lojas_integracoes_templates.corpo,
      variaveisContagem: lojas_integracoes_templates.variaveis_contagem,
      status: lojas_integracoes_templates.status,
    })
    .from(lojas_integracoes_templates)
    .where(vivosE(lojas_integracoes_templates, eq(lojas_integracoes_templates.id, templateId)))
    .limit(1);
  if (!modelo || modelo.integracaoId !== integracaoId) {
    throw new ErroDeValidacao({ template_id: ["Este modelo não pertence à conta escolhida."] });
  }
  if (modelo.status !== "aprovado") {
    throw new ErroDeValidacao({ template_id: ["Este modelo ainda não foi aprovado pela Meta."] });
  }
  return modelo;
}

/**
 * A regra que o antigo não tinha (03/C1): a lista de variáveis tem o tamanho
 * EXATO que o modelo pede, senão não sai de rascunho.
 */
export function exigirVariaveisDoModelo(variaveis: readonly VariavelTemplate[], modelo: Modelo): void {
  const problema = conferirVariaveis(variaveis, modelo.variaveisContagem);
  if (problema) throw new ErroDeValidacao({ variaveis: [problema] });
}
