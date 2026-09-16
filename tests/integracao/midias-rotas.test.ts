import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/lib/auth/guard";

/**
 * Rotas de mídia contra Postgres e MinIO reais (aceite do M3, 05-plano §6).
 *
 * O portão (`exigirSessao`) é substituído por uma sessão montada aqui: a prova
 * do portão é da fundação (tests/seguranca). O que se prova aqui é o que a ROTA
 * faz com a sessão — escopo, allowlist, magic bytes, tetos e a exceção RN-M06.
 */

const atual = vi.hoisted(() => ({ sessao: null as Sessao | null }));

vi.mock("@/lib/auth/guard", async (original) => {
  const real = await original<typeof import("@/lib/auth/guard")>();
  return {
    ...real,
    exigirSessao: async () => {
      if (!atual.sessao) throw new real.ErroNaoAutenticado();
      return atual.sessao;
    },
  };
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { POST } = await import("@/app/api/midias/route");
const { GET, HEAD } = await import("@/app/api/midias/[id]/route");
const { excluirMidia } = await import("@/lib/actions/midias");
const { lerObjeto } = await import("@/lib/armazenamento/midia");
const apoio = await import("./midias-apoio");
const { banco, criarAnexo, criarLoja, criarPessoa, jpeg, linhaDaMidia, parametros, pedidoDeLeitura, pedidoDeUpload, png } =
  apoio;

let lojaA: string;
let lojaB: string;
let vendedoraA: Sessao;
let vendedoraB: Sessao;
let gerente: Sessao;
let viewerA: Sessao;

beforeAll(async () => {
  lojaA = await criarLoja();
  lojaB = await criarLoja();
  vendedoraA = await criarPessoa("vendedor", lojaA);
  vendedoraB = await criarPessoa("vendedor", lojaB);
  viewerA = await criarPessoa("viewer", lojaA);
  gerente = await criarPessoa("gerente", null);
});

beforeEach(() => {
  atual.sessao = vendedoraA;
});

afterAll(async () => {
  await banco.end();
});

async function subir(bytes: Buffer, tipo = "image/png", consulta = "pasta=produtos&nome=foto.png") {
  const r = await POST(pedidoDeUpload(bytes, tipo, consulta));
  return { status: r.status, corpo: (await r.json()) as { id?: string; duplicada?: boolean; codigo?: string } };
}

describe("POST /api/midias", () => {
  it("imagem válida: 201, linha, original e miniatura no bucket", async () => {
    const { status, corpo } = await subir(await png(64, 48));
    expect(status).toBe(201);
    const linha = await linhaDaMidia(corpo.id!);
    expect(linha).toMatchObject({
      loja_id: lojaA,
      origem: "upload",
      pasta: "produtos",
      tipo_arquivo: "imagem",
      mime_type: "image/png",
      largura: 64,
      altura: 48,
      nome_original: "foto.png",
      enviada_por: vendedoraA.usuarioId,
    });
    expect(String(linha!.chave_objeto)).toBe(`${lojaA}/upload/${corpo.id}.png`);
    expect(await lerObjeto(String(linha!.chave_objeto), { soCabecalho: true })).not.toBeNull();
    expect(await lerObjeto(String(linha!.chave_miniatura), { soCabecalho: true })).not.toBeNull();

    const trilha = await banco.query(
      "select acao, ator_tipo from auditoria_eventos where entidade = 'lojas_midias' and entidade_id = $1",
      [corpo.id],
    );
    expect(trilha.rows).toEqual([{ acao: "midia_enviada", ator_tipo: "usuario" }]);
  });

  it("o mesmo arquivo de novo devolve a mídia existente, sem segunda linha", async () => {
    const bytes = await png(10, 10, "#123456");
    const primeira = await subir(bytes);
    const segunda = await subir(bytes);
    expect(segunda.status).toBe(200);
    expect(segunda.corpo).toEqual({ id: primeira.corpo.id, duplicada: true });
  });

  it("imagem de 6 MB: 413 antes de ler", async () => {
    const seis = Buffer.alloc(6 * 1024 * 1024, 0);
    (await png()).copy(seis);
    const { status } = await subir(seis);
    expect(status).toBe(413);
  });

  it(".svg: 415", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await subir(svg, "image/svg+xml")).status).toBe(415);
  });

  it("extensão trocada (declara png, manda jpeg): 415 e nada no banco", async () => {
    const antes = await banco.query("select count(*)::int n from lojas_midias where loja_id = $1", [lojaA]);
    expect((await subir(await jpeg(), "image/png")).status).toBe(415);
    expect((await subir(Buffer.from("<html>oi</html>"), "application/pdf")).status).toBe(415);
    const depois = await banco.query("select count(*)::int n from lojas_midias where loja_id = $1", [lojaA]);
    expect(depois.rows[0].n).toBe(antes.rows[0].n);
  });

  it("pasta inválida: 400; vazio: 400; sem origem: 403", async () => {
    expect((await subir(await png(), "image/png", "pasta=segredos")).status).toBe(400);
    expect((await POST(pedidoDeUpload(Buffer.alloc(0), "image/png"))).status).toBe(400);
    expect((await POST(pedidoDeUpload(await png(), "image/png", "pasta=geral", { origem: null }))).status).toBe(403);
  });

  it("corpo maior que o content-length declarado é recusado", async () => {
    const bytes = await png(30, 30, "#abcdef");
    const r = await POST(pedidoDeUpload(bytes, "image/png", "pasta=geral", { tamanho: bytes.byteLength - 10 }));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it("viewer não envia (403); gestão sem loja recebe FALTA_LOJA; com loja grava nela", async () => {
    atual.sessao = viewerA;
    expect((await subir(await png())).status).toBe(403);

    atual.sessao = gerente;
    const semLoja = await subir(await png(11, 11));
    expect(semLoja.status).toBe(409);
    expect(semLoja.corpo.codigo).toBe("FALTA_LOJA");

    const comLoja = await subir(await png(12, 12), "image/png", `pasta=geral&loja=${lojaB}`);
    expect(comLoja.status).toBe(201);
    expect((await linhaDaMidia(comLoja.corpo.id!))?.loja_id).toBe(lojaB);
  });

  it("vendedora não escolhe loja: o parâmetro é ignorado e grava na dela", async () => {
    const r = await subir(await png(13, 13), "image/png", `pasta=geral&loja=${lojaB}`);
    expect(r.status).toBe(201);
    expect((await linhaDaMidia(r.corpo.id!))?.loja_id).toBe(lojaA);
  });
});

describe("GET /api/midias/[id]", () => {
  let midiaA: string;
  let bytesA: Buffer;

  beforeAll(async () => {
    atual.sessao = vendedoraA;
    bytesA = await png(50, 20, "#00aa00");
    midiaA = (await subir(bytesA)).corpo.id!;
  });

  it("serve o binário com os cabeçalhos da régua", async () => {
    const r = await GET(pedidoDeLeitura(midiaA), parametros(midiaA));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await r.arrayBuffer()).equals(bytesA)).toBe(true);
  });

  it("?miniatura=1 serve a webp; HEAD não traz corpo; Range devolve 206", async () => {
    const mini = await GET(pedidoDeLeitura(midiaA, "?miniatura=1"), parametros(midiaA));
    expect(mini.headers.get("content-type")).toBe("image/webp");
    await mini.arrayBuffer();

    const cabeca = await HEAD(pedidoDeLeitura(midiaA), parametros(midiaA));
    expect(cabeca.status).toBe(200);
    expect(cabeca.body).toBeNull();

    const parte = await GET(pedidoDeLeitura(midiaA, "", { range: "bytes=0-7" }), parametros(midiaA));
    expect(parte.status).toBe(206);
    expect(Buffer.from(await parte.arrayBuffer())).toEqual(bytesA.subarray(0, 8));
  });

  it("mídia de outra loja: 404; gestão (rede) lê", async () => {
    atual.sessao = vendedoraB;
    expect((await GET(pedidoDeLeitura(midiaA), parametros(midiaA))).status).toBe(404);
    atual.sessao = gerente;
    const r = await GET(pedidoDeLeitura(midiaA), parametros(midiaA));
    expect(r.status).toBe(200);
    await r.arrayBuffer();
  });

  it("id que não é uuid e id inexistente: 404; sem sessão: 401", async () => {
    expect((await GET(pedidoDeLeitura("x"), parametros("../../etc"))).status).toBe(404);
    const falso = "00000000-0000-4000-8000-000000000000";
    expect((await GET(pedidoDeLeitura(falso), parametros(falso))).status).toBe(404);
    atual.sessao = null;
    expect((await GET(pedidoDeLeitura(midiaA), parametros(midiaA))).status).toBe(401);
  });

  it("documento sai como attachment", async () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
    const { corpo } = await subir(pdf, "application/pdf", "pasta=geral&nome=nota%20fiscal.pdf");
    const r = await GET(pedidoDeLeitura(corpo.id!), parametros(corpo.id!));
    expect(r.headers.get("content-disposition")).toMatch(/^attachment;.*nota%20fiscal\.pdf/);
    await r.arrayBuffer();
  });
});

describe("exclusão lógica e RN-M06", () => {
  async function excluir(id: string, sessao: Sessao) {
    atual.sessao = sessao;
    const linha = await linhaDaMidia(id);
    return excluirMidia({ id, updated_at: (linha!.updated_at as Date).toISOString(), loja: lojaA });
  }

  it("vendedora não exclui (midia:excluir é gestão)", async () => {
    const { corpo } = await subir(await png(14, 14));
    const r = await excluir(corpo.id!, vendedoraA);
    expect(r).toMatchObject({ ok: false, codigo: "SEM_PERMISSAO" });
  });

  it("excluída NÃO referenciada: 404; excluída REFERENCIADA: 200", async () => {
    const solta = (await subir(await png(15, 15))).corpo.id!;
    const citada = (await subir(await png(16, 16))).corpo.id!;
    await criarAnexo(lojaA, { midiaId: citada });

    expect(await excluir(solta, gerente)).toEqual({ ok: true, dados: null });
    expect(await excluir(citada, gerente)).toEqual({ ok: true, dados: null });
    expect((await linhaDaMidia(solta))?.is_deleted).toBe(true);

    atual.sessao = vendedoraA;
    expect((await GET(pedidoDeLeitura(solta), parametros(solta))).status).toBe(404);
    const r = await GET(pedidoDeLeitura(citada), parametros(citada));
    expect(r.status).toBe(200);
    await r.arrayBuffer();
    // O binário continua lá: a exclusão é da linha, não do arquivo.
    expect(await lerObjeto(String((await linhaDaMidia(solta))!.chave_objeto), { soCabecalho: true })).not.toBeNull();
  });

  it("excluir com updated_at velho é COLISAO", async () => {
    const { corpo } = await subir(await png(17, 17));
    atual.sessao = gerente;
    const r = await excluirMidia({ id: corpo.id, updated_at: "2020-01-01T00:00:00.000Z", loja: lojaA });
    expect(r).toMatchObject({ ok: false, codigo: "COLISAO" });
  });
});
