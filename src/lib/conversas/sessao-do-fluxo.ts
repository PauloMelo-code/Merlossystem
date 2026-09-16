import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { Sessao } from "@/lib/auth/guard";

/**
 * Reavaliação da sessão de um stream SSE aberto (03-arquitetura.md §9).
 *
 * O portão na abertura não basta: um stream vive horas. A cada heartbeat o
 * handler chama isto — SEM renovar atividade — e compara com o handshake.
 * Devolve o MOTIVO do corte, ou `null` quando a sessão continua valendo.
 *
 * Lê as tabelas de sessão direto (leitura de outro domínio pelo schema, sem
 * import de módulo alheio) com as mesmas regras de `exigirSessao()`.
 */

export const TETO_ABSOLUTO_MS = 12 * 60 * 60 * 1000;
const INATIVIDADE_MS = 60 * 60 * 1000;

type Linha = {
  papel: string;
  loja_id: string | null;
  ativo: boolean;
  is_deleted: boolean;
  precisa_configurar_fator: boolean;
  precisa_trocar_senha: boolean;
  bloqueado_ate: Date | null;
  ultimo_uso_em: Date | null;
  criada_em: Date;
};

export async function motivoParaFecharFluxo(handshake: Sessao, abertaEm: Date): Promise<string | null> {
  if (Date.now() - abertaEm.getTime() > TETO_ABSOLUTO_MS) return "teto_absoluto";
  const linhas = await db.execute<Linha>(sql`
    select u.papel, u.loja_id, u.ativo, u.is_deleted, u.precisa_configurar_fator,
           u.precisa_trocar_senha, u.bloqueado_ate, s.ultimo_uso_em, s.created_at as criada_em
      from usuarios_sessoes s
      join usuarios u on u.id = s.usuario_id
     where s.id = ${handshake.sessaoId}::uuid
       and s.usuario_id = ${handshake.usuarioId}::uuid
       and s.expira_em > now()
     limit 1
  `);
  const l = linhas.rows[0];
  if (!l) return "sessao_encerrada";
  if (l.is_deleted || !l.ativo) return "conta_desativada";
  if (l.precisa_configurar_fator || l.precisa_trocar_senha) return "gate_de_sessao";
  if (l.bloqueado_ate && new Date(l.bloqueado_ate) > new Date()) return "conta_bloqueada";
  if (l.papel !== handshake.papel) return "papel_alterado";
  if ((l.loja_id ?? null) !== handshake.lojaId) return "loja_alterada";
  const ultimoUso = new Date(l.ultimo_uso_em ?? l.criada_em);
  if (Date.now() - ultimoUso.getTime() > INATIVIDADE_MS) return "inatividade";
  return null;
}
