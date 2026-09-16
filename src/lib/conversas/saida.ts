import type { Contexto } from "@/lib/auth/guard";
import type { Transacao } from "@/lib/db/mutacoes";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: M1, consumida por M6 (05-plano-construcao.md §5).
 *
 * Porta ÚNICA de saída de mensagem. Campanha e mensagem agendada não montam a
 * linha de `conversas_mensagens` por conta própria: chamam esta função. Duas
 * implementações dariam duas regras de mesclagem de conversa, e a campanha
 * abriria uma segunda conversa com a mesma cliente.
 *
 * Grava dentro da transação de quem chama (por isso recebe `tx`) e devolve o id
 * da mensagem. O ENVIO é da fila: esta função só registra e enfileira
 * `mensagens-saida/enviar-mensagem` depois do commit.
 *
 * `chaveIdempotencia` casa com o único `(conversa_id, chave_idempotencia)`: é o
 * que impede a mesma cliente de receber a campanha duas vezes quando o lote é
 * reprocessado.
 */

export type EnvioParaRegistrar = {
  lojaId: string;
  contatoId: string;
  integracaoId: string;
  conteudo: string;
  chaveIdempotencia: string;
};

export async function registrarEnvio(
  _tx: Transacao,
  envio: EnvioParaRegistrar,
  ctx: Contexto,
): Promise<{ mensagemId: string; conversaId: string }> {
  throw naoImplementado(
    `registrarEnvio [contato ${envio.contatoId}, origem ${ctx.origem}] (saída de conversa, pacote M1)`,
  );
}
