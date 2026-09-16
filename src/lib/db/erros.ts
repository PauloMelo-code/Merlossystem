/**
 * Sanitiza o erro do `pg` antes de qualquer log (03-arquitetura.md §14.3).
 *
 * O `detail` de uma violação de UNIQUE carrega o VALOR que colidiu
 * (`Key (email)=(ana@merlostore.com.br) already exists`) e o `parameters`
 * carrega a linha inteira que ia ser gravada. Logar o erro do driver como veio
 * é gravar dado pessoal — e, no caso do login, entregar que a conta existe.
 */

/** Campos do erro do driver que podem ir para o log. Lista branca, de propósito. */
const CAMPOS_SEGUROS = [
  "name",
  "code",
  "severity",
  "constraint",
  "table",
  "column",
  "schema",
  "routine",
] as const;

export type ErroBancoSanitizado = {
  mensagem: string;
} & Partial<Record<(typeof CAMPOS_SEGUROS)[number], string>>;

export function sanitizarErroBanco(erro: unknown): ErroBancoSanitizado {
  if (typeof erro !== "object" || erro === null) {
    return { mensagem: "Erro desconhecido do banco." };
  }

  const bruto = erro as Record<string, unknown>;
  const limpo: ErroBancoSanitizado = {
    // A mensagem do Postgres nomeia a constraint, não o valor; o valor está no
    // `detail`, que fica de fora.
    mensagem: typeof bruto.message === "string" ? bruto.message : "Erro do banco.",
  };

  for (const campo of CAMPOS_SEGUROS) {
    const valor = bruto[campo];
    if (typeof valor === "string") limpo[campo] = valor;
  }

  return limpo;
}

/**
 * Violação de único (23505) numa das constraints dadas. Lê o erro do `pg`
 * direto ou embrulhado pelo Drizzle (`cause`). Quem chama traduz para
 * `ErroDeColisao` — a transação já está abortada e vai sofrer rollback.
 */
export function ehViolacaoDeUnico(erro: unknown, ...constraints: readonly string[]): boolean {
  type ErroPg = { code?: unknown; constraint?: unknown };
  const bruto = erro as (ErroPg & { cause?: ErroPg }) | null;
  const pg = bruto && bruto.code !== undefined ? bruto : bruto?.cause;
  return pg?.code === "23505" && typeof pg.constraint === "string" && constraints.includes(pg.constraint);
}
