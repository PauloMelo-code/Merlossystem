import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { logger } from "@/lib/logger";
import { sanitizarErroBanco } from "@/lib/db/erros";
import { enfileirarEmailSeguranca } from "./emails";
import { houveEventoRecente, registrarEventoAuth } from "./trilha";

/**
 * Bloqueio por CONTA, atômico e persistido (02-seguranca.md §7.1, REQ-C1).
 *
 * É a PRIMEIRA linha de defesa — o teto por IP é a segunda, e é fail-open. O
 * `accountLockout` do plugin `twoFactor` não serve aqui: ele conta falha de
 * segundo fator, não de senha.
 *
 * Uma instrução SQL só. `SELECT` seguido de `UPDATE` perde a corrida de oito
 * tentativas paralelas — que é exatamente o que a trava T6 dispara.
 */

export const MAX_FALHAS = 5;
export const JANELA_MINUTOS = 15;
export const BLOQUEIO_MINUTOS = 15;

type LinhaBloqueio = {
  id: string;
  bloqueado_ate: Date | null;
  falhas_login: number;
};

export type EstadoDeBloqueio = {
  bloqueada: boolean;
  usuarioId: string | null;
  ate: Date | null;
};

const EMAIL_INEXISTENTE: EstadoDeBloqueio = { bloqueada: false, usuarioId: null, ate: null };

function normalizar(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Consulta usada ANTES de chamar o BA: conta bloqueada não vira KDF e não conta
 * falha nova (C3, "bloqueio como arma").
 */
export async function estaBloqueada(email: string): Promise<EstadoDeBloqueio> {
  try {
    const linhas = await db.execute<LinhaBloqueio>(sql`
      select id, bloqueado_ate, falhas_login
      from usuarios
      where lower(email) = ${normalizar(email)} and is_deleted = false
      limit 1
    `);
    const linha = linhas.rows[0];
    if (!linha) return EMAIL_INEXISTENTE;
    const ate = linha.bloqueado_ate ? new Date(linha.bloqueado_ate) : null;
    return {
      bloqueada: ate !== null && ate.getTime() > Date.now(),
      usuarioId: linha.id,
      ate,
    };
  } catch (erro) {
    // Fail-closed seria trancar todo mundo fora quando o banco tosse; mas o
    // caminho seguinte (o próprio login) também vai ao banco e vai falhar lá,
    // com a recusa única. Aqui só não há informação.
    logger.error({ erro: sanitizarErroBanco(erro) }, "consulta de bloqueio falhou");
    return EMAIL_INEXISTENTE;
  }
}

/**
 * Conta UMA falha de credencial. Chamado somente quando a causa é credencial
 * (`401 INVALID_EMAIL_OR_PASSWORD`) — 403 de conta desativada e 429 do
 * limitador não alimentam o contador.
 *
 * E-mail inexistente: NENHUMA escrita (C5). O `WHERE` já garante isso.
 *
 * O `= 5` (e não `>= 5`) mais o filtro `bloqueado_ate IS NULL OR < now()`
 * garantem que martelar NÃO estende o bloqueio.
 */
export async function registrarFalha(email: string): Promise<EstadoDeBloqueio> {
  const chave = normalizar(email);
  try {
    const linhas = await db.execute<{ id: string; bloqueado_ate: Date | null }>(sql`
      update usuarios set
        falhas_login = case
          when ultima_falha_em is null or ultima_falha_em < now() - make_interval(mins => ${JANELA_MINUTOS})
          then 1 else falhas_login + 1 end,
        ultima_falha_em = now(),
        bloqueado_ate = case
          when (case
                  when ultima_falha_em is null or ultima_falha_em < now() - make_interval(mins => ${JANELA_MINUTOS})
                  then 1 else falhas_login + 1 end) = ${MAX_FALHAS}
          then now() + make_interval(mins => ${BLOQUEIO_MINUTOS})
          else bloqueado_ate end
      where lower(email) = ${chave}
        and is_deleted = false
        and (bloqueado_ate is null or bloqueado_ate < now())
      returning id, bloqueado_ate
    `);

    const linha = linhas.rows[0];
    if (!linha) return EMAIL_INEXISTENTE;

    const ate = linha.bloqueado_ate ? new Date(linha.bloqueado_ate) : null;
    const bloqueouAgora = ate !== null && ate.getTime() > Date.now();
    if (bloqueouAgora) await avisarVitima(linha.id);

    return { bloqueada: bloqueouAgora, usuarioId: linha.id, ate };
  } catch (erro) {
    logger.error({ erro: sanitizarErroBanco(erro) }, "registro de falha de login falhou");
    return EMAIL_INEXISTENTE;
  }
}

/** Login bem-sucedido, reset concluído e entrada por passkey zeram o contador. */
export async function zerar(email: string): Promise<void> {
  try {
    await db.execute(sql`
      update usuarios
      set falhas_login = 0, ultima_falha_em = null, bloqueado_ate = null
      where lower(email) = ${normalizar(email)} and is_deleted = false
    `);
  } catch (erro) {
    logger.error({ erro: sanitizarErroBanco(erro) }, "zerar bloqueio falhou");
  }
}

/** Passkey entra mesmo com a conta trancada e destrava (C9, §4.3). */
export async function zerarPorId(usuarioId: string): Promise<void> {
  try {
    await db.execute(sql`
      update usuarios
      set falhas_login = 0, ultima_falha_em = null, bloqueado_ate = null
      where id = ${usuarioId}::uuid
    `);
  } catch (erro) {
    logger.error({ erro: sanitizarErroBanco(erro) }, "zerar bloqueio por id falhou");
  }
}

/**
 * Aviso à vítima com dedupe NO BANCO, 24 h. Dedupe no Redis sumiria justamente
 * quando o Redis cai — e uma rajada viraria uma rajada de e-mails para quem já
 * está sendo atacado. O Redis fica só para o alerta interno da equipe.
 */
async function avisarVitima(usuarioId: string): Promise<void> {
  try {
    if (await houveEventoRecente("conta_bloqueada", usuarioId, 24)) return;
  } catch (erro) {
    logger.error({ erro: sanitizarErroBanco(erro) }, "dedupe de conta_bloqueada falhou");
    return;
  }
  await registrarEventoAuth({
    tipo: "conta_bloqueada",
    usuarioId,
    resultado: "recusado",
    meio: "senha",
    detalhes: { tentativas: MAX_FALHAS },
  });
  // `void`: nunca `await` de SMTP dentro da resposta (C7).
  enfileirarEmailSeguranca("conta-bloqueada", usuarioId);
}
