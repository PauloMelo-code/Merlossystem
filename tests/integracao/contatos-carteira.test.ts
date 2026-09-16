import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buscarCarteira,
  criarContato,
  definirEtiquetas,
  editarContato,
  etiquetarEmMassa,
  excluirContato,
  exportarCsv,
  lerFicha,
} from "@/lib/contatos";
import { pool } from "@/lib/db/client";
import { ErroDeColisao, ErroDeEscopo, ErroDeValidacao } from "@/lib/erros";
import { registrarConsentimento } from "@/lib/lgpd";
import { criarContatoSchema, filtrosContatosSchema } from "@/lib/validadores/contatos";
import {
  cenario,
  contexto,
  contextoTodas,
  emRollback,
  exigirBancoDeTeste,
  novaEtiqueta,
  novoContato,
  umaLinha,
} from "./contatos-apoio";

/**
 * Carteira por loja (01-dados-dominio.md §2.1 e §2.6; 04-ui.md §5.3 e §8.1).
 * Tudo em transação com rollback, pelo papel `merlo_app`.
 */

beforeAll(() => exigirBancoDeTeste());
afterAll(async () => {
  await pool.end().catch(() => undefined);
});

const filtros = (bruto: Record<string, unknown> = {}) => filtrosContatosSchema.parse(bruto);
const dados = (bruto: Record<string, unknown>) => criarContatoSchema.parse(bruto);

describe("criar e editar contato", () => {
  it("grava o telefone canônico E.164 e recusa telefone repetido na MESMA loja", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const criado = await criarContato(tx, contexto(c), dados({ nome: "Ana", telefone: "(51) 99999-0000" }));
      const linha = await umaLinha<{ telefone: string }>(tx, sql`select telefone from contatos where id = ${criado.id}`);
      expect(linha.telefone).toBe("5551999990000");

      await expect(
        tx.transaction((sp) => criarContato(sp, contexto(c), dados({ nome: "Outra", telefone: "51999990000" }))),
      ).rejects.toBeInstanceOf(ErroDeValidacao);

      // A mesma pessoa na outra loja é outro contato (DN-05).
      const naOutra = await criarContato(tx, contexto(c, c.outraLojaId), dados({ telefone: "5551999990000" }));
      expect(naOutra.id).not.toBe(criado.id);
    });
  });

  it("avisa quando existe um contato EXCLUÍDO com o mesmo número", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const antigo = await novoContato(tx, c.lojaId, { telefone: "5551977776666" });
      await excluirContato(tx, contexto(c), { id: antigo.id, updatedAt: antigo.updatedAt });
      const novo = await criarContato(tx, contexto(c), dados({ nome: "Volta", telefone: "5551977776666" }));
      expect(novo.existeExcluido).toBe(true);
    });
  });

  it("edição com versão velha devolve COLISAO; com a versão certa grava e registra a trilha sem PII", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const t = await novoContato(tx, c.lojaId, { nome: "Bia" });
      const base = { id: t.id, nome: "Bia Souza", telefone: "", email: "", endereco: null };
      await expect(
        tx.transaction((sp) =>
          editarContato(sp, contexto(c), { ...dados(base), id: t.id, updatedAt: new Date(t.updatedAt.getTime() - 5) }),
        ),
      ).rejects.toBeInstanceOf(ErroDeColisao);

      const salvo = await editarContato(tx, contexto(c), { ...dados(base), id: t.id, updatedAt: t.updatedAt });
      expect(salvo.atualizadoEm.getTime()).toBeGreaterThanOrEqual(t.updatedAt.getTime());
      const trilha = await umaLinha<{ depois: Record<string, unknown> }>(tx, sql`
        select depois from auditoria_eventos where entidade_id = ${t.id} and acao = 'contato_alterado'`);
      expect(trilha.depois.nome).toBe("(alterado)");
    });
  });

  it("contato de outra loja não existe para quem está na loja errada", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const t = await novoContato(tx, c.lojaId);
      expect(await lerFicha(tx, contexto(c, c.outraLojaId), t.id)).toBeNull();
      await expect(
        tx.transaction((sp) =>
          excluirContato(sp, contexto(c, c.outraLojaId), { id: t.id, updatedAt: t.updatedAt }),
        ),
      ).rejects.toBeInstanceOf(ErroDeEscopo);
    });
  });
});

describe("carteira: filtros, cursor e CSV", () => {
  it("pagina por (ultimo_contato_em, id) sem pular nem repetir, inclusive quem nunca foi contatado", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const base = Date.parse("2026-09-01T12:00:00Z");
      for (let i = 0; i < 30; i += 1) {
        await novoContato(tx, c.lojaId, {
          nome: `Cliente ${i}`,
          // Três sem contato (null) e horários repetidos para testar o desempate.
          ultimoContatoEm: i < 3 ? null : new Date(base - Math.floor(i / 2) * 60_000),
        });
      }
      const ctx = contexto(c);
      const vistos: string[] = [];
      let cursor: string | null = null;
      do {
        const pagina = await buscarCarteira(tx, ctx, filtros({ porPagina: 25, ...(cursor ? { cursor } : {}) }));
        vistos.push(...pagina.itens.map((i) => i.id));
        expect(pagina.total).toBe(30);
        cursor = pagina.cursorProximo;
      } while (cursor);
      expect(vistos).toHaveLength(30);
      expect(new Set(vistos).size).toBe(30);

      // Voltar da segunda página devolve exatamente a primeira.
      const primeira = await buscarCarteira(tx, ctx, filtros({ porPagina: 25 }));
      const segunda = await buscarCarteira(tx, ctx, filtros({ porPagina: 25, cursor: primeira.cursorProximo }));
      const devolta = await buscarCarteira(
        tx,
        ctx,
        filtros({ porPagina: 25, cursor: segunda.cursorAnterior, direcao: "anterior" }),
      );
      expect(devolta.itens.map((i) => i.id)).toEqual(primeira.itens.map((i) => i.id));
    });
  });

  it("busca por nome (prefixo) e por dígitos do telefone; opt-out e etiqueta filtram", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const maria = await novoContato(tx, c.lojaId, { nome: "Maria Silva", telefone: "5551911112222" });
      await novoContato(tx, c.lojaId, { nome: "João", telefone: "5551933334444" });
      await registrarConsentimento(tx, contexto(c), {
        contatoId: maria.id,
        tipo: "marketing",
        concedido: false,
        origem: "tela",
        ip: null,
      });
      const vip = await novaEtiqueta(tx, c.lojaId, "VIP");
      await etiquetarEmMassa(tx, contexto(c), { contatoIds: [maria.id], etiquetaId: vip });
      const ctx = contexto(c);

      const nomes = async (f: Record<string, unknown>) =>
        (await buscarCarteira(tx, ctx, filtros(f))).itens.map((i) => i.nome);
      expect(await nomes({ busca: "mar" })).toEqual(["Maria Silva"]);
      expect(await nomes({ busca: "silva" })).toEqual([]);
      expect(await nomes({ busca: "3333-4444" })).toEqual(["João"]);
      expect(await nomes({ busca: "100%" })).toEqual([]);
      expect(await nomes({ optOut: "sim" })).toEqual(["Maria Silva"]);
      expect(await nomes({ etiqueta: vip })).toEqual(["Maria Silva"]);
      // "Todos" é a AUSÊNCIA do filtro; `all` é ignorado, nunca interpretado.
      expect((await nomes({ optOut: "all" })).sort()).toEqual(["João", "Maria Silva"]);
    });
  });

  it("gestão em 'todas' vê as duas lojas; CSV usa o mesmo filtro e neutraliza fórmula", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      // 'todas' alcança o banco inteiro (outras suítes gravam contatos): a
      // busca por um prefixo único deixa só as duas linhas deste teste.
      const marca = `Zq${Date.now().toString(36)}`;
      await novoContato(tx, c.lojaId, { nome: "=HYPERLINK(1)" });
      await novoContato(tx, c.lojaId, { nome: `${marca} do centro` });
      await novoContato(tx, c.outraLojaId, { nome: `${marca} da outra` });
      const todas = await buscarCarteira(tx, contextoTodas(c), filtros({ busca: marca }));
      expect(todas.variasLojas).toBe(true);
      expect(todas.itens.map((i) => i.nome).sort()).toEqual([`${marca} da outra`, `${marca} do centro`]);

      const { csv, quantidade } = await exportarCsv(tx, contexto(c), filtros());
      expect(quantidade).toBe(2);
      expect(csv).toContain(`"'=HYPERLINK(1)"`);
      expect(csv).not.toContain("da outra");
    });
  });
});

describe("etiquetas", () => {
  it("troca o conjunto: some o que saiu, nasce o que entrou, as duas pontas na trilha", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const t = await novoContato(tx, c.lojaId);
      const a = await novaEtiqueta(tx, c.lojaId, "A");
      const b = await novaEtiqueta(tx, c.lojaId, "B");
      const ctx = contexto(c);
      await definirEtiquetas(tx, ctx, { contatoId: t.id, etiquetaIds: [a] });
      await definirEtiquetas(tx, ctx, { contatoId: t.id, etiquetaIds: [b] });
      const ficha = await lerFicha(tx, ctx, t.id);
      expect(ficha?.etiquetas.map((e) => e.nome)).toEqual(["B"]);
      const trilha = await umaLinha<{ n: number }>(tx, sql`
        select count(*)::int as n from auditoria_eventos where acao = 'contato_etiqueta_alterada'`);
      expect(trilha.n).toBe(3);
    });
  });

  it("etiqueta de outra loja nunca vira vínculo; em massa não duplica", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const t = await novoContato(tx, c.lojaId);
      const alheia = await novaEtiqueta(tx, c.outraLojaId, "Alheia");
      const ctx = contexto(c);
      await expect(
        tx.transaction((sp) => definirEtiquetas(sp, ctx, { contatoId: t.id, etiquetaIds: [alheia] })),
      ).rejects.toBeInstanceOf(ErroDeEscopo);

      const minha = await novaEtiqueta(tx, c.lojaId, "Minha");
      const u = await novoContato(tx, c.lojaId);
      expect(await etiquetarEmMassa(tx, ctx, { contatoIds: [t.id, u.id], etiquetaId: minha })).toEqual({
        etiquetados: 2,
        jaTinham: 0,
      });
      expect(await etiquetarEmMassa(tx, ctx, { contatoIds: [t.id, u.id], etiquetaId: minha })).toEqual({
        etiquetados: 0,
        jaTinham: 2,
      });
    });
  });
});
