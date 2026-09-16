import { describe, expect, it } from "vitest";
import {
  ALVO_POR_TIPO,
  chaveDeDeduplicacao,
  lerChave,
  mensagemDoAlerta,
  PRAZOS_SLA_TEXTO,
  rotaDoAlerta,
  SEVERIDADE_POR_TIPO,
  SLA_MINUTOS,
  TIPOS_GERADOS_R1,
} from "@/lib/alertas/regras";
import { SEVERIDADES, TIPOS_ALERTA } from "@/lib/db/schema/_enums/plataforma";
import { celula, gerarCsv } from "@/lib/relatorios/csv";
import { formatarValor, METRICAS, type Indicadores } from "@/lib/relatorios/definicoes";
import { ontem } from "@/lib/relatorios/resumo";
import { filtrosRelatorioSchema } from "@/lib/validadores/relatorios";

describe("regras dos alertas", () => {
  it("SLA do R1: WhatsApp 5, Instagram 15, Facebook 30, TikTok 60", () => {
    expect(SLA_MINUTOS).toMatchObject({ whatsapp_oficial: 5, uazapi: 5, instagram: 15, facebook: 30, tiktok_shop: 60 });
    expect(PRAZOS_SLA_TEXTO.map((p) => p.minutos)).toEqual([5, 15, 30, 60]);
  });

  it("todo tipo gerado está no CHECK, tem severidade válida e alvo", () => {
    for (const tipo of TIPOS_GERADOS_R1) {
      expect(TIPOS_ALERTA).toContain(tipo);
      expect(SEVERIDADES).toContain(SEVERIDADE_POR_TIPO[tipo]);
      expect(ALVO_POR_TIPO[tipo]).toBeTruthy();
    }
    // Funil e pagamentos estão fora do R1: o gerador não os produz.
    expect(TIPOS_GERADOS_R1).not.toContain("negocio_parado");
    expect(TIPOS_GERADOS_R1).not.toContain("pagamento_pendente");
  });

  it("chave vai e volta; chave estranha não é deste gerador", () => {
    const chave = chaveDeDeduplicacao("sla_estourado", { tipo: "conversa", id: "abc" });
    expect(lerChave(chave)).toEqual({ tipo: "sla_estourado", alvo: { tipo: "conversa", id: "abc" } });
    expect(lerChave("qualquer-coisa")).toBeNull();
    expect(lerChave("negocio_parado|conversa|x")).toBeNull();
  });

  it("mensagem não carrega dado da cliente", () => {
    for (const tipo of TIPOS_GERADOS_R1) {
      const texto = mensagemDoAlerta(tipo, { minutos: 7, rotulo: "Vendas" });
      expect(texto.length).toBeGreaterThan(10);
      expect(texto).not.toMatch(/\d{8,}|@/);
    }
  });

  it("o alerta abre o objeto certo", () => {
    const base = { tipo: "x", conversaId: null, contatoId: null, pedidoId: null };
    expect(rotaDoAlerta({ ...base, conversaId: "c", chave: "" })).toBe("/conversas/c");
    expect(rotaDoAlerta({ ...base, chave: "integracao_com_erro|integracao|i" })).toBe("/configuracoes/integracoes/i");
    expect(rotaDoAlerta({ ...base, contatoId: "k", chave: "follow_up_atrasado|agendamento|a" })).toBe("/agendadas");
    expect(rotaDoAlerta({ ...base, contatoId: "k", chave: "primeiro_contato|contato|k" })).toBe("/contatos/k");
    expect(rotaDoAlerta({ ...base, chave: "" })).toBeNull();
  });
});

describe("relatórios", () => {
  it("toda métrica do tipo Indicadores tem rótulo e definição", () => {
    const chaves: (keyof Indicadores)[] = [
      "receita",
      "pedidosLancados",
      "ticketMedio",
      "pedidosCriados",
      "conversasIniciadas",
      "taxaResposta",
      "tempoPrimeiraResposta",
    ];
    expect(METRICAS.map((m) => m.id).sort()).toEqual([...chaves].sort());
    for (const m of METRICAS) expect(m.definicao.length).toBeGreaterThan(30);
    expect(METRICAS.find((m) => m.id === "receita")?.definicao).toMatch(/lançados no Masc/);
  });

  it("formata moeda, percentual, minutos e nulo", () => {
    expect(formatarValor("moeda", "1234567.5")).toBe("R$ 1.234.567,50");
    expect(formatarValor("percentual", 0.125)).toBe("12,5%");
    expect(formatarValor("minutos", 45.4)).toBe("45 min");
    expect(formatarValor("minutos", 125)).toBe("2 h 5 min");
    expect(formatarValor("numero", 12345)).toBe("12.345");
    expect(formatarValor("minutos", null)).toBe("—");
  });

  it("CSV neutraliza fórmula e escapa separador", () => {
    expect(celula("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(celula('a;"b"')).toBe('"a;""b"""');
    const csv = gerarCsv({
      loja: "Centro",
      deTexto: "2026-09-01",
      ateTexto: "2026-09-02",
      indicadores: {
        receita: "10.00",
        pedidosLancados: 1,
        ticketMedio: "10.00",
        pedidosCriados: 1,
        conversasIniciadas: 0,
        taxaResposta: null,
        tempoPrimeiraResposta: null,
      },
      serie: [{ dia: "2026-09-01", receita: "10.00", conversas: 0 }],
    });
    expect(csv.startsWith("﻿Loja;Centro\r\nPeríodo;2026-09-01 a 2026-09-02")).toBe(true);
    expect(csv).toContain("2026-09-01;10,00;0");
  });

  it("período do relatório: padrão de 30 dias e recusa de inversão", () => {
    const padrao = filtrosRelatorioSchema.parse({});
    expect(Math.round((padrao.ate.getTime() - padrao.de.getTime()) / 86_400_000)).toBe(30);
    expect(filtrosRelatorioSchema.safeParse({ de: "2026-09-05", ate: "2026-09-01" }).success).toBe(false);
  });

  it("resumo diário pega o dia anterior inteiro de São Paulo", () => {
    const r = ontem(new Date("2026-09-16T02:00:00Z")); // 23h do dia 15 em SP
    expect(r.dia).toBe("2026-09-14");
    expect(r.de.toISOString()).toBe("2026-09-14T03:00:00.000Z");
    expect(r.ate.toISOString()).toBe("2026-09-15T03:00:00.000Z");
  });
});
