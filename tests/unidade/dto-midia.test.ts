import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { enderecoDaMidia } from "@/lib/conversas/dto";

/**
 * `url_externa` NUNCA entra em DTO de mensagem (01-dados-dominio.md §2.4;
 * 03-arquitetura.md §13.2). A URL do provedor é pública e contornaria o portão
 * de mídia; a leitura é sempre a rota interna, derivada do id.
 *
 * Trava de FONTE sobre o caminho de leitura do atendimento: consultas, DTO,
 * montagem das telas, actions e componentes.
 */

const RAIZ = process.cwd();
const ALVOS = [
  "src/lib/conversas/_consultas.ts",
  "src/lib/conversas/dto.ts",
  "src/lib/conversas/leitura.ts",
  "src/lib/actions/conversas.ts",
];
const ID = "11111111-1111-4111-8111-111111111111";

function arquivosDe(pasta: string): string[] {
  return readdirSync(join(RAIZ, pasta)).flatMap((nome) => {
    const caminho = join(pasta, nome);
    return statSync(join(RAIZ, caminho)).isDirectory() ? arquivosDe(caminho) : [caminho];
  });
}

const codigo = (texto: string) =>
  texto
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

describe("dto-midia", () => {
  it("a rota interna é o único endereço", () => {
    expect(enderecoDaMidia(ID)).toBe(`/api/midias/${ID}`);
    expect(enderecoDaMidia(ID, true)).toBe(`/api/midias/${ID}?miniatura=1`);
    expect(enderecoDaMidia(null)).toBeNull();
  });

  it("nenhum arquivo do caminho de leitura cita url_externa", () => {
    const telas = arquivosDe("src/app/(app)/conversas").filter((f) => /\.tsx?$/.test(f));
    const achados = [...ALVOS, ...telas].filter((f) =>
      /url_externa|urlExterna/.test(codigo(readFileSync(join(RAIZ, f), "utf8"))),
    );
    expect(telas.length).toBeGreaterThanOrEqual(5);
    expect(achados).toEqual([]);
  });

  it("a projeção de mídia do atendimento sai de midia_id, não da coluna de trabalho", () => {
    const consultas = codigo(readFileSync(join(RAIZ, "src/lib/conversas/_consultas.ts"), "utf8"));
    const funcao = consultas.slice(consultas.indexOf("export async function listarMidiasDe"));
    const projecao = funcao.slice(0, funcao.indexOf(".from("));
    expect(projecao).toContain("midiaId: conversas_mensagens_midias.midia_id");
    expect(projecao).not.toContain("url_externa");
  });
});
