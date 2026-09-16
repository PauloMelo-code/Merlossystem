# ADR 0027 — Reautenticacao carimba a sessao corrente em vez de criar outra

Data: 16/09/2026
Status: Aceito

## Contexto

`02-seguranca.md §10` descreve a reautenticacao assim: cria sessao NOVA
(revogando a atual) e carimba `reautenticada_em = now()`, para `created_at`
voltar a ser recente e o `freshAge` NATIVO do BA concordar com
`exigirSessaoFresca()`.

O efeito exigido e real: o `freshSessionMiddleware` do BA mede frescor por
`session.createdAt` e guarda o cadastro de passkey. Se so o nosso relogio
(`reautenticada_em`) andasse, `exigirSessaoFresca()` diria "fresca" e o BA
responderia 403 — a pessoa ficaria sem saida depois de 15 minutos (G11).

Criar a sessao nova fora do runtime do BA, porem, exigiria forjar o cookie
assinado dentro de uma Server Action, e revogar a atual derrubaria a acao
pendente que o modal de reautenticacao vai refazer.

## Decisao

`carimbarReautenticacao()` (`src/lib/auth/fatores.ts`) faz UM `UPDATE` na
sessao corrente:

```sql
update usuarios_sessoes
set reautenticada_em = now(), created_at = now(), ultimo_uso_em = now()
where id = $sessao
```

`expira_em` NAO e tocado: o teto absoluto de 12 h continua contando do login
original (F2, `disableSessionRefresh: true`).

## Alternativas consideradas

- **Sessao nova via `internalAdapter.createSession` + cookie manual**: forja o
  cookie assinado fora do BA e quebra a cada minor. Rejeitada.
- **So `reautenticada_em`**: o frescor nativo do BA discordaria do nosso.
  Rejeitada.

## Consequencias

- `created_at` de `usuarios_sessoes` deixa de ser "quando a sessao nasceu" e
  passa a ser "ultima prova de identidade". A hora do login fica em
  `auth_eventos` (`sessao_criada`, `login_sucesso`), que e append-only.
- O teto de sessoes simultaneas ordena por `created_at`: a sessao reautenticada
  passa a contar como a mais nova, e a mais antiga de fato cai primeiro.
- Prova: `tests/seguranca/sessoes.test.ts` (T9).
