import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import {
  ATOR_SISTEMA,
  atualizarComTrava,
  contextoDeSistema,
  emTransacao,
  inserirAuditado,
  registrarConsentimentoBase,
  violacaoDeTelefone,
  type Transacao,
} from "@/lib/db/mutacoes";
import { contatos } from "@/lib/db/schema/contatos";
import { banco, criarContatoDeCrm, criarLoja, fecharBanco } from "./conversas-apoio";

/**
 * Contexto de sistema (ATOR_SISTEMA semeado na 0018), trilha ANTES do efeito,
 * `e.cause` do Drizzle 0.45 e a gravação-base de consentimento. Efeito real no
 * Postgres de teste; nenhum mock de banco.
 */

let lojaId: string;
beforeAll(async () => {
  lojaId = await criarLoja();
});
afterAll(fecharBanco);

const trilha = async (entidadeId: string) =>
  (
    await banco.query(
      `select ator_tipo, ator_id, acao, motivo from auditoria_eventos
        where entidade_id = $1 order by criado_em, id`,
      [entidadeId],
    )
  ).rows;

describe("ATOR_SISTEMA", () => {
  it("está semeado, inerte, e o banco recusa ativá-lo ou dar outro papel", async () => {
    const { rows } = await banco.query(
      "select ativo, papel, loja_id, email from usuarios where id = $1",
      [ATOR_SISTEMA],
    );
    expect(rows[0]).toMatchObject({ ativo: false, papel: "viewer", loja_id: null });
    expect(rows[0].email).toMatch(/\.invalid$/);
    await expect(
      banco.query("update usuarios set ativo = true where id = $1", [ATOR_SISTEMA]),
    ).rejects.toMatchObject({ code: "23514", constraint: "usuarios_ator_sistema_inerte" });
    await expect(
      banco.query("update usuarios set papel = 'gerente' where id = $1", [ATOR_SISTEMA]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("gravação de sistema carimba modified_by e a trilha com o ator, sem sessão", async () => {
    const ctx = contextoDeSistema({ origem: "worker", lojaId });
    expect("sessao" in ctx).toBe(false);
    const linha = await emTransacao(ctx, (tx, c) =>
      inserirAuditado(tx, contatos, { loja_id: lojaId, nome: "Via worker" }, c, "contato_criado"),
    );
    expect(linha.modified_by).toBe(ATOR_SISTEMA);
    expect(await trilha(String(linha.id))).toEqual([
      { ator_tipo: "sistema", ator_id: ATOR_SISTEMA, acao: "contato_criado", motivo: null },
    ]);
  });

  it("sem lojaId o escopo é de rede", () => {
    expect(contextoDeSistema({ origem: "webhook" }).escopo).toEqual({ tipo: "todas" });
  });
});

/** Registra a ORDEM das chamadas ao banco sem mudar o que elas fazem. */
function espiao(tx: Transacao, ordem: string[]): Transacao {
  return new Proxy(tx, {
    get(alvo, prop, receptor) {
      const valor = Reflect.get(alvo, prop, receptor);
      if ((prop === "execute" || prop === "update") && typeof valor === "function") {
        return (...args: unknown[]) => {
          ordem.push(prop);
          return (valor as (...a: unknown[]) => unknown).apply(alvo, args);
        };
      }
      return valor;
    },
  });
}

describe("atualizarComTrava com trilha antes do efeito", () => {
  it("grava a trilha ANTES do UPDATE, com o motivo", async () => {
    const id = await criarContatoDeCrm(lojaId, "5551911110001", "Antes");
    const { rows } = await banco.query("select updated_at from contatos where id = $1", [id]);
    const ctx = contextoDeSistema({ origem: "worker", lojaId });
    const ordem: string[] = [];
    await db.transaction((tx) =>
      atualizarComTrava(
        espiao(tx, ordem),
        contatos,
        { id, escopo: ctx.escopo, updatedAtOriginal: rows[0].updated_at, dados: { observacoes: "x" } },
        ctx,
        "contato_alterado",
        { trilhaAntes: true, motivo: "pedido da cliente" },
      ),
    );
    expect(ordem).toEqual(["execute", "update"]);
    expect(await trilha(id)).toEqual([
      { ator_tipo: "sistema", ator_id: ATOR_SISTEMA, acao: "contato_alterado", motivo: "pedido da cliente" },
    ]);
  });

  it("sem a opção, a ordem continua efeito → trilha", async () => {
    const id = await criarContatoDeCrm(lojaId, "5551911110002", "Depois");
    const { rows } = await banco.query("select updated_at from contatos where id = $1", [id]);
    const ctx = contextoDeSistema({ origem: "worker", lojaId });
    const ordem: string[] = [];
    await db.transaction((tx) =>
      atualizarComTrava(
        espiao(tx, ordem),
        contatos,
        { id, escopo: ctx.escopo, updatedAtOriginal: rows[0].updated_at, dados: { observacoes: "y" } },
        ctx,
        "contato_alterado",
      ),
    );
    expect(ordem).toEqual(["update", "execute"]);
  });

  it("na colisão, a trilha gravada antes cai junto com a transação", async () => {
    const id = await criarContatoDeCrm(lojaId, "5551911110003", "Colide");
    const ctx = contextoDeSistema({ origem: "worker", lojaId });
    await expect(
      db.transaction((tx) =>
        atualizarComTrava(
          tx,
          contatos,
          { id, escopo: ctx.escopo, updatedAtOriginal: new Date(0), dados: { observacoes: "z" } },
          ctx,
          "contato_alterado",
          { trilhaAntes: true },
        ),
      ),
    ).rejects.toMatchObject({ codigo: "COLISAO" });
    expect(await trilha(id)).toEqual([]);
  });
});

describe("violacaoDeTelefone", () => {
  const erroPg = { code: "23505", constraint: "uq_contatos_telefone" };
  it("reconhece o erro do pg cru e embrulhado em cause (Drizzle 0.45)", () => {
    expect(violacaoDeTelefone(erroPg)).toBe(true);
    expect(violacaoDeTelefone(Object.assign(new Error("Failed query"), { cause: erroPg }))).toBe(true);
    expect(violacaoDeTelefone(Object.assign(new Error("x"), { cause: { code: "23505", constraint: "outra" } }))).toBe(false);
    expect(violacaoDeTelefone(null)).toBe(false);
  });

  it("o erro real do Drizzle traz a constraint em cause", async () => {
    const telefone = "5551911110004";
    await criarContatoDeCrm(lojaId, telefone);
    const erro = await db
      .transaction((tx) => inserirAuditado(tx, contatos, { loja_id: lojaId, nome: "Dup", telefone },
        contextoDeSistema({ origem: "worker", lojaId }), "contato_criado"))
      .catch((e: unknown) => e);
    expect(violacaoDeTelefone(erro)).toBe(true);
  });
});

describe("registrarConsentimentoBase", () => {
  it("grava a trilha de consentimento e o espelho na mesma transação", async () => {
    const id = await criarContatoDeCrm(lojaId, "5551911110005", "Opt");
    const ctx = contextoDeSistema({ origem: "webhook", lojaId });
    const r = await emTransacao(ctx, (tx, c) =>
      registrarConsentimentoBase(tx, c, {
        contatoId: id, tipo: "marketing", concedido: false, origem: "mensagem",
        termoVersao: "marketing-v1", ip: null, optOut: true,
      }),
    );
    expect(r).toEqual({ optOut: true, espelhoMudou: true });
    const { rows } = await banco.query(
      `select c.opt_out, (select count(*)::int from consentimentos k where k.contato_id = c.id) as n,
              (select registrado_por from consentimentos k where k.contato_id = c.id) as por
         from contatos c where c.id = $1`,
      [id],
    );
    // Sem pessoa, `registrado_por` fica nulo: o ATOR_SISTEMA não "consentiu".
    expect(rows[0]).toEqual({ opt_out: true, n: 1, por: null });
    expect((await trilha(id)).map((l) => l.acao)).toEqual(["consentimento_registrado"]);
  });

  it("contato de outra loja é recusado e nada é gravado", async () => {
    const outra = await criarLoja();
    const id = await criarContatoDeCrm(outra, "5551911110006", "Outra loja");
    const ctx = contextoDeSistema({ origem: "webhook", lojaId });
    await expect(
      emTransacao(ctx, (tx, c) =>
        registrarConsentimentoBase(tx, c, {
          contatoId: id, tipo: "marketing", concedido: false, origem: "mensagem",
          termoVersao: "marketing-v1", ip: null, optOut: true,
        }),
      ),
    ).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
    const { rows } = await banco.query("select count(*)::int n from consentimentos where contato_id = $1", [id]);
    expect(rows[0].n).toBe(0);
  });
});
