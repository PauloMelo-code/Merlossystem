import type { Contexto } from "@/lib/auth/guard";
import { ErroDeEscopo, ErroDeIntegracao, ErroDeValidacao, type ErroDoAplicativo } from "@/lib/erros";

/**
 * Contexto de quem grava a partir da FILA (templates/job.ts).
 *
 * O worker não tem sessão. `origem: "worker"` faz a trilha gravar
 * `ator_tipo = 'sistema'`; `autorId` é a pessoa que originou o trabalho (quem
 * iniciou a campanha, quem agendou a mensagem), porque `modified_by` é FK para
 * `usuarios` e "o sistema" não é uma linha daquela tabela.
 */
export function contextoDoWorker(lojaId: string, autorId: string): Contexto {
  return {
    sessao: undefined as never,
    escopo: { tipo: "uma", lojaId },
    autorId,
    origem: "worker",
  };
}

/**
 * Erro que não melhora na quinta tentativa (03-arquitetura.md §8.2): vira
 * `falhou` com o motivo. O resto sobe e a fila retenta.
 */
export function ehPermanente(erro: unknown): erro is ErroDoAplicativo {
  return (
    (erro instanceof ErroDeIntegracao && erro.permanente) ||
    erro instanceof ErroDeValidacao ||
    erro instanceof ErroDeEscopo
  );
}

/** O motivo legível: a validação guarda a frase útil no campo, não na mensagem. */
export function motivoDoErro(erro: ErroDoAplicativo): string {
  const doCampo = erro instanceof ErroDeValidacao ? Object.values(erro.campos)[0]?.[0] : undefined;
  return (doCampo ?? erro.message).slice(0, 500);
}
