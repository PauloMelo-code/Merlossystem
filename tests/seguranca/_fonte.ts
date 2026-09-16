import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Apoio das travas de FONTE (02-seguranca.md §20). Elas leem o codigo, nao o
 * runtime: "uma implementacao so" e "nenhum segredo comparado com ===" nao tem
 * como ser provados executando.
 *
 * Nao termina em `.test.ts`, entao o Vitest nao o coleta como suite.
 */

export const RAIZ = fileURLToPath(new URL("../..", import.meta.url)).replace(/[\\/]$/, "");

const IGNORADAS = new Set(["node_modules", ".next", ".git", "dist", "migrations", "drizzle"]);

/** Caminhos relativos a raiz, sempre com barra normal. */
export function arquivosDe(pasta: string, extensoes: string[]): string[] {
  const achados: string[] = [];
  const raiz = join(RAIZ, pasta);

  function descer(atual: string): void {
    for (const nome of readdirSync(atual)) {
      if (IGNORADAS.has(nome)) continue;
      const caminho = join(atual, nome);
      if (statSync(caminho).isDirectory()) descer(caminho);
      else if (extensoes.some((e) => nome.endsWith(e))) {
        achados.push(relative(RAIZ, caminho).split(sep).join("/"));
      }
    }
  }

  descer(raiz);
  return achados.sort();
}

export function lerFonte(relativo: string): string {
  return readFileSync(join(RAIZ, relativo), "utf8");
}

/** Linhas numeradas, para a mensagem de falha dizer ONDE. */
export function linhasCom(conteudo: string, padrao: RegExp): string[] {
  return conteudo
    .split(/\r?\n/)
    .map((linha, i) => ({ linha, n: i + 1 }))
    .filter(({ linha }) => padrao.test(linha))
    .map(({ linha, n }) => `${n}: ${linha.trim()}`);
}

/**
 * Comentario que CITA a regra nao e violacao da regra. Sem isto, a propria
 * explicacao de `env.ts` e de `origem.ts` — que escrevem o padrao proibido
 * para ensinar por que ele e proibido — faria a trava reprovar os arquivos que
 * ela protege.
 */
export function semComentarios(conteudo: string): string {
  return conteudo
    .split(/\r?\n/)
    .filter((linha) => !/^\s*(\/\/|\*|\/\*)/.test(linha))
    .join("\n");
}
