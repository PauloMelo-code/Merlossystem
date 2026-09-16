/**
 * PLACEHOLDER DE F4 — só o TIPO, nenhuma função.
 *
 * `src/lib/db/consultas.ts` importa `EscopoLoja` daqui (01-dados.md §3, import
 * de TIPO: não cria ciclo). F5 reescreve este arquivo com `escopoDeLoja()`,
 * `lojaParaGravar()` e `contextoDe()` — mantendo este tipo exatamente como
 * está, que é a forma publicada em 01-dados.md §13.1.
 */
export type EscopoLoja =
  | { tipo: "todas" }
  | { tipo: "uma"; lojaId: string }
  | { tipo: "nenhuma" };
