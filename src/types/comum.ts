/**
 * Tipos compartilhados, sem lógica e sem import de runtime.
 *
 * O que NÃO mora aqui: o `Resultado<T>` (é de `src/lib/erros.ts`), `Sessao`,
 * `EscopoLoja` e `Contexto` (são do portão, `src/lib/auth/guard.ts`), e a
 * paginação por cursor (é de `src/lib/validadores/comum.ts`). Tipo com dono
 * declarado fica com o dono — segunda declaração vira segunda verdade.
 */

/**
 * Quem disparou a ação. É o mesmo valor de `Contexto.origem` (01-dados.md
 * §13.1) e o campo fixo `origem` de todo log (03-arquitetura.md §14.3).
 */
export type OrigemDeAcao = "ui" | "webhook" | "worker";
