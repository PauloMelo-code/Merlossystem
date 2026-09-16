# ADR 0009 — Timestamps timestamptz(3), trava de colisao por updated_at e predicado literal em indice parcial

Data: 16/09/2026
Status: Aceito

## Contexto

Tres defeitos do sistema antigo tinham a mesma raiz: tempo mal tipado e
gravacao sem trava. Mensagem chegando com fuso do servidor, duas atendentes
salvando o mesmo contato e a ultima sobrescrevendo em silencio, e indice unico
parcial que o drizzle-kit gerava quebrado.

## Decisao

1. **timestamptz, precisao 3, `mode: "date"`**, em toda coluna de tempo, pelo
   helper `instante()`. Precisao 3 porque e o que o JavaScript representa: com
   a precisao padrao, o valor lido do banco nao volta igual ao gravado e a
   trava de colisao falha por arredondamento.
2. **Optimistic locking e o PADRAO**, nao a excecao: `atualizarComTrava()`
   compara `updated_at` e zero linhas vira `ErroDeColisao` com quem gravou e
   quando. A lista de excecoes e fechada e esta em `01-dados.md` secao 4.7.
3. **`updated_at` NAO tem `$onUpdate`.** Ele dispara em todo `UPDATE`,
   inclusive no de contador (`nao_lidas`, `ultima_mensagem_em`), e ai o
   `updated_at` que a tela levou envelhece a cada mensagem que chega e toda
   edicao legitima devolve "registro alterado por outro usuario". Quem escreve
   `updated_at` e `atualizarComTrava()` e `inserirAuditado()`.
4. **Indice unico parcial so com template `sql` cru e literais**, nunca `eq()`
   ou `inArray()`. O drizzle-kit gera parametro posicional no SQL da migracao
   quando o predicado vem de helper, e o indice nasce invalido. Trava de CI em
   `tests/travas/migracoes.test.ts`.

## Consequencias

- `atualizarContador()` e `atualizarEstado()` existem justamente para gravar
  sem tocar `updated_at`, e so aceitam pares de uma lista fechada.
- `tests/travas/timestamps.test.ts` reprova `timestamp(` sem `precision: 3` e
  `withTimezone: true`.
