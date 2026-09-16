import { describe, expect, it } from "vitest";
import {
  idDeConteudo,
  lerJson,
  rotearInstagram,
  rotearUazapi,
  rotearWhatsapp,
} from "@/lib/integracoes/payload";
import { conectarPorTokenSchema, editarContaSchema } from "@/lib/validadores/integracoes";
import { criarLojaSchema } from "@/lib/validadores/lojas";
import { PROVEDORES, PROVEDORES_CONECTAVEIS } from "@/lib/integracoes/catalogo-provedores";
import { PROVEDORES as PROVEDORES_DO_BANCO } from "@/lib/db/schema/_enums/plataforma";

/**
 * Roteamento do corpo dos webhooks (03-arquitetura.md §11) — puro, com
 * payload fixo. O sistema antigo roteava o lote INTEIRO pela primeira entrada.
 */

function loteWhatsapp() {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "111", display_phone_number: "5551" },
              contacts: [{ wa_id: "5551999990000" }],
              messages: [
                { id: "wamid.A", type: "image", image: { id: "m1" } },
                { id: "wamid.A", type: "image", image: { id: "m2" } },
                { id: "wamid.B", type: "text", text: { body: "oi" } },
              ],
            },
          },
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "222" },
              statuses: [{ id: "wamid.C", status: "delivered" }],
            },
          },
          {
            field: "message_template_status_update",
            value: { event: "APPROVED", message_template_id: 99, message_template_name: "oferta" },
          },
        ],
      },
    ],
  };
}

describe("rotearWhatsapp", () => {
  const itens = rotearWhatsapp(loteWhatsapp());

  it("agrupa por CONTA: cada item carrega o phone_number_id dele", () => {
    const contas = itens.map((i) => i.conta);
    expect(contas).toContain("111");
    expect(contas).toContain("222");
    expect(itens.find((i) => i.externoId === "st-wamid.C-delivered")?.conta).toBe("222");
  });

  it("vários anexos com o mesmo id viram UM item com N mídias", () => {
    const a = itens.filter((i) => i.externoId === "msg-wamid.A");
    expect(a).toHaveLength(1);
    const corpo = a[0]!.corpo as { entry: { changes: { value: { messages: unknown[] } }[] }[] };
    expect(corpo.entry[0]!.changes[0]!.value.messages).toHaveLength(2);
  });

  it("o pedaço mantém a forma do payload da Meta (o adaptador lê sem saber do corte)", () => {
    const b = itens.find((i) => i.externoId === "msg-wamid.B")!;
    const corpo = b.corpo as { object: string; entry: { changes: { field: string; value: Record<string, unknown> }[] }[] };
    expect(corpo.object).toBe("whatsapp_business_account");
    expect(corpo.entry[0]!.changes[0]!.field).toBe("messages");
    expect(corpo.entry[0]!.changes[0]!.value.metadata).toEqual({ phone_number_id: "111", display_phone_number: "5551" });
  });

  it("status de modelo sai sem conta (vem pela WABA, que é cifrada)", () => {
    const modelo = itens.find((i) => i.tipo === "modelo")!;
    expect(modelo.conta).toBeNull();
    expect(modelo.externoId).toMatch(/^modelo-99-APPROVED-/);
  });

  it("o mesmo lote gera os mesmos ids (reentrega é idempotente)", () => {
    const outra = rotearWhatsapp(loteWhatsapp()).map((i) => i.externoId).sort();
    expect(outra).toEqual(itens.map((i) => i.externoId).sort());
  });

  it("payload ilegível devolve lista vazia sem lançar", () => {
    expect(rotearWhatsapp(lerJson("isto não é json"))).toEqual([]);
    expect(rotearWhatsapp({ entry: "x" })).toEqual([]);
    expect(rotearWhatsapp(null)).toEqual([]);
  });
});

describe("rotearInstagram", () => {
  it("a conta é entry.id, e eco de página não é descartado aqui (é do adaptador)", () => {
    const itens = rotearInstagram({
      object: "instagram",
      entry: [
        { id: "IG-1", messaging: [{ sender: { id: "u1" }, message: { mid: "m1", text: "oi" } }] },
        { id: "IG-2", messaging: [{ sender: { id: "p" }, message: { mid: "m2", is_echo: true } }, { read: { mid: "m0" } }] },
      ],
    });
    expect(itens.map((i) => [i.conta, i.externoId])).toEqual([
      ["IG-1", "msg-m1"],
      ["IG-2", "msg-m2"],
      ["IG-2", "lido-m0"],
    ]);
  });
});

describe("rotearUazapi", () => {
  it("o token da instância repetido no corpo NUNCA vai para o diário", () => {
    const [item] = rotearUazapi({ EventType: "messages", token: "segredo-da-instancia", message: { messageid: "X1" } });
    expect(item!.externoId).toBe("msg-X1");
    expect(JSON.stringify(item!.corpo)).not.toContain("segredo-da-instancia");
  });

  it("evento de conexão vira item de sessão", () => {
    const [item] = rotearUazapi({ EventType: "connection", instance: { status: "open" } });
    expect(item!.tipo).toBe("sessao");
  });

  it("corpo que não é objeto não gera item", () => {
    expect(rotearUazapi(lerJson("[1,2]"))).toEqual([]);
  });

  it("id de conteúdo é estável e curto", () => {
    expect(idDeConteudo({ a: 1 })).toBe(idDeConteudo({ a: 1 }));
    expect(idDeConteudo({ a: 1 })).toHaveLength(40);
  });
});

describe("validadores e catálogo", () => {
  it("todo provedor conectável existe no CHECK do banco; facebook e tiktok ficam fora do R1", () => {
    for (const p of PROVEDORES_CONECTAVEIS) expect(PROVEDORES_DO_BANCO).toContain(p);
    expect(PROVEDORES_CONECTAVEIS).not.toContain("facebook");
    expect(PROVEDORES_CONECTAVEIS).not.toContain("tiktok_shop");
  });

  it("a credencial sai só com as chaves do provedor; chave faltando reprova", () => {
    const base = {
      provedor: "whatsapp_oficial",
      lojaId: "7f000000-0000-4000-8000-000000000001",
      rotulo: "WhatsApp Centro",
      referencia: "123456",
      chave_access_token: "EAAB-token-123",
      chave_waba_id: "998877",
      chave_intrusa: "nao-deve-passar",
    };
    const ok = conectarPorTokenSchema.safeParse(base);
    expect(ok.success).toBe(true);
    expect(Object.keys(ok.data!.credencial).sort()).toEqual([...PROVEDORES.whatsapp_oficial.chaves].sort());

    const falta = conectarPorTokenSchema.safeParse({ ...base, chave_waba_id: "" });
    expect(falta.success).toBe(false);
    expect(falta.error!.issues.map((i) => i.path.join("."))).toContain("chave_waba_id");
  });

  it("bling não é conectável por token (só OAuth)", () => {
    const r = conectarPorTokenSchema.safeParse({ provedor: "bling", lojaId: "x", rotulo: "Bling", referencia: "r" });
    expect(r.success).toBe(false);
  });

  it("loja: sigla com 3 letras vira maiúscula; slug fora do padrão reprova", () => {
    const ok = criarLojaSchema.parse({ nome: "Centro", slug: "Centro", sigla: "cen", blingDepositoId: "" });
    expect(ok).toEqual({ nome: "Centro", slug: "centro", sigla: "CEN", blingDepositoId: null });
    expect(criarLojaSchema.safeParse({ nome: "X Y", slug: "com espaço", sigla: "ABCD" }).success).toBe(false);
  });

  it("editar conta: loja vazia não troca a loja", () => {
    const r = editarContaSchema.parse({
      id: "7f000000-0000-4000-8000-000000000001",
      updatedAt: new Date().toISOString(),
      rotulo: "Conta",
      lojaId: "",
    });
    expect(r.lojaId).toBeUndefined();
  });
});
