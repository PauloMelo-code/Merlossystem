import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { exigirAlvoPermitido, exigirPapelConvidavel, ordemDePrivilegio } from "@/lib/auth/permissoes/alvo";
import type { Contexto, Sessao } from "@/lib/auth/guard";
import { PAPEIS, type Papel } from "@/lib/db/schema/_enums/auth";

/**
 * T14 — quem pode agir sobre quem (02-seguranca.md §2.3, S-17).
 *
 * Reprova quando alvo de papel IGUAL ou SUPERIOR é aceito, e quando o auto-alvo
 * passa. Sem isto, `admin` reseta, desativa, destrava, encerra sessões, troca
 * e-mail e recupera fator de outro `admin` e do `dono`.
 *
 * A segunda metade (pacote M7) prova no BANCO, pelas funções que
 * `src/lib/actions/usuarios.ts` chama: 403 COM trilha e sem efeito; `dono`
 * sobre `admin` passando; corrida de `FOR UPDATE` que não deixa zero dono nem
 * três donos; sessões do alvo revogadas; trilha ANTES do efeito e fail-closed;
 * e nenhuma action administrativa recebendo senha (E8).
 */

const trilhaFora = vi.hoisted(() => ({ ligado: false }));

vi.mock("@/lib/auth/emails", () => ({ enfileirarEmailSeguranca: () => undefined }));

vi.mock("@/lib/auth/trilha", async (original) => {
  const real = await original<typeof import("@/lib/auth/trilha")>();
  return {
    ...real,
    gravarEventoAuth: async (...args: Parameters<typeof real.gravarEventoAuth>) => {
      if (trilhaFora.ligado) throw new Error("trilha indisponível (simulada)");
      return real.gravarEventoAuth(...args);
    },
  };
});

function sessao(papel: Papel, id: string = randomUUID()): Sessao {
  return {
    usuarioId: id,
    sessaoId: randomUUID(),
    papel,
    lojaId: papel === "vendedor" || papel === "viewer" ? randomUUID() : null,
    ativo: true,
    precisaTrocarSenha: false,
    precisaConfigurarFator: false,
  };
}

function alvo(papel: Papel) {
  return { id: randomUUID(), papel };
}

describe("guarda de alvo", () => {
  it("a ordem de privilégio é a de 01-dados.md §16.2", () => {
    expect([...PAPEIS]).toEqual(["dono", "admin", "gerente", "vendedor", "viewer"]);
    expect(ordemDePrivilegio("dono")).toBeLessThan(ordemDePrivilegio("admin"));
    expect(ordemDePrivilegio("admin")).toBeLessThan(ordemDePrivilegio("gerente"));
    expect(ordemDePrivilegio("viewer")).toBe(PAPEIS.length - 1);
  });

  it("auto-alvo é recusado em toda ação administrativa (INV-32)", () => {
    for (const papel of PAPEIS) {
      const ator = sessao(papel);
      // O caminho do próprio usuário é `/perfil/seguranca`, não a tela de
      // administração — senão `admin` se auto-reseta e escapa da escada.
      expect(() => exigirAlvoPermitido(ator, { id: ator.usuarioId, papel })).toThrow();
    }
  });

  it("admin NÃO alcança outro admin nem o dono (T14)", () => {
    const ator = sessao("admin");
    expect(() => exigirAlvoPermitido(ator, alvo("admin"))).toThrow();
    expect(() => exigirAlvoPermitido(ator, alvo("dono"))).toThrow();
  });

  it("dono alcança admin, gerente, vendedor e viewer", () => {
    const ator = sessao("dono");
    for (const papel of ["admin", "gerente", "vendedor", "viewer"] as Papel[]) {
      expect(() => exigirAlvoPermitido(ator, alvo(papel)), papel).not.toThrow();
    }
  });

  it("ninguém age sobre dono, exceto outro dono", () => {
    for (const papel of ["admin", "gerente", "vendedor", "viewer"] as Papel[]) {
      expect(() => exigirAlvoPermitido(sessao(papel), alvo("dono")), papel).toThrow();
    }
    expect(() => exigirAlvoPermitido(sessao("dono"), alvo("dono"))).not.toThrow();
  });

  it("papel igual nunca alcança papel igual", () => {
    for (const papel of ["admin", "gerente", "vendedor", "viewer"] as Papel[]) {
      expect(() => exigirAlvoPermitido(sessao(papel), alvo(papel)), papel).toThrow();
    }
  });

  it("papel inferior nunca alcança papel igual ou superior", () => {
    for (let i = 0; i < PAPEIS.length; i += 1) {
      for (let j = 0; j <= i; j += 1) {
        // A única exceção escrita é `dono -> dono`: sem ela, um dono nunca
        // poderia rebaixar o outro e a regra de "no máximo 2 donos" ficaria
        // sem saída (INV-31).
        if (PAPEIS[i] === "dono" && PAPEIS[j] === "dono") continue;
        const ator = sessao(PAPEIS[i]!);
        expect(() => exigirAlvoPermitido(ator, alvo(PAPEIS[j]!)), `${PAPEIS[i]}->${PAPEIS[j]}`)
          .toThrow();
      }
    }
  });

  it("o convite obedece à MESMA escada, e dono não é convidável", () => {
    const admin = sessao("admin");
    for (const papel of ["gerente", "vendedor", "viewer"] as Papel[]) {
      expect(() => exigirPapelConvidavel(admin, papel), papel).not.toThrow();
    }
    // Convite com papel `admin` só pelo dono, com ciência versionada.
    expect(() => exigirPapelConvidavel(admin, "admin")).toThrow();
    expect(() => exigirPapelConvidavel(sessao("dono"), "admin")).not.toThrow();
    // `dono` não é convidável nem pelo dono: posse só se transfere.
    expect(() => exigirPapelConvidavel(sessao("dono"), "dono")).toThrow();
  });

  it("a recusa é 403, não 404 nem 500", () => {
    try {
      exigirAlvoPermitido(sessao("admin"), alvo("admin"));
      throw new Error("deveria ter recusado");
    } catch (erro) {
      expect((erro as { status: number }).status).toBe(403);
      expect((erro as { codigo: string }).codigo).toBe("SEM_PERMISSAO");
    }
  });
});

// ---------------------------------------------------------------------------
// No banco (pacote M7)
// ---------------------------------------------------------------------------

const apoio = await import("./_apoio");
const { emTransacao } = await import("@/lib/db/mutacoes");
const adm = await import("@/lib/usuarios/administracao");
const acesso = await import("@/lib/usuarios/acesso");
const trocas = await import("@/lib/usuarios/trocas-email");

type Dados = { alvoId: string; motivo: string; updatedAt?: Date; emailNovo?: string };
type Operacao = (tx: never, ctx: Contexto, dados: never) => Promise<unknown>;

const MOTIVO = "motivo administrativo de teste";

function ctxDe(id: string, papel: Papel): Contexto {
  return {
    sessao: { ...sessao(papel, id), lojaId: null },
    escopo: { tipo: "todas" },
    autorId: id,
    origem: "ui",
  };
}

function rodar(ctx: Contexto, fn: Operacao, dados: object): Promise<unknown> {
  return emTransacao(ctx, (tx) => fn(tx as never, ctx, dados as never));
}

async function comVersao(id: string, extra: object = {}): Promise<Dados> {
  const { updated_at } = await apoio.lerUsuario(id);
  return { alvoId: id, motivo: MOTIVO, updatedAt: updated_at as Date, ...extra };
}

async function darFatores(id: string): Promise<void> {
  await apoio.poolDeTeste.query(
    `insert into usuarios_passkeys (usuario_id, nome, chave_publica, credential_id)
     values ($1::uuid, 'Aparelho', 'chave-sem-valor', gen_random_uuid()::text)`,
    [id],
  );
  await apoio.poolDeTeste.query(
    `insert into usuarios_totp (usuario_id, secret, verificado) values ($1::uuid, 'x', true)`,
    [id],
  );
}

async function abrirSessao(usuarioId: string): Promise<void> {
  await apoio.poolDeTeste.query(
    `insert into usuarios_sessoes (token, usuario_id, expira_em)
     values ($1, $2, now() + interval '1 hour')`,
    [randomUUID(), usuarioId],
  );
}

async function contar(consulta: string, parametros: unknown[] = []): Promise<number> {
  const { rows } = await apoio.poolDeTeste.query<{ n: number }>(consulta, parametros);
  return rows[0]!.n;
}

const sessoesDe = (id: string) =>
  contar("select count(*)::int as n from usuarios_sessoes where usuario_id = $1", [id]);
// A recusa de alvo responde SEM_PERMISSAO; o porquê curto fica em
// `detalhes.motivo` (ADR 0032).
const recusasSobre = (id: string) =>
  contar(
    `select count(*)::int as n from auth_eventos
     where tipo = 'recusa_403' and alvo_id = $1 and detalhes->>'motivo' = 'alvo'`,
    [id],
  );
const donosAtivos = () =>
  contar("select count(*)::int as n from usuarios where papel = 'dono' and ativo and not is_deleted");

let n = 0;
const novoEmail = (p: string) => `${p}-${String((n += 1))}@t14.local`;

describe("T14 no banco", () => {
  beforeAll(async () => {
    await apoio.limparAuth();
  });

  afterAll(async () => {
    await apoio.fecharApoio();
  });

  it("admin A sobre admin B e sobre o dono → 403, com trilha e sem efeito", async () => {
    const dono = await apoio.criarUsuario(novoEmail("dono"), { papel: "dono" });
    const a = await apoio.criarUsuario(novoEmail("admin-a"), { papel: "admin" });
    const b = await apoio.criarUsuario(novoEmail("admin-b"), { papel: "admin" });
    const ctx = ctxDe(a.id, "admin");

    for (const alvo of [b, dono]) {
      const tentativas: [Operacao, Dados][] = [
        [adm.desativarUsuario as Operacao, await comVersao(alvo.id)],
        [adm.trocarPapel as Operacao, await comVersao(alvo.id, { papel: "gerente", lojaId: null })],
        [acesso.iniciarResetDeSenha as Operacao, { alvoId: alvo.id, motivo: MOTIVO }],
        [
          trocas.iniciarTrocaDeEmail as Operacao,
          { alvoId: alvo.id, motivo: MOTIVO, emailNovo: novoEmail("tomado") },
        ],
        [acesso.recuperarAcessoAssistido as Operacao, { alvoId: alvo.id, motivo: MOTIVO }],
        [acesso.encerrarSessoesDe as Operacao, { alvoId: alvo.id, motivo: MOTIVO }],
        [acesso.destravarConta as Operacao, { alvoId: alvo.id, motivo: MOTIVO }],
      ];
      const antes = await apoio.lerUsuario(alvo.id);
      for (const [fn, dados] of tentativas) {
        await expect(rodar(ctx, fn, dados)).rejects.toMatchObject({
          codigo: "SEM_PERMISSAO",
          status: 403,
        });
      }
      expect(await recusasSobre(alvo.id)).toBe(tentativas.length);
      expect(await apoio.lerUsuario(alvo.id)).toEqual(antes);
    }
  });

  it("dono sobre admin → passa e revoga as sessões; auto-alvo → 403", async () => {
    const dono = await apoio.criarUsuario(novoEmail("dono"), { papel: "dono" });
    const alvo = await apoio.criarUsuario(novoEmail("admin"), { papel: "admin" });
    await apoio.criarUsuario(novoEmail("admin-reserva"), { papel: "admin" });
    await abrirSessao(alvo.id);
    await abrirSessao(alvo.id);

    const ctx = ctxDe(dono.id, "dono");
    await rodar(ctx, adm.desativarUsuario as Operacao, await comVersao(alvo.id));
    expect((await apoio.lerUsuario(alvo.id)).ativo).toBe(false);
    expect(await sessoesDe(alvo.id)).toBe(0);

    await expect(
      rodar(ctx, adm.desativarUsuario as Operacao, await comVersao(dono.id)),
    ).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
  });

  it("rebaixamento cruzado de dois donos não deixa zero dono", async () => {
    await apoio.limparAuth();
    const d1 = await apoio.criarUsuario(novoEmail("d1"), { papel: "dono" });
    const d2 = await apoio.criarUsuario(novoEmail("d2"), { papel: "dono" });
    const papel = { papel: "admin", lojaId: null };

    const resultados = await Promise.allSettled([
      rodar(ctxDe(d1.id, "dono"), adm.trocarPapel as Operacao, await comVersao(d2.id, papel)),
      rodar(ctxDe(d2.id, "dono"), adm.trocarPapel as Operacao, await comVersao(d1.id, papel)),
    ]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await donosAtivos()).toBe(1);
  });

  it("duas transferências simultâneas não criam dois donos novos", async () => {
    await apoio.limparAuth();
    const dono = await apoio.criarUsuario(novoEmail("dono"), { papel: "dono" });
    const a1 = await apoio.criarUsuario(novoEmail("a1"), { papel: "admin" });
    const a2 = await apoio.criarUsuario(novoEmail("a2"), { papel: "admin" });
    await darFatores(a1.id);
    await darFatores(a2.id);
    const ctx = ctxDe(dono.id, "dono");

    const resultados = await Promise.allSettled([
      rodar(ctx, adm.transferirPosse as Operacao, await comVersao(a1.id)),
      rodar(ctx, adm.transferirPosse as Operacao, await comVersao(a2.id)),
    ]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await donosAtivos()).toBe(1);
    // Quem transferiu virou admin.
    expect((await apoio.lerUsuario(dono.id)).papel).toBe("admin");
  });

  it("terceiro dono é recusado mesmo pelo dono", async () => {
    await apoio.limparAuth();
    const d1 = await apoio.criarUsuario(novoEmail("d1"), { papel: "dono" });
    await apoio.criarUsuario(novoEmail("d2"), { papel: "dono" });
    const inativo = await apoio.criarUsuario(novoEmail("d3"), { papel: "dono", ativo: false });
    await darFatores(inativo.id);
    await apoio.poolDeTeste.query("update usuarios set two_factor_enabled = true where id = $1", [
      inativo.id,
    ]);
    await expect(
      rodar(ctxDe(d1.id, "dono"), adm.reativarUsuario as Operacao, await comVersao(inativo.id)),
    ).rejects.toMatchObject({ codigo: "VALIDACAO" });
    expect(await donosAtivos()).toBe(2);
  });

  it("trilha fora do ar = efeito nenhum (fail-closed, na mesma transação)", async () => {
    const dono = await apoio.criarUsuario(novoEmail("dono"), { papel: "dono" });
    const alvo = await apoio.criarUsuario(novoEmail("gerente"), { papel: "gerente" });
    await darFatores(alvo.id);
    trilhaFora.ligado = true;
    try {
      await expect(
        rodar(ctxDe(dono.id, "dono"), adm.promoverAAdmin as Operacao, await comVersao(alvo.id)),
      ).rejects.toThrow(/trilha/);
    } finally {
      trilhaFora.ligado = false;
    }
    expect((await apoio.lerUsuario(alvo.id)).papel).toBe("gerente");
  });

  it("dono não é convidável: o CHECK do banco recusa", async () => {
    await expect(
      apoio.criarConvite(novoEmail("dono-convite"), { papel: "dono" }),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("fonte das actions administrativas", () => {
  const RAIZ = process.cwd();
  const ler = (caminho: string) => readFileSync(join(RAIZ, caminho), "utf8");

  it("a trilha vem ANTES do efeito em toda função que troca papel, posse ou acesso", () => {
    const efeitos = [
      "atualizarComTrava(",
      "gravarPapel(",
      "revogarSessoesDe(",
      "removerTodosOsFatores(",
    ];
    for (const arquivo of ["src/lib/usuarios/administracao.ts", "src/lib/usuarios/acesso.ts"]) {
      const funcoes = ler(arquivo).split(/\nexport async function /).slice(1);
      expect(funcoes.length, arquivo).toBeGreaterThanOrEqual(4);
      for (const corpo of funcoes) {
        const trilha = corpo.indexOf("gravarEventoAuth(");
        if (trilha === -1) continue;
        const nome = corpo.slice(0, corpo.indexOf("("));
        for (const efeito of efeitos) {
          const posicao = corpo.indexOf(efeito);
          if (posicao !== -1) expect(trilha, `${nome}: ${efeito}`).toBeLessThan(posicao);
        }
      }
    }
  });

  it("toda ação exige sessão fresca e nenhuma recebe senha (E8) nem espalha o corpo (H12)", () => {
    const actions = ler("src/lib/actions/usuarios.ts") + ler("src/lib/actions/convites.ts");
    const exportadas = actions.match(/^export async function /gm) ?? [];
    const frescas = actions.match(/^\s+fresca: true,$/gm) ?? [];
    expect(exportadas.length).toBeGreaterThanOrEqual(12);
    expect(frescas.length).toBe(exportadas.length);
    expect(actions).not.toMatch(/novaSenha|newPassword|senhaSchema|setPassword/);
    expect(ler("src/lib/validadores/usuarios.ts")).not.toMatch(/\bsenha\s*:/i);
    expect(actions).not.toMatch(/\.\.\.(dados|entrada|input)\b/);
  });

  it("o convite só entra na fila depois do commit e fator só sai pela fundação", () => {
    // O domínio roda DENTRO da transação: enfileirar ali mandaria link morto.
    const dominio = ler("src/lib/usuarios/convites.ts");
    expect(dominio).toContain("emitirConviteEm(");
    expect(dominio).not.toMatch(/\benviarConvite\(|enfileirarEmailSeguranca\(/);
    expect(ler("src/lib/actions/convites.ts")).toContain("enviarConvite(convite, autorId)");
    // Nenhum delete de fator fora de `src/lib/auth/fatores.ts`.
    expect(ler("src/lib/usuarios/acesso.ts")).not.toMatch(/adapter|\.delete\(/);
  });
});
