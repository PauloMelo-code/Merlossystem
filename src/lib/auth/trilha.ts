import "server-only";
import { sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { db } from "@/lib/db/client";
import { sanitizarErroBanco } from "@/lib/db/erros";
import type { DetalhesAuthEvento } from "@/lib/db/schema/auth-eventos";
import type {
  AtorTipo,
  MeioAuth,
  ResultadoAuth,
  TipoAuthEvento,
} from "@/lib/db/schema/_enums/auth";
import { hashEmailCom } from "./tokens";

/**
 * Funil único da trilha de autenticação (02-seguranca.md §17, 01-dados.md §7.1).
 *
 * `auth_eventos` é append-only: `REVOKE UPDATE, DELETE, TRUNCATE` para
 * `merlo_app` e gatilho `trilha_imutavel()` (migração 0004). Por isso a
 * gravação é um `INSERT` cru por `db.execute` — não passa por `mutacoes.ts`,
 * que existe para tabela de DOMÍNIO com auditoria e trava de colisão, e nenhum
 * `UPDATE` desta tabela é possível nem pela aplicação nem por superusuário.
 *
 * Duas portas, porque a política de gravação é POR TIPO DE EVENTO (§17.2):
 *   - `registrarEventoAuth`  — best-effort, NUNCA lança. Entrada e saída de
 *     sessão, recusas, infraestrutura. Trilha não pode impedir alguém de entrar.
 *   - `gravarEventoAuth`     — fail-closed, aceita `tx`. Promoção, rebaixamento,
 *     transferência de posse, desativação, recuperação assistida, semeadura.
 *     Gravada ANTES do efeito e na MESMA transação: se ela falha, o efeito não
 *     acontece.
 */

export type EventoAuth = {
  tipo: TipoAuthEvento;
  atorTipo?: AtorTipo;
  usuarioId?: string | null;
  /** O e-mail em claro NUNCA é gravado: vira HMAC com `AUTH_EMAIL_HASH_KEY`. */
  email?: string | null;
  sessaoId?: string | null;
  meio?: MeioAuth | null;
  resultado?: ResultadoAuth;
  ip?: string | null;
  agente?: string | null;
  atorId?: string | null;
  alvoId?: string | null;
  motivo?: string | null;
  detalhes?: DetalhesAuthEvento;
};

/** `db` ou a transação aberta por `emTransacao`. */
export type Executor = Pick<typeof db, "execute">;

/** Teto do best-effort: trilha lenta não pode segurar a resposta do login. */
const TETO_MS = 3_000;

export function hashEmail(email: string | null | undefined): string | null {
  return hashEmailCom(env.AUTH_EMAIL_HASH_KEY, email);
}

/** Fail-closed: lança. Use quando o efeito destrói o estado anterior. */
export async function gravarEventoAuth(evento: EventoAuth, executor?: Executor): Promise<void> {
  const alvo = executor ?? db;
  await alvo.execute(sql`
    insert into auth_eventos
      (tipo, ator_tipo, usuario_id, email_hash, sessao_id, meio, resultado,
       ip, agente, ator_id, alvo_id, motivo, detalhes)
    values (
      ${evento.tipo},
      ${evento.atorTipo ?? "usuario"},
      ${evento.usuarioId ?? null},
      ${hashEmail(evento.email)},
      ${evento.sessaoId ?? null},
      ${evento.meio ?? null},
      ${evento.resultado ?? "sucesso"},
      ${evento.ip ?? null},
      ${evento.agente ?? null},
      ${evento.atorId ?? null},
      ${evento.alvoId ?? null},
      ${evento.motivo ?? null},
      ${JSON.stringify(evento.detalhes ?? {})}::jsonb
    )
  `);
}

/**
 * Best-effort: `try/catch` em volta de tudo, `.catch` na promessa e corrida com
 * um teto de 3 s. Falha vira log CRITICAL e segue (REQ-L3).
 */
export async function registrarEventoAuth(evento: EventoAuth): Promise<void> {
  try {
    let expirar: ReturnType<typeof setTimeout> | undefined;
    const teto = new Promise<void>((resolver) => {
      expirar = setTimeout(resolver, TETO_MS);
    });
    await Promise.race([
      gravarEventoAuth(evento).catch((erro: unknown) => {
        logger.fatal(
          { evento: evento.tipo, erro: sanitizarErroBanco(erro) },
          "trilha de auth falhou (best-effort)",
        );
      }),
      teto,
    ]);
    if (expirar) clearTimeout(expirar);
  } catch (erro) {
    logger.fatal(
      { evento: evento.tipo, erro: sanitizarErroBanco(erro) },
      "trilha de auth falhou (best-effort)",
    );
  }
}

/**
 * Dedupe NO BANCO (não no Redis): o aviso de conta bloqueada tem de continuar
 * deduplicado justamente quando o Redis cai — senão uma rajada de tentativas
 * vira uma rajada de e-mails para a vítima (§7.1). O índice
 * `(usuario_id, criado_em DESC)` já existe.
 */
export async function houveEventoRecente(
  tipo: TipoAuthEvento,
  usuarioId: string,
  horas: number,
): Promise<boolean> {
  const linhas = await db.execute<{ existe: boolean }>(sql`
    select exists (
      select 1 from auth_eventos
      where usuario_id = ${usuarioId}
        and tipo = ${tipo}
        and criado_em > now() - make_interval(hours => ${horas})
    ) as existe
  `);
  return Boolean(linhas.rows[0]?.existe);
}
