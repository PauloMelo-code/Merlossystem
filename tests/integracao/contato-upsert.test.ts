import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { upsertContatoPorCanal } from "@/lib/db/mutacoes";
import { banco, criarContatoDeCrm, criarLoja, fecharBanco } from "./conversas-apoio";

/**
 * `upsertContatoPorCanal` com contato do CRM que tem o telefone e NÃO tem
 * `whatsapp_id` (01-dados-dominio.md §2.1; fecha 02/C-01 e 01/D-03). O upsert
 * simples violava `(loja_id, telefone)` e a mensagem se perdia com 200.
 */

let lojaId: string;
beforeAll(async () => {
  lojaId = await criarLoja();
});
afterAll(fecharBanco);

function upsert(loja: string, telefone: string, nome?: string) {
  return db.transaction((transacao) =>
    upsertContatoPorCanal(
      transacao,
      loja,
      { canal: "whatsapp_id", valor: telefone, telefone, ...(nome ? { nome } : {}) },
      new Date(),
    ),
  );
}

describe("upsertContatoPorCanal", () => {
  it("carimba o whatsapp_id no contato do CRM em vez de criar outro", async () => {
    // Telefone só deste arquivo: a varredura da LGPD (M2) procura 5551988887777
    // em todas as tabelas, e o mesmo banco roda as duas suítes.
    const telefone = "5551930304040";
    const crm = await criarContatoDeCrm(lojaId, telefone, "Joana do CRM");
    const linha = await upsert(lojaId, telefone, "Joana");
    expect(linha.id).toBe(crm);
    const { rows } = await banco.query(
      "select count(*)::int as n, max(whatsapp_id) as w, max(nome) as nome from contatos where loja_id = $1 and telefone = $2",
      [lojaId, telefone],
    );
    // O nome do CRM é preservado: o canal não sobrescreve o cadastro.
    expect(rows[0]).toMatchObject({ n: 1, w: telefone, nome: "Joana do CRM" });
  });

  it("segunda chamada acha pelo canal e não duplica", async () => {
    const telefone = "5551977776666";
    const a = await upsert(lojaId, telefone);
    const b = await upsert(lojaId, telefone);
    expect(a.id).toBe(b.id);
  });

  it("o mesmo telefone em outra loja é outro contato (carteira por loja)", async () => {
    const outra = await criarLoja();
    const telefone = "5551966665555";
    const a = await upsert(lojaId, telefone);
    const b = await upsert(outra, telefone);
    expect(a.id).not.toBe(b.id);
  });
});
