import "server-only";

/**
 * API pública do módulo de integrações (03-arquitetura.md §4.1 e §4.2): conta
 * por canal, cofre, OAuth, roteamento de webhook, diário de ingestão e
 * modelos da Meta. O resto do módulo é privado.
 *
 * `integracoes/bling/**` é do pacote M4 e não passa por aqui.
 */

export {
  conectarPorToken,
  desconectarConta,
  editarConta,
  marcarSincronizacao,
  registrarEstadoDoSistema,
  substituirCredencial,
  type ContaConectada,
} from "./contas";
export {
  contasDoProvedor,
  contaDaRede,
  detalheDaConta,
  listarContas,
  type ContaNaTela,
  type EventoNaTela,
} from "./_consultas";
export { registrarEventoRecebido, registrarProcessamentoEvento } from "./diario";
export { sincronizarModelosDaConta } from "./meta/modelos";
export {
  blingConfigurado,
  COOKIE_NONCE,
  concluirAutorizacaoBling,
  ErroDeOAuth,
  iniciarAutorizacaoBling,
  renovarTokenBling,
  VALIDADE_COOKIE_S,
} from "./oauth";
export { conferirSessao, parearUazapi, type Pareamento } from "./sessao";
export { contextoDoSistema } from "./_sistema";
