import { ErroDeValidacao } from "@/lib/erros";
import { motivosDeSenha, type ContextoDeSenha } from "./senha-regras";

/**
 * Política de senha (02-seguranca.md §6).
 *
 * A parte determinística é PURA e mora em `./senha-regras.ts`, que a tela
 * importa direto: é o mesmo módulo dos dois lados, para a lista de motivos ser
 * idêntica (B6). Ela foi separada daqui porque este arquivo alcança o banco e
 * o HIBP por `import()`, e o empacotador do Next arrastaria esse grafo para o
 * navegador — onde `server-only` reprova o build.
 *
 * ONDE RODA: só onde a senha é GRAVADA — convite, `/reset-password`,
 * `/change-password` e a troca pela action. NUNCA em `password.hash`/`verify`,
 * que rodam no login e virariam oráculo (B9/G22/G23).
 */

export {
  CAMINHOS_QUE_GRAVAM_SENHA,
  MAX_BYTES_SENHA,
  MAX_SENHA,
  MIN_SENHA,
  motivosDeSenha,
} from "./senha-regras";
export type { ContextoDeSenha } from "./senha-regras";

/**
 * HIBP por k-anonimato: manda só os 5 primeiros do SHA-1 e compara o sufixo.
 * `Add-Padding: true` para o tamanho da resposta não contar quantos vazamentos
 * o prefixo tem. Teto de 1,5 s e **fail-open** com evento — o plugin do BA é
 * fail-closed e pendurado no hash: HIBP fora do ar travaria toda troca de senha
 * (G23).
 */
async function vazouNoHibp(senha: string): Promise<boolean> {
  const { createHash } = await import("node:crypto");
  const sha1 = createHash("sha1").update(senha, "utf8").digest("hex").toUpperCase();
  const prefixo = sha1.slice(0, 5);
  const sufixo = sha1.slice(5);

  const abortar = new AbortController();
  const expirar = setTimeout(() => abortar.abort(), 1_500);
  try {
    const resposta = await fetch(`https://api.pwnedpasswords.com/range/${prefixo}`, {
      headers: { "Add-Padding": "true" },
      signal: abortar.signal,
      cache: "no-store",
    });
    if (!resposta.ok) throw new Error(`HIBP ${resposta.status}`);
    const corpo = await resposta.text();
    return corpo
      .split("\n")
      .some((linha) => linha.slice(0, 35).trim().toUpperCase() === sufixo);
  } catch (erro) {
    const { registrarEventoAuth } = await import("./trilha");
    void registrarEventoAuth({
      tipo: "hibp_indisponivel",
      resultado: "falha",
      atorTipo: "sistema",
      detalhes: { acao: String(erro) },
    });
    return false;
  } finally {
    clearTimeout(expirar);
  }
}

/**
 * Histórico: as 5 mais recentes de `usuarios_senhas_historico`, hash Argon2id,
 * leitura **fail-closed** — se a consulta falha, a troca não acontece. A tabela
 * é append-only e nunca podada (podar exigiria `DELETE`).
 */
async function repetiuSenha(usuarioId: string, senha: string): Promise<boolean> {
  const [{ db }, { sql }, { kdf }] = await Promise.all([
    import("@/lib/db/client"),
    import("drizzle-orm"),
    import("./kdf"),
  ]);
  const linhas = await db.execute<{ senha_hash: string }>(sql`
    select senha_hash from usuarios_senhas_historico
    where usuario_id = ${usuarioId}
    order by criado_em desc
    limit 5
  `);
  for (const linha of linhas.rows) {
    if (await kdf.verify(linha.senha_hash, senha)) return true;
  }
  return false;
}

export type OpcoesDaPolitica = {
  usuarioId?: string | undefined;
  contexto?: ContextoDeSenha;
  /** Interruptor `AUTH_HIBP_HABILITADO` já resolvido por quem chama. */
  conferirHibp?: boolean;
};

/**
 * Política completa. Lança `ErroDeValidacao` com TODOS os motivos de uma vez —
 * devolver um motivo por vez faz a pessoa tentar cinco senhas ruins seguidas.
 */
export async function politicaDeSenha(
  senha: unknown,
  opcoes: OpcoesDaPolitica = {},
): Promise<void> {
  if (typeof senha !== "string") {
    throw new ErroDeValidacao({ senha: ["Informe a nova senha."] });
  }

  const motivos = motivosDeSenha(senha, opcoes.contexto ?? {});

  if (motivos.length === 0 && opcoes.conferirHibp !== false && (await vazouNoHibp(senha))) {
    motivos.push("Esta senha já apareceu em vazamento público. Escolha outra.");
  }

  if (motivos.length === 0 && opcoes.usuarioId && (await repetiuSenha(opcoes.usuarioId, senha))) {
    motivos.push("Você já usou esta senha. Escolha uma que ainda não usou.");
  }

  if (motivos.length > 0) throw new ErroDeValidacao({ senha: motivos });
}
