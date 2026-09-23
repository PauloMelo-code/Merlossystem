/**
 * Reconectar uma integracao depois de desconectar.
 *
 * O defeito que estes testes travam custou a conta do Bling em producao
 * (23/09/2026): `StoreIntegracao` tem `@@unique([provedor, referenciaExterna])`
 * e esse indice NAO e parcial — a linha excluida logicamente continua ocupando
 * a chave. Quem procurava a linha filtrando por `isDeleted: false` nao achava
 * nada, caia no `create` com a MESMA referencia e estourava violacao de
 * unicidade. Na tela isso virava `?erro=erro-inesperado`, e a integracao
 * ficava impossivel de reconectar sem alguem mexer no banco.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const raiz = resolve(__dirname, "..")
const ler = (...p: string[]) => readFileSync(resolve(raiz, ...p), "utf8")

/** Toda rota que GRAVA a conexao de um provedor. */
const ROTAS_QUE_CONECTAM = [
  ["src", "app", "api", "integracoes", "bling", "callback", "route.ts"],
  ["src", "app", "api", "integracoes", "tiktok", "callback", "route.ts"],
  ["src", "app", "api", "integracoes", "uazapi", "route.ts"],
  ["src", "app", "api", "integracoes", "route.ts"],
]

describe("desconectar nao pode ser irreversivel", () => {
  it("nenhuma rota de conexao cria StoreIntegracao direto", () => {
    // `prisma.storeIntegracao.create` aqui e exatamente o caminho que estoura
    // contra a linha apagada. Quem grava conexao passa por `gravarConexao`.
    for (const rota of ROTAS_QUE_CONECTAM) {
      const src = ler(...rota)
      expect(src, rota.join("/")).not.toMatch(/prisma\.storeIntegracao\.create/)
      expect(src, rota.join("/")).toMatch(/gravarConexao/)
    }
  })

  it("o gravador procura a linha SEM filtrar isDeleted", () => {
    // Filtrar aqui e o bug: e justamente a linha apagada que precisa ser
    // encontrada, porque e ela que ocupa o indice unico.
    const lib = ler("src", "lib", "integracoes-conexao.ts")
    // So o `where` da busca: o `select` ao lado dele cita `isDeleted` de
    // proposito, para saber se a linha estava apagada e reportar que reviveu.
    const filtro = lib.match(/findFirst\(\{\s*where: \{([^}]*)\}/)
    expect(filtro, "findFirst com where nao encontrado").not.toBeNull()
    expect(filtro![1]).toMatch(/provedor: opts\.provedor/)
    expect(filtro![1]).toMatch(/referenciaExterna: opts\.referenciaExterna/)
    expect(filtro![1]).not.toMatch(/isDeleted/)
  })

  it("reconectar REVIVE a linha em vez de criar outra", () => {
    // Reviver mantem o id: as conversas que apontam para aquela integracao
    // voltam a rotear. Criar com id novo as deixaria orfas de canal.
    const lib = ler("src", "lib", "integracoes-conexao.ts")
    expect(lib).toMatch(/isDeleted: false, deletedAt: null/)
    expect(lib).toMatch(/where: \{ id: existente\.id \}/)
  })

  it("desconectar continua apagando a credencial", () => {
    // Reviver nao pode virar "reconectar sem passar pelo provedor": a
    // credencial e apagada de verdade no desconectar, e nao volta sozinha.
    const rota = ler("src", "app", "api", "integracoes", "[id]", "route.ts")
    expect(rota).toMatch(/credenciaisCifradas: null/)
    expect(rota).toMatch(/isDeleted: true/)
    const lib = ler("src", "lib", "integracoes-conexao.ts")
    expect(lib).not.toMatch(/credenciaisCifradas: existente/)
  })
})
