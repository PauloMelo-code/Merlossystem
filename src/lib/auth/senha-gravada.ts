import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { logger } from "@/lib/logger";
import { sanitizarErroBanco } from "@/lib/db/erros";
import { enfileirarEmailSeguranca } from "./emails";
import { registrarEventoAuth } from "./trilha";

/**
 * O que acontece DEPOIS que uma senha foi gravada — um lugar só (REQ-E5).
 *
 * Chamado por `emailAndPassword.onPasswordReset`, pela action de troca de senha
 * e pelo consumo de convite. Três caminhos gravam senha; ter três versões desta
 * rotina é ter dois caminhos onde o histórico não entra e o bloqueio não zera.
 */

export type OrigemDaSenha = "reset" | "troca" | "convite";

const EVENTO = {
  reset: "reset_concluido",
  troca: "senha_trocada",
  convite: "convite_usado",
} as const;

export async function aposSenhaGravada(
  usuarioId: string,
  origem: OrigemDaSenha,
): Promise<void> {
  try {
    // Histórico: copia o hash que acabou de ser gravado na conta de credencial.
    // A tabela é append-only e nunca podada (01-dados.md §5.8).
    await db.execute(sql`
      insert into usuarios_senhas_historico (usuario_id, senha_hash)
      select ${usuarioId}::uuid, c.senha_hash
      from usuarios_contas c
      where c.usuario_id = ${usuarioId}::uuid
        and c.provedor_id = 'credential'
        and c.senha_hash is not null
      limit 1
    `);

    // Senha nova zera o bloqueio por conta (E3) e fecha o gate de troca.
    await db.execute(sql`
      update usuarios
      set falhas_login = 0,
          ultima_falha_em = null,
          bloqueado_ate = null,
          precisa_trocar_senha = false,
          updated_at = now()
      where id = ${usuarioId}::uuid
    `);
  } catch (erro) {
    // A senha JÁ está gravada: derrubar aqui deixaria a pessoa sem saber se a
    // troca valeu. Loga como crítico e segue — o aviso por e-mail ainda sai.
    logger.fatal(
      { usuarioId, origem, erro: sanitizarErroBanco(erro) },
      "pós-gravação de senha falhou",
    );
  }

  void registrarEventoAuth({
    tipo: EVENTO[origem],
    usuarioId,
    meio: origem === "reset" ? "reset" : origem === "convite" ? "convite" : "senha",
  });

  if (origem !== "convite") {
    void enfileirarEmailSeguranca("senha-alterada", usuarioId);
  }
}
