# Conferência do pacote instalado — Better Auth 1.7.5

Gerado lendo os tipos do pacote **que está no `node_modules`** deste repositório, antes
de escrever `src/lib/auth/auth.ts` (exigência de `02-seguranca.md §4.4`).

| Pacote | Versão instalada | Arquivo lido |
|---|---|---|
| `better-auth` | 1.7.5 | `node_modules/better-auth/dist/**/*.d.mts` |
| `@better-auth/core` | (dependência de 1.7.5) | `node_modules/@better-auth/core/dist/types/init-options.d.mts` |
| `@better-auth/passkey` | 1.7.5 | `node_modules/@better-auth/passkey/dist/index-B7Y0IgKK.d.mts` |
| `@better-auth/drizzle-adapter` | (dependência de 1.7.5) | `node_modules/@better-auth/drizzle-adapter/dist/schema-check-*.mjs` |

`BetterAuthOptions` **não** mora em `better-auth`: é um `type` de `@better-auth/core`
(`dist/types/init-options.d.mts`, 1563 linhas), reexportado por `better-auth/types`. O
`satisfies BetterAuthOptions` da §4.2 continua valendo, com o import vindo de
`better-auth` (que reexporta o tipo).

---

## 1. Opções exigidas por `02-seguranca.md §4.4`

Legenda: **existe** = a opção está no tipo instalado, com a forma que o documento
assume · **existe, forma diferente** = está lá, mas o valor a passar não é o que o
documento escreveu · **não existe** = plano B obrigatório.

| # | Opção | Veredito | Evidência no pacote | Plano B (se aplicável) |
|---|---|---|---|---|
| 1 | `secrets` (plural, versionado) | **existe, forma diferente** | `init-options.d.mts:529` — `secrets?: Array<{ version: number; value: string }>`. O documento e `env.ts` usam a **string** `"v2:…,v1:…"` | Nenhum plano B necessário: `auth.ts` converte a string de `env.BETTER_AUTH_SECRETS` no array pedido (`segredosVersionados()` em `src/lib/auth/auth.ts`). O prefixo `v` é convenção **nossa**, do `env.ts`; o pacote quer só o número |
| 2 | `advanced.ipAddress.trustedProxies` | **existe** | `init-options.d.mts:266` — `trustedProxies?: string[]`, com a doc dizendo "walked right to left, trusted hops are skipped" (mesmo algoritmo de §7.3) | — |
| 3 | `advanced.ipAddress.ipv6Subnet` | **existe** | `init-options.d.mts:253` — `ipv6Subnet?: number`, default 64 | — |
| 4 | `advanced.database.generateId: "uuid"` | **existe** | `init-options.d.mts:374` — `generateId?: GenerateIdFn \| false \| "serial" \| "uuid"`; em Postgres usa `gen_random_uuid()` | — |
| 5 | `backupCodeOptions` (desligar emissão) | **existe** | `two-factor/backup-codes/index.d.mts` — `amount?: number`. O gerador é `Array.from({ length: options?.amount ?? 10 })`, então `amount: 0` produz **lista vazia** | — (ainda assim o teste de efeito de `auth-efeito.test.ts` prova que `/two-factor/enable` não devolve `backupCodes`) |
| 6 | `twoFactorCookieMaxAge` | **existe** | `two-factor/types.d.mts` — `twoFactorCookieMaxAge?: number`, default 600 | — |
| 7 | `trustDeviceMaxAge` | **existe** | `two-factor/types.d.mts` — `trustDeviceMaxAge?: number`, default 2592000 | — |
| 8 | `twoFactor.accountLockout` | **existe** | `two-factor/types.d.mts` — `{ enabled?, maxFailedAttempts?, durationSeconds? }` | — |
| 9 | `passkey.registration.afterVerification` | **existe** | `passkey/dist/index-B7Y0IgKK.d.mts` — `PasskeyRegistrationOptions.afterVerification({ ctx, verification, user, clientData })` | — |
| 10 | `passkey.authentication.afterVerification` | **existe** | mesma fonte — `PasskeyAuthenticationOptions.afterVerification({ ctx, verification, clientData })` | — |
| 11 | `passkey.authenticatorSelection` | **existe** | `authenticatorSelection?: AuthenticatorSelectionCriteria` (tipo do DOM: aceita `userVerification` e `residentKey`) | — |
| 12 | `rateLimit.customStorage` | **existe, exatamente na forma escrita** | `init-options.d.mts:159` — `consume: (key, { window, max }) => Promise<{ allowed: boolean; retryAfter: number \| null }>`. O comentário do pacote diz que `get`/`set` separados **não são mais aceitos**, pelo mesmo motivo que §7.2 dá | — |
| 13 | `verification.storeIdentifier: "hashed"` | **existe** | `init-options.d.mts:1205` — default `"plain"`, confirmando G1 | — |
| 14 | `disabledPaths` | **existe** | `init-options.d.mts:1528` — `disabledPaths?: string[]` | — |
| 15 | `session.disableSessionRefresh` | **existe** | `init-options.d.mts:950` | — |
| 16 | `session.freshAge` | **existe** | `init-options.d.mts:1048` — default **1 dia**, confirmando G11 | — |
| 17 | `session.cookieCache.enabled: false` | **existe** | `init-options.d.mts:981` — default já é `false`; passamos explícito | — |
| 18 | `emailAndPassword.password.{hash,verify}` | **existe** | `init-options.d.mts:750` — `hash?: (password) => Promise<string>`, `verify?: ({ hash, password }) => Promise<boolean>` | — |
| 19 | `emailAndPassword.revokeSessionsOnPasswordReset` | **existe** | `init-options.d.mts:768` — default `false`, confirmando G16 | — |
| 20 | `emailAndPassword.onPasswordReset` | **existe** | `init-options.d.mts:741` — `({ user }, request?)` | — |
| 21 | `emailAndPassword.sendResetPassword` | **existe** | `init-options.d.mts:719` — recebe `{ user, url, token }`; ignoramos a `url` (G15) | — |
| 22 | `user.changeEmail.enabled` / `user.deleteUser.enabled` | **existe** | `init-options.d.mts:863` e `:889` | — |
| 23 | `user.additionalFields` com `input: false` | **existe** | `BetterAuthDBOptions.additionalFields` (`init-options.d.mts:183`), valores `DBFieldAttribute` | — |
| 24 | `hooks.before` + `createAuthMiddleware` | **existe** | `init-options.d.mts:1513` (`before?: AuthMiddleware`); `createAuthMiddleware` exportado de `better-auth/api` | — |
| 25 | `databaseHooks.session.create.{before,after}` | **existe** | `init-options.d.mts:1311` — `before` pode devolver `false` para **recusar** a criação (é o que `podeCriarSessao` usa) | — |
| 26 | `databaseHooks.session.delete.before` | **existe** | `init-options.d.mts:1343` — devolver `false` aborta o delete; por isso o hook é `try/catch` (G25) | — |
| 27 | `nextCookies()` | **existe** | `better-auth/next-js` (`dist/integrations/next-js.d.mts`) | — |
| 28 | `APIError` | **existe** | exportado por `better-auth` e por `better-auth/api` | — |

## 2. Funções internas que o desenho cita

| Citado em | Veredito | Evidência | Plano B |
|---|---|---|---|
| `internalAdapter.deleteUserSessions(userId)` (§10, revogação em massa) | **existe** | `better-auth/dist/db/internal-adapter.mjs:502` | — |
| `internalAdapter.deleteSession(token)` (§4.3, teto de sessões) | **existe, forma diferente** | `internal-adapter.mjs:451` — recebe o **token**, não o `id` | `aposCriarSessao` derruba a mais antiga pelo `token` lido do banco. É o único lugar do sistema que toca o `token`, e ele não sai da função |
| `internalAdapter.listSessions(userId)` | **existe** | `internal-adapter.mjs:177` | — |
| `auth.$context` (acesso ao `internalAdapter`) | **existe** | `better-auth/dist/types/auth.d.mts` | — |
| `getIP(req, options)` do core (§7.3, "importar em vez de reimplementar") | **existe** | `@better-auth/core/dist/utils/ip.d.mts:66` | **Não usado.** A função do core não tem o teto de **1 salto** nem o evento `ip_cadeia_inesperada` que §7.3 exige, e recebe `BetterAuthOptions` inteiro — o que criaria ciclo `ip.ts → auth.ts → ip.ts`. `ipDoCliente()` implementa o mesmo caminhamento (direita → esquerda, descarta confiável, para no primeiro não confiável) com o teto e o evento |
| `auth.api.changePassword` / `signInEmail` / `getSession` | **existe** | `better-auth/dist/api/index.d.mts` (`changePassword`, `signInEmail`, `getSession` exportados) | — |

## 3. ACHADO QUE MUDA O MODELO DE DADOS — `usuarios_totp`

**O que foi encontrado.** O `schema` do plugin `twoFactor` instalado
(`better-auth/dist/plugins/two-factor/schema.mjs`) declara, no modelo `twoFactor`,
**três campos que `01-dados.md §5.5` não previu**:

```js
verified:                { type: "boolean", required: false, defaultValue: true,  input: false },
failedVerificationCount: { type: "number",  required: false, defaultValue: 0,     input: false },
lockedUntil:             { type: "date",    required: false, input: false },
```

**Por que isso derruba o boot.** O verificador de schema do adaptador Drizzle
(`@better-auth/drizzle-adapter/dist/schema-check-*.mjs` → `diffSchema` de
`@better-auth/core/dist/db/schema-diff.mjs:41`) monta o conjunto
`written = { idColumn, ...Object.keys(table.fields) }` e acusa `missing-column` para
**todo** campo declarado — `required: false` **não** o dispensa. E
`advanced.database.validateSchema` é `true` por padrão, com a doc do próprio pacote
dizendo: *"Authentication requests await the same check and fail when the schema does
not match"*. É exatamente a armadilha G27.

`failedVerificationCount` e `lockedUntil` também são as colunas que o
`accountLockout` de §4.2 (`maxFailedAttempts: 5, durationSeconds: 900`) escreve: sem
elas, a opção que o desenho exige não teria onde gravar.

**Caminho seguido** — o que `02-seguranca.md §4.1` manda ("Regra de conflito"):
acrescentar a coluna ao modelo de dados, **nunca** renomear coluna existente nem
inventar um segundo de-para. Portanto:

| Campo do plugin | Coluna acrescentada em `usuarios_totp` | Migração |
|---|---|---|
| `verified` | `verificado boolean NOT NULL DEFAULT true` | `0017_totp_framework` |
| `failedVerificationCount` | `falhas_verificacao integer NOT NULL DEFAULT 0` | `0017_totp_framework` |
| `lockedUntil` | `bloqueado_ate timestamptz(3) NULL` | `0017_totp_framework` |

O de-para entra em `CAMPOS_BA.twoFactor.fields`, que é a fonte única (`01-dados.md
§5.10`), e a trava `tests/integracao/ba-fields.test.ts` continua provando coluna a
coluna. **Pendência para F9: ADR registrando este desvio de `01-dados.md §5.5`.**

## 4. ACHADO MENOR — `CAMPOS_BA` sem os campos dos plugins

`01-dados.md §5.10` publica `twoFactor: { modelName: "usuarios_totp" }` e
`passkey: { modelName: "usuarios_passkeys" }`, **sem** `fields`. `02-seguranca.md §4.1`
corrige isso por escrito ("`CAMPOS_BA` nasce completo … `modelName` sozinho deixa o BA
procurando `userId`, `publicKey`, `credentialID`… e o boot falha") e publica a tabela
de de-para dos plugins.

Confirmado no pacote: `introspectDrizzleSchema` lê cada coluna **pelo nome da
propriedade no objeto Drizzle** (`usuario_id`, `chave_publica`, `credential_id`…), então
sem `fields` o `diffSchema` acusaria 9 colunas faltando em `usuarios_passkeys` e 4 em
`usuarios_totp`. F5 completou `_ba-fields.ts` com exatamente a tabela de §4.1, mais os
três campos da §3 acima.

## 5. O que **não** foi encontrado como problema

- `usuarios_passkeys` cobre 100% do schema do plugin de passkey instalado (`name`,
  `publicKey`, `userId`, `credentialID`, `counter`, `deviceType`, `backedUp`,
  `transports`, `createdAt`, `aaguid`).
- Nenhuma coluna nossa cai em `unexpected-required-column`: toda coluna `NOT NULL` das
  seis tabelas do BA ou é escrita por ele (`nome`, `email`, `token`, `expira_em`,
  `identificador`, `valor`, `conta_id`, `provedor_id`, `secret`, `chave_publica`,
  `credential_id`) ou tem `DEFAULT`.
- A tabela `rateLimit` do BA **não** é criada: com `customStorage` o armazenamento é o
  Redis (`01-dados.md §5.11`), e `getExpectedSchema` só a espera quando
  `rateLimit.storage === "database"`.

## 6. Como reexecutar esta conferência

Ao subir a minor do Better Auth (REQ-M5), reler:

```
node_modules/@better-auth/core/dist/types/init-options.d.mts     # BetterAuthOptions
node_modules/better-auth/dist/plugins/two-factor/types.d.mts     # TwoFactorOptions
node_modules/better-auth/dist/plugins/two-factor/schema.mjs      # colunas exigidas
node_modules/@better-auth/passkey/dist/index-B7Y0IgKK.d.mts      # PasskeyOptions
node_modules/@better-auth/core/dist/db/schema-diff.mjs           # regra do validador
```

e rodar `npm run test:integracao -- auth-config auth-efeito` — os testes de §4.4 são de
**efeito**, não de literal: opção com nome errado passa em comparação de string e é
ignorada em runtime.
