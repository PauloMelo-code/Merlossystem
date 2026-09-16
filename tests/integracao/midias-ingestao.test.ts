import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import type { DadosDownload } from "@/lib/midias/ingestao";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Entrada de mídia de fora, jobs da fila `midia`, limpeza de binário e grade
 * por cursor — contra Postgres, Redis (índice 3) e MinIO reais.
 */

/** DNS trocado: teste de rede não depende de rede (mesmo padrão de ssrf.test.ts). */
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => {
    if (host === "mmg.whatsapp.net") return [{ address: "157.240.1.2", family: 4 }];
    throw new Error("ENOTFOUND");
  },
}));

const { ESTADOS_DE_SISTEMA } = await import("@/lib/db/listas-fechadas");
const { emTransacao } = await import("@/lib/db/mutacoes");
const { ErroDeIntegracao } = await import("@/lib/erros");
const { fecharConexoes } = await import("@/lib/fila/conexao");
const { fecharFilas, fila } = await import("@/lib/fila/filas");
const { lerObjeto } = await import("@/lib/armazenamento/midia");
const ingestao = await import("@/lib/midias/ingestao");
const { limparMidiasExpiradas, removerBinarios } = await import("@/lib/midias/limpeza");
const { listarMidias } = await import("@/lib/midias/_consultas");
const { baixarDeUrl } = await import("@/server/processadores/midia");
const apoio = await import("./midias-apoio");
const { banco, criarAnexo, criarLoja, linhaDaMidia, png } = apoio;

let loja: string;

beforeAll(async () => {
  loja = await criarLoja();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await fecharFilas();
  await fecharConexoes();
  await banco.end();
});

async function guardar(bytes: Buffer, tipoMime?: string) {
  const ctx = ingestao.contextoDeSistema(loja);
  return emTransacao(ctx, (tx) =>
    ingestao.guardarMidiaRecebida(tx, { lojaId: loja, origem: "uazapi", bytes, ...(tipoMime ? { tipoMime } : {}) }, ctx),
  );
}

async function anexo(id: string) {
  const { rows } = await banco.query("select * from conversas_mensagens_midias where id = $1", [id]);
  return rows[0] as Record<string, unknown>;
}

describe("guardarMidiaRecebida (costura consumida por M1)", () => {
  it("bytes: grava origem recebida, sem pasta, com trilha de sistema e job de miniatura", async () => {
    const { midiaId } = await guardar(await png(80, 60, "#654321"), "image/png");
    const linha = await linhaDaMidia(midiaId);
    expect(linha).toMatchObject({ origem: "recebida", pasta: null, enviada_por: null, modified_by: null });
    expect(String(linha!.chave_objeto)).toBe(`${loja}/recebida/${midiaId}.png`);
    expect(String(linha!.chave_miniatura)).toBe(`${loja}/recebida/${midiaId}.min.webp`);

    const trilha = await banco.query(
      "select ator_tipo, ator_id from auditoria_eventos where entidade_id = $1",
      [midiaId],
    );
    expect(trilha.rows).toEqual([{ ator_tipo: "sistema", ator_id: null }]);

    const job = await fila("midia").getJob(`miniatura-${midiaId}`);
    expect(job?.name).toBe("gerar-miniatura");
    expect(job?.data).toEqual({ lojaId: loja, midiaId });

    // O job, rodado à mão: gera, e gerar de novo é idempotente.
    expect(await ingestao.gerarMiniaturaDaMidia({ lojaId: loja, midiaId })).toBe("gerada");
    expect(await ingestao.gerarMiniaturaDaMidia({ lojaId: loja, midiaId })).toBe("gerada");
    expect(await lerObjeto(String(linha!.chave_miniatura), { soCabecalho: true })).not.toBeNull();
  });

  it("o mesmo conteúdo na mesma loja não duplica", async () => {
    const bytes = await png(9, 9, "#999999");
    const a = await guardar(bytes);
    const b = await guardar(bytes);
    expect(b.midiaId).toBe(a.midiaId);
  });

  it("só URL é recusada (URL entra por agendarDownload) e HTML não vira mídia", async () => {
    const ctx = ingestao.contextoDeSistema(loja);
    await expect(
      emTransacao(ctx, (tx) =>
        ingestao.guardarMidiaRecebida(tx, { lojaId: loja, origem: "uazapi", url: "https://x.invalido/a" }, ctx),
      ),
    ).rejects.toMatchObject({ permanente: true });
    await expect(guardar(Buffer.from("<html><script>1</script></html>"), "image/png")).rejects.toMatchObject({
      status: 415,
    });
  });

  it("miniatura de mídia que ainda não existe é transitória (retenta)", async () => {
    await expect(
      ingestao.gerarMiniaturaDaMidia({ lojaId: loja, midiaId: randomUUID() }),
    ).rejects.toMatchObject({ permanente: false });
  });
});

describe("baixar-de-url", () => {
  it.each([
    "http://127.0.0.1:9002/merlostore-midia/segredo.png",
    "http://169.254.169.254/latest/meta-data",
    "https://evil.example/a.png",
  ])("recusa %s de forma permanente e não toca no anexo", async (url) => {
    const id = await criarAnexo(loja, { url });
    await expect(ingestao.baixarAnexo({ lojaId: loja, anexoId: id, provedor: "whatsapp_oficial" })).rejects.toSatisfy(
      (e: unknown) => e instanceof ErroDeIntegracao && e.permanente && /recusado/i.test(e.message),
    );
    expect(await anexo(id)).toMatchObject({ baixada: false, midia_id: null, url_externa: url });

    // O processador não retenta erro permanente: termina sem lançar.
    const job = { id: "t", name: "baixar-de-url", data: { lojaId: loja, anexoId: id, provedor: "whatsapp_oficial" } };
    await expect(baixarDeUrl(job as unknown as Job<DadosDownload>)).resolves.toBeUndefined();
  });

  it("anexo ainda invisível é transitório; provedor desconhecido é permanente", async () => {
    await expect(
      ingestao.baixarAnexo({ lojaId: loja, anexoId: randomUUID(), provedor: "uazapi" }),
    ).rejects.toMatchObject({ permanente: false });
    const id = await criarAnexo(loja, { url: "https://mmg.whatsapp.net/x" });
    await expect(
      ingestao.baixarAnexo({ lojaId: loja, anexoId: id, provedor: "bling" }),
    ).rejects.toMatchObject({ permanente: true });
  });

  it("agendarDownload usa jobId determinístico", async () => {
    const anexoId = randomUUID();
    const dados = { lojaId: loja, anexoId, provedor: "uazapi" };
    expect(await ingestao.agendarDownload(dados)).toBe(`download-${anexoId}`);
    expect(await ingestao.agendarDownload(dados)).toBe(`download-${anexoId}`);
    const job = await fila("midia").getJob(`download-${anexoId}`);
    expect(job?.data).toEqual(dados);
  });

  // Depende de `conversas_mensagens_midias` em ESTADOS_DE_SISTEMA (bloqueio do M3,
  // arquivo da fundação). Liga sozinho quando a entrada existir.
  it.skipIf(!ESTADOS_DE_SISTEMA.conversas_mensagens_midias)(
    "sucesso: grava a mídia e, no mesmo UPDATE, preenche midia_id, marca baixada e limpa url_externa",
    async () => {
      const bytes = await png(33, 33, "#0000ff");
      vi.stubGlobal("fetch", async () => new Response(new Uint8Array(bytes), { headers: { "content-type": "image/png" } }));
      const id = await criarAnexo(loja, { url: "https://mmg.whatsapp.net/v/abc" });
      expect(await ingestao.baixarAnexo({ lojaId: loja, anexoId: id, provedor: "whatsapp_oficial" })).toBe("baixada");
      const depois = await anexo(id);
      expect(depois).toMatchObject({ baixada: true, url_externa: null });
      expect(depois.midia_id).toBeTruthy();
      expect(
        await ingestao.baixarAnexo({ lojaId: loja, anexoId: id, provedor: "whatsapp_oficial" }),
      ).toBe("ja-baixada");
    },
  );
});

describe("limpeza de binário", () => {
  async function excluidaHa(dias: number): Promise<{ id: string; chave: string }> {
    const { midiaId } = await guardar(await png(5 + dias, 5, "#abcabc"));
    await banco.query(
      `update lojas_midias set is_deleted = true, deleted_at = now() - make_interval(days => $2) where id = $1`,
      [midiaId, dias],
    );
    return { id: midiaId, chave: String((await linhaDaMidia(midiaId))!.chave_objeto) };
  }

  const existe = async (chave: string) => (await lerObjeto(chave, { soCabecalho: true })) !== null;

  it("remove só o objeto excluído há mais de 90 dias e não referenciado; a linha fica", async () => {
    const velha = await excluidaHa(100);
    const citada = await excluidaHa(101);
    await criarAnexo(loja, { midiaId: citada.id });
    const recente = await excluidaHa(10);

    expect(await limparMidiasExpiradas(loja)).toBeGreaterThanOrEqual(1);
    expect(await existe(velha.chave)).toBe(false);
    expect(await existe(citada.chave)).toBe(true);
    expect(await existe(recente.chave)).toBe(true);
    expect((await linhaDaMidia(velha.id))?.is_deleted).toBe(true);

    // Idempotente: objeto ausente é sucesso.
    await expect(limparMidiasExpiradas(loja)).resolves.toBeGreaterThanOrEqual(1);
  });

  it("removerBinarios (LGPD) remove por id e aceita objeto já ausente", async () => {
    const alvo = await excluidaHa(1);
    expect(await removerBinarios([alvo.id])).toBe(1);
    expect(await existe(alvo.chave)).toBe(false);
    expect(await removerBinarios([alvo.id])).toBe(1);
    expect(await removerBinarios([])).toBe(0);
  });
});

describe("grade por cursor", () => {
  it("pagina (created_at, id) nos dois sentidos, por origem e por loja", async () => {
    const minha = await criarLoja();
    const outra = await criarLoja();
    for (let i = 0; i < 27; i += 1) {
      await banco.query(
        `insert into lojas_midias (loja_id, chave_objeto, tipo_arquivo, mime_type, tamanho_bytes, origem, pasta, created_at)
         values ($1, $2, 'imagem', 'image/png', 10, 'upload', 'geral', now() - make_interval(secs => $3))`,
        [minha, `${minha}/upload/${randomUUID()}.png`, i % 3 === 0 ? 5 : i],
      );
    }
    await banco.query(
      `insert into lojas_midias (loja_id, chave_objeto, tipo_arquivo, mime_type, tamanho_bytes, origem)
       values ($1, $2, 'imagem', 'image/png', 10, 'recebida')`,
      [minha, `${minha}/recebida/${randomUUID()}.png`],
    );
    await banco.query(
      `insert into lojas_midias (loja_id, chave_objeto, tipo_arquivo, mime_type, tamanho_bytes, origem, pasta)
       values ($1, $2, 'imagem', 'image/png', 10, 'upload', 'geral')`,
      [outra, `${outra}/upload/${randomUUID()}.png`],
    );

    const escopo = { tipo: "uma" as const, lojaId: minha };
    const base = { origem: "upload" as const, direcao: "proxima" as const, porPagina: 25 as const };
    const p1 = await listarMidias(escopo, base);
    expect(p1.itens).toHaveLength(25);
    expect(p1.cursorAnterior).toBeNull();
    expect(p1.itens.every((m) => m.lojaId === minha && m.origem === "upload")).toBe(true);
    expect(JSON.stringify(p1)).not.toMatch(/chave|url_externa|urlExterna/);

    const p2 = await listarMidias(escopo, { ...base, cursor: p1.cursorProximo! });
    expect(p2.itens).toHaveLength(2);
    expect(p2.cursorProximo).toBeNull();
    const ids = new Set([...p1.itens, ...p2.itens].map((m) => m.id));
    expect(ids.size).toBe(27);

    const volta = await listarMidias(escopo, { ...base, cursor: p2.cursorAnterior!, direcao: "anterior" });
    expect(volta.itens.map((m) => m.id)).toEqual(p1.itens.map((m) => m.id));
    expect(volta.cursorAnterior).toBeNull();

    const recebidas = await listarMidias(escopo, { ...base, origem: "recebida" });
    expect(recebidas.itens).toHaveLength(1);
    expect((await listarMidias({ tipo: "nenhuma" }, base)).itens).toHaveLength(0);
  });
});
