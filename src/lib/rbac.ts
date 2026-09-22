/**
 * RBAC da API — quem pode o que, num lugar so.
 *
 * Aplicado pelo `src/middleware.ts` em `/api/**`, antes de a rota rodar. Nao ha
 * checagem espalhada por route handler: rota nova ja cai na regra padrao, sem
 * ninguem precisar lembrar.
 *
 * A tabela efetiva das 50 rotas esta em `docs/rbac.md` e e travada por
 * `tests/rbac.test.ts` — mudanca de permissao aparece no diff do teste.
 */

export const ROLES = ["admin", "gerente", "vendedor", "viewer"] as const
export type Role = (typeof ROLES)[number]

export type Metodo = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

const TODOS: Role[] = ["admin", "gerente", "vendedor", "viewer"]
const ESCRITA: Role[] = ["admin", "gerente", "vendedor"]
const EXCLUSAO: Role[] = ["admin", "gerente"]
const SO_ADMIN: Role[] = ["admin"]

/**
 * Regra padrao, por metodo:
 *
 *   GET     todos                    — `viewer` existe para isso
 *   POST    admin+gerente+vendedor   — operacao do dia a dia
 *   PUT     idem
 *   PATCH   idem
 *   DELETE  admin+gerente            — gestao exclui; atendente nao
 *
 * `gerente` pode tudo menos configuracao e usuario (docs/rbac.md) — por isso
 * ele entra ate no DELETE, e as duas areas de fora viram excecao abaixo.
 */
const PADRAO: Record<Metodo, Role[]> = {
  GET: TODOS,
  POST: ESCRITA,
  PUT: ESCRITA,
  PATCH: ESCRITA,
  DELETE: EXCLUSAO,
}

/**
 * Excecoes ao padrao. Primeira que casar vence, entao vao da mais especifica
 * para a mais generica. Os padroes casam o caminho REAL em runtime
 * (`/api/contacts/abc-123`), nao a forma de arquivo (`/api/contacts/[id]`).
 */
const EXCECOES: { re: RegExp; metodos: Partial<Record<Metodo, Role[]>>; motivo: string }[] = [
  {
    // Cancelar mensagem agendada e soft delete (grava status "cancelled"),
    // nao exclusao. E trabalho de atendimento.
    re: /^\/api\/scheduled\/[^/]+$/,
    metodos: { DELETE: ESCRITA },
    motivo: "DELETE aqui e cancelamento logico, nao exclusao",
  },

  {
    // A PROPRIA conta: nome, foto e senha. Vale para todo papel, inclusive
    // viewer — cuidar da propria senha nao e privilegio de gestao, e sem isto
    // toda troca passava pelo administrador (na pratica, senha combinada no
    // grupo). A rota so toca no usuario da sessao, nunca em papel ou loja.
    re: /^\/api\/perfil$/,
    metodos: { GET: TODOS, PUT: TODOS },
    motivo: "cuidar da propria conta nao e administracao",
  },

  // === Area de GESTAO — fora do dia a dia da vendedora =====================
  // Decisao do cliente (22/09/2026): a vendedora atende, vende e registra
  // troca; disparo em massa, modelo de mensagem, relatorio, base de
  // conhecimento e alerta sao de quem coordena a loja. Esconder no menu nao
  // basta: sem esta regra, a URL digitada a mao continuava abrindo.
  {
    re: /^\/api\/(broadcasts|templates|analytics|knowledge|alerts)(\/|$)/,
    metodos: { GET: EXCLUSAO, POST: EXCLUSAO, PUT: EXCLUSAO, PATCH: EXCLUSAO, DELETE: EXCLUSAO },
    motivo: "coordenacao da loja, nao atendimento",
  },

  // === Area de CONFIGURACAO — so admin, em qualquer metodo =================
  // `gerente` pode tudo menos configuracao e usuario (docs/rbac.md).
  {
    // ANTES da regra geral de integracoes (a primeira que casa vence): a lista
    // de NUMEROS da loja nao e configuracao — e o filtro da caixa de entrada,
    // que a vendedora usa para ver so o atendimento do numero dela. A rota
    // devolve apelido, canal e responsavel; nunca credencial, referencia
    // externa ou estado de token. Mesmo criterio de `/api/lojas` e
    // `/api/usuarios` logo abaixo.
    re: /^\/api\/integracoes\/numeros$/,
    metodos: { GET: TODOS },
    motivo: "escolher por qual numero filtrar e operacao, nao configuracao",
  },
  {
    re: /^\/api\/integracoes(\/|$)/,
    metodos: { GET: SO_ADMIN, POST: SO_ADMIN, PUT: SO_ADMIN, PATCH: SO_ADMIN, DELETE: SO_ADMIN },
    motivo: "credencial de integracao: chave que movimenta dinheiro e dado de cliente",
  },
  {
    // LER a lista nao e configuracao — e a propria rota que escopa o que cada
    // papel enxerga (gestao ve as duas; vendedor ve so a dele, para a interface
    // poder mostrar em qual loja ele esta). Cadastrar loja continua so com admin.
    re: /^\/api\/lojas(\/|$)/,
    metodos: { POST: SO_ADMIN, PUT: SO_ADMIN, PATCH: SO_ADMIN, DELETE: SO_ADMIN },
    motivo: "cadastro de loja e configuracao; a listagem e operacao",
  },

  // === Area de USUARIO — escrita so admin =================================
  {
    // Mesmo criterio de `/api/lojas` acima: LER a lista de colegas e operacao,
    // nao configuracao. O vendedor precisa dela para transferir uma conversa, e
    // travar o GET em admin deixava o seletor de transferencia vazio justamente
    // para quem transfere. A rota devolve o minimo — nome, papel e avatar,
    // filtrados pela loja de quem pergunta — e nunca e-mail ou senha.
    //
    // Criar usuario, trocar papel e desativar continuam privilegio de admin.
    re: /^\/api\/usuarios(\/|$)/,
    metodos: { POST: SO_ADMIN, PUT: SO_ADMIN, PATCH: SO_ADMIN, DELETE: SO_ADMIN },
    motivo: "escrever usuario e privilegio de admin; listar colegas e operacao",
  },

  // LGPD e trilha de auditoria NAO sao configuracao: a tela mora em
  // /settings, mas o recurso e operacao e gestao. `gerente` alcanca os dois —
  // por isso nao ha excecao aqui, seguem o padrao.
]

/** Papeis autorizados para um caminho + metodo. */
export function rolesPermitidos(pathname: string, metodo: string): Role[] {
  // HEAD e OPTIONS nao alteram nada; valem como leitura.
  const m = (metodo === "HEAD" || metodo === "OPTIONS" ? "GET" : metodo) as Metodo

  for (const regra of EXCECOES) {
    if (regra.re.test(pathname)) {
      const permitidos = regra.metodos[m]
      if (permitidos) return permitidos
    }
  }
  return PADRAO[m] ?? SO_ADMIN // metodo desconhecido: fecha
}

/** `role` vem do JWT e pode estar ausente ou desatualizada — string mesmo. */
export function podeAcessar(role: string | undefined, pathname: string, metodo: string): boolean {
  if (!role) return false
  return (rolesPermitidos(pathname, metodo) as string[]).includes(role)
}
