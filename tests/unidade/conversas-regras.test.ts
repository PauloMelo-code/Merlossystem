import { describe, expect, it } from "vitest";
import { paraData, previa, telefoneDoRemetente } from "@/lib/canais/normalizacao";
import {
  avisoDoComposer,
  bloqueioDoComposer,
  codificarCursor,
  colunaDoCanal,
  decodificarCursor,
  janelaFechada,
  podeAvancar,
  type EntradaDoBloqueio,
} from "@/lib/conversas/regras";

/** Regras puras do atendimento (04-ui.md §5.2; 01-dados-dominio.md §2.3). */

const agora = new Date("2026-09-16T12:00:00Z");
const base: EntradaDoBloqueio = {
  podeEscrever: true,
  provedor: "whatsapp_oficial",
  statusConta: "conectado",
  rotuloConta: "Vendas Centro",
  contaAlteradaEm: new Date("2026-09-16T10:42:00Z"),
  ultimaEntradaEm: new Date("2026-09-16T11:00:00Z"),
  podeReconectar: false,
  agora,
};

describe("bloqueio do composer (os casos decididos no servidor)", () => {
  it("livre quando tudo está em ordem", () => {
    expect(bloqueioDoComposer(base)).toBeNull();
  });

  it("papel sem escrita", () => {
    expect(bloqueioDoComposer({ ...base, podeEscrever: false })).toEqual({ caso: "somente_leitura" });
  });

  it("número desconectado, com conta e horário, e saída conforme o papel", () => {
    expect(bloqueioDoComposer({ ...base, statusConta: "erro", podeReconectar: true })).toEqual({
      caso: "desconectado",
      conta: "Vendas Centro",
      desde: "2026-09-16T10:42:00.000Z",
      podeReconectar: true,
    });
  });

  it("janela de 24 h fechada só no WhatsApp oficial", () => {
    const velha = new Date("2026-09-15T11:59:00Z");
    expect(bloqueioDoComposer({ ...base, ultimaEntradaEm: velha })).toEqual({ caso: "janela_24h" });
    expect(bloqueioDoComposer({ ...base, provedor: "uazapi", ultimaEntradaEm: velha })).toBeNull();
    expect(janelaFechada("whatsapp_oficial", null, agora)).toBe(true);
    expect(janelaFechada("instagram", null, agora)).toBe(false);
  });

  it("precedência: sem escrita > desconectado > janela", () => {
    const tudo = { ...base, podeEscrever: false, statusConta: "erro", ultimaEntradaEm: null };
    expect(bloqueioDoComposer(tudo)?.caso).toBe("somente_leitura");
    expect(bloqueioDoComposer({ ...tudo, podeEscrever: true })?.caso).toBe("desconectado");
  });
});

describe("aviso do composer", () => {
  it("resolvida reabre; arquivada abre nova; sem responsável fica comigo", () => {
    expect(avisoDoComposer("resolvida", true)).toBe("Enviar reabre a conversa.");
    expect(avisoDoComposer("arquivada", true)).toBe(
      "Esta conversa foi arquivada. Responder abre uma conversa nova.",
    );
    expect(avisoDoComposer("aberta", false)).toBe("Ao responder, a conversa fica com você.");
    expect(avisoDoComposer("aberta", true)).toBeNull();
  });
});

describe("status de entrega — uma prova por transição", () => {
  it.each([
    [null, "enviada", true],
    ["pendente", "enviada", true],
    ["enviada", "entregue", true],
    ["entregue", "lida", true],
    ["enviada", "lida", true],
    ["lida", "entregue", false],
    ["entregue", "enviada", false],
    ["enviada", "enviada", false],
    ["pendente", "falhou", true],
    ["lida", "falhou", true],
    ["falhou", "enviada", false],
    ["falhou", "lida", false],
    ["falhou", "falhou", false],
  ] as const)("%s → %s = %s", (de, para, esperado) => {
    expect(podeAvancar(de, para)).toBe(esperado);
  });
});

describe("cursor (instante, id)", () => {
  const id = "0b6a0f1e-9f5d-4a58-8c1e-3b8f0d2c4e11";

  it("ida e volta preserva milissegundo e id", () => {
    const c = { em: new Date("2026-09-16T12:00:00.123Z"), id };
    expect(decodificarCursor(codificarCursor(c))).toEqual(c);
  });

  it("cursor adulterado vira primeira página, nunca erro de banco", () => {
    const lixos = [
      null,
      "",
      "abc",
      Buffer.from("2026|nao-uuid").toString("base64url"),
      Buffer.from(`x|${id}`).toString("base64url"),
    ];
    for (const lixo of lixos) expect(decodificarCursor(lixo)).toBeNull();
  });
});

describe("normalização", () => {
  it("telefone do remetente só vira E.164 quando casa com o CHECK", () => {
    expect(telefoneDoRemetente("5551988887777@s.whatsapp.net")).toBe("5551988887777");
    expect(telefoneDoRemetente("IGSID-123")).toBeUndefined();
    expect(telefoneDoRemetente("0551988887777")).toBeUndefined();
    // O id do WhatsApp já traz o país: número estrangeiro curto não ganha o 55.
    expect(telefoneDoRemetente("14155551234@s.whatsapp.net")).toBe("14155551234");
  });

  it("prévia de 100 caracteres e rótulo por tipo", () => {
    expect(previa("texto", "a".repeat(150))).toHaveLength(100);
    expect(previa("audio", null)).toBe("Áudio");
    expect(previa("imagem", "  ")).toBe("Foto");
  });

  it("instante em segundos, milissegundos ou ISO", () => {
    const s = paraData("1757000000");
    expect(paraData(1757000000000).getTime()).toBe(s.getTime());
    expect(paraData("2026-09-16T12:00:00Z").toISOString()).toBe("2026-09-16T12:00:00.000Z");
    const agoraFixo = new Date("2026-01-01T00:00:00Z");
    expect(paraData("ontem", agoraFixo)).toBe(agoraFixo);
  });

  it("coluna do contato por provedor", () => {
    expect(colunaDoCanal("uazapi")).toBe("whatsapp_id");
    expect(colunaDoCanal("instagram")).toBe("instagram_id");
    expect(colunaDoCanal("bling")).toBeNull();
  });
});
