import "server-only";
import { publicarNaLoja } from "@/lib/tempo-real/publicar";

/**
 * API PÚBLICA do módulo `conversas` (03-arquitetura.md §4.1). O resto do
 * diretório é privado: quem está fora importa daqui (a costura `saida.ts`
 * tem caminho próprio, fixado no plano).
 */

export { processarEventoDeCanal, marcarEventoComoFalho, type ResultadoDaEntrada } from "./ingestao";
export { enviarDaFila, ErroTransitorioDeEnvio, marcarFalhaDeEnvio, type DesfechoDoEnvio } from "./envio";
export {
  arquivarConversa,
  enviarPelaTela,
  marcarComoLida,
  mudarPrioridade,
  reabrirConversa,
  reenviarMensagem,
  resolverConversa,
  transferirConversa,
  type EnvioDaTela,
  type RespostaDoEnvio,
} from "./gestao";
export {
  abrirAtendimento,
  opcoesDeFiltro,
  paginaDeConversas,
  paginaDeMensagens,
  type FiltrosDaLista,
  type OpcoesDeFiltro,
} from "./leitura";
export { agendarEnvio, agendarReenvio, registrarEnvio, type DadosDoEnvio } from "./saida";
export type * from "./dto";
export { motivoParaFecharFluxo } from "./sessao-do-fluxo";

/**
 * Tempo real (03-arquitetura.md §9): o evento NÃO carrega conteúdo — só
 * `{ tipo, lojaId, conversaId, mensagemId, versao }`. A tela busca o dado pela
 * action, que reaplica o portão. Nunca lança (o PUBLISH é conforto).
 */
export function avisarConversa(
  lojaId: string,
  tipo: "mensagem-nova" | "mensagem-atualizada" | "conversa-atualizada",
  ids: { conversaId: string; mensagemId?: string },
): void {
  publicarNaLoja(lojaId, { tipo, versao: Date.now(), ...ids });
}
