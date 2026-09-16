/**
 * Manifesto das rotas que NAO tem portao de sessao (02-seguranca.md §3.1, §12;
 * 03-arquitetura.md §5). E a fonte da trava T2: rota sem portao e fora daqui
 * reprova, e item daqui sem linha em docs/seguranca/caminhos-de-acesso.md
 * tambem.
 *
 * Nasce COMPLETO de proposito. Na onda 2 nenhum pacote edita arquivo de outro,
 * entao as rotas de webhook e o callback do OAuth, que M5 vai escrever, ja
 * estao listados aqui com o motivo delas.
 *
 * Nao importa `server-only`: e lido por trava e por script de documentacao,
 * que rodam em Node puro.
 */

export type TipoDePortao =
  /** rotaPublica(): sem sessao, com motivo, limitador e teto de corpo. */
  | "publica"
  /** rotaDeMaquina(): assinatura ou segredo sobre o corpo cru, nunca cookie. */
  | "maquina"
  /** Portao proprio da biblioteca ou do protocolo (Better Auth, OAuth). */
  | "proprio";

export type RotaPublica = {
  caminho: string;
  metodos: readonly string[];
  portao: TipoDePortao;
  /** Por que esta rota pode existir sem sessao. Entra no doc e na trava. */
  motivo: string;
  /** Pacote que entrega o arquivo. "fundacao" ja existe. */
  dono: "fundacao" | "M5" | "R2-B" | "R2-D";
};

export const ROTAS_PUBLICAS: readonly RotaPublica[] = [
  {
    caminho: "/api/auth/[...all]",
    metodos: ["GET", "POST"],
    portao: "proprio",
    motivo: "protocolo do Better Auth: quem entra ainda nao tem sessao",
    dono: "fundacao",
  },
  {
    caminho: "/api/saude",
    metodos: ["GET"],
    portao: "publica",
    motivo: "liveness do orquestrador: responde 200 sem tocar em dependencia",
    dono: "fundacao",
  },
  {
    caminho: "/api/pronto",
    metodos: ["GET"],
    portao: "maquina",
    motivo: "readiness: segredo em cabecalho comparado em tempo constante",
    dono: "fundacao",
  },
  {
    caminho: "/api/csp",
    metodos: ["POST"],
    portao: "publica",
    motivo: "coletor do Content-Security-Policy-Report-Only, sem persistencia longa",
    dono: "fundacao",
  },
  {
    caminho: "/api/webhooks/whatsapp",
    metodos: ["GET", "POST"],
    portao: "maquina",
    motivo: "Meta entrega evento: HMAC-SHA256 do corpo cru com META_APP_SECRET",
    dono: "M5",
  },
  {
    caminho: "/api/webhooks/instagram",
    metodos: ["GET", "POST"],
    portao: "maquina",
    motivo: "Meta entrega evento: mesmo HMAC, token de challenge proprio do canal",
    dono: "M5",
  },
  {
    caminho: "/api/webhooks/uazapi/[integracaoId]",
    metodos: ["POST"],
    portao: "maquina",
    motivo: "uazapi entrega evento: segredo por integracao, so em cabecalho",
    dono: "M5",
  },
  {
    caminho: "/api/integracoes/bling/callback",
    metodos: ["GET"],
    portao: "proprio",
    motivo: "redirect do provedor: state assinado, validade de 5 min e uso unico",
    dono: "M5",
  },
  {
    caminho: "/api/webhooks/pagamentos/[provedor]/[integracaoId]",
    metodos: ["POST"],
    portao: "maquina",
    motivo: "confirmacao do provedor de pagamento: HMAC da aplicacao da loja e consulta de volta antes de mudar estado",
    dono: "R2-B",
  },
  {
    caminho: "/api/webhooks/facebook",
    metodos: ["GET", "POST"],
    portao: "maquina",
    motivo: "Meta entrega evento do Messenger: HMAC do corpo cru, token de challenge proprio",
    dono: "R2-D",
  },
  {
    caminho: "/api/webhooks/tiktok",
    metodos: ["POST"],
    portao: "maquina",
    motivo: "TikTok entrega mensagem direta: HMAC com o segredo do app e carimbo de tempo",
    dono: "R2-D",
  },
  {
    caminho: "/api/integracoes/tiktok/callback",
    metodos: ["GET"],
    portao: "proprio",
    motivo: "redirect do provedor: state assinado, 5 min, contexto de uso unico e sessao reconferida",
    dono: "R2-D",
  },
] as const;

/** Caminhos que o matcher do src/proxy.ts precisa deixar passar intactos. */
export const PREFIXOS_SEM_PROXY = [
  "/api/auth",
  "/api/webhooks",
  "/api/eventos",
  "/api/midias",
  "/api/saude",
  "/api/pronto",
] as const;

export function ehRotaPublica(caminho: string): boolean {
  return ROTAS_PUBLICAS.some((r) => r.caminho === caminho);
}
