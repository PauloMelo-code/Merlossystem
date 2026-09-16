import "server-only";

/**
 * API pública do módulo `auditoria` (03-arquitetura.md §4.2): a trilha de
 * negócio e as leituras de qualidade, excluídos e acesso.
 *
 * `gravador.ts` (a escrita) é da fundação e é importado por `mutacoes.ts`; ele
 * não passa por aqui de propósito — escrever é caminho de toda mutação, ler é
 * tela com filtro e página.
 */

export {
  detalheDoEvento,
  listarTrilha,
  pessoasDaEquipe,
  type EventoDetalhado,
  type EventoNaLista,
  type FiltrosTrilha,
} from "./consulta";
export { ocorrenciasDe, painelDeQualidade, type LinhaQualidade, type Ocorrencia } from "./qualidade";
export { listarExcluidos, type RegistroExcluido } from "./excluidos";
export {
  detalheDoEventoDeAcesso,
  listarEventosDeAcesso,
  type EventoDeAcesso,
  type EventoDeAcessoDetalhado,
} from "./seguranca";
export { decodificarCursor, type Pagina } from "./cursor";
export { ALTERADO, rotuloDaAcao, rotuloDaEntidade, type LinhaDeDiff } from "./apresentacao";
export { anonimizarEventosAntigos, contarConvitesVencidos, RETENCAO_DIAS } from "./retencao";
