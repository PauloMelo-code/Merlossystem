# ADR 0025 — Tres colunas do plugin `twoFactor` em `usuarios_totp` (migracao 0017)

Data: 16/09/2026
Status: Aceito

## Contexto

`01-dados.md §5.5` define `usuarios_totp` com `id`, `usuario_id`, `secret`,
`backup_codes`, `ultimo_passo_totp` e `created_at`. O `schema` do plugin
`twoFactor` do Better Auth 1.7.5 instalado declara, no modelo `twoFactor`, tres
campos que o documento nao previa: `verified`, `failedVerificationCount` e
`lockedUntil`.

O verificador de schema do adaptador Drizzle cobra TODO campo declarado,
inclusive os `required: false`, e `validateSchema` vem ligado: sem as colunas,
todo `/api/auth/**` falha (armadilha G27). Alem disso, `failedVerificationCount`
e `lockedUntil` sao onde o `accountLockout` exigido por `02-seguranca.md §4.2`
grava. A evidencia esta em `docs/seguranca/conferencia-ba-1.7.5.md §3`.

## Decisao

Seguir a "Regra de conflito" de `02-seguranca.md §4.1`: ACRESCENTAR colunas,
nunca renomear nem criar um segundo de-para. A migracao
`0017_totp_framework.sql` cria:

| Campo do plugin | Coluna |
|---|---|
| `verified` | `verificado boolean NOT NULL DEFAULT true` |
| `failedVerificationCount` | `falhas_verificacao integer NOT NULL DEFAULT 0` |
| `lockedUntil` | `bloqueado_ate timestamptz(3) NULL` |

O de-para entra em `CAMPOS_BA.twoFactor.fields` (ADR 0026), a fonte unica.

`ultimo_passo_totp` continua sendo coluna NOSSA: o plugin nao a conhece e nao a
escreve. Quem grava e `src/lib/auth/totp-replay.ts`, no funil de criacao de
sessao (`02-seguranca.md §9.1`).

## Consequencias

- `verificado = false` e TOTP em cadastro: nao conta como fator
  (`estadoDosFatores`). A troca de aplicativo passa por esse estado.
- `usuarios_totp` segue `compliance:framework` (ADR 0008): o bloqueio do 2o
  fator e distinto do bloqueio de senha (`usuarios.bloqueado_ate`), e os dois
  convivem.
- A trava `tests/integracao/ba-fields.test.ts` prova coluna a coluna; uma minor
  do BA que acrescente outro campo reprova no CI, nao no boot de producao.
- `01-dados.md §5.5` fica defasado nestes tres nomes ate a proxima revisao do
  documento; este ADR e a referencia ate la.
