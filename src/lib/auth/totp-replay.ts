import "server-only";
import { sql } from "drizzle-orm";
import { symmetricDecrypt } from "better-auth/crypto";
import { createOTP } from "@better-auth/utils/otp";
import { db } from "@/lib/db/client";
import { logger } from "@/lib/logger";
import { sanitizarErroBanco } from "@/lib/db/erros";

/**
 * Anti-replay do TOTP NO BANCO (02-seguranca.md §9.1, D6).
 *
 * O plugin do Better Auth confere o código e NÃO lembra qual passo já foi
 * usado: o mesmo código de 6 dígitos entraria de novo enquanto valesse. Esta
 * função grava o passo do código num `UPDATE` condicional — zero linhas quer
 * dizer "este passo, ou um mais novo, já foi usado", e a sessão não nasce.
 *
 * O PASSO É O DO CÓDIGO, não o do relógio: `@better-auth/utils/otp` aceita
 * ±1 passo (e o plugin não expõe essa janela). Gravar o passo do relógio
 * deixaria o mesmo código entrar de novo no passo seguinte, ainda dentro da
 * janela. Por isso a semente é decifrada aqui — com a MESMA chave versionada do
 * BA — só para descobrir qual dos três passos casou; ela não sai desta função.
 *
 * ponytail: `@better-auth/utils` entra como dependência transitiva de
 * `better-auth` (travada no lockfile), o mesmo precedente de
 * `@simplewebauthn/browser` em `porta-de-auth.ts`. Usar o gerador da própria
 * biblioteca garante o mesmo truncamento que a verificação usou.
 */

/** Os mesmos valores de `OPCOES_2FA.totpOptions` (import direto criaria ciclo). */
const PERIODO_S = 30;
const DIGITOS = 6;
/** Janela fixa de `verifyTOTP` em @better-auth/utils 1.x. */
const JANELA = 1;

function passoAgora(): number {
  return Math.floor(Date.now() / 1000 / PERIODO_S);
}

async function passoDoCodigo(segredo: string, codigo: string): Promise<number | null> {
  const agora = passoAgora();
  const otp = createOTP(segredo, { digits: DIGITOS, period: PERIODO_S });
  for (let desvio = -JANELA; desvio <= JANELA; desvio += 1) {
    if ((await otp.hotp(agora + desvio)) === codigo) return agora + desvio;
  }
  return null;
}

/**
 * `true` = passo inédito, gravado agora. `false` = reapresentação — ou falha
 * ao conferir, e aí FAIL-CLOSED: é o banco que sustenta o anti-replay, e sem
 * ele o código voltaria a valer (§7.2 lista este controle entre os que não
 * podem abrir).
 */
export async function consumirPassoDoTotp(usuarioId: string, codigo: unknown): Promise<boolean> {
  try {
    const linhas = await db.execute<{ secret: string }>(sql`
      select secret from usuarios_totp where usuario_id = ${usuarioId}::uuid limit 1
    `);
    const cifrado = linhas.rows[0]?.secret;
    if (!cifrado) return false;

    const { auth } = await import("./auth");
    const contexto = await auth.$context;
    const segredo = await symmetricDecrypt({ key: contexto.secretConfig, data: cifrado });
    // Sem código legível, o passo do relógio: recusa ao menos o mesmo passo.
    const passo =
      (typeof codigo === "string" ? await passoDoCodigo(segredo, codigo) : null) ?? passoAgora();

    const gravado = await db.execute(sql`
      update usuarios_totp set ultimo_passo_totp = ${passo}
      where usuario_id = ${usuarioId}::uuid
        and (ultimo_passo_totp is null or ultimo_passo_totp < ${passo})
      returning usuario_id
    `);
    return gravado.rows.length === 1;
  } catch (erro) {
    logger.error({ erro: sanitizarErroBanco(erro) }, "anti-replay de TOTP falhou");
    return false;
  }
}
