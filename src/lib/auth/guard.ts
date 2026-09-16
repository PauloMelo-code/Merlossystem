import type { PAPEIS } from "@/lib/db/schema/_enums/auth";
import type { EscopoLoja } from "./loja";

/**
 * PLACEHOLDER DE F4 — só os TIPOS do contrato do portão (01-dados.md §13.1).
 *
 * `src/lib/db/mutacoes.ts` precisa de `Contexto` para gravar a trilha na mesma
 * transação do efeito, e mutações são de F4. F5 reescreve este arquivo com
 * `pode()`, `exigirSessao()`, `exigirSessaoFresca()`, `exigirPermissao()`,
 * `ehPrivilegioMaximo()`, `rotaDeMaquina()` e `rotaPublica()` — mantendo estes
 * quatro tipos exatamente como estão.
 */

/** Vem da constante `PAPEIS`, para não existir uma segunda lista de papéis. */
export type Papel = (typeof PAPEIS)[number];

export type Sessao = {
  usuarioId: string;
  sessaoId: string;
  papel: Papel;
  lojaId: string | null;
  ativo: true;
  precisaTrocarSenha: boolean;
  precisaConfigurarFator: boolean;
};

export type Contexto = {
  sessao: Sessao;
  escopo: EscopoLoja;
  autorId: string;
  origem: "ui" | "webhook" | "worker";
};

export type { EscopoLoja };
