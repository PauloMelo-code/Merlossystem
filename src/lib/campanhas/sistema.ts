import { ErroDeEscopo, ErroDeIntegracao, ErroDeValidacao, type ErroDoAplicativo } from "@/lib/erros";

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
