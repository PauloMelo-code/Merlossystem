import "server-only";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { registrarEventoAuth } from "@/lib/auth/trilha";
import { alertar } from "./alertas";
import { ErroCorpoGrande, TETO_WEBHOOK, lerCorpoComTeto } from "./corpo";
import { chaveDeIp, ipDoCliente } from "./ip";
import { limitarPorIp, type Regra } from "./limite";

/**
 * Superficie de maquina e rota publica (02-seguranca.md §12, §3.1;
 * 03-arquitetura.md §11).
 *
 * `rotaDeMaquina` NUNCA aceita cookie de sessao e `exigirSessao` nunca aceita
 * segredo de maquina (REQ-A4): canais separados, codigos distintos. Este
 * arquivo nao le `cookie`, `authorization`, `x-user-id`, `x-loja-id` nem
 * `x-roles` (I13) — o unico segredo aceito vem de cabecalho proprio, e a
 * conferencia e do chamador, por `assinaturas.ts`.
 */

const NO_STORE = "no-store";

/** Recusa de maquina: 401 com CORPO NULO, sem motivo, sempre igual (§12). */
function recusa(): Response {
  return new Response(null, { status: 401, headers: { "cache-control": NO_STORE } });
}

function excesso(retryAfter: number | null): Response {
  return new Response(null, {
    status: 429,
    headers: {
      "cache-control": NO_STORE,
      ...(retryAfter === null ? {} : { "retry-after": String(retryAfter) }),
    },
  });
}

/**
 * MESMO piso de tempo da recusa humana, pelo mesmo motivo: sem ele da para
 * separar "integracao inexistente" de "assinatura invalida" pelo relogio.
 */
async function esperarAte(inicio: number): Promise<void> {
  const alvo = inicio + env.PISO_RECUSA_MS + Math.floor(Math.random() * 51);
  const falta = alvo - Date.now();
  if (falta > 0) await new Promise((resolver) => setTimeout(resolver, falta));
}

/** Segredo por query string nunca e lido (D-10/I15): a requisicao e recusada. */
const PARAMETROS_PROIBIDOS = ["segredo", "secret", "token", "key", "signature"];

function temSegredoNaUrl(req: Request): boolean {
  const { searchParams } = new URL(req.url);
  return PARAMETROS_PROIBIDOS.some((p) => searchParams.has(p));
}

export const LIMITE_IP_PADRAO: Regra = { janela: 60, max: 600 };
export const LIMITE_INTEGRACAO_PADRAO: Regra = { janela: 60, max: 300 };

export type EntradaDeMaquina<I> = {
  req: Request;
  corpoCru: string;
  integracao: I;
  ip: string | null;
};

export type ConfigMaquina<I> = {
  /** Nome do provedor: entra na trilha, no alerta e na chave do limitador. */
  provedor: string;
  limiteIp?: Regra;
  /**
   * Teto por integracao, contado SO depois de autenticar (REQ-I4): antes da
   * assinatura, um balde por chave e arma de bloqueio contra a integracao —
   * qualquer um esgota o balde com POST sem assinatura. `null` desliga o balde:
   * rota assinada pelo APP (Messenger, TikTok), em que a chave e constante e um
   * balde so estrangularia todas as contas juntas.
   */
  limiteIntegracao?: Regra | null;
  maxBytes?: number;
  /**
   * Chave de roteamento, extraida SEM JSON.parse — da URL ou de cabecalho
   * (INV-48). Nula quando nem a chave veio.
   */
  chave(req: Request): string | null;
  /** Carrega integracao e credencial. Nulo = inexistente, revogada ou sem loja. */
  carregar(chave: string, req: Request): Promise<I | null>;
  /** Assinatura ou segredo sobre o CORPO CRU, em tempo constante. */
  conferir(corpoCru: string, req: Request, integracao: I | null): boolean;
  /** So roda depois de autenticado: parse, anti-repeticao, persistir, enfileirar. */
  processar(entrada: EntradaDeMaquina<I>): Promise<Response>;
  /** GET de verificacao (challenge) do provedor, quando existir. */
  verificar?(req: Request): Response | Promise<Response>;
};

/** Trilha best-effort + alerta deduplicado da rajada de recusas. */
function recusado(provedor: string, motivo: string, ip: string | null): void {
  void registrarEventoAuth({
    tipo: "webhook_recusado",
    atorTipo: "sistema",
    resultado: "recusado",
    ip,
    motivo,
    detalhes: { rota: provedor },
  });
  alertar("webhook_recusado", provedor);
}

/**
 * Ordem FIXA (§12), e ela nao muda: teto por IP -> content-length -> leitura
 * com teto -> carregar integracao -> validade -> assinatura sobre o corpo cru
 * -> teto por integracao (so autenticado) -> (do chamador) anti-repeticao ->
 * persistir -> enfileirar -> 200. NENHUM JSON.parse antes de autenticar.
 */
export function rotaDeMaquina<I>(cfg: ConfigMaquina<I>): (req: Request) => Promise<Response> {
  return async function tratar(req: Request): Promise<Response> {
    const inicio = Date.now();
    const ip = ipDoCliente(req.headers);

    if (temSegredoNaUrl(req)) {
      recusado(cfg.provedor, "segredo na url", ip);
      await esperarAte(inicio);
      return recusa();
    }

    // 1. Teto por IP, ANTES de tocar o banco.
    const porIp = await limitarPorIp(
      `maquina:${cfg.provedor}`,
      chaveDeIp(ip),
      cfg.limiteIp ?? LIMITE_IP_PADRAO,
    );
    if (!porIp.permitido) return excesso(porIp.retryAfter);

    const chave = cfg.chave(req);

    if (req.method === "GET" || req.method === "HEAD") {
      if (!cfg.verificar) return new Response(null, { status: 404 });
      return cfg.verificar(req);
    }

    // 3 e 4. Content-length e leitura com teto. Route Handler nao tem
    // bodySizeLimit, e um content-length mentiroso e de graca (B8/I11).
    let corpoCru: string;
    try {
      corpoCru = await lerCorpoComTeto(req, cfg.maxBytes ?? TETO_WEBHOOK);
    } catch (erro) {
      if (erro instanceof ErroCorpoGrande) {
        return new Response(null, { status: 413, headers: { "cache-control": NO_STORE } });
      }
      throw erro;
    }

    // 5 e 6. Carregar e conferir validade. O carregar do chamador ja devolve
    // nulo para revogada, sem loja ou is_deleted.
    const integracao = chave === null ? null : await cfg.carregar(chave, req);

    // 7. Assinatura sobre o corpo CRU. Roda MESMO com integracao nula: sem
    // isso da para descobrir quais ids existem pela forma e pelo tempo.
    const autentica = cfg.conferir(corpoCru, req, integracao);
    if (integracao === null || !autentica) {
      const motivo = integracao === null ? "integracao invalida" : "assinatura invalida";
      recusado(cfg.provedor, motivo, ip);
      await esperarAte(inicio);
      return recusa();
    }

    // 8. Teto por integracao, SO para quem autenticou (REQ-I4): anti-laco do
    // provedor. Contar antes da assinatura deixaria qualquer um travar a conta.
    if (cfg.limiteIntegracao !== null && chave !== null) {
      const porIntegracao = await limitarPorIp(
        `maquina:${cfg.provedor}:conta`,
        chave,
        cfg.limiteIntegracao ?? LIMITE_INTEGRACAO_PADRAO,
      );
      if (!porIntegracao.permitido) return excesso(porIntegracao.retryAfter);
    }

    try {
      return await cfg.processar({ req, corpoCru, integracao, ip });
    } catch (erro) {
      // Falha ao PERSISTIR = 500, para o provedor reentregar (§11).
      logger.error({ provedor: cfg.provedor, erro: String(erro) }, "webhook falhou ao persistir");
      return new Response(null, { status: 500, headers: { "cache-control": NO_STORE } });
    }
  };
}

export type ConfigPublica = {
  /** OBRIGATORIO: e o que entra no manifesto rotas-publicas.ts (trava T2). */
  motivo: string;
  limite: Regra;
  maxBytes: number;
  handler: (req: Request, corpoCru: string) => Promise<Response> | Response;
};

/**
 * Route Handler sem sessao — o UNICO jeito de um handler nao ter portao. O
 * motivo e obrigatorio porque e ele que aparece no manifesto e no
 * docs/seguranca/caminhos-de-acesso.md.
 */
export function rotaPublica(cfg: ConfigPublica): (req: Request) => Promise<Response> {
  return async function tratar(req: Request): Promise<Response> {
    const ip = ipDoCliente(req.headers);
    const veredito = await limitarPorIp(`publica:${cfg.motivo}`, chaveDeIp(ip), cfg.limite);
    if (!veredito.permitido) return excesso(veredito.retryAfter);

    let corpoCru = "";
    if (req.method !== "GET" && req.method !== "HEAD") {
      try {
        corpoCru = await lerCorpoComTeto(req, cfg.maxBytes);
      } catch (erro) {
        if (erro instanceof ErroCorpoGrande) {
          return new Response(null, { status: 413, headers: { "cache-control": NO_STORE } });
        }
        throw erro;
      }
    }

    const resposta = await cfg.handler(req, corpoCru);
    const cabecalhos = new Headers(resposta.headers);
    cabecalhos.set("cache-control", NO_STORE);
    return new Response(resposta.body, { status: resposta.status, headers: cabecalhos });
  };
}
