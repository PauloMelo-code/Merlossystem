import { describe, expect, it } from "vitest";
import { arquivosDe, lerFonte, linhasCom, semComentarios } from "./_fonte";

/**
 * T13 — escopo de loja (02-seguranca.md §2.4 e §20; INV-01..12).
 *
 * Trava de FONTE. O vazamento de escopo nao aparece em teste feliz: tudo passa
 * enquanto so existe uma loja no banco de desenvolvimento. Ele aparece no dia
 * em que a gerente da loja B abre um pedido da loja A.
 *
 * O que esta trava garante hoje:
 *
 *   1. `condicaoDeLoja` tem UMA implementacao. Duas versoes divergem, e a
 *      segunda e sempre a permissiva.
 *   2. `escopoDeLoja` e `lojaParaGravar` moram so em `src/lib/auth/loja.ts`.
 *   3. O cookie de loja NUNCA e lido fora de `actions/_base.ts` e do layout da
 *      casca: cookie e preferencia de interface, nunca autorizacao.
 *   4. Consulta de modulo de dominio que nao cita escopo REPROVA. O piso e
 *      o valor real da onda 2 e esta escrito — quem entrega modulo SOBE o piso,
 *      como em `block-3s.test.tsx`. Sem isso a trava vira decoracao.
 *   5. Escopo que nao resolve FECHA: `ErroDeEscopo` responde 404, nunca 403.
 */

const FONTES = arquivosDe("src", [".ts", ".tsx"]);

/** Modulos de dominio da onda 2 (05-plano-construcao.md §6). */
const PASTAS_DE_DOMINIO = [
  "src/lib/conversas/",
  "src/lib/contatos/",
  "src/lib/pedidos/",
  "src/lib/catalogo/",
  "src/lib/campanhas/",
  "src/lib/midias/",
  "src/lib/integracoes/",
  "src/lib/lojas/",
  "src/lib/usuarios/",
  "src/lib/alertas/",
  "src/lib/relatorios/",
  "src/lib/conteudo/",
  "src/lib/agendamentos/",
  "src/lib/lgpd/",
];

/**
 * Valor real depois da onda 2 (139 leituras nos modulos de dominio). So DESCE
 * com motivo escrito no commit — uma queda silenciosa e pasta que sumiu da
 * varredura.
 */
const PISO_DE_CONSULTAS_DE_DOMINIO = 139;

const ehDeDominio = (f: string) => PASTAS_DE_DOMINIO.some((p) => f.startsWith(p));

/** `.select(`, `.findMany(`, `.findFirst(` — qualquer leitura de tabela. */
const CONSULTA = /\.(select|findMany|findFirst)\s*\(/;
const CITA_ESCOPO = /condicaoDeLoja|escopo|loja_id|lojaId/;

/** `export function X` e `export const X =` sao a mesma definicao para a regra. */
function defineNoArquivo(arquivo: string, nome: string): boolean {
  const padrao = new RegExp(String.raw`export\s+(async\s+function|function|const)\s+${nome}\b`);
  return padrao.test(lerFonte(arquivo));
}

describe("T13 uma implementacao so de escopo de loja", () => {
  it("varre um repositorio de verdade (piso minimo)", () => {
    expect(FONTES.length).toBeGreaterThanOrEqual(80);
  });

  it("condicaoDeLoja e definida so em src/lib/db/consultas.ts", () => {
    const definem = FONTES.filter((f) => defineNoArquivo(f, "condicaoDeLoja"));
    expect(definem).toEqual(["src/lib/db/consultas.ts"]);
  });

  it("escopoDeLoja e lojaParaGravar sao definidas so em src/lib/auth/loja.ts", () => {
    for (const nome of ["escopoDeLoja", "lojaParaGravar"]) {
      const definem = FONTES.filter((f) => defineNoArquivo(f, nome));
      expect(definem, nome).toEqual(["src/lib/auth/loja.ts"]);
    }
  });
});

describe("T13 o cookie de loja e preferencia, nunca autorizacao", () => {
  /** Quem LE o cookie tem de passar por `resolverLojaPedida` logo depois. */
  const PODEM_LER_O_COOKIE = [
    "src/lib/actions/_base.ts",
    "src/app/(app)/layout.tsx",
    // `escopoDoCookie()`: a porta de página e de Route Handler.
    "src/lib/auth/loja.ts",
  ];

  it("nenhum outro arquivo le o cookie loja_ativa", () => {
    const achados = FONTES.filter((f) => !PODEM_LER_O_COOKIE.includes(f)).filter((f) =>
      /loja_ativa|COOKIE_LOJA/.test(semComentarios(lerFonte(f))),
    );
    // `_acoes.ts` da casca GRAVA o cookie, e gravar tambem exige conferir que a
    // loja existe e esta viva — por isso ele aparece aqui se passar a ler.
    expect(achados.filter((f) => !f.endsWith("_acoes.ts"))).toEqual([]);
  });

  it("quem le o cookie chama resolverLojaPedida no mesmo arquivo", () => {
    for (const f of PODEM_LER_O_COOKIE) {
      expect(lerFonte(f), f).toMatch(/resolverLojaPedida/);
    }
  });
});

describe("T13 consulta de dominio nao existe sem escopo", () => {
  const consultas = FONTES.filter(ehDeDominio).flatMap((f) =>
    linhasCom(semComentarios(lerFonte(f)), CONSULTA).map((l) => ({ arquivo: f, linha: l })),
  );

  it("o piso escrito bate com o que existe hoje", () => {
    // Quem entregar o primeiro modulo de dominio SOBE este piso. Piso parado em
    // zero para sempre e trava que nunca vai reprovar nada.
    expect(consultas.length).toBeGreaterThanOrEqual(PISO_DE_CONSULTAS_DE_DOMINIO);
  });

  it("toda consulta de modulo de dominio cita escopo de loja", () => {
    const semEscopo = FONTES.filter(ehDeDominio)
      .filter((f) => CONSULTA.test(semComentarios(lerFonte(f))))
      .filter((f) => !CITA_ESCOPO.test(semComentarios(lerFonte(f))));
    expect(semEscopo).toEqual([]);
  });
});

describe("T13 escopo que nao resolve FECHA", () => {
  it("ErroDeEscopo responde 404, nunca 403", () => {
    const erros = lerFonte("src/lib/erros.ts");
    const bloco = erros.slice(
      erros.indexOf("export class ErroDeEscopo"),
      erros.indexOf("export class ErroFaltaLoja"),
    );
    expect(bloco).toContain("404");
    expect(bloco).not.toContain("403");
  });

  it("escopo 'nenhuma' aborta a transacao antes de qualquer gravacao", () => {
    const mutacoes = semComentarios(lerFonte("src/lib/db/mutacoes/base.ts"));
    expect(mutacoes).toMatch(/escopo\.tipo === "nenhuma"[\s\S]{0,80}ErroDeEscopo/);
  });
});
