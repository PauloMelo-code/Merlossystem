import { Pool } from "pg";
import { env } from "../src/lib/env";
import {
  CIENCIA_ADMIN_V1,
  VALIDADE_CONVITE_HORAS,
  hashEmailCom,
  linkComToken,
  novoToken,
} from "../src/lib/auth/tokens";

/**
 * Semeadura do primeiro dono (02-seguranca.md §9.2 e §18, 01-dados.md §5.7).
 *
 *   npm run primeiro-dono -- dono@merlostore.com.br
 *
 * Substitui o `/api/register` público do sistema antigo, que tinha TOCTOU e
 * ficava exposto depois de todo deploy com banco vazio (D-02).
 *
 * NÃO aceita senha, NÃO cria usuário e NÃO roda no entrypoint do container:
 * emite um convite `bootstrap = true, papel = 'admin'`, imprime o link UMA vez
 * e grava `dono_semeado`. Quem consome o convite nasce `dono` — e só se ainda
 * não houver nenhum dono vivo, conferido dentro da transação do consumo.
 *
 * Usa `pg` direto, e não `src/lib/db/client.ts`, porque o client importa
 * `server-only` e estoura fora do runtime do Next. O ambiente vem de
 * `src/lib/env.ts` (nada de `process.env` aqui, T17) e o token é gerado pelo
 * MESMO módulo puro que a aplicação usa.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function principal(): Promise<void> {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) {
    console.error("Uso: npm run primeiro-dono -- <e-mail do primeiro dono>");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const cliente = await pool.connect();
  try {
    await cliente.query("begin");

    const donos = await cliente.query<{ donos: string }>(
      "select count(*)::text as donos from usuarios where papel = 'dono' and is_deleted = false",
    );
    if (Number(donos.rows[0]?.donos ?? "0") > 0) {
      await cliente.query("rollback");
      console.error("Já existe um dono ativo. A semeadura só roda com o sistema sem dono.");
      console.error("Para acrescentar outro dono, use a transferência de posse na tela.");
      process.exit(1);
    }

    const { token, hash } = novoToken();
    const convite = await cliente.query<{ id: string; expira_em: Date }>(
      `insert into usuarios_convites
         (email, papel, loja_id, token_hash, expira_em, criado_por, ciencia_versao,
          bootstrap, motivo, created_at, updated_at, modified_by)
       values ($1, 'admin', null, $2, now() + make_interval(hours => $3), null, $4,
               true, 'semeadura do primeiro dono', now(), now(), null)
       returning id, expira_em`,
      [email, hash, VALIDADE_CONVITE_HORAS, CIENCIA_ADMIN_V1],
    );

    // Fail-closed e na MESMA transação: sem a prova, a semeadura não vale.
    await cliente.query(
      `insert into auth_eventos (tipo, ator_tipo, email_hash, meio, resultado, motivo, detalhes)
       values ('dono_semeado', 'sistema', $1, 'sistema', 'sucesso', $2, $3::jsonb)`,
      [
        hashEmailCom(env.AUTH_EMAIL_HASH_KEY, email),
        "convite de semeadura emitido por scripts/primeiro-dono.ts",
        JSON.stringify({ papel: "admin" }),
      ],
    );

    await cliente.query("commit");

    const expira = new Date(convite.rows[0]!.expira_em);
    console.log("");
    console.log("Convite de semeadura emitido. O link aparece UMA vez:");
    console.log("");
    console.log(`  ${linkComToken(env.APP_URL, "/primeiro-acesso", token)}`);
    console.log("");
    console.log(`  válido até ${expira.toLocaleString("pt-BR")}`);
    console.log("  entregue por canal fora do e-mail se o provedor ainda não estiver configurado.");
    console.log("");
  } catch (erro) {
    await cliente.query("rollback").catch(() => undefined);
    // O único parcial `uq_usuarios_convites_bootstrap` garante no máximo UM
    // convite de semeadura vivo. Bater nele não é defeito: é a barreira.
    if ((erro as { constraint?: string }).constraint === "uq_usuarios_convites_bootstrap") {
      console.error("Já existe um convite de semeadura em aberto.");
      console.error("Use o link que foi impresso da primeira vez ou espere ele vencer (24 h).");
      process.exit(1);
    }
    throw erro;
  } finally {
    cliente.release();
    await pool.end();
  }
}

// `void` e não `await` de topo: o tsx transpila este arquivo como CJS.
void principal().catch((erro: unknown) => {
  console.error(erro);
  process.exit(1);
});
