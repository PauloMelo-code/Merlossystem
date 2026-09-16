import "server-only";

/**
 * API pública do módulo de integrações (03-arquitetura.md §4.1 e §4.2): conta
 * por canal, cofre, OAuth, roteamento de webhook e modelos da Meta. O resto
 * do módulo é privado. O diário de ingestão e o contexto de sistema moram em
 * `@/lib/db/mutacoes`.
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
export { webhookInstagram, webhookUazapi, webhookWhatsapp } from "./roteamento";
export { conferirSessao, parearUazapi, type Pareamento } from "./sessao";
