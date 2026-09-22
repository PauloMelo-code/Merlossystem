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
  it("as 63 rotas protegidas entram na avaliacao", () => {
    expect(rotas.length).toBe(63)
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

  it("viewer nunca escreve — excecao unica: a propria conta", () => {
    // Trocar a propria senha e a propria foto nao e escrever no dado da loja:
    // e cuidar do proprio acesso. Fechar isso obrigaria o observador a pedir
    // troca de senha ao administrador, que e como senha acaba combinada no
    // grupo. `/api/perfil` so toca no usuario da sessao, nunca em papel ou loja.
    const escritasDoViewer = pares
      .filter((p) => p.metodo !== "GET" && podeAcessar("viewer", p.caminho, p.metodo))
      .map((p) => `${p.metodo} ${p.rota}`)
    expect(escritasDoViewer).toEqual(["PUT /api/perfil"])
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

  /** Coordenacao da loja: fora do atendimento (decisao de 22/09/2026). */
  const EH_COORDENACAO = (rota: string) =>
    /^\/api\/(broadcasts|templates|analytics|knowledge|alerts)(\/|$)/.test(rota)

  it("gerente exclui como admin em tudo que nao e configuracao", () => {
    const negados = pares
      .filter((p) => p.metodo === "DELETE" && !podeAcessar("gerente", p.caminho, "DELETE"))
      .map((p) => p.rota)
    expect(negados.every(EH_CONFIG), `negados: ${negados}`).toBe(true)
    expect(negados).toContain("/api/integracoes/[id]")
  })

  it("as leituras escondidas do viewer sao as de configuracao e as de coordenacao", () => {
    // LGPD e trilha de auditoria nao entram: sao operacao e gestao (decisao 7).
    // Desde 22/09/2026, disparo, modelo, relatorio, base de conhecimento e
    // alerta tambem ficam fora: viraram area de coordenacao da loja, junto com
    // a decisao de tirar isso do dia a dia da vendedora.
    const leiturasFechadas = pares
      .filter((p) => p.metodo === "GET" && !podeAcessar("viewer", p.caminho, "GET"))
      .map((p) => p.rota)
    expect(
      leiturasFechadas.every((r) => EH_CONFIG(r) || EH_COORDENACAO(r)),
      `fechadas: ${leiturasFechadas}`
    ).toBe(true)
    expect(Array.from(new Set(leiturasFechadas)).sort()).toEqual([
      "/api/alerts",
      "/api/analytics",
      "/api/broadcasts",
      "/api/broadcasts/[id]",
      "/api/integracoes",
      "/api/integracoes/[id]",
      "/api/integracoes/bling/autorizar",
      "/api/integracoes/bling/catalogo",
      "/api/integracoes/bling/depositos",
      "/api/integracoes/tiktok/autorizar",
      "/api/integracoes/uazapi/[id]/sessao",
      "/api/knowledge",
      "/api/knowledge/[id]",
      "/api/templates",
      "/api/templates/[id]",
    ])
    // O atendimento continua aberto para ele.
    expect(podeAcessar("viewer", "/api/conversations", "GET")).toBe(true)
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
    // Alerta saiu do dia a dia dela em 22/09/2026, junto com disparo, modelo,
    // relatorio e base de conhecimento: e coordenacao da loja.
    expect(podeAcessar("vendedor", "/api/alerts/abc123", "PUT")).toBe(false)
  })

  it("viewer le o painel de atendimento, mas nao o de coordenacao nem escreve", () => {
    expect(podeAcessar("viewer", "/api/conversations", "GET")).toBe(true)
    expect(podeAcessar("viewer", "/api/messages", "POST")).toBe(false)
    // Relatorio virou area de coordenacao (gerente e admin).
    expect(podeAcessar("viewer", "/api/analytics", "GET")).toBe(false)
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

  it("a lista de numeros e operacao; a de integracoes continua so do admin", () => {
    // A vendedora precisa dos numeros para filtrar a caixa de entrada por
    // "cada numero tem o seu atendimento". A rota devolve apelido, canal e
    // responsavel — nunca credencial. Se a regra geral de /api/integracoes
    // passar a vir antes desta, o filtro morre para quem mais usa.
    for (const papel of ["vendedor", "gerente", "viewer"] as const) {
      expect(podeAcessar(papel, "/api/integracoes/numeros", "GET"), papel).toBe(true)
      // O resto da area de integracao segue fechado.
      expect(podeAcessar(papel, "/api/integracoes", "GET"), papel).toBe(false)
      expect(podeAcessar(papel, "/api/integracoes/abc", "GET"), papel).toBe(false)
      expect(podeAcessar(papel, "/api/integracoes/uazapi", "POST"), papel).toBe(false)
    }
    // Escrever num caminho que so tem GET liberado cai no padrao fechado.
    expect(podeAcessar("vendedor", "/api/integracoes/numeros", "POST")).toBe(false)
  })

  it("vendedora nao alcanca a area de coordenacao; gestao alcanca", () => {
    // Decisao do cliente (22/09/2026): disparo, modelo, relatorio, base de
    // conhecimento e alerta sao de quem coordena. Esconder no menu nao basta —
    // sem a regra, a URL digitada a mao continuava abrindo.
    for (const area of ["/api/broadcasts", "/api/templates", "/api/analytics", "/api/knowledge", "/api/alerts"]) {
      expect(podeAcessar("vendedor", area, "GET"), area).toBe(false)
      expect(podeAcessar("viewer", area, "GET"), area).toBe(false)
      expect(podeAcessar("gerente", area, "GET"), area).toBe(true)
      expect(podeAcessar("admin", area, "GET"), area).toBe(true)
      // E tambem no caminho com id, nao so na raiz.
      expect(podeAcessar("vendedor", `${area}/abc-123`, "PUT"), area).toBe(false)
    }
    // O que e do atendimento continua dela.
    for (const area of ["/api/conversations", "/api/messages", "/api/orders", "/api/products", "/api/returns", "/api/media", "/api/quick-replies", "/api/deals"]) {
      expect(podeAcessar("vendedor", area, "GET"), area).toBe(true)
    }
  })

  it("metodo fora da tabela fecha", () => {
    expect(rolesPermitidos("/api/contacts", "TRACE")).toEqual(["admin"])
  })

  it("HEAD vale como leitura", () => {
    expect(podeAcessar("viewer", "/api/contacts", "HEAD")).toBe(true)
  })
})
