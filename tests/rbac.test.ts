/**
 * RBAC — as invariantes valem para TODAS as rotas lidas do disco, nao para uma
 * lista escrita a mao. Afrouxar uma permissao (ou criar rota permissiva nova)
 * quebra um destes testes.
 */
import { describe, it, expect } from "vitest"
import { rolesPermitidos, podeAcessar, ROLES } from "@/lib/rbac"
import { ehApiPublica } from "@/lib/api-publica"
import { listarRotas } from "./rotas"

const rotas = listarRotas().filter((r) => !ehApiPublica(r.caminho))

/** Pares (caminho, metodo) de todas as rotas protegidas. */
const pares = rotas.flatMap((r) =>
  r.metodos.map((metodo) => ({ ...r, metodo }))
)

describe("cobertura", () => {
  it("as 59 rotas protegidas entram na avaliacao", () => {
    expect(rotas.length).toBe(59)
    expect(pares.length).toBeGreaterThan(60)
  })

  it("todo par rota+metodo resolve para pelo menos um papel", () => {
    for (const p of pares) {
      expect(rolesPermitidos(p.caminho, p.metodo).length).toBeGreaterThan(0)
    }
  })

  it("nenhuma permissao cita papel inexistente", () => {
    for (const p of pares) {
      for (const role of rolesPermitidos(p.caminho, p.metodo)) {
        expect(ROLES).toContain(role)
      }
    }
  })
})

describe("invariantes", () => {
  it("admin passa em tudo", () => {
    for (const p of pares) {
      expect(podeAcessar("admin", p.caminho, p.metodo), `${p.metodo} ${p.rota}`).toBe(true)
    }
  })

  it("viewer nunca escreve", () => {
    for (const p of pares.filter((x) => x.metodo !== "GET")) {
      expect(podeAcessar("viewer", p.caminho, p.metodo), `${p.metodo} ${p.rota}`).toBe(false)
    }
  })

  it("vendedor nunca exclui — excecao unica: cancelar mensagem agendada", () => {
    const deletesDoVendedor = pares
      .filter((p) => p.metodo === "DELETE" && podeAcessar("vendedor", p.caminho, p.metodo))
      .map((p) => p.rota)
    expect(deletesDoVendedor).toEqual(["/api/scheduled/[id]"])
  })

  it("todo DELETE permite admin", () => {
    for (const p of pares.filter((x) => x.metodo === "DELETE")) {
      expect(podeAcessar("admin", p.caminho, "DELETE"), p.rota).toBe(true)
    }
  })

  /**
   * Area de configuracao: so admin, em qualquer metodo (decisao 7).
   *
   * `lojas` entra aqui porque cadastrar e desativar loja e configuracao da
   * rede. LER a lista continua liberada — quem escopa a resposta e a rota, e o
   * vendedor precisa dela para a interface dizer em que loja ele esta.
   */
  const EH_CONFIG = (rota: string) =>
    /^\/api\/(integracoes|usuarios|lojas)(\/|$)/.test(rota)

  it("gerente exclui como admin em tudo que nao e configuracao", () => {
    const negados = pares
      .filter((p) => p.metodo === "DELETE" && !podeAcessar("gerente", p.caminho, "DELETE"))
      .map((p) => p.rota)
    expect(negados.every(EH_CONFIG), `negados: ${negados}`).toBe(true)
    expect(negados).toContain("/api/integracoes/[id]")
  })

  it("as unicas leituras escondidas do viewer sao as de configuracao", () => {
    // LGPD e trilha de auditoria nao entram: sao operacao e gestao (decisao 7).
    const leiturasFechadas = pares
      .filter((p) => p.metodo === "GET" && !podeAcessar("viewer", p.caminho, "GET"))
      .map((p) => p.rota)
    expect(leiturasFechadas.every(EH_CONFIG), `fechadas: ${leiturasFechadas}`).toBe(true)
    expect(leiturasFechadas.sort()).toEqual([
      "/api/integracoes",
      "/api/integracoes/[id]",
      "/api/integracoes/bling/autorizar",
      "/api/integracoes/bling/catalogo",
      "/api/integracoes/bling/depositos",
      "/api/integracoes/tiktok/autorizar",
      "/api/integracoes/uazapi/[id]/sessao",
    ])
  })

  it("sem role (token antigo ou adulterado) nao passa em nada", () => {
    for (const p of pares) {
      expect(podeAcessar(undefined, p.caminho, p.metodo)).toBe(false)
      expect(podeAcessar("", p.caminho, p.metodo)).toBe(false)
      expect(podeAcessar("superuser", p.caminho, p.metodo)).toBe(false)
    }
  })
})

describe("casos que motivaram o RBAC", () => {
  it("apagar cliente por LGPD e gestao, nao atendimento", () => {
    expect(podeAcessar("admin", "/api/lgpd", "DELETE")).toBe(true)
    expect(podeAcessar("gerente", "/api/lgpd", "DELETE")).toBe(true)
    expect(podeAcessar("vendedor", "/api/lgpd", "DELETE")).toBe(false)
    expect(podeAcessar("viewer", "/api/lgpd", "DELETE")).toBe(false)
  })

  it("registrar opt-out e atendimento", () => {
    expect(podeAcessar("vendedor", "/api/lgpd", "POST")).toBe(true)
  })

  it("vendedor nao apaga contato, produto nem midia", () => {
    expect(podeAcessar("vendedor", "/api/contacts/abc123", "DELETE")).toBe(false)
    expect(podeAcessar("vendedor", "/api/products/abc123", "DELETE")).toBe(false)
    expect(podeAcessar("vendedor", "/api/media/abc123", "DELETE")).toBe(false)
  })

  it("vendedor opera o dia a dia", () => {
    expect(podeAcessar("vendedor", "/api/messages", "POST")).toBe(true)
    expect(podeAcessar("vendedor", "/api/conversations/abc123", "PUT")).toBe(true)
    expect(podeAcessar("vendedor", "/api/orders", "POST")).toBe(true)
    expect(podeAcessar("vendedor", "/api/deals/abc123", "PUT")).toBe(true)
    expect(podeAcessar("vendedor", "/api/alerts/abc123", "PUT")).toBe(true)
  })

  it("viewer le o painel mas nao mexe", () => {
    expect(podeAcessar("viewer", "/api/analytics", "GET")).toBe(true)
    expect(podeAcessar("viewer", "/api/conversations", "GET")).toBe(true)
    expect(podeAcessar("viewer", "/api/messages", "POST")).toBe(false)
  })

  it("cancelar agendamento e do vendedor; apagar template nao", () => {
    expect(podeAcessar("vendedor", "/api/scheduled/abc123", "DELETE")).toBe(true)
    expect(podeAcessar("vendedor", "/api/templates/abc123", "DELETE")).toBe(false)
  })

  it("configuracao fica so com admin — nem gerente entra", () => {
    for (const caminho of ["/api/integracoes", "/api/integracoes/abc123"]) {
      for (const metodo of ["GET", "POST", "PUT", "DELETE"]) {
        expect(podeAcessar("admin", caminho, metodo), `admin ${metodo} ${caminho}`).toBe(true)
        expect(podeAcessar("gerente", caminho, metodo), `gerente ${metodo} ${caminho}`).toBe(false)
        expect(podeAcessar("vendedor", caminho, metodo), `vendedor ${metodo} ${caminho}`).toBe(false)
      }
    }
  })

  it("usuario: todos leem a lista de colegas; so admin cadastra", () => {
    // Mesmo desenho de `/api/lojas` logo abaixo. Transferir conversa e trabalho
    // de atendimento: com o GET fechado em admin, o seletor de transferencia
    // ficava vazio para o vendedor, que e justamente quem transfere. A rota
    // devolve so nome, papel e avatar, filtrados pela loja de quem pergunta.
    for (const papel of ["admin", "gerente", "vendedor", "viewer"]) {
      expect(podeAcessar(papel, "/api/usuarios", "GET"), `${papel} GET`).toBe(true)
    }
    // Escrever continua privilegio de admin: trocar papel escala privilegio.
    for (const metodo of ["POST", "PUT", "DELETE"]) {
      expect(podeAcessar("admin", "/api/usuarios", metodo)).toBe(true)
      expect(podeAcessar("gerente", "/api/usuarios", metodo), `gerente ${metodo}`).toBe(false)
      expect(podeAcessar("vendedor", "/api/usuarios", metodo), `vendedor ${metodo}`).toBe(false)
    }
  })

  it("loja: todos leem a lista; so admin cadastra", () => {
    // A rota escopa a resposta (gestao ve as duas, vendedor ve a dele), entao a
    // leitura segue o padrao. Cadastrar loja e que e configuracao.
    for (const papel of ["admin", "gerente", "vendedor", "viewer"]) {
      expect(podeAcessar(papel, "/api/lojas", "GET"), `${papel} GET`).toBe(true)
    }
    for (const metodo of ["POST", "PUT", "DELETE"]) {
      expect(podeAcessar("gerente", "/api/lojas", metodo), `gerente ${metodo}`).toBe(false)
      expect(podeAcessar("admin", "/api/lojas", metodo), `admin ${metodo}`).toBe(true)
    }
  })

  it("metodo fora da tabela fecha", () => {
    expect(rolesPermitidos("/api/contacts", "TRACE")).toEqual(["admin"])
  })

  it("HEAD vale como leitura", () => {
    expect(podeAcessar("viewer", "/api/contacts", "HEAD")).toBe(true)
  })
})
