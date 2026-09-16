import { auth } from "@/lib/auth/auth";
import { canonizarCaminho, estaDesligado } from "@/lib/auth/caminhos";
import * as bloqueio from "@/lib/auth/bloqueio";
import { registrarEventoAuth } from "@/lib/auth/trilha";
import { ErroCorpoGrande, TETO_AUTH, lerCorpoComTeto } from "@/lib/seguranca/corpo";
import { ipDoCliente } from "@/lib/seguranca/ip";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Route Handler do Better Auth (02-seguranca.md §5.1 e §8).
 *
 * A ordem das etapas é a do documento e NÃO pode ser reordenada: cada uma
 * existe para fechar um oráculo.
 */

/** Toda resposta de auth. Página autenticada sem isto é F13. */
const NO_STORE = "no-store";

/**
 * Recusa ÚNICA de login (§8, REQ-C4). Bytes exatos, ordem de chaves fixa,
 * sem `Set-Cookie`, sem `X-Retry-After`, sem `WWW-Authenticate`.
 *
 * Caem aqui: e-mail inexistente, senha errada, conta desativada, conta
 * `is_deleted`, conta bloqueada, 429 do limitador e semáforo de KDF cheio.
 * NÃO caem: conta com `precisa_trocar_senha` e conta sem 2º fator — essas
 * AUTENTICAM, e quem decide o destino é o gate de §9.4.
 */
const CORPO_RECUSA = '{"code":"CREDENCIAIS_INVALIDAS","message":"E-mail ou senha inválidos."}';

function respostaDeRecusa(): Response {
  return new Response(CORPO_RECUSA, {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": NO_STORE,
      "content-length": String(Buffer.byteLength(CORPO_RECUSA, "utf8")),
    },
  });
}

/** `200 {"status":true}` idêntico byte a byte, exista ou não a conta (E1). */
const CORPO_RESET = '{"status":true}';

function respostaDeReset(): Response {
  return new Response(CORPO_RESET, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": NO_STORE,
      "content-length": String(Buffer.byteLength(CORPO_RESET, "utf8")),
    },
  });
}

/**
 * Piso de tempo + jitter. `PISO_RECUSA_MS` tem `.min(300)` no `env.ts`: sem
 * piso mínimo, `PISO_RECUSA_MS=0` em produção desligaria, sem deixar rastro, o
 * único controle que esconde a diferença entre "existe" e "não existe".
 */
async function esperarAte(inicio: number): Promise<void> {
  const alvo = inicio + env.PISO_RECUSA_MS + Math.floor(Math.random() * 51);
  const falta = alvo - Date.now();
  if (falta > 0) await new Promise((resolver) => setTimeout(resolver, falta));
}

/** Caminhos cuja recusa é normalizada byte a byte e no tempo (§5.1 item 6). */
const CAMINHOS_ISONOMICOS = new Set([
  "/sign-in/email",
  "/sign-in/passkey",
  "/passkey/generate-authenticate-options",
  "/passkey/verify-authentication",
  "/two-factor/verify-totp",
]);

function caminhoDaRequisicao(req: Request): string {
  const bruto = new URL(req.url).pathname;
  const indice = bruto.indexOf("/api/auth");
  return canonizarCaminho(indice === -1 ? bruto : bruto.slice(indice + "/api/auth".length));
}

function extrairEmail(corpo: string): string | null {
  try {
    const objeto = JSON.parse(corpo) as { email?: unknown };
    // Normaliza SÓ o e-mail. NUNCA a senha (B5).
    return typeof objeto.email === "string" ? objeto.email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

async function ehRedirecionamentoDe2FA(resposta: Response): Promise<boolean> {
  try {
    const texto = await resposta.clone().text();
    return texto.includes("twoFactorRedirect");
  } catch {
    return false;
  }
}

function comCabecalhosFixos(resposta: Response, caminho: string): Response {
  const cabecalhos = new Headers(resposta.headers);
  cabecalhos.set("cache-control", NO_STORE);
  if (caminho === "/sign-out") {
    cabecalhos.set("clear-site-data", '"cache","cookies","storage"');
  }
  return new Response(resposta.body, {
    status: resposta.status,
    statusText: resposta.statusText,
    headers: cabecalhos,
  });
}

async function tratar(req: Request): Promise<Response> {
  const inicio = Date.now();
  const caminho = caminhoDaRequisicao(req);

  // 1. Caminho desligado: 404 SEM corpo, ANTES de o BA ser chamado.
  // `disabledPaths` sozinho responde 404 COM corpo "Not Found", e caminho
  // inexistente responde 404 SEM corpo — a diferença de bytes é um oráculo
  // (G19, REQ-L9).
  if (estaDesligado(caminho)) {
    void registrarEventoAuth({
      tipo: "sonda_caminho_desligado",
      atorTipo: "sistema",
      resultado: "recusado",
      ip: ipDoCliente(req.headers),
      agente: req.headers.get("user-agent"),
      detalhes: { rota: caminho },
    });
    return new Response(null, { status: 404 });
  }

  // 2. Teto de corpo. Route Handler não tem `bodySizeLimit` (B8/I11).
  let corpo = "";
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      corpo = await lerCorpoComTeto(req, TETO_AUTH);
    } catch (erro) {
      if (erro instanceof ErroCorpoGrande) return new Response(null, { status: 413 });
      throw erro;
    }
  }

  const email = caminho === "/sign-in/email" ? extrairEmail(corpo) : null;

  // 3. Conta bloqueada não vira KDF e NÃO conta falha nova ("bloqueio como
  // arma", C3). A recusa é a mesma de senha errada, no mesmo tempo.
  if (email) {
    const estado = await bloqueio.estaBloqueada(email);
    if (estado.bloqueada) {
      void registrarEventoAuth({
        tipo: "login_falha",
        usuarioId: estado.usuarioId,
        email,
        meio: "senha",
        resultado: "recusado",
        ip: ipDoCliente(req.headers),
        agente: req.headers.get("user-agent"),
        detalhes: { rota: caminho },
      });
      await esperarAte(inicio);
      return respostaDeRecusa();
    }
  }

  // 4. O semáforo de KDF vive dentro de `kdf` (§6) e alcança tanto o `hash`
  // quanto o `verify` configurados em `emailAndPassword.password`.
  const paraBa =
    req.method === "GET" || req.method === "HEAD"
      ? req
      : new Request(req.url, { method: req.method, headers: req.headers, body: corpo });

  let resposta: Response;
  try {
    resposta = await auth.handler(paraBa);
  } catch (erro) {
    logger.error({ caminho, erro: String(erro) }, "handler do Better Auth lançou");
    if (CAMINHOS_ISONOMICOS.has(caminho)) {
      await esperarAte(inicio);
      return respostaDeRecusa();
    }
    return new Response(null, { status: 500, headers: { "cache-control": NO_STORE } });
  }

  // 7. Pedido de reset: resposta e tempo iguais, exista ou não a conta (E1).
  if (caminho === "/request-password-reset") {
    await esperarAte(inicio);
    return respostaDeReset();
  }

  if (caminho === "/sign-in/email" && email) {
    if (resposta.status === 200) {
      await bloqueio.zerar(email);
      if (await ehRedirecionamentoDe2FA(resposta)) {
        void registrarEventoAuth({
          tipo: "senha_aceita_aguardando_2fa",
          email,
          meio: "senha",
          ip: ipDoCliente(req.headers),
          agente: req.headers.get("user-agent"),
        });
      }
    } else {
      // 5. Só credencial alimenta o contador. 403 de conta desativada e 429 do
      // limitador NÃO contam falha — senão qualquer um tranca a conta alheia.
      if (resposta.status === 401) await bloqueio.registrarFalha(email);
      void registrarEventoAuth({
        tipo: "login_falha",
        email,
        meio: "senha",
        resultado: "falha",
        ip: ipDoCliente(req.headers),
        agente: req.headers.get("user-agent"),
        detalhes: { rota: caminho },
      });
      await esperarAte(inicio);
      return respostaDeRecusa();
    }
  }

  // 6. Mesma normalização de bytes e de tempo para os demais caminhos que
  // autenticam: passkey (as duas etapas) e TOTP.
  if (resposta.status !== 200 && CAMINHOS_ISONOMICOS.has(caminho)) {
    await esperarAte(inicio);
    return respostaDeRecusa();
  }

  return comCabecalhosFixos(resposta, caminho);
}

export async function GET(req: Request): Promise<Response> {
  return tratar(req);
}

export async function POST(req: Request): Promise<Response> {
  return tratar(req);
}
