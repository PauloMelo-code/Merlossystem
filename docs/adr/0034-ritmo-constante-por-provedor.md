# ADR 0034 — Ritmo de envio constante por provedor

Data: 16/09/2026
Status: Aceito

## Contexto

`03-arquitetura.md` secao 8.4 fala em "ritmo configuravel por integracao", mas
`lojas_integracoes` nao tem coluna para isso e nenhuma tela o edita. O pacote
M6 usou constante por provedor em `src/lib/campanhas/regras.ts`
(`RITMO_POR_SEGUNDO`).

## Decisao

O ritmo e constante por provedor no R1: 1 mensagem por segundo no uazapi e 10
na API oficial. Nao nasce coluna nem tela.

## Alternativas consideradas

- **Coluna em `lojas_integracoes`**: exige migracao, tela e validacao para um
  valor que ninguem pediu para mudar, e um valor alto derruba o numero da loja.
  Adiada.

## Consequencias

- Mudar o ritmo e mudanca de codigo, revisada e versionada.
- Se a operacao precisar de ritmo por conta, a coluna entra com migracao e
  esta ADR e substituida.
