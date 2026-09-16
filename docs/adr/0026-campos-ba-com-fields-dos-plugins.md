# ADR 0026 — `CAMPOS_BA` com `fields` tambem nos modelos dos plugins

Data: 16/09/2026
Status: Aceito

## Contexto

`01-dados.md §5.10` publica o de-para Better Auth -> coluna como fonte unica,
mas para os dois plugins traz so o nome da tabela:

```ts
twoFactor: { modelName: "usuarios_totp" },
passkey:   { modelName: "usuarios_passkeys" },
```

Conferido no pacote instalado: o adaptador Drizzle le cada coluna pelo nome da
propriedade no objeto Drizzle (`usuario_id`, `chave_publica`,
`credential_id`...). Sem `fields`, o BA procura `userId`, `publicKey`,
`credentialID`, e o `diffSchema` acusaria 9 colunas faltando em
`usuarios_passkeys` e 4 em `usuarios_totp` — boot derrubado (G27).
`02-seguranca.md §4.1` ja corrigia isso por escrito.

## Decisao

`src/lib/db/schema/_ba-fields.ts` nasce COMPLETO: `twoFactor` e `passkey`
carregam `modelName` E `fields`, com a tabela de `02-seguranca.md §4.1` mais os
tres campos do ADR 0025.

`src/lib/auth/auth.ts` passa esses objetos aos plugins (`schema.twoFactor`,
`schema.passkey`) sem redigitar nenhum nome de coluna.

## Consequencias

- Continua existindo UM de-para. Schema e `auth.ts` leem a mesma constante.
- `tests/integracao/ba-fields.test.ts` confere todo valor de `CAMPOS_BA`,
  inclusive o dos plugins, contra `getTableColumns()`.
- `tests/seguranca/auth-efeito.test.ts` prova o efeito: `/get-session`
  responde 200, o que so acontece com o schema batendo.
- `01-dados.md §5.10` fica defasado ate a proxima revisao; este ADR e a
  referencia.
