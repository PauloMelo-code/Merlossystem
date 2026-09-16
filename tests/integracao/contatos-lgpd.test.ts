import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "@/lib/db/client";
import { ErroDeEscopo, ErroDeValidacao } from "@/lib/erros";
import {
  iniciarExportacao,
  lerDossie,
  registrarConsentimento,
  registrarSolicitacao,
  TERMO_VIGENTE,
} from "@/lib/lgpd";
import {
  cenario,
  contexto,
  emRollback,
  exigirBancoDeTeste,
  novoContato,
  umaLinha,
} from "./contatos-apoio";

/**
 * Consentimento com espelho e dossiê do titular (01-dados-dominio.md §7.2 e
 * §7.3; 02-seguranca.md §16).
 */

beforeAll(() => exigirBancoDeTeste());
afterAll(async () => {
  await pool.end().catch(() => undefined);
});

describe("registrarConsentimento", () => {
  it("grava a trilha e o espelho NA MESMA transação, com o IP do servidor", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const t = await novoContato(tx, c.lojaId);
      const ctx = contexto(c);

      const saiu = await registrarConsentimento(tx, ctx, {
        contatoId: t.id,
        tipo: "marketing",
        concedido: false,
        origem: "tela",
        ip: "200.0.0.10",
      });
      expect(saiu).toEqual({ optOut: true, espelhoMudou: true });

      const espelho = await umaLinha<{ opt_out: boolean; opt_out_em: Date | null }>(
        tx,
        sql`select opt_out, opt_out_em from contatos where id = ${t.id}`,
      );
      expect(espelho.opt_out).toBe(true);
      expect(espelho.opt_out_em).not.toBeNull();

      const prova = await umaLinha<{ ip: string; termo_versao: string; registrado_por: string; origem: string }>(
        tx,
        sql`select ip, termo_versao, registrado_por, origem from consentimentos where contato_id = ${t.id}`,
      );
      expect(prova).toEqual({ ip: "200.0.0.10", termo_versao: TERMO_VIGENTE, registrado_por: c.usuarioId, origem: "tela" });

      // Repetir o mesmo pedido grava a prova, mas o espelho não muda.
      const repetido = await registrarConsentimento(tx, ctx, {
        contatoId: t.id,
        tipo: "opt_out",
        concedido: true,
        origem: "mensagem",
        ip: null,
      });
      expect(repetido).toEqual({ optOut: true, espelhoMudou: false });

      // Voltar a aceitar promoção limpa o espelho.
      await registrarConsentimento(tx, ctx, { contatoId: t.id, tipo: "opt_in", concedido: true, origem: "tela", ip: null });
      const depois = await umaLinha<{ opt_out: boolean; opt_out_em: Date | null; n: number }>(
        tx,
        sql`select opt_out, opt_out_em, (select count(*)::int from consentimentos where contato_id = ${t.id}) as n
              from contatos where id = ${t.id}`,
      );
      expect(depois).toEqual({ opt_out: false, opt_out_em: null, n: 3 });

      const trilha = await umaLinha<{ n: number }>(tx, sql`
        select count(*)::int as n from auditoria_eventos
         where entidade_id = ${t.id} and acao = 'consentimento_registrado'`);
      expect(trilha.n).toBe(3);
    });
  });

  it("tratamento de dados não mexe no espelho; contato de outra loja é 404", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const t = await novoContato(tx, c.lojaId);
      const r = await registrarConsentimento(tx, contexto(c), {
        contatoId: t.id,
        tipo: "tratamento_dados",
        concedido: true,
        origem: "tela",
        ip: null,
      });
      expect(r.espelhoMudou).toBe(false);
      await expect(
        tx.transaction((sp) =>
          registrarConsentimento(sp, contexto(c, c.outraLojaId), {
            contatoId: t.id,
            tipo: "marketing",
            concedido: false,
            origem: "tela",
            ip: null,
          }),
        ),
      ).rejects.toBeInstanceOf(ErroDeEscopo);
    });
  });

  it("o papel da aplicação não consegue reescrever a prova", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const t = await novoContato(tx, c.lojaId);
      await registrarConsentimento(tx, contexto(c), { contatoId: t.id, tipo: "marketing", concedido: true, origem: "tela", ip: null });
      await expect(
        tx.transaction((sp) => sp.execute(sql`update consentimentos set concedido = false where contato_id = ${t.id}`)),
      ).rejects.toMatchObject({ cause: { code: "42501" } });
    });
  });
});

describe("dossiê do titular", () => {
  it("registra a solicitação e a trilha, e pagina as mensagens sem perder nenhuma", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const t = await novoContato(tx, c.lojaId, { nome: "Titular", telefone: "5551955554444" });
      const conversa = await umaLinha<{ id: string }>(tx, sql`
        insert into conversas (loja_id, contato_id, integracao_id)
        values (${c.lojaId}, ${t.id}, ${c.integracaoId}) returning id`);
      await tx.execute(sql`
        insert into conversas_mensagens (loja_id, conversa_id, direcao, autor_tipo, conteudo, ocorrida_em, created_at)
        select ${c.lojaId}, ${conversa.id}, 'entrada', 'contato', 'mensagem ' || g, now(),
               now() - make_interval(secs => g % 7)
          from generate_series(1, 205) g`);
      const ctx = contexto(c);

      const aberta = await iniciarExportacao(tx, ctx, {
        contatoId: t.id,
        protocolo: "ACESSO-01",
        motivo: "Titular pediu cópia dos dados",
      });
      const trilha = await umaLinha<{ n: number }>(tx, sql`
        select count(*)::int as n from auditoria_eventos where entidade_id = ${t.id} and acao = 'lgpd_exportado'`);
      expect(trilha.n).toBe(1);

      const contato = await lerDossie(tx, ctx, { solicitacaoId: aberta.solicitacaoId, secao: "contato" });
      expect(contato.linhas[0]).toMatchObject({ nome: "Titular", telefone: "5551955554444" });

      const vistas = new Set<unknown>();
      let cursor: string | undefined;
      let paginas = 0;
      do {
        const pagina = await lerDossie(tx, ctx, {
          solicitacaoId: aberta.solicitacaoId,
          secao: "mensagens",
          ...(cursor ? { cursor } : {}),
        });
        pagina.linhas.forEach((l) => vistas.add(l.id));
        expect(pagina.linhas.every((l) => !("url_externa" in l))).toBe(true);
        cursor = pagina.proximoCursor ?? undefined;
        paginas += 1;
      } while (cursor);
      expect(vistas.size).toBe(205);
      expect(paginas).toBe(2);

      // Uma hora depois, a exportação não abre mais página nenhuma.
      const depois = new Date(Date.now() + 61 * 60 * 1000);
      await expect(
        tx.transaction((sp) => lerDossie(sp, ctx, { solicitacaoId: aberta.solicitacaoId, secao: "contato" }, depois)),
      ).rejects.toBeInstanceOf(ErroDeValidacao);

      // Outra loja não enxerga a solicitação.
      await expect(
        tx.transaction((sp) =>
          lerDossie(sp, contexto(c, c.outraLojaId), { solicitacaoId: aberta.solicitacaoId, secao: "contato" }),
        ),
      ).rejects.toBeInstanceOf(ErroDeEscopo);
    });
  });

  it("pedido de correção só registra protocolo; protocolo repetido é recusado", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const t = await novoContato(tx, c.lojaId);
      const ctx = contexto(c);
      await registrarSolicitacao(tx, ctx, { contatoId: t.id, tipo: "correcao", protocolo: "COR-1", motivo: "Nome escrito errado" });
      const linha = await umaLinha<{ tipo: string; executado_em: Date | null }>(
        tx,
        sql`select tipo, executado_em from lgpd_solicitacoes where protocolo = 'COR-1'`,
      );
      expect(linha).toEqual({ tipo: "correcao", executado_em: null });
      await expect(
        tx.transaction((sp) =>
          registrarSolicitacao(sp, ctx, { contatoId: t.id, tipo: "correcao", protocolo: "COR-1", motivo: "Outra vez o mesmo" }),
        ),
      ).rejects.toBeInstanceOf(ErroDeValidacao);
    });
  });
});
