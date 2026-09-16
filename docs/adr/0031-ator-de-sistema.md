# ADR 0031 — Ator de sistema com linha propria e contexto de gravacao sem sessao

Data: 16/09/2026
Status: Aceito

## Contexto

`03-arquitetura.md` secao 6.4 manda webhook e worker gravarem com
`ctx.autorId = ATOR_SISTEMA`, um uuid fixo com linha em `usuarios` para
satisfazer a FK de `modified_by`. A fundacao nao entregou nem a constante nem a
linha. Na onda 2, cinco pacotes (M1, M3, M4, M5, M6) inventaram o proprio
contexto de sistema com `autorId: null as unknown as string` e
`sessao: undefined as never`: a trilha saia com `ator_id` nulo e o tipo
`Contexto` mentia sobre o que carregava.

Complicacao: o CHECK `usuarios_papel_loja` exige loja para `viewer`, e na
migracao ainda nao existe loja nenhuma.

## Decisao

1. `ATOR_SISTEMA = '00000000-0000-4000-8000-000000000001'` em
   `src/lib/db/schema/_enums/auth.ts`, reexportado por `src/lib/db/sistema.ts`
   e por `src/lib/db/mutacoes.ts`.
2. A migracao 0018 semeia a linha por uma funcao idempotente,
   `semear_ator_sistema()`: nome "Sistema", e-mail
   `sistema@merlostore.invalid` (dominio reservado, RFC 2606), `viewer`, sem
   loja, inativa, sem 2o fator e sem linha em `usuarios_contas`.
3. Dois CHECKs cuidam dela: `usuarios_papel_loja` ganha a excecao "o ator de
   sistema nao tem loja", e `usuarios_ator_sistema_inerte` impede ativa-la,
   trocar o papel ou ligar o 2o fator. Ela nunca vira conta de gente.
4. Tipos novos em `src/lib/db/sistema.ts`:
   - `ContextoDeGravacao = { escopo, autorId, origem }`: o que `mutacoes.ts` e
     o gravador da trilha leem. O `Contexto` do portao ja satisfaz;
   - `ContextoDeSistema`: sem `sessao`, com `sistema: true` e
     `origem: "webhook" | "worker"`. Codigo que exige `ctx.sessao` nao compila
     com ele, e o contexto de sistema nunca passa por `pode()`;
   - `contextoDeSistema({ origem, lojaId? })`: sem loja, o escopo e `todas`
     (diario de ingestao, sincronizacao de rede).
5. `emTransacao` passa a ser generica no contexto: devolve ao callback o mesmo
   tipo que recebeu.
6. A trilha de sistema grava `ator_tipo = 'sistema'` e `ator_id = ATOR_SISTEMA`.
   `consentimentos.registrado_por` continua nulo para sistema: o ator de
   sistema nao registrou consentimento de ninguem.

## Alternativas consideradas

- **Autor nulo** (o que os pacotes fizeram): a FK aceita, mas a trilha perde o
  "quem" e o tipo precisa de cast. Rejeitada.
- **Papel `gerente` sem loja** para nao mexer no CHECK: uma linha de gestao
  inativa e pior do que uma de leitura se um dia for ativada por engano.
  Rejeitada.
- **Linha semeada pelo `seed-dev`**: nao existe em HML/PRD sem passo manual, e a
  primeira mensagem do webhook violaria a FK. Rejeitada.

## Consequencias

- `scripts/verificar-schema.mjs` confere a linha (existe, inerte, sem
  credencial). `tests/integracao/mutacoes-contexto.test.ts` prova os CHECKs e o
  carimbo.
- Telas que listam pessoas (`/usuarios`) devem filtrar `id <> ATOR_SISTEMA`.
- Teste que limpa `usuarios` precisa preservar a linha, ou chamar
  `semear_ator_sistema()` depois.
