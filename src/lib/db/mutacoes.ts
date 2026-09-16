/**
 * Porta ÚNICA de escrita (03-arquitetura.md §6.4). A implementação mora em
 * `src/lib/db/mutacoes/`; `.insert(` e `.update(` só existem lá (trava
 * `tests/travas/mutacoes.test.ts`). Nenhum DELETE em lugar nenhum.
 * Importe sempre de `@/lib/db/mutacoes`; a pasta NÃO tem `index.ts`.
 */
export * from "./mutacoes/base";
export * from "./mutacoes/canais";
export * from "./mutacoes/pagamentos";
export * from "./mutacoes/pedidos";
export * from "./mutacoes/pos-venda";
export * from "./mutacoes/sistema";
export * from "./mutacoes/transcricao";
