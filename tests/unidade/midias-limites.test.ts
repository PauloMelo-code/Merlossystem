import { describe, expect, it } from "vitest";
import {
  ACEITOS,
  chaveDaMiniatura,
  chaveDoObjeto,
  conferirAssinatura,
  conferirDeclarado,
  detectarMime,
  FORMATOS,
  normalizarMime,
  TETOS,
} from "@/lib/armazenamento/limites";

/** Allowlist, magic bytes, tetos e chave de objeto (02-seguranca.md §15). */

const MB = 1024 * 1024;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0, 0, 0, 0]);
const PDF = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n");
const MP4 = Uint8Array.from([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypisom"), 0, 0, 0, 0]);
const HTML = new TextEncoder().encode("<html><script>x</script></html>");

function recusa(r: ReturnType<typeof conferirDeclarado>) {
  return "status" in r ? r.status : 0;
}

describe("conferirDeclarado: corte antes de ler", () => {
  it("imagem de 6 MB é 413", () => {
    expect(recusa(conferirDeclarado("image/jpeg", 6 * MB))).toBe(413);
  });

  it("imagem de exatamente 5 MB passa; vídeo de 16 MB passa; documento de 100 MB passa", () => {
    expect(recusa(conferirDeclarado("image/png", TETOS.imagem))).toBe(0);
    expect(recusa(conferirDeclarado("video/mp4", 16 * MB))).toBe(0);
    expect(recusa(conferirDeclarado("application/pdf", 100 * MB))).toBe(0);
    expect(recusa(conferirDeclarado("audio/ogg", 16 * MB + 1))).toBe(413);
  });

  it.each(["image/svg+xml", "text/html", "application/x-msdownload", "text/plain", "application/zip", ""])(
    "%s é 415",
    (tipo) => {
      expect(recusa(conferirDeclarado(tipo, 10))).toBe(415);
    },
  );

  it("vazio é 400 e sem content-length é 411", () => {
    expect(recusa(conferirDeclarado("image/png", 0))).toBe(400);
    expect(recusa(conferirDeclarado("image/png", null))).toBe(411);
    expect(recusa(conferirDeclarado("image/png", "abc"))).toBe(411);
  });

  it("ignora parâmetro e caixa do content-type", () => {
    expect(normalizarMime("Image/PNG; charset=binary")).toBe("image/png");
    const r = conferirDeclarado("IMAGE/Png; x=y", 10);
    expect("mime" in r && r.mime).toBe("image/png");
  });

  it("a allowlist não tem SVG, HTML nem executável", () => {
    for (const mime of Object.keys(FORMATOS)) {
      // `openxmlformats` (docx/xlsx) é ZIP conferido por assinatura, não XML servido.
      expect(mime).not.toMatch(/svg|html|\/xml|\+xml|javascript|msdownload|executable|octet-stream/);
    }
    expect(ACEITOS).not.toContain("svg");
  });
});

describe("conferirAssinatura: magic bytes", () => {
  it("png de verdade passa", () => {
    expect(conferirAssinatura(FORMATOS["image/png"]!, PNG)).toBeNull();
  });

  it("extensão trocada (declara png, é jpeg) é 415", () => {
    expect(conferirAssinatura(FORMATOS["image/png"]!, JPG)?.status).toBe(415);
  });

  it("HTML declarado como pdf é 415", () => {
    expect(conferirAssinatura(FORMATOS["application/pdf"]!, HTML)?.status).toBe(415);
  });

  it("pdf e mp4 passam", () => {
    expect(conferirAssinatura(FORMATOS["application/pdf"]!, PDF)).toBeNull();
    expect(conferirAssinatura(FORMATOS["video/mp4"]!, MP4)).toBeNull();
  });
});

describe("detectarMime: mídia do provedor", () => {
  it("descobre pelos bytes e respeita o declarado quando ele confere", () => {
    expect(detectarMime(JPG)).toBe("image/jpeg");
    expect(detectarMime(JPG, "image/png")).toBe("image/jpeg");
    expect(detectarMime(MP4, "audio/mp4")).toBe("audio/mp4");
    expect(detectarMime(MP4)).toBe("video/mp4");
  });

  it("HTML não vira mídia", () => {
    expect(detectarMime(HTML)).toBeNull();
    expect(detectarMime(HTML, "image/png")).toBeNull();
  });
});

describe("chave do objeto", () => {
  it("segue {loja}/{origem}/{uuid}.{ext} com extensão minúscula", () => {
    expect(chaveDoObjeto("L1", "upload", "ABC", "JPG")).toBe("l1/upload/abc.jpg");
  });

  it("sem extensão vira .bin e `..` não escapa", () => {
    expect(chaveDoObjeto("loja", "upload", "id")).toBe("loja/upload/id.bin");
    expect(chaveDoObjeto("../loja", "../../x", "a/../b", "p/../ng")).toBe("loja/x/ab.png");
  });

  it("a miniatura mora ao lado, em webp", () => {
    expect(chaveDaMiniatura("l/upload/abc.png")).toBe("l/upload/abc.min.webp");
  });
});
