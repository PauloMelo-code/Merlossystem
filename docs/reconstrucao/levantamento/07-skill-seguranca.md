# 07 — Régua de CONSTRUÇÃO de segurança de login e conta (skill `audit-auth-security` → MerlostoreChat v2)

Data do levantamento: **15/09/2026** · Autor: subagente de levantamento (read-only) · Alvo: reconstrução do MerlostoreChat
(branch `refactor/reconstrucao-estrutura-base`) em Next.js 16.3 + Better Auth 1.7.x + Drizzle 0.45 + PostgreSQL 16.

> Este arquivo transforma a régua de **auditoria** (catálogo `REQ-A1..M6`) em régua de **construção**. Para cada REQ:
> **o que construir**, **onde** (arquivo/camada), **config exata** do Better Auth quando se aplica (com as armadilhas
> verificadas no pacote publicado) e a **trava** (teste) que impede a regressão. Quem desenha a arquitetura a partir
> daqui não precisa ter lido o código antigo, a skill nem a documentação do Better Auth.

## 0. Como ler

- **IDs estáveis**: `REQ-<letra><n>` iguais aos do catálogo da skill. A auditoria final (`/audit-auth-security`) usa os
  mesmos IDs; o que está aqui é o que ela vai cobrar.
- **Portão de entrega** (bloqueia como 🔴 se ❌ ou sem evidência): A2/A3 · A5 · B1/B9/B10 · C1/C4 ·
  D1/D2/D5/D7/D8/D10 · E1–E4/E8 · F1/F2/F4/F5/F6 · G2/G8 · H1–H3/H5 · I1/I6/I8 · J1/J3/J4 · K1/K3 · L1–L3/L5 · M1/M2.
  Linha do portão só passa como "não" com **exceção escrita: motivo + quem decidiu + até quando** (código e ADR).
- **Tipos de trava**:
  - **[fonte]** teste Vitest que lê arquivos do repositório (regex/AST) e reprova padrão proibido ou ausência de padrão
    obrigatório. Roda sem banco.
  - **[integração]** teste Vitest que sobe o app/handler contra o Postgres de teste (docker, porta 5437, banco `*_test`)
    e Redis (6382) e mede resposta real (status, bytes, `Set-Cookie`, linhas no banco).
  - **[config]** teste que importa o objeto de config do Better Auth / `next.config` e confere valores.
- Caminhos propostos (a confirmar pelo arquiteto) seguem a estrutura da base: `src/lib/auth/*`, `src/lib/seguranca/*`,
  `src/lib/actions/*`, `src/app/api/**`, `tests/seguranca/*`.
- "BA" = Better Auth. `dist/...:N` = arquivo:linha no pacote **publicado** `better-auth@1.7.5` (lido via jsDelivr em
  15/09/2026), salvo quando outro pacote é citado.

## 1. Fontes lidas

| Fonte | O que deu |
| :--- | :--- |
| Skill `audit-auth-security`: `SKILL.md` + `references/` (requirements-catalog, threat-catalog, library-gotchas, standards-and-recency, stack-recon, engagement-safety, report-template) | catálogo A1–M6, ataques, armadilhas, portão |
| `estrutura base/docs/seguranca-login.md` | régua curta da casa + 9 armadilhas de campo + 3 varreduras obrigatórias |
| `MerlostoreChat/docs/integracoes.md`, `docs/adr/0004-fontes-da-verdade.md`, `docs/rbac.md`, `docs/oauth.md`, `docs/api.md`, `docs/deploy-easypanel.md`, `docker-compose.yml` | domínio: lojas, papéis, webhooks, crons, OAuth Bling/TikTok, topologia EasyPanel |
| `MerlostoreChat` @ `5e902d4`: `src/lib/webhook-auth.ts`, `src/lib/api-publica.ts`, lista de `tests/` e rotas públicas | padrões antigos que valem como referência (não como implementação) |
| `HUG/hug-atende`: `src/lib/auth/auth.ts`, `guard.ts`, `permissions.ts`, `src/lib/security/rate-limit.ts`, `secrets.ts`, `src/lib/db/schema/auth.ts`, `schema/audit.ts`, `src/middleware.ts`, `src/app/api/webhook/whatsapp/route.ts` | "padrão da casa" com Better Auth — o que copiar e o que **não** copiar (§3.3) |
| Pacote publicado `better-auth@1.7.5`, `@better-auth/passkey@1.7.5`, `@better-auth/core@1.7.5`, `@better-auth/utils@0.4.2` (dist lido por arquivo) | confirmação das armadilhas na versão-alvo (§2) |
| Docs Better Auth (options, 2fa, passkey, rate-limit, session-management, admin, email-password, security, have-i-been-pwned), release notes v1.7.0–v1.7.5 | nomes e defaults de opção |
| Docs Next.js 16.3.5: `proxy.js`, `serverActions` | proxy não cobre Server Functions fora do matcher; `Origin` ausente passa |
| OSV API (`api.osv.dev`), GitHub Security Advisories, blogs de segurança Next.js (mai/jul/ago 2026) e Better Auth (jun 2026), npm registry | advisories e versões mínimas (§17) |

Não foram lidos: arquivos `.env*` (regra). O documento-fonte `~/Documents/tools/login-e-seguranca-de-conta.md` citado
pela skill **não existe nesta máquina** (limitação: o "porquê" extenso não foi consultado; as `references/` bastam).

---

## 2. Armadilhas CONFIRMADAS no pacote publicado (better-auth 1.7.5)

Cada linha foi lida no `dist` publicado. **Não confie na documentação para estes pontos** — a doc descreve intenção;
o fonte é o que roda. Toda linha vira um teste [config] ou [integração] (coluna "Trava").

| # | Armadilha (default perigoso) | Evidência no fonte | Efeito | Config/controle obrigatório | Trava |
| :-- | :--- | :--- | :--- | :--- | :--- |
| G1 | `verification.storeIdentifier` default **plain** | `dist/db/verification-token-storage.mjs:9` (`if (!option \|\| option === "plain") return identifier`) | token de reset/2FA legível na tabela de verificação | `verification: { storeIdentifier: "hashed" }` | [integração] pedir reset → `SELECT identificador` ≠ token do e-mail |
| G2 | `twoFactor.otpOptions.storeOTP` default **plain**; `period` em **minutos** (default 3) | `dist/plugins/two-factor/otp/index.mjs:35`, `:38` (`(options?.period \|\| 3) * 60 * 1e3`) | OTP em claro; `period: 180` = 3 h | se OTP por e-mail existir: `storeOTP: "hashed"`, `period: 5` (= 5 min). **Proposta: não habilitar OTP por e-mail** (§3.5) | [config] `otpOptions` ausente **ou** `storeOTP==="hashed" && period<=10` |
| G3 | TOTP: 6 dígitos, 30 s; semente cifrada com o segredo do BA | `dist/plugins/two-factor/totp/index.mjs:26-27`, `:122` (`symmetricDecrypt({ key: secretConfig })`) | ok; rotação de `BETTER_AUTH_SECRET` sem `secrets` versionados torna sementes ilegíveis | usar `secrets` versionados (`BETTER_AUTH_SECRETS=v:valor,...`) | [config] `secrets` definido em produção |
| G4 | Códigos de resgate guardados como **JSON em claro** por default; "encrypted" é reversível; verificação faz `codes.includes(code)` após decifrar → **hash impossível** com o plugin | `dist/plugins/two-factor/backup-codes/index.mjs:17-24`, `:30`, `:39` | viola D7/K3 | não usar os códigos do plugin (§3.5): `storeBackupCodes` custom que descarta + remover `backupCodes` da resposta de enable + desligar rotas | [integração] após enable, coluna de backup codes = `[]`; resposta sem `backupCodes` |
| G5 | `/two-factor/enable` exige só **sessão + senha** (sem frescor); `/two-factor/disable` e `/get-totp-uri` e `/generate-backup-codes` vivos por HTTP | `dist/plugins/two-factor/index.mjs:73-76`, `:106-108`, `:192-195`; `totp/index.mjs:90-92`; `backup-codes/index.mjs:250-253` | cookie roubado + senha vazada = desligar/ler/substituir fator (D10/D11) | desligar os 4 caminhos por HTTP (§4 `disabledPaths` + 404 no Route Handler) e expor só via Server Action própria com reautenticação pelo fator atual | [integração] `POST` nos 4 → 404 **sem corpo**, igual a `/api/auth/nao-existe` |
| G6 | Re-enroll de TOTP substituía autenticador ativo + códigos | release v1.7.3 ("Fixed TOTP re-enrollment replacing an active authenticator"); guarda em `two-factor/index.mjs:132` | substituição silenciosa do fator | versão mínima **1.7.3** | [fonte] lockfile `better-auth` ≥ 1.7.3 |
| G7 | "Lembrar dispositivo" **30 dias** (cookie assinado com `userId`) | `two-factor/index.mjs:23` (`trustDeviceMaxAge ?? 2592e3`); `verify-two-factor.mjs:41-56` | pula 2º fator por 30 dias (D15) | **desligado**: `hooks.before` recusa `trustDevice: true` em `/two-factor/verify-*` | [integração] `verify-totp` com `trustDevice:true` → 400; nenhum cookie `trust_device` emitido |
| G8 | 2º fator só intercepta `/sign-in/email`, `/sign-in/username`, `/sign-in/phone-number`; **login por passkey cria sessão direto** | `two-factor/index.mjs:244-246`; `@better-auth/passkey dist/index.mjs:500` | passkey contorna 2FA — só aceitável se UV exigido (D8/D9) | `authentication.afterVerification` que recusa `!authenticationInfo.userVerified` | [integração] asserção WebAuthn com `uv=false` (simulada) → recusa; [fonte] hook presente |
| G9 | Passkey cabeia `requireUserVerification: false` no cadastro e no login; `userVerification: "preferred"` | passkey `dist/index.mjs:179`, `:278`, `:355`, `:483` | "posse do aparelho" sem PIN/biometria | `authenticatorSelection.userVerification: "required"` **e** `registration.afterVerification` + `authentication.afterVerification` exigindo `userVerified` (recebem `verification` em `:369-375`, `:487-491`) | [fonte] os dois hooks existem e leem `userVerified`; [integração] |
| G10 | `rpID` = `options.rpID` ou hostname do `baseURL` | passkey `dist/index.mjs:13-14` | rpID divergente inutiliza todas as chaves | `rpID` e `origin` derivados da **mesma** `APP_URL` que `baseURL`/`trustedOrigins` | [config] `rpID === new URL(env.APP_URL).hostname` |
| G11 | Cadastro de passkey usa `freshSessionMiddleware` (`freshAge`, default **1 dia**) | passkey `dist/index.mjs:88`, `:324`; `api/routes/session.mjs:331-341` | "fresco" = sessão criada há < 24 h | `session.freshAge: 900` (15 min) | [config] `freshAge <= 900` |
| G12 | `sensitiveSessionMiddleware` **não confere frescor** — só lê a sessão do banco (ignora cookie cache) | `api/routes/session.mjs:304-311` | `/change-password`, `/change-email`, `/revoke-session*`, `/two-factor/disable`, `/delete-user` **não** exigem sessão fresca | frescor exigido na nossa Server Action (§4, `exigirSessaoFresca`) | [fonte] toda action sensível chama `exigirSessaoFresca` |
| G13 | `/list-sessions` exige sessão **fresca** e devolve o objeto de sessão (inclui `token`); `/revoke-session` recebe o **token no corpo** | `session.mjs:347-370`, `:377-407` | token sai do servidor (F6); listagem some após `freshAge` | desligar `/list-sessions`, `/revoke-session`, `/revoke-sessions`, `/revoke-other-sessions` por HTTP; listar/encerrar por Server Action com projeção **sem token** e alvo por `id` | [integração] payload RSC da tela de sessões não contém o valor do cookie |
| G14 | `emailAndPassword.autoSignIn` default **true** (cadastro cria sessão) | `api/routes/sign-up.mjs:162-163` | cadastro pula 2FA | `disableSignUp: true` e `autoSignIn: false` | [config] |
| G15 | Reset: `/request-password-reset` monta `.../reset-password/<token>?callbackURL=` e o GET redireciona com `?token=`; o POST **consome o token antes** de `password.hash` | `api/routes/password.mjs:81`, `:92-127`, `:157` (consume) → `:162` (hash) | token em path/query (log, Referer); política dentro do hash queima o link | link próprio `APP_URL/redefinir-senha#t=<token>` montado em `sendResetPassword` (usa `token`, ignora `url`); GET `/reset-password/:token` bloqueado no Route Handler; política em `hooks.before` | [integração] link do e-mail contém `#`; GET `/api/auth/reset-password/x` → 404 sem corpo; senha fraca não consome token |
| G16 | `revokeSessionsOnPasswordReset` default **false**; `onPasswordReset` só roda em `/reset-password` | `password.mjs:170-171`; doc options | reset não expulsa invasor; troca logada perde histórico | `revokeSessionsOnPasswordReset: true`; efeitos comuns em `databaseHooks.account.update` | [integração] sessão B morre após reset |
| G17 | `/verify-email` é **GET** e, com `autoSignInAfterVerification`, **cria sessão no GET** | `api/routes/email-verification.mjs:126`, `:297-300` | scanner de e-mail consome link (F12) | não usar verificação de e-mail do BA (conta nasce por convite próprio, §3.4); desligar `/verify-email` e `/send-verification-email` | [integração] 404 sem corpo |
| G18 | Login: KDF simulado para e-mail inexistente e mensagem única `INVALID_EMAIL_OR_PASSWORD` (401) — **mas** conta banida/inativa responde `BANNED_USER` (hook de sessão) e e-mail não verificado responde 403 próprio, **depois** da senha certa | `api/routes/sign-in.mjs:318-334`, `:336`; `plugins/admin/admin.mjs:33-47` | oráculo "existe + senha certa + desativada" (C4) | normalização de **toda** recusa de `/sign-in/*` no Route Handler (§6) | [integração] matriz byte-a-byte (C4) |
| G19 | `disabledPaths` responde `404` com corpo `"Not Found"`; caminho inexistente responde 404 **sem corpo** | `api/index.mjs:166-168` | oráculo "existe e foi desligado" (L9) | Route Handler devolve `new Response(null,{status:404})` para a lista desligada **antes** de chamar o BA | [integração] `cmp` dos dois corpos |
| G20 | Rate limit default **memória** (`Map`); sem IP resolvido cai num **balde único compartilhado** `no-trusted-ip` | `api/rate-limiter/index.mjs:6`, `:235-240`; storage `database` é ler-e-condicionar (`:79-182`) | teto × instâncias; um atacante tranca o login de todos | `rateLimit.customStorage` (Redis `INCR`+`EXPIRE NX`, fail-open com alerta) + `advanced.ipAddress.trustedProxies` | [config] `customStorage` definido; [integração] XFF forjado não muda o balde |
| G21 | Resolução de IP: sem `trustedProxies`, só aceita `x-forwarded-for` com **um** valor; com `trustedProxies`, percorre da direita e para no 1º IP não confiável; IPv6 agrupado em /64 | `@better-auth/core dist/utils/ip.mjs:170-193`, `:105`, `:196` | proxy que apenda XFF + atacante que manda XFF = IP nulo = balde único | `trustedProxies` com as redes do Traefik/EasyPanel (padrão HUG `auth.ts:166-175`) | [integração] duas requisições com XFF à esquerda diferentes → mesmo IP gravado |
| G22 | KDF default **scrypt N=16384, r=16, p=1** (≈ 32 MiB) com `normalize("NFKC")` | `@better-auth/utils@0.4.2 dist/password.node.mjs:4-7`; `password.mjs:11` | abaixo do piso OWASP de B1 (scrypt N≥2¹⁷/r8/p1 ≈ 128 MiB) | `emailAndPassword.password.hash/verify` com **Argon2id** m=19456 KiB, t=2, p=1 (`@node-rs/argon2`); só KDF ali, nunca política | [config] + [integração] hash gravado começa com `$argon2id$v=19$m=19456,t=2,p=1$` |
| G23 | Plugin `haveIBeenPwned`: **fail-closed** (500 se a API cair), pendurado em `password.hash` e com `/reset-password` na lista (depois do consumo do token); não cobre troca por admin | `dist/plugins/haveibeenpwned/index.mjs:37-41`, `:51-56`, `:70` | cadastro/troca travam quando HIBP cai; link de reset queimado; B3/B9/E9 | **não usar o plugin**; política própria em `hooks.before` com HIBP k-anonimato fail-open | [fonte] `haveIBeenPwned` não importado |
| G24 | Plugin `admin`: `hasPermission` dá **bypass total** a `adminUserIds`; `createUser` sem `headers` pula a checagem; `set-user-password` **não revoga** sessões; `remove-user` **apaga fisicamente**; `impersonate-user` instalado | `plugins/admin/has-permission.mjs:4`; `routes.mjs:153`, `:802-845`, `:753-780`, `:557-596` | escalonamento, abuso interno, delete físico, 15 rotas a mais | **não registrar o plugin admin** (§3.2) | [fonte] `from "better-auth/plugins"` sem `admin` |
| G25 | `databaseHooks.<modelo>.delete.before` pode **cancelar** (retorno `false`) e `delete.after` roda depois da transação | `dist/db/with-hooks.mjs:116-140` e `deleteManyWithHooks` | base para trilha "antes do efeito" nas deleções que o BA faz | trilha de logout/revogação em `session.delete.before` (§3.1) | [integração] revogar sessão gera `auth_eventos` antes do delete |
| G26 | Origem: `originCheckMiddleware` pula GET/HEAD/OPTIONS; em POST **com cookie**, `Origin`/`Referer` ausente ou `"null"` → 403 | `api/middlewares/origin-check.mjs:44`, `:99-111`, `:137` | ok para `/api/auth/*`; **não** cobre Server Actions nem Route Handlers próprios | checagem própria de origem nas actions (J7) | [integração] POST action com `Origin: https://evil.example` → recusa |
| G27 | v1.7.3 liga **validação de schema na inicialização** e rejeita requisições de auth se o schema divergir | release v1.7.3 | renomear tabela/coluna para PT-BR sem mapear `fields` derruba todo `/api/auth/**` | mapear `modelName`/`fields` de cada modelo (§3.1) | [integração] fumaça `GET /api/auth/get-session` = 200 após migrar |
| G28 | `nextCookies()` precisa ser o **último** plugin | library-gotchas (Next) | Server Action não grava cookie | ordem de `plugins` | [config] último plugin tem `id === "next-cookies"` |

Next.js 16.3 (doc oficial 16.3.5):
- **N1** Server Functions não são rotas na cadeia do proxy: são POST para a rota onde são usadas; matcher que exclui a
  rota **também exclui a action**. "Always verify authentication and authorization inside each Server Function" (doc
  `proxy.js`, seção *Execution order*). → A5/A3.
- **N2** `experimental.serverActions.allowedOrigins`: "A request that carries no `Origin` header at all is allowed
  through with a warning rather than rejected." → J7 exige checagem própria.
- **N3** `bodySizeLimit` default 1 MB em Server Actions; Route Handlers **não** têm teto → I11.
- **N4** Proxy roda em Node por padrão (v16); `runtime` não é configurável no proxy.
- **N5** CVE-2026-64643 (jul/2026): IDs de Server Function podem ser divulgados → trate todo `'use server'` como
  endpoint público conhecido.

---

## 3. Decisões de arquitetura propostas (viram ADR antes do código)

### 3.1 ADR — Tabelas do Better Auth em PT-BR, auditoria e delete físico (armadilha conhecida nº 2)

**Problema.** O BA apaga fisicamente sessões (logout, revogação, expiração, reset), verificações (consumo de token,
limpeza) e usuários (`/delete-user`, `admin/remove-user`). A regra da casa proíbe delete físico e exige 5 colunas de
auditoria. Não há opção no BA para soft delete de sessão sem `secondaryStorage`. O truque de cancelar o delete em
`delete.before` (G25) e expirar a linha à mão depende de detalhe interno — **descartado** por fragilidade entre versões.

**Decisão proposta.**

| Modelo BA | Tabela (PT-BR, hierárquica) | Delete físico? | Auditoria |
| :--- | :--- | :--- | :--- |
| `user` | `usuarios` | **Nunca.** `/delete-user` desligado, plugin admin não registrado. Desativar = `ativo=false` + revogar sessões; excluir = soft delete por action própria | 5 colunas + `modified_by` |
| `session` | `usuarios_sessoes` | **Sim, pela biblioteca** — exceção escrita no ADR | espelho append-only em `auth_eventos` (`sessao_criada`, `sessao_encerrada` + motivo) via `databaseHooks.session.create.after` e `session.delete.before` |
| `account` | `usuarios_contas` | Não ocorre no fluxo usado (sem login social) | eventos de troca de senha em `auth_eventos` |
| `verification` | `usuarios_verificacoes` | **Sim, pela biblioteca** (o consumo atômico do token é o controle de E2/D5) | **não** espelhar valor (segredo); evento do fluxo sem token em `auth_eventos` |
| `twoFactor` | `usuarios_totp` | Só em `/two-factor/disable` (desligado por HTTP) | `fator_*` em `auth_eventos` |
| `passkey` | `usuarios_passkeys` | `delete-passkey` só via action que mantém o piso D1 | `passkey_removida` antes do delete |

- Mapear cada modelo com `modelName` + `fields` (ex.: `session: { modelName: "usuarios_sessoes", fields: { userId: "usuario_id", expiresAt: "expira_em", ipAddress: "ip", userAgent: "agente" } }`). A v1.7.3 valida o schema no boot (G27) → trava de fumaça.
- Colunas da casa podem existir **a mais** nas tabelas do BA (default no banco). Em `usuarios_sessoes` e `usuarios_verificacoes` elas não têm semântica (a linha some): o ADR declara as duas como **efêmeras de framework**, fora da regra de soft delete. O `scripts/check-compliance.mjs` hoje só isenta tabela marcada `APPEND_ONLY` perto do `pgTable` (linhas ~211-213): **falta definir o marcador de "tabela de framework"**.
- **Exceção (M6)**: motivo = limitação do Better Auth 1.7.x; quem decidiu = Paulo (a confirmar); até quando = revisão a cada minor do BA.
- Timestamps: **`timestamp({ precision: 3, withTimezone: true })`** em **todas** as tabelas (armadilha nº 1 + K5): milissegundo casa com `Date` do JS no optimistic locking; `timestamptz` tira o fuso da conexão da comparação de expiração.

### 3.2 ADR — Sem plugin `admin` do Better Auth

Motivos verificados (G24): bypass por `adminUserIds`; `createUser` sem checagem quando chamado sem `headers`;
`set-user-password` sem revogação; `remove-user` com delete físico; impersonação instalada; 15 rotas a mais. Papel, loja
e ativo são colunas **nossas** em `usuarios`, em `user.additionalFields` com `input: false` (o corpo de `/update-user`
não as aceita):

```ts
user: {
  modelName: "usuarios",
  additionalFields: {
    papel:              { type: "string",  input: false, required: true, defaultValue: "viewer" }, // menor privilégio
    lojaId:             { type: "string",  input: false, required: false, fieldName: "loja_id" },
    ativo:              { type: "boolean", input: false, required: true, defaultValue: false },
    precisaTrocarSenha: { type: "boolean", input: false, defaultValue: false, fieldName: "precisa_trocar_senha" },
    precisaConfigurarFator: { type: "boolean", input: false, defaultValue: true, fieldName: "precisa_configurar_fator" },
    falhasLogin:        { type: "number",  input: false, defaultValue: 0, fieldName: "falhas_login" },
    bloqueadoAte:       { type: "date",    input: false, required: false, fieldName: "bloqueado_ate" },
  },
},
```

Revogar sessões de outro usuário (desativação, troca de papel, reset iniciado por admin) usa
`(await auth.$context).internalAdapter.deleteUserSessions(userId)` em `src/lib/auth/sessoes.ts` (confirmar a API na
versão instalada). O delete fica na biblioteca (ADR 3.1), sem `db.delete` no nosso código.
`CHECK` do banco (de `integracoes.md`): `(papel IN ('admin','gerente') AND loja_id IS NULL) OR (papel IN ('vendedor','viewer') AND loja_id IS NOT NULL)`.

### 3.3 O que copiar e o que NÃO copiar do HUG Atende

| Peça do HUG | Veredito | Por quê |
| :--- | :--- | :--- |
| `src/lib/auth/auth.ts:80` `disableSignUp: true` | copiar | C8 |
| `auth.ts:166-175` `advanced.ipAddress.trustedProxies` (faixas do Docker/Traefik) | copiar, ajustando às redes do EasyPanel **medidas** | G21/C6 |
| `src/lib/security/rate-limit.ts:85-89` Redis `MULTI INCR + EXPIRE NX`, fail-open com log | copiar como `rateLimit.customStorage` e limitador geral | C2 |
| `src/app/api/webhook/whatsapp/route.ts:55-85` `readBodyCapped` | copiar para `src/lib/seguranca/corpo.ts` | B8/I11 |
| `auth.ts:97-104` sessão 7 d + `updateAge` + `cookieCache` 5 min | **não copiar** | F2 (renovação infinita), H6 (papel com atraso), histórico CVE-2026-67337 (bypass de 2FA via cookie cache) |
| `auth.ts:127-147` `rateLimit` em memória | **não copiar** | G20 |
| `src/middleware.ts:14-21` `getSessionCookie` "protegendo" rota | **não copiar como controle** (só UX) | A5 |
| `src/lib/auth/guard.ts:97-101` papel desconhecido vira `"atendente"` | **não copiar** | H5: papel desconhecido = nenhuma permissão |
| `rate-limit.ts:138-145` `clientIp` próprio (último XFF) | **não copiar** como 2ª implementação | C6 |
| `src/lib/security/secrets.ts:30-38` chave derivada do `BETTER_AUTH_SECRET` | **não copiar** | K2 (usar `INTEGRATIONS_KEY` dedicada, já decidido em `integracoes.md`) |
| `webhook/whatsapp/route.ts:175-178` 401 com `reason` no corpo | **não copiar** | I3 |
| `src/lib/db/schema/audit.ts` `audit_log` append-only sem FK | copiar o conceito (`auth_eventos`, `auditoria_eventos`) | L1 |

Do MerlostoreChat antigo (`5e902d4`): copiar o **padrão** de `src/lib/webhook-auth.ts` (segredo ausente = 403,
`timingSafeEqual`), de `src/lib/api-publica.ts` (lista explícita de rotas sem sessão + teste que falha se mudar) e de
`tests/escopo-loja.test.ts` (fatiar por handler + piso de handlers encontrados, `docs/rbac.md` §"Por que o teste e por
HANDLER"). **Não** copiar `?segredo=` do uazapi (I15) nem o segredo compartilhado do webhook de pagamento (I8).

### 3.4 ADR — Provisionamento por convite (sem auto-cadastro, sem verificação de e-mail do BA)

1. Admin cria convite em `usuarios_convites` (`token_hash` SHA-256 de 32 bytes CSPRNG, `expira_em` 24 h, `usado_em`, `papel`, `loja_id`, 5 colunas). Convite com papel `admin` exige a ciência de H2.
2. E-mail com `APP_URL/convite#t=<token>` (fragmento: F12/E2). A página não consome; o **POST** da action consome atomicamente: `UPDATE usuarios_convites SET usado_em=now() WHERE token_hash=$1 AND usado_em IS NULL AND expira_em>now() RETURNING *`.
3. Na mesma transação: cria `usuarios` (`ativo=false`, `emailVerified=true`, posse provada pelo link) e a senha via `auth.api` server-side; a política de senha (B*) roda antes do consumo.
4. Sessão **provisória** (`precisa_configurar_fator=true`): o guard só libera `/primeiro-acesso/*` e as actions dessa pasta (gate igual a E11).
5. Passkey com UV **ou** TOTP verificado → `ativo=true`, `twoFactorEnabled=true`, `precisa_configurar_fator=false`, revoga a sessão provisória e exige login novo (F4).

Consequência: `/sign-up/email`, `/verify-email`, `/send-verification-email`, `/change-email` desligados. C10/C11 viram
⚪ "não se aplica" com esta decisão escrita.

### 3.5 ADR — Fatores oferecidos

- **Passkey** (resistente a phishing, D2), `userVerification: "required"` + hooks de UV (G9). **Obrigatória para `admin`** (H7).
- **TOTP** como alternativa (celular de loja sem biometria).
- **Sem OTP por e-mail/SMS** (D3/D4). Se o cliente exigir, reabrir o ADR com `storeOTP: "hashed"`, `period: 5` (minutos!), `allowedAttempts: 5` e o texto "transição" na tela.
- **Sem códigos de resgate do plugin** (G4). Perda de fator = recuperação assistida (E7). Futuro: tabela própria com hash Argon2id por código.
- **Sem "lembrar dispositivo"** (G7).

### 3.6 ADR — Borda e sessão

- `proxy.ts` só faz UX (redirecionar sem cookie) e cabeçalhos; **nunca** decide acesso (A5, N1).
- Sessão: teto absoluto **12 h** (`expiresIn: 43200`, `disableSessionRefresh: true`), inatividade **60 min** pelo guard (F3), `cookieCache` desligado, `freshAge: 900`.
- `baseURL`, `trustedOrigins`, `rpID`, links de e-mail e checagem de origem das actions saem de **uma** env `APP_URL` validada no boot.

---

## 4. Configuração de referência do Better Auth 1.7.5 (`src/lib/auth/auth.ts`)

Esqueleto para o arquiteto. Nome de opção conferido na doc de opções e no fonte; o que está marcado `CONFERIR` precisa
ser lido no pacote instalado antes de fechar.

```ts
import { betterAuth, APIError } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";              // mesmo número de versão do core
import { nextCookies } from "better-auth/next-js";
import { createAuthMiddleware } from "better-auth/api";      // CONFERIR subpath na 1.7.5
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { env } from "@/lib/env";                             // K1: zod, sem fallback
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema/auth";
import { armazenamentoLimiteRedis } from "@/lib/seguranca/limite";
import { PROXIES_CONFIAVEIS } from "@/lib/seguranca/ip";
import { politicaDeSenha } from "@/lib/auth/politica-senha";
import { registrarEventoAuth } from "@/lib/auth/trilha";
import { enfileirarEmailSeguranca } from "@/lib/auth/emails";

const ARGON2 = { algorithm: 2 /* Argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const auth = betterAuth({
  appName: "MerloStore Chat",
  baseURL: env.APP_URL,
  secrets: env.BETTER_AUTH_SECRETS,                          // versionados (G3); nunca derivar outra chave dele
  trustedOrigins: [env.APP_URL],                             // J1/J2: nada de "*"
  database: drizzleAdapter(db, { provider: "pg", schema }),

  user: { modelName: "usuarios", fields: { /* PT-BR */ }, additionalFields: { /* §3.2 */ },
          changeEmail: { enabled: false }, deleteUser: { enabled: false } },
  session: {
    modelName: "usuarios_sessoes", fields: { /* PT-BR */ },
    expiresIn: 60 * 60 * 12,        // F2: teto absoluto 12 h
    disableSessionRefresh: true,    // único teto absoluto real (library-gotchas)
    freshAge: 60 * 15,              // G11/F9
    cookieCache: { enabled: false },// H6 + CVE-2026-67337
    additionalFields: { ultimoUsoEm: { type: "date", input: false, fieldName: "ultimo_uso_em" } }, // F3
  },
  account: { modelName: "usuarios_contas", accountLinking: { enabled: false }, fields: { /* PT-BR */ } },
  verification: { modelName: "usuarios_verificacoes", storeIdentifier: "hashed", fields: { /* PT-BR */ } }, // G1

  emailAndPassword: {
    enabled: true,
    disableSignUp: true,                     // C8
    autoSignIn: false,                       // G14
    requireEmailVerification: false,         // conta nasce verificada pelo convite (§3.4)
    minPasswordLength: 15,                   // B2 (fator único na hora da senha); a política real está em hooks.before
    maxPasswordLength: 128,                  // B2 ≥ 64
    revokeSessionsOnPasswordReset: true,     // G16/E3
    resetPasswordTokenExpiresIn: 60 * 30,    // E2: 30 min
    password: {                              // G22: só KDF aqui, NUNCA política (roda no login)
      hash: (senha) => argon2Hash(senha, ARGON2),
      verify: ({ hash, password }) => argon2Verify(hash, password),
    },
    sendResetPassword: async ({ user, token }) => {
      // G15: ignora `url` (token em path/query). Link em FRAGMENTO. Fora do caminho da resposta (E1/C7).
      void enfileirarEmailSeguranca("reset", user.id, `${env.APP_URL}/redefinir-senha#t=${token}`);
    },
    onPasswordReset: async ({ user }) => { /* E3/E5: zera falhas_login, bloqueado_ate, precisa_trocar_senha; trilha; aviso D12 */ },
  },

  rateLimit: {
    enabled: true,                            // em dev também (o default desliga em dev)
    customStorage: armazenamentoLimiteRedis,  // G20/C2: INCR+EXPIRE NX, fail-open + alerta
    window: 60, max: 300,                     // balde geral por IP (não apertar: NAT da loja)
    customRules: {
      "/sign-in/email": { window: 60, max: 20 },          // 2ª linha; a 1ª é o bloqueio por conta (C1)
      "/sign-in/passkey": { window: 60, max: 20 },
      "/request-password-reset": { window: 600, max: 5 },
      "/reset-password": { window: 600, max: 10 },
      "/two-factor/*": { window: 60, max: 10 },
      "/passkey/*": { window: 60, max: 30 },
    },
  },

  advanced: {
    useSecureCookies: env.NODE_ENV === "production",  // F1: __Secure-
    cookiePrefix: "merlo",
    ipAddress: { trustedProxies: PROXIES_CONFIAVEIS, ipv6Subnet: 64 },  // G21 (mesma constante do ip.ts)
    database: { generateId: "uuid" },                 // CONFERIR: FK uuid nas tabelas de domínio
    // NUNCA: disableCSRFCheck, disableOriginCheck
  },

  disabledPaths: [ /* §5.1 — e o Route Handler devolve 404 sem corpo (G19) */ ],

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // B9/E9: política só em caminhos que GRAVAM e ANTES do consumo do token
      if (ctx.path === "/reset-password" || ctx.path === "/change-password") {
        await politicaDeSenha(ctx.body?.newPassword, { usuarioId: ctx.context.session?.user.id });
      }
      // G7/D15: sem "lembrar dispositivo"
      if (ctx.path.startsWith("/two-factor/verify") && ctx.body?.trustDevice) {
        throw new APIError("BAD_REQUEST", { message: "Operação não permitida." });
      }
    }),
  },

  databaseHooks: {
    session: {
      create: {
        before: async (sessao) => { /* D9/C3/H6: recusa se usuario inativo/is_deleted/bloqueado (todo caminho: senha, 2FA, passkey) */ },
        after: async (sessao, ctx) => { await registrarEventoAuth("sessao_criada", sessao, ctx); }, // L2 funil único
      },
      delete: { before: async (sessao, ctx) => { await registrarEventoAuth("sessao_encerrada", sessao, ctx); } }, // G25
    },
    account: {
      update: { before: async (conta, ctx) => { /* troca de senha pelo /change-password: histórico B7, trilha, aviso D12 (G16) */ } },
    },
  },

  plugins: [
    twoFactor({
      issuer: "MerloStore Chat",
      skipVerificationOnEnable: false,
      totpOptions: { digits: 6, period: 30 },
      // otpOptions ausente: sem OTP por e-mail (§3.5). Se reabrir: { storeOTP: "hashed", period: 5, allowedAttempts: 5 }
      backupCodeOptions: { storeBackupCodes: { encrypt: async () => "[]", decrypt: async () => "[]" } }, // G4: descarta (CONFERIR resposta de enable)
      accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 900 }, // D5 (default 10/900 em verify-two-factor.mjs:118-122)
      schema: { twoFactor: { modelName: "usuarios_totp" } },
    }),
    passkey({
      rpID: new URL(env.APP_URL).hostname,   // G10
      rpName: "MerloStore Chat",
      origin: env.APP_URL,
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      registration: {
        requireSession: true,                // freshSessionMiddleware (G11)
        afterVerification: async ({ verification }) => {
          if (!verification.registrationInfo?.userVerified) throw new APIError("FORBIDDEN", { message: "Verificação do usuário obrigatória." });
        },
      },
      authentication: {
        afterVerification: async ({ verification }) => {   // G8/G9: passkey pula o 2FA, então UV é obrigatório
          if (!verification.authenticationInfo?.userVerified) throw new APIError("UNAUTHORIZED", { message: "Não foi possível entrar." });
        },
      },
      schema: { passkey: { modelName: "usuarios_passkeys" } },   // CONFERIR chave de schema do plugin
    }),
    nextCookies(),                           // G28: SEMPRE o último
  ],
});
```

Travas da config (todas [config], arquivo `tests/seguranca/auth-config.test.ts`, importando `auth.options`):
`disableSignUp===true`, `autoSignIn===false`, `revokeSessionsOnPasswordReset===true`, `storeIdentifier==="hashed"`,
`disableSessionRefresh===true`, `expiresIn<=86400`, `freshAge<=900`, `cookieCache?.enabled!==true`,
`rateLimit.customStorage` definido, `trustedOrigins` sem `*`, `advanced.disableCSRFCheck/disableOriginCheck` ausentes,
nenhum plugin com `id` em `["admin","have-i-been-pwned","email-otp","magic-link","api-key","organization","oidc","mcp","sso","anonymous","multi-session"]`,
último plugin `next-cookies`, `passkey` com `userVerification==="required"` e os dois `afterVerification` definidos,
`twoFactor` sem `otpOptions.sendOTP` (ou com `storeOTP==="hashed"` e `period<=10`).

---

## 5. Mapa de arquivos e camadas (onde cada controle mora)

| Camada | Arquivo proposto | Responsabilidade | REQs |
| :--- | :--- | :--- | :--- |
| Boot | `src/lib/env.ts` | zod de todas as envs; `throw` se faltar; sem `\|\|` literal | K1, K2, M3 |
| Auth | `src/lib/auth/auth.ts` | instância BA (§4) | B*, C*, D*, E*, F* |
| Auth | `src/app/api/auth/[...all]/route.ts` | **único** Route Handler do BA: teto de corpo, 404 sem corpo para caminhos desligados, normalização de recusa e piso de tempo do login, bloqueio por conta | A2, B8, C1, C3, C4, E1, L9 |
| Auth | `src/lib/auth/guard.ts` | `exigirSessao()`, `exigirSessaoFresca()`, `exigirPermissao()`, gates (`precisa_trocar_senha`, `precisa_configurar_fator`), inatividade | A3, A5, E11, F3, F9, H5, H6 |
| Auth | `src/lib/auth/permissoes.ts` | matriz papel × recurso × ação, fail-closed | H5, H1 |
| Auth | `src/lib/auth/loja.ts` | escopo de loja pelo servidor (`escopoDaLoja`, `lojaParaGravar`) | H10, H12 |
| Auth | `src/lib/auth/bloqueio.ts` | contador por conta atômico | C1, C3, C7, C9, H9 |
| Auth | `src/lib/auth/politica-senha.ts` (+ espelho de mensagens para a tela) | comprimento, teto bruto, HIBP fail-open, contextuais, sequências, histórico | B2–B9 |
| Auth | `src/lib/auth/trilha.ts` | `registrarEventoAuth()` com teto de espera, nunca lança | L1–L5 |
| Auth | `src/lib/auth/sessoes.ts` | listar sem token, encerrar por id, revogar todas de um usuário | F5–F7 |
| Auth | `src/lib/auth/emails.ts` | e-mails de segurança via fila BullMQ, remetente dedicado, retorno conferido | C7, D12, D13, D16, E1 |
| Actions | `src/lib/actions/seguranca.ts` (`'use server'`) | tela Meu perfil › Segurança: trocar senha, passkey, TOTP, sessões — **sem `userId`** | G1–G8 |
| Actions | `src/lib/actions/usuarios.ts` (`'use server'`) | convite, papel, desativar, iniciar reset, destravar, trocar e-mail (admin) | E7, E8, E12, H1–H4, H9 |
| Máquina | `src/lib/seguranca/maquina.ts` | wrapper de rota M2M (ordem I2), recusa única | I2–I5, I12, I15 |
| Máquina | `src/lib/seguranca/assinaturas.ts` | HMAC Meta/TikTok/pagamento, segredo uazapi, `iguaisEmTempoConstante` | I8, I6 |
| Borda | `src/lib/seguranca/ip.ts` | `ipDoCliente()` + `PROXIES_CONFIAVEIS` | C6, L4 |
| Borda | `src/lib/seguranca/origem.ts` | `origemEsperada()` de `env.APP_URL`; `conferirOrigem(headers)` | J1, J3, J7 |
| Borda | `src/lib/seguranca/limite.ts` | Redis `INCR+EXPIRE NX`, fail-open com alerta; `customStorage` do BA | C2, A6, I4 |
| Borda | `src/lib/seguranca/corpo.ts` | `lerCorpoComTeto()` | B8, I11 |
| Borda | `next.config.ts` (`headers()`) + `proxy.ts` | HSTS, CSP, frame-ancestors etc.; proxy só UX | J4–J6, A5 |
| Banco | `src/lib/db/schema/auth.ts`, `auth-eventos.ts`, `usuarios-convites.ts` | tabelas §3.1; `auth_eventos` append-only | K3, K5, K6, L1 |
| Banco | migration SQL | `REVOKE UPDATE, DELETE ON auth_eventos, auditoria_eventos FROM app`; trigger que lança em UPDATE/DELETE; `CHECK` de papel/loja; índices | L1, H1, H10, K6 |
| Testes | `tests/seguranca/*.test.ts` | travas (§16) | M1 |

### 5.1 Caminhos do BA: em uso × desligados

Inventário das rotas instaladas pelo core + `twoFactor` + `passkey` na 1.7.5 (lidas nos arquivos citados em §2). Tudo
que não está em "em uso" entra em `disabledPaths` **e** na lista `CAMINHOS_DESLIGADOS` do Route Handler, que responde
`new Response(null, { status: 404 })` antes de chamar o BA (G19). Caminho com parâmetro (`/reset-password/:token`,
`/delete-user/callback`) é bloqueado por regex no Route Handler (o `disabledPaths` compara igualdade exata).

| Em uso por HTTP (chamador no app) | Desligado por HTTP (404 sem corpo) |
| :--- | :--- |
| `POST /sign-in/email` · `POST /sign-out` · `GET /get-session` | `/sign-up/email` · `/verify-email` · `/send-verification-email` · `/change-email` · `/update-user` · `/delete-user` · `/delete-user/callback` · `/set-password` (serverOnly) |
| `POST /request-password-reset` · `POST /reset-password` (token no corpo) | `GET /reset-password/:token` · `/verify-password` · `/change-password` (a troca vai por Server Action que chama `auth.api.changePassword` com frescor) |
| `POST /two-factor/verify-totp` | `/two-factor/enable` · `/two-factor/disable` · `/two-factor/get-totp-uri` · `/two-factor/generate-backup-codes` · `/two-factor/verify-backup-code` · `/two-factor/send-otp` · `/two-factor/verify-otp` |
| `POST /passkey/generate-authenticate-options` · `POST /passkey/verify-authentication` · `POST /sign-in/passkey` (CONFERIR nome na 1.7.5) | `/passkey/generate-register-options` e `/passkey/verify-registration` só se o cadastro for 100% server action; senão **em uso** com `freshSessionMiddleware` · `/passkey/list-user-passkeys` · `/passkey/delete-passkey` · `/passkey/update-passkey` (via actions) |
| — | `/list-sessions` · `/revoke-session` · `/revoke-sessions` · `/revoke-other-sessions` (G13) · `/link-social` · `/unlink-account` · `/list-accounts` · `/refresh-token` · `/get-access-token` · `/account-info` · `/error` (página de erro do BA) |

Server-side, as actions chamam `auth.api.*` (o `disabledPaths` é aplicado só no roteador HTTP, `dist/api/index.mjs:166`).
A lista **real** sai do pacote instalado: a trava `tests/seguranca/caminhos-ba.test.ts` [fonte] percorre
`node_modules/better-auth/dist/**/*.mjs` e `node_modules/@better-auth/passkey/dist/*.mjs` buscando
`createAuthEndpoint("/...")`, subtrai `createAuthEndpoint.serverOnly` e reprova qualquer caminho que não esteja em
`EM_USO` nem em `CAMINHOS_DESLIGADOS` (rota nova numa atualização do BA quebra o teste — A2).

### 5.2 Route Handler do BA (`src/app/api/auth/[...all]/route.ts`) — ordem

1. Caminho em `CAMINHOS_DESLIGADOS` ou regex de parâmetro → `404` corpo nulo + evento `sonda_caminho_desligado` (L9, L7).
2. `content-length` > 16 KB → 413; leitura com `lerCorpoComTeto(16 KB)` (B8).
3. Se `/sign-in/email`: normaliza e-mail (`trim().toLowerCase()` **só no e-mail**, nunca na senha); `bloqueio.estaBloqueada(email)` → se sim, não chama o BA, espera o piso e devolve a recusa única (C3/C4).
4. Chama `auth.handler(new Request(url, { method, headers, body }))`.
5. Se `/sign-in/email` e status ≠ 200: `bloqueio.registrarFalha(email)` (atômico) só quando a causa é credencial (401 `INVALID_EMAIL_OR_PASSWORD`); **qualquer** não-200 (401, 403 `BANNED_USER`, 429) vira o mesmo corpo `{"code":"CREDENCIAIS_INVALIDAS","message":"E-mail ou senha inválidos."}` com status 401 e piso de tempo (≥ p95 do Argon2id medido, ex.: 450 ms + jitter 0–50 ms). Status 200 → `bloqueio.zerar(email)`; se `twoFactorRedirect` → evento `senha_aceita_aguardando_2fa` (L7).
6. Idem para `/sign-in/passkey` e `/two-factor/verify-totp`: recusa única por rota.
7. `/request-password-reset`: sempre `200 {"status":true}` idêntico, com piso de tempo (E1).
8. Respostas: `Cache-Control: no-store`; em `/sign-out` acrescentar `Clear-Site-Data: "cache", "cookies", "storage"` (F13).

---

## 6. Domínio A — Inventário e isonomia de caminhos

| REQ | O que construir | Onde | Config BA / armadilha | Trava |
| :--- | :--- | :--- | :--- | :--- |
| **A1** 🟠 | `docs/seguranca/caminhos-de-acesso.md` com **todos** os caminhos que criam sessão ou concedem acesso: senha(+TOTP), passkey, convite (sessão provisória), reset (não cria sessão), webhooks Meta/Instagram/Facebook, TikTok Shop, uazapi, pagamento, crons, callbacks OAuth Bling/TikTok, Server Actions, `/api/auth/*`. Cada linha: portão, limitador, trilha | doc + `src/lib/seguranca/rotas-publicas.ts` (manifesto) | — | [fonte] `tests/seguranca/inventario.test.ts`: `find src/app -name route.ts` + todo arquivo `'use server'` ⊆ (manifesto público ∪ rotas que chamam o guard); todo item do manifesto aparece no doc |
| **A2** 🔴 | Desligar no servidor todo caminho instalado sem chamador (§5.1), 404 **sem corpo** | Route Handler do BA + `disabledPaths` | G5, G13, G17, G19, G24; CVE-2025-71399 (barra dupla furava `disabledPaths` < 1.4.5 — manter normalização do Route Handler também) | [fonte] `caminhos-ba.test.ts` (varre o pacote instalado); [integração] `POST /api/auth/two-factor/disable` e `//two-factor/disable` com sessão válida → corpo e status idênticos a `/api/auth/nao-existe` (`cmp`) |
| **A3** 🔴 | Todo Route Handler de escrita e todo export de módulo `'use server'` começa por guarda (`exigirSessao`/`exigirPermissao`/`rotaDeMaquina`/`rotaPublica`) | todos os handlers/actions | N1, N5 | [fonte] `tests/seguranca/guarda.test.ts` (varredura por **identidade de função**: resolve o import do guard, não o nome; fatia por `export async function` e por `export const x = async` — arrow anônima conta; exige piso mínimo de handlers encontrados para não passar vazio) |
| **A4** 🟠 | Canal de máquina separado: `rotaDeMaquina()` nunca aceita cookie de sessão; `exigirSessao()` nunca aceita `Authorization`/segredo. Códigos distintos: humano sem sessão `401 NAO_AUTENTICADO`, máquina `401 NAO_AUTORIZADO` | `maquina.ts`, `guard.ts` | — | [integração] cookie válido no webhook → 401 máquina; `Authorization: Bearer $CRON_SECRET` numa action → 401 humano |
| **A5** 🔴 | Página (`page.tsx`/`layout.tsx` servidor), Route Handler e action conferem sessão por conta própria; `proxy.ts` só redireciona por UX | `guard.ts` chamado em `src/app/(app)/layout.tsx` **e** em cada `page.tsx` sensível **e** em cada action | N1 (matcher que exclui rota exclui a action), CVE-2025-29927, CVE-2026-45109/44575 (segment-prefetch), CVE-2026-64642 (Turbopack + locale único) | [fonte] `proxy.ts` não importa `auth`/`db` nem decide 401/403; [integração] `x-middleware-subrequest: middleware:middleware:middleware`, `Next-Router-Prefetch: 1`, `?_rsc=1` sem cookie em `/configuracoes` → não renderiza dado |
| **A6** 🟠 | Área pública = `/login`, `/convite`, `/redefinir-senha`, webhooks, callbacks OAuth, `/api/auth/*`. Primeira instrução de toda escrita pública: limitador por IP. Tokens efêmeros hasheados e em `#` | páginas públicas + `limite.ts` | — | [fonte] actions de `src/app/(publico)/**` começam por `limitarPorIp(`; [fonte] nenhum link de e-mail usa `?token=`/`?t=` |
| **A7** 🔴 se aplicável | **Não se aplica**: sem login social/OIDC/SAML (ADR 3.4, `account.accountLinking.enabled:false`). OAuth de Bling/TikTok é o sistema como **cliente de API**, não login → regras em I14/I8 | — | CVE-2026-53516 (auto-link) irrelevante com linking desligado | [config] nenhum `socialProviders`; `accountLinking.enabled===false` |
| **A8** 🔴 se aplicável | **Não se aplica**: sem GraphQL/tRPC/gRPC. Server Actions são N endpoints POST (cobertos por A3) | — | — | [fonte] sem dependência `graphql`/`@trpc/*` no `package.json` |

## 7. Domínio B — Senha

| REQ | O que construir | Onde | Config BA / armadilha | Trava |
| :--- | :--- | :--- | :--- | :--- |
| **B1** 🔴 | Argon2id m=19456 KiB, t=2, p=1 via `@node-rs/argon2` | `auth.ts` `emailAndPassword.password` | G22 (scrypt default N=2¹⁴/r=16 ≈ 32 MiB fica abaixo do piso); `password.hash/verify` rodam **no login** (library-gotchas) → só KDF ali | [config]; [integração] após criar conta: `SELECT password FROM usuarios_contas` casa `^\$argon2id\$v=19\$m=19456,t=2,p=1\$` |
| **B2** 🟠 | Mínimo **15** (a senha é fator único no momento da checagem de senha; o 2º fator não reduz o risco de spray), máximo **128** (≥ 64) | `politica-senha.ts` + `minPasswordLength:15`, `maxPasswordLength:128` | BA confere `min/max` antes do consumo (`password.mjs:152-153`) mas `set-password` admin só por length (G24 — plugin não usado) | [integração] 14 chars recusado em convite, reset e troca |
| **B3** 🟠 | HIBP Pwned Passwords por k-anonimato (prefixo SHA-1 de 5, `Add-Padding: true`), timeout 1,5 s, **fail-open** com evento `hibp_indisponivel` (CRITICAL deduplicado) + lista local ≥ top-3000 com entradas ≥ 15 chars e variantes contextuais (`merlostore`, `merlo`, `centro`, `cerroazul`) | `politica-senha.ts` | **não** usar plugin `haveIBeenPwned` (G23: fail-closed, pendurado no hash) | [integração] com HIBP simulado fora do ar a troca **passa** e há evento; `Password123456!` recusada (mock do range) |
| **B4** 🟡 | Sem regra de composição; sem expiração periódica; troca forçada só por suspeita (`precisa_trocar_senha`) | `politica-senha.ts` | — | [fonte] nenhuma regex de classe (`[A-Z]`, `\d`, `[^a-zA-Z0-9]`) usada como bloqueio em `politica-senha.ts`; nenhum cron de expiração |
| **B5** 🟡 | `<input type="password" autocomplete="current-password\|new-password">` com botão mostrar; sem `onPaste` bloqueando; sem `maxLength` < 128; senha nunca `trim()`/`toLowerCase()` | componente `CampoSenha` + `politica-senha.ts` | BA normaliza NFKC só no scrypt (G22) — com Argon2id próprio **não** normalizar | [fonte] sem `onPaste` com `preventDefault` e sem `.trim()`/`.toLowerCase()` em variável de senha nos componentes/actions de auth |
| **B6** 🟡 | Reprovação determinística de termos contextuais (nome, e-mail, loja, marca) e sequências (alfabeto, teclado, repetição de período não-divisível); **módulo único** servidor+tela, mensagens com os mesmos N motivos | `politica-senha.ts` (puro, sem I/O) importado pelo componente | — | [fonte/unit] vetores `Abcdefghij12345!`, `abcabcabcab`, `qwertyuiop12345` reprovados; teste de paridade: a tela lista exatamente os códigos que o servidor devolve |
| **B7** 🟡 | Histórico das 5 últimas (hash Argon2id) em `usuarios_senhas_historico` (append-only); leitura **fail-closed** | `politica-senha.ts` + `databaseHooks.account.update.before` | `onPasswordReset` não roda no `/change-password` (G16) | [integração] trocar para a 3ª anterior → recusada; mock de erro na leitura → troca recusada |
| **B8** 🟠 | Teto bruto (`senha.length > 1024` ou corpo > 16 KB) **antes** de normalizar/avaliar/hashear | Route Handler do BA (§5.2 passo 2) + 1ª linha de `politicaDeSenha` e das actions | Server Actions já têm 1 MB (N3) — insuficiente | [integração] POST login com senha de 1 MB → 413 em < 20 ms (mediana de 10) |
| **B9** 🔴 | Lista branca explícita: política roda em convite, `/reset-password`, troca de senha (action), senha temporária — e em **nenhum** caminho que só confere (`/sign-in/email`, reautenticação, verify-password) | `hooks.before` (`auth.ts`) + actions | **nunca** em `password.hash` (G22/G23); reset consome o token antes do hash (G15) | [fonte] `CAMINHOS_QUE_GRAVAM_SENHA` constante única; `politicaDeSenha` não é chamada em `password.hash`; [integração] senha fraca no login devolve a recusa única (não mensagem de política) |
| **B10** 🔴 | Troca exige senha atual: action chama `auth.api.changePassword({ body: { currentPassword, newPassword, revokeOtherSessions: true }, headers })` | `actions/seguranca.ts` | `/change-password` usa `sensitiveSessionMiddleware` sem frescor (G12) → `exigirSessaoFresca()` antes | [integração] sem `currentPassword` → 400; com atual errada → recusa + conta para o bloqueio (C1) |

## 8. Domínio C — Login, anti-automação e oráculos

| REQ | O que construir | Onde | Config BA / armadilha | Trava |
| :--- | :--- | :--- | :--- | :--- |
| **C1** 🔴 | Bloqueio por **conta**: 5 falhas em 15 min → `bloqueado_ate = now() + 15 min`; **uma** operação SQL: `UPDATE usuarios SET falhas_login = CASE WHEN ultima_falha_em < now() - interval '15 min' THEN 1 ELSE falhas_login + 1 END, ultima_falha_em = now(), bloqueado_ate = CASE WHEN (...) >= 5 THEN now() + interval '15 min' ELSE bloqueado_ate END WHERE lower(email) = $1 AND is_deleted = false RETURNING bloqueado_ate`. E-mail inexistente: nenhuma escrita (C5) | `src/lib/auth/bloqueio.ts`, chamado pelo Route Handler (§5.2) | **o plugin `twoFactor` NÃO conta falha de senha** (seu `accountLockout` é só do 2º fator — `verify-two-factor.mjs:118-122`); rate limit do BA é por IP | [integração] `tests/seguranca/bloqueio-conta.test.ts`: 8 tentativas **paralelas** erradas → `falhas_login = 8`, conta bloqueada; 7ª resposta byte-igual à 1ª; [fonte] `bloqueio.ts` não tem `select` seguido de `update` da mesma coluna |
| **C2** 🟠 | Limitador com Redis compartilhado (`INCR` + `EXPIRE NX` num `MULTI`), **fail-open** + evento CRITICAL deduplicado quando o Redis cai | `limite.ts`, plugado em `rateLimit.customStorage` e nos limitadores próprios | G20 (memória default; `database` é ler-e-condicionar) | [integração] Redis parado (container `merlostore_redis` pausado no teste) → login **passa** (não 500) e existe evento `limitador_indisponivel` |
| **C3** 🟠 | Conta bloqueada/desativada recusada **antes do KDF** e sem contar nova falha: Route Handler lê `bloqueado_ate > now()` e `ativo`/`is_deleted` antes de chamar o BA; desativada que acerta a senha também cai na recusa única | Route Handler + `databaseHooks.session.create.before` (rede de segurança para passkey/2FA) | G18 (hook de sessão do BA responde depois da senha) | [integração] conta bloqueada: mediana de 10 respostas ≈ piso (sem Argon2id medido por span/log), `falhas_login` inalterado |
| **C4** 🔴 | Recusa única byte-a-byte: status 401, `{"code":"CREDENCIAIS_INVALIDAS","message":"E-mail ou senha inválidos."}` (ordem fixa de chaves), sem `Set-Cookie`, mesmos cabeçalhos; piso de tempo; KDF para e-mail inexistente (BA já faz: `sign-in.mjs:318`, `:325`) | Route Handler §5.2 passo 5 | G18: `BANNED_USER`, `EMAIL_NOT_VERIFIED`, 429 do limitador geram corpos diferentes → normalizar | [integração] `tests/seguranca/recusa-unica.test.ts`: inexistente / senha errada / desativada / bloqueada / limitada (429) / com `precisa_trocar_senha` → `cmp` dos corpos e dos cabeçalhos relevantes + p50/p95 de 10 amostras dentro de ±50 ms |
| **C5** 🟠 | Nenhuma escrita disparada por requisição anônima sem teto: `registrarFalha` só atualiza linha **existente**; eventos de falha anônima vão para `auth_eventos` só após passar o limitador por IP | `bloqueio.ts`, `trilha.ts` | — | [fonte] Route Handler chama o limitador antes de `registrarEventoAuth` em caminho anônimo |
| **C6** 🟠 | **Uma** função `ipDoCliente(headers)` com `PROXIES_CONFIAVEIS` (mesma constante do `advanced.ipAddress.trustedProxies`); algoritmo idêntico ao do BA (direita→esquerda, pula proxies confiáveis, IPv6 /64). Medir no EasyPanel se o Traefik apenda ou sobrescreve XFF e registrar no ADR | `src/lib/seguranca/ip.ts` | G21. Se o pacote instalado exportar a função do core (`@better-auth/core` `utils/ip`), importar em vez de reimplementar (CONFERIR exports) | [fonte] `grep -rn "x-forwarded-for" src` só em `ip.ts`; [unit] vetores de paridade com o algoritmo do BA; [integração/homolog] XFF forjado à esquerda grava o IP real em `usuarios_sessoes.ip` e em `auth_eventos.ip` |
| **C7** 🟡 | Aviso de bloqueio à vítima por e-mail, dedupe 24 h (chave Redis `aviso-bloqueio:<usuarioId>`), enfileirado com `void` fora da resposta | `bloqueio.ts` → `emails.ts` (BullMQ) | — | [fonte] nenhum `await enfileirarEmailSeguranca` dentro do Route Handler; [integração] 2 bloqueios em 24 h → 1 job |
| **C8** 🔴 | Sem auto-cadastro (`disableSignUp`), sem conta padrão, seed **nunca** no entrypoint e sem senha literal; primeiro admin por comando CLI interativo que gera convite (H8) | `auth.ts`, `scripts/primeiro-admin.ts`, `Dockerfile` | G14 | [config]; [fonte] `Dockerfile`/`docker-entrypoint*`/`package.json scripts.start` não chamam seed; `grep` de senha literal em `scripts/`, `README`, `CLAUDE.md`, `docs/`; [integração] `POST /api/auth/sign-up/email` → 404 sem corpo |
| **C9** 🟡 | Login por passkey **não** consulta `bloqueado_ate` e **zera** `falhas_login` (`databaseHooks.session.create.after` quando o caminho é passkey) | `auth.ts` hooks + `bloqueio.ts` | G8 (passkey cria sessão direto) | [integração] conta bloqueada entra por passkey e `falhas_login=0` após |
| **C10** 🔴 se aplicável | **⚪ Não se aplica** por decisão (ADR 3.4): sem auto-cadastro, sem login social, conta nasce verificada pelo convite. Manter `accountLinking.enabled:false` | — | CVE-2026-53516 e GHSA-qq9h-g4jm-xgf3 (pré-sequestro) exigem auto-cadastro + social/magic-link/email-OTP — todos ausentes | [config] sem `socialProviders`, sem plugins `magic-link`/`email-otp` |
| **C11** 🟠 | Convite **nunca sobrescreve** identidade existente: se o e-mail já existe em `usuarios` (ativo ou não), a conclusão não faz `UPDATE` de nome/e-mail/papel; resposta idêntica casada/não-casada, devolvendo o **digitado**; token não sobrevive a rollback (consumo e criação na mesma transação) | `actions/convites.ts` | — | [integração] convite para e-mail já existente → mesma resposta e nenhuma coluna alterada; erro forçado após consumo → token volta a `usado_em IS NULL` (transação) |

## 9. Domínio D — Segundo fator e fatores fortes

| REQ | O que construir | Onde | Config BA / armadilha | Trava |
| :--- | :--- | :--- | :--- | :--- |
| **D1** 🔴 | 2º passo obrigatório ligado no provisionamento (ADR 3.4): conta só vira `ativo=true` com passkey UV **ou** TOTP verificado; gate `precisa_configurar_fator` no guard; sem "lembrar dispositivo" | `actions/convites.ts`, `guard.ts` | G7, G8 | [integração/SQL] `SELECT count(*) FROM usuarios u WHERE u.ativo AND NOT u.is_deleted AND NOT u.two_factor_enabled AND NOT EXISTS (SELECT 1 FROM usuarios_passkeys p WHERE p.usuario_id=u.id)` = 0 — roda também como verificação de fumaça pós-deploy (M4) |
| **D2** 🟠 | Passkey funcionando em produção; `rpID` = hostname de `APP_URL`; admins com ≥ 1 chave | `auth.ts` passkey | G10 | [config] rpID; [fumaça] `POST /api/auth/passkey/generate-authenticate-options` ≠ 404 em produção; [SQL] todo `papel='admin'` ativo tem passkey |
| **D3** 🟡 | ⚪ enquanto não houver OTP por e-mail (ADR 3.5). Se reabrir: texto "código por e-mail é transição" na tela e no ADR, sem chamar de "MFA" | — | G2 | [fonte] `twoFactor` sem `otpOptions.sendOTP` |
| **D4** 🟠 | Sem SMS/telefone como fator ou recuperação (sem plugin `phone-number`) | — | — | [fonte] `grep -ri "twilio\|sms\|phoneNumber("` em `src/lib/auth` vazio |
| **D5** 🔴 | Se OTP existir: `storeOTP:"hashed"`, `period` ≤ 10 (**minutos**), `allowedAttempts` 5, comparação constante (BA já usa `constantTimeEqual`, `otp/index.mjs:222`), código fora de log. Para TOTP (em uso): `accountLockout` 5/900 s + rate limit `/two-factor/*` | `auth.ts` twoFactor | G2 (plain + minutos) | [config]; [fonte] nenhum `logger`/`console` recebe `code`/`otp`/`totp` em `src/lib/auth/**` |
| **D6** 🟠 | Semente TOTP cifrada (BA faz com `secrets`, G3); período 30 s; anti-replay: gravar `ultimo_passo_totp` e recusar o mesmo passo (CONFERIR se a 1.7.5 já faz; se não, `hooks.before` em `/two-factor/verify-totp` com Redis `SET NX` de `totp:<usuario>:<passo>` por 90 s) | `auth.ts` hooks | G3 | [integração] mesmo código TOTP duas vezes em 30 s → 2ª recusada; `SELECT secret FROM usuarios_totp` não casa base32 `^[A-Z2-7]+=*$` |
| **D7** 🔴 | ⚪ por decisão (ADR 3.5): sem códigos de resgate. Garantir que o plugin não os persiste nem devolve: `storeBackupCodes` que descarta + `hooks.after` em `/two-factor/enable` removendo `backupCodes` + rotas desligadas | `auth.ts` | G4 | [integração] enable via action → `SELECT backup_codes FROM usuarios_totp` = `[]` e payload sem `backupCodes`; `POST /two-factor/verify-backup-code` → 404 sem corpo |
| **D8** 🔴 | Passkey exige `userVerified` no cadastro e no login (hooks) e cadastro com sessão fresca (`freshAge` 900) | `auth.ts` passkey | G9, G11 | [fonte] `tests/seguranca/passkey-uv.test.ts` lê `auth.ts` e exige `registrationInfo?.userVerified` e `authenticationInfo?.userVerified`; [unit] hook com `userVerified:false` lança |
| **D9** 🔴 | Passkey contorna 2FA só porque D8 vale; desativada/`is_deleted` recusada também por passkey (`databaseHooks.session.create.before`) | `auth.ts` | G8 | [integração] usuário `ativo=false` com passkey → sem sessão, recusa única |
| **D10** 🔴 | Não há "desligar 2FA", "ler semente" nem "regenerar códigos" por HTTP (404 sem corpo). Remover um fator = action `substituirFator` que exige reautenticação com um fator **existente** feita há ≤ 5 min, cadastra o novo, remove o antigo (rotação) e nunca deixa a conta com zero fatores | Route Handler (§5.1) + `actions/seguranca.ts` | G5 | [integração] os 3 caminhos → `cmp` com inexistente; action remove único fator → recusa; [fonte] nenhum chamador de `disableTwoFactor`/`getTOTPURI`/`generateBackupCodes` em `src/` |
| **D11** 🟠 | Adicionar/substituir fator exige o fator atual (conta com TOTP/passkey) ou, só no primeiro acesso, senha + sessão provisória fresca | `actions/seguranca.ts` (chama `auth.api.enableTwoFactor` server-side após a prova) | G5 (`/two-factor/enable` só pede senha, sem frescor); G6 (≥1.7.3) | [integração] conta com passkey tentando cadastrar TOTP só com senha → recusa |
| **D12** 🟠 | E-mail ao dono em: senha trocada/resetada, fator adicionado/removido, passkey adicionada/removida, e-mail trocado (ao antigo), recuperação assistida concluída. Texto: o que mudou, quando, IP aproximado, e "não foi você? fale com <contato admin> e peça bloqueio" | `emails.ts` + chamadas nas actions/hooks | G16 (reset × troca por caminhos diferentes) | [fonte] cada action de credencial chama `avisarDono(`; [integração] job enfileirado com tipo esperado |
| **D13** 🟠 | Falha de envio (retorno `{success:false}` **ou** exceção) → evento CRITICAL `email_seguranca_falhou` + alerta; resposta HTTP segue genérica | worker BullMQ de e-mail | library-gotchas: `sendEmail` que **retorna** erro em vez de lançar | [unit] mock do provedor devolvendo `{success:false}` gera evento |
| **D14** 🟠 | Tela de login: com passkey disponível, botão "Entrar com chave de acesso" primário; senha+TOTP em "outras opções" | `src/app/(publico)/login/` | — | [fonte/e2e leve] componente renderiza passkey como ação primária |
| **D15** 🟠 | "Lembrar dispositivo" **desligado** (decisão escrita) | `hooks.before` | G7 (30 dias default) | [integração] `trustDevice:true` → 400; nenhum `Set-Cookie` com `trust_device` |
| **D16** 🟡 | Domínio remetente dos e-mails de segurança (`seguranca@<dominio>`) com SPF, DKIM, DMARC `p=quarantine`/`reject` alinhados; remetente separado de campanhas/broadcast | infra DNS + `emails.ts` | — | [fumaça] `dig +short TXT _dmarc.<dominio>` no checklist de deploy; [fonte] `FROM_SEGURANCA` ≠ `FROM_MARKETING` |
| **D17** 🟠 | ⚪ para OTP/push (não usados). Desafio 2FA vinculado ao login: cookie `two_factor` assinado de 10 min criado no `/sign-in/email` (`two-factor/index.mjs:290-304`) — reduzir `twoFactorCookieMaxAge` para 300 | `auth.ts` | — | [config] `twoFactorCookieMaxAge <= 300` |
| **D18** 🟠 | Cooldown por conta-alvo em `/request-password-reset` (1 envio por 60 s por e-mail, Redis `SET NX EX 60`), resposta idêntica; reenvio invalida o anterior (apagar verificação `reset-password:*` do usuário antes de criar a nova — CONFERIR se o BA já faz); sem CAPTCHA (sistema interno, sem cadastro público — decisão escrita) | Route Handler / `hooks.before` | — | [integração] 5 pedidos em 10 s → 5 respostas iguais, 1 job de e-mail; login da vítima segue funcionando |

## 10. Domínio E — Recuperação de conta e troca de senha

| REQ | O que construir | Onde | Config BA / armadilha | Trava |
| :--- | :--- | :--- | :--- | :--- |
| **E1** 🔴 | `/request-password-reset` sempre `200 {"status":true}` com piso de tempo; envio por fila (`void`) | Route Handler §5.2 passo 7 + `sendResetPassword` | BA simula busca para inexistente (`password.mjs:62-66`) mas o envio síncrono vira oráculo de tempo | [integração] inexistente × existente × desativado: `cmp` corpo + p50 ±50 ms |
| **E2** 🔴 | Token ≥ 128 bits (BA gera), `storeIdentifier:"hashed"`, uso único atômico (BA `consumeVerificationValue`, `password.mjs:157`), TTL 30 min, link em **fragmento** e POST com token no corpo | `auth.ts` + página `/redefinir-senha` (lê `location.hash`, limpa com `history.replaceState`, POST) | G1, G15 | [integração] `SELECT identificador FROM usuarios_verificacoes` ≠ token; dois POST simultâneos com o mesmo token → exatamente um 200; link do e-mail sem `?token` |
| **E3** 🔴 | Reset revoga **todas** as sessões, zera `falhas_login`/`bloqueado_ate`, **não** cria sessão | `revokeSessionsOnPasswordReset:true` + `onPasswordReset` | G16; o `/reset-password` da 1.7.5 não cria sessão (`password.mjs:129-171`) — travar para a próxima versão | [integração] resposta sem `Set-Cookie`; sessão B anterior → 401; conta bloqueada destrava |
| **E4** 🔴 | Reset não contorna 2º fator: após reset, login normal com senha + TOTP/passkey | idem | `autoSignIn:false` (G14) | [integração] mesmo teste de E3 + login seguinte recebe `twoFactorRedirect` |
| **E5** 🟡 | Reset e troca saem do mesmo estado: `precisa_trocar_senha=false`, histórico, trilha, aviso — em função única `aposSenhaGravada(usuarioId, meio)` chamada por `onPasswordReset` e `databaseHooks.account.update.before` | `src/lib/auth/senha-gravada.ts` | G16 | [fonte] as duas pontas chamam a mesma função |
| **E6** 🔴 | Sem pergunta secreta, dica ou KBA | — | — | [fonte] `grep -ri "pergunta_secreta\|security_question\|dica_senha\|hint"` em schema/actions vazio |
| **E7** 🟠 | Perda de fator: recuperação **assistida** — admin (permissão `usuarios:recuperar_fator`), motivo 8–255, confirmação de identidade presencial/por gerente registrada, trilha **antes**; efeito: remove fatores, revoga sessões, `precisa_configurar_fator=true`, envia link de reset (senha também é trocada); aviso D12 | `actions/usuarios.ts` `recuperarAcessoAssistido` + `docs/seguranca/runbook.md` | não existe "desligar 2FA por link" (G5 desligado) | [integração] sem motivo → 422; trilha gravada antes (falha simulada da trilha → nada muda) |
| **E8** 🔴 | Admin **inicia** reset (dispara e-mail de reset ao alvo) + revoga sessões do alvo + motivo + trilha antes; **nunca** define senha | `actions/usuarios.ts` `iniciarResetDeSenha` | G24 (`set-user-password` não revoga; plugin admin não usado) | [fonte] nenhuma action recebe `novaSenha` com `usuarioId` de terceiro; [integração] sessões do alvo = 0 após a action |
| **E9** 🟠 | Política antes de consumir o token (`hooks.before` em `/reset-password`) | `auth.ts` hooks | G15 (consume `:157` antes do hash `:162`) | [integração] senha fraca com token válido → 400 e em seguida a senha forte com o **mesmo** token funciona |
| **E10** 🟢 | Mensagens da política sem "token", "link", "inválido", "expirado" | `politica-senha.ts` | — | [unit] vocabulário |
| **E11** 🟠 | Gate server-side de `precisa_trocar_senha` e `precisa_configurar_fator` em **página e action** via `exigirSessao()`; `/primeiro-acesso/*`, `/trocar-senha` e `/api/auth/*` fora do gate | `guard.ts` | Server Action não passa por layout | [integração] com a flag ligada, chamar action de conversa → 403 `TROCA_OBRIGATORIA`; a action de troca funciona |
| **E12** 🔴 | Troca de e-mail só por admin (ADR 3.4): `iniciarTrocaDeEmail` (sessão fresca do admin, motivo, trilha) grava `email_pendente` + código 6 dígitos hasheado (10 min) enviado ao **novo**; o próprio usuário confirma o código numa action com sessão fresca; aviso ao **antigo** com instrução de contestação; até confirmar, reset vai ao antigo | `actions/usuarios.ts`, `actions/seguranca.ts`, `usuarios_verificacoes` própria ou tabela `usuarios_trocas_email` | `/change-email` desligado (G12/G17) | [integração] pedir troca e pedir reset → link cai no antigo; confirmar com código errado 5× → pedido cancelado |
| **E13** 🟡 | Não há senha temporária (convite e reset por link). Tokens de convite/troca: `crypto.randomBytes(32)`, expiração própria | `actions/convites.ts` | — | [fonte] `grep "Math.random"` em `src/lib/auth`, `src/lib/actions` vazio |
| **E14** 🟠 | Reset não alimenta `falhas_login`; limitador próprio por IP (`customRules`) e por conta (D18) | Route Handler | — | [integração] 10 pedidos de reset → login com senha certa entra |

## 11. Domínio F — Sessão

| REQ | O que construir | Onde | Config BA / armadilha | Trava |
| :--- | :--- | :--- | :--- | :--- |
| **F1** 🔴 | Token opaco do BA (CSPRNG), cookie `__Secure-merlo.session_token` `HttpOnly; Secure; SameSite=Lax; Path=/`; validação no banco a cada requisição (cookie cache desligado) | `auth.ts` `advanced.useSecureCookies`, `cookiePrefix` | cookie `__Host-` exige sem `Domain` — avaliar `advanced.cookies.session_token.name` (CONFERIR); `__Secure-` é o mínimo aceito | [integração/homolog HTTPS] `curl -I` pós-login: nome e atributos |
| **F2** 🔴 | Teto absoluto 12 h sem renovação (`disableSessionRefresh:true`, `expiresIn:43200`); motivo escrito: turno de loja | `auth.ts` | library-gotchas: sem bloco `session`, 7 dias renovados para sempre | [config]; [integração] `expira_em - criada_em = 12 h` e não muda após uso |
| **F3** 🟠 | Inatividade 60 min: `exigirSessao()` recusa se `ultimo_uso_em < now() - 60 min` e revoga; atualiza `ultimo_uso_em` no máximo a cada 5 min e **só** em requisição iniciada pelo usuário (não em polling de inbox — flag `{ renovaAtividade: false }`) | `guard.ts` + `session.additionalFields.ultimoUsoEm` | BA não tem inatividade com refresh desligado | [integração] relógio de teste +61 min → 401 e sessão removida; polling não renova |
| **F4** 🔴 | Sessão nova a cada autenticação; sessão pré-2FA apagada; sessão provisória do convite revogada ao concluir fator | BA (`two-factor/index.mjs:287-288`) + `actions/convites.ts` | — | [integração] cookie antes ≠ depois; após `verify-totp` não existe linha da sessão pré-desafio |
| **F5** 🔴 | Desativar conta, trocar papel/loja, remover fator, reset e recuperação assistida revogam sessões do alvo (`internalAdapter.deleteUserSessions`) | `sessoes.ts` chamado pelas actions | G24 | [integração] para cada action: sessão do alvo → 401 na requisição seguinte |
| **F6** 🟠 | Tela lista sessões por **projeção** (`id`, `ip`, `agente`, `criada_em`, `expira_em`, `atual`) — nunca `token`; listar não exige frescor; encerrar uma/todas as outras exige `exigirSessaoFresca()` e alvo por `id` **dentro** das sessões do usuário corrente | `sessoes.ts`, `actions/seguranca.ts` | G13 (`/list-sessions` devolve token e exige frescor; `/revoke-session` recebe token) | [fonte] `select` de `usuarios_sessoes` na action não inclui a coluna `token`; [integração] payload RSC da página não contém o valor do cookie; id de sessão de outro usuário → 404 |
| **F7** 🟡 | Admin encerra sessões de qualquer usuário (permissão `usuarios:encerrar_sessoes`, motivo, trilha) | `actions/usuarios.ts` | — | [integração] |
| **F8** 🟡 | "Sair" no cabeçalho de toda tela; `POST /api/auth/sign-out` remove a sessão no servidor | layout do app | — | [fonte] componente de cabeçalho contém ação de sair; [integração] cookie antigo após logout → 401 |
| **F9** 🟠 | Frescor (≤ 15 min desde a criação da sessão **ou** reautenticação recente registrada em `usuarios_sessoes.reautenticada_em`) exigido em: trocar senha, cadastrar/remover fator/passkey, encerrar sessões, trocar e-mail, ações administrativas de H2/H4/E7/E8 | `guard.ts` `exigirSessaoFresca()` + action `reautenticar` (senha+TOTP ou passkey) | G11, G12 | [fonte] lista `ACOES_SENSIVEIS` ⊆ actions que chamam `exigirSessaoFresca`; [integração] +16 min → `SESSAO_NAO_FRESCA` |
| **F10** 🟢 | Job diário remove sessões/verificações vencidas via BA (ou deixa a limpeza preguiçosa do BA) sem apagar vivas; tela filtra `expira_em > now()` | worker BullMQ `limpeza-auth` | ADR 3.1 cobre o delete | [integração] sessão viva sobrevive ao job |
| **F11** 🟢 | Nota no ADR 3.6: DBSC avaliado, não adotado (defesa em profundidade; teto e revogação cobrem) | ADR | — | — |
| **F12** 🟠 | Nenhum link de e-mail consome token ou cria sessão com GET: convite, reset e troca de e-mail usam fragmento + POST; `/verify-email` desligado | páginas públicas | G15, G17 | [integração] `curl -sD- -o /dev/null "$LINK"` → sem `Set-Cookie`, token intacto no banco |
| **F13** 🟠 | Sem token em URL/`localStorage`/JSON; `Cache-Control: no-store` em página e resposta autenticadas; logout com `Clear-Site-Data` | `next.config.ts` headers + Route Handler | — | [fonte] `grep "localStorage.setItem\|sessionStorage.setItem"` sem token; [integração] cabeçalhos |
| **F14** 🟡 | Decisão escrita: até 3 sessões simultâneas por usuário (vendedora usa loja + celular), 2 para `admin`; ao exceder, derruba a mais antiga e registra evento | `databaseHooks.session.create.after` | — | [integração] 4º login → 3 sessões vivas, a mais antiga removida |

## 12. Domínio G — Tela "Meu perfil › Segurança"

Rota: `src/app/(app)/perfil/seguranca/page.tsx` (Server Component) + `src/lib/actions/seguranca.ts`. Link no menu do
usuário em todo o layout autenticado; **sem** permissão de catálogo (qualquer papel ativo).

| REQ | O que construir | Onde | Config BA / armadilha | Trava |
| :--- | :--- | :--- | :--- | :--- |
| **G1** 🟠 | Página existe e é alcançável de toda área autenticada (inclusive durante `precisa_trocar_senha`, com escopo reduzido) | layout + página | — | [fonte] menu do usuário referencia `/perfil/seguranca`; `permissoes.ts` não tem chave para ela |
| **G2** 🔴 | **Nenhuma** action da tela recebe `usuarioId`/`userId`: alvo = `exigirSessao().usuario.id` | `actions/seguranca.ts` | — | [fonte] `tests/seguranca/perfil-sem-userid.test.ts`: nenhum parâmetro, schema zod ou `formData.get` com `userId`/`usuarioId`/`usuario_id` nesse arquivo |
| **G3** 🔴 | Trocar senha: atual + nova, requisitos ao vivo item a item (mesmo módulo da política, B6) | `CampoNovaSenha` + `trocarSenha` | B10, F9 | [integração] |
| **G4** 🔴 | Cadastrar TOTP (QR exibido uma vez durante o cadastro, verificação obrigatória); remover só por `substituirFator` que mantém o piso | `configurarTotp`, `substituirFator` | G5; sem códigos de resgate (D7) | [integração] remover o único fator → recusa |
| **G5** 🟠 | Passkeys: cadastrar (UV), renomear, remover (mantém piso), listar com nome, criada em, `backedUp` (sincronizada), fabricante por AAGUID | `cadastrarPasskey`, `renomearPasskey`, `removerPasskey` | CVE-2025-71400 (IDOR em delete-passkey < 1.4.0): conferir dono na action também | [integração] remover passkey de outro usuário por id → 404 |
| **G6** 🟠 | Ver e encerrar sessões (uma / todas as outras) | `listarMinhasSessoes`, `encerrarSessao(id)`, `encerrarOutrasSessoes` | G13 | F6 |
| **G7** 🟡 | Estado: fatores ativos, passkeys, senha alterada em, troca obrigatória pendente, último login (de `auth_eventos`) | página | — | [unit] campo ausente mostra "—" |
| **G8** 🔴 | A tela **não** tem: desligar 2º fator, códigos de resgate, token de sessão, `userId` | página + actions | — | [fonte] `tests/seguranca/perfil-proibidos.test.ts`: sem `disableTwoFactor`, `backupCodes`, `generateBackupCodes`, `getTOTPURI` fora do fluxo de cadastro, `token` em projeção |

## 13. Domínio H — Administração, privilégio máximo e autorização

Papéis do cliente (decisões 1, 2 e 7 de `integracoes.md`): `admin` (sem loja, tudo), `gerente` (sem loja, tudo menos
configuração e usuário), `vendedor` (com loja, opera; não exclui), `viewer` (com loja, lê). **Proposta**: `admin` é o
**privilégio máximo nomeado** (H1–H3 valem para ele). A régua da casa pede `OWNER` separado de `ADMIN`; aqui o cliente
não tem um "admin operacional" distinto do dono da rede — registrar no ADR de papéis (decisão a confirmar com Paulo;
se surgir admin operacional, criar `dono` acima de `admin`).

| REQ | O que construir | Onde | Config BA / armadilha | Trava |
| :--- | :--- | :--- | :--- | :--- |
| **H1** 🔴 | `admin` nunca por convite comum sem ciência (H2), nunca por rota de API genérica, nunca auto-atribuído, nunca em chave de máquina. "É admin?" por comparação literal `papel === "admin"` em `ehPrivilegioMaximo()`, nunca via `pode()`. Default da coluna = `viewer`. `CHECK` de papel ∈ lista + regra de loja | `permissoes.ts`, migration, `actions/usuarios.ts` | G24 (sem plugin admin: não há `adminUserIds`) | [fonte] única escrita de `papel: "admin"` está em `promoverAAdmin`; [integração] `INSERT` direto com papel inventado → violação de `CHECK` |
| **H2** 🔴 | `promoverAAdmin(alvoId, motivo, ciencia)`: ator é admin com sessão fresca; alvo ativo e ≠ ator; ciência textual versionada (`CIENCIA_ADMIN_V1`) digitada; trilha **antes** do `UPDATE`, na mesma transação; falha na trilha = não concede (fail-closed); revoga sessões do alvo (H6) | `actions/usuarios.ts` | — | [integração] trilha simulada falhando → papel inalterado; auto-alvo → recusa |
| **H3** 🔴 | Nunca zero admins: rebaixar/desativar/excluir admin só se `count(admin ativo) > 1` dentro da transação com `SELECT ... FOR UPDATE`; sem auto-alvo | `actions/usuarios.ts` | — | [integração] duas requisições paralelas rebaixando os 2 últimos admins → exatamente uma passa |
| **H4** 🟠 | Toda ação sobre conta alheia exige `motivo` (zod 8–255) e grava ator, alvo, antes, depois em `auditoria_eventos` | `actions/usuarios.ts` | — | [fonte] todo export de `usuarios.ts` que recebe `alvoId` valida `motivo` |
| **H5** 🔴 | RBAC fail-closed: `pode(papel, recurso, acao)` com tabela explícita; recurso/ação sem entrada = `false`; papel desconhecido = `false`. Toda página sensível e toda action começam por `exigirPermissao`; menu é só reflexo. Mapa de rotas de página → permissão; rota sem mapeamento não renderiza | `permissoes.ts`, `guard.ts`, layout | HUG `guard.ts:97-101` (default para papel mais baixo) é o contraexemplo | [fonte] `tests/seguranca/rbac.test.ts` no estilo do antigo `tests/rbac.test.ts`: varre handlers/actions/páginas e prova invariantes (admin tudo; viewer nunca escreve; vendedor nunca exclui salvo exceções listadas; gerente **nunca** alcança `configuracao:*` e `usuarios:*` — lista de negados exatamente a esperada; papel `superuser` inventado não passa em nada) |
| **H6** 🟠 | Papel, loja, `ativo` lidos do **banco** a cada requisição (`getSession` com `cookieCache` desligado já relê usuário); mudança revoga sessões do alvo | `auth.ts`, `sessoes.ts` | armadilha de campo: papel no JWT de 24 h; CVE-2026-67337 (cookie cache) | [integração] trocar papel → próxima requisição do alvo já nega |
| **H7** 🟡 | `admin`: passkey obrigatória, sessões máx. 2, frescor em toda ação de configuração/usuário, trilha completa | `guard.ts`, ADR 3.5 | — | [SQL fumaça] admins sem passkey = 0 |
| **H8** 🟡 | Primeiro operador: `scripts/primeiro-admin.ts` (CLI, só com banco vazio de admins, pede e-mail no terminal, gera **convite** admin e imprime o link uma vez; grava trilha `ator_tipo='sistema'`) — nunca no entrypoint | `scripts/` | C8 | [fonte] script recusa se já existe admin; não aceita senha |
| **H9** 🟡 | Destravar conta (`bloqueado_ate`): permissão `usuarios:destravar`, recusa se `bloqueado_ate <= now()`, motivo, trilha antes | `actions/usuarios.ts` | consulta de "bloqueada" compara `bloqueado_ate > now()` | [integração] destravar conta livre → 409 |
| **H10** 🔴 | Escopo de loja do **servidor**: `vendedor`/`viewer` → `loja_id` da sessão (lido do banco), parâmetro ignorado; `admin`/`gerente` → cookie `loja_ativa` aceito **só** após conferir papel de gestão e existência da loja; toda query de domínio filtra `loja_id`; fora do escopo = 404 | `src/lib/auth/loja.ts`, repositórios Drizzle | decisões 1, 2, 5 de `integracoes.md` | [fonte] `tests/seguranca/escopo-loja.test.ts` (fatiado por handler/action, piso mínimo, como o antigo); [integração] vendedor Centro pedindo contato do Cerro Azul por id → 404 idêntico a inexistente |
| **H11** 🔴 | ⚪ **Não se aplica**: sem impersonação (plugin admin não registrado; decisão escrita). Suporte usa recuperação assistida (E7) | — | G24 | [config] sem plugin admin; [integração] `POST /api/auth/admin/impersonate-user` → 404 sem corpo |
| **H12** 🔴 | Autorização por objeto: todo id vindo do cliente (conversa, contato, pedido, integração, usuário, sessão, passkey, mídia, template, produto) conferido contra loja/dono no `where`; ids secundários no corpo (`templateId`, `mediaFileIds`, `productId`) conferidos contra a loja resolvida (achado do sistema antigo, `docs/rbac.md` "Cuidado com id que vem do corpo"); update de usuário nunca espalha corpo (`...input`) — campos de privilégio só em actions dedicadas | repositórios + actions | `additionalFields.input:false` (§3.2) | [fonte] `grep` de `...body`/`...input`/`...data` dentro de `.set(` e `.values(` em `src/lib/actions` e `src/lib/db` reprova; [integração] troca de id para recurso de outra loja → 404 |

## 14. Domínio I — Área pública, máquina (webhooks, crons, OAuth de integração)

### 14.1 Superfícies de máquina do MerlostoreChat v2

| Superfície | Rota proposta | Autenticação | Resolução de conta/loja | Observação |
| :--- | :--- | :--- | :--- | :--- |
| WhatsApp oficial (Meta) | `POST /api/webhooks/whatsapp` · `GET` challenge | HMAC-SHA256 do **corpo cru** com `META_APP_SECRET`, header `X-Hub-Signature-256: sha256=<hex>`; GET: `hub.verify_token` = `WHATSAPP_VERIFY_TOKEN` em tempo constante | `metadata.phone_number_id` → `stores_integracoes(provedor='whatsapp_oficial', referencia_externa)` | conta desconhecida: 200 + descarte + evento |
| Instagram / Facebook (Meta) | `/api/webhooks/instagram`, `/api/webhooks/facebook` | idem, token de challenge **por canal** (`INSTAGRAM_VERIFY_TOKEN`, `FACEBOOK_VERIFY_TOKEN`) | `entry.id` | lição do sistema antigo: token compartilhado entre canais |
| uazapi (WhatsApp não oficial) | `POST /api/webhooks/uazapi/[integracaoId]` | segredo **por integração** em header (`x-uazapi-secret`), guardado como SHA-256 em `stores_integracoes.segredo_webhook_hash`; comparação `timingSafeEqual` dos hashes; **nunca** `?segredo=` | `integracaoId` da URL → integração → loja (conferir `provedor='uazapi'` e `is_deleted=false`) | uazapi não assina o corpo (`webhook-auth.ts` antigo); segredo ausente/integração inexistente → 401 idêntico |
| TikTok Shop | `POST /api/webhooks/tiktok-shop` | HMAC-SHA256 de `app_key + corpo cru`, chave `TIKTOK_SHOP_APP_SECRET`, hex minúsculo, header `Authorization` (`docs/api.md` antigo, **CONFERIR** na doc vigente) | `shop_id` do payload → integração | `ASSINATURA_INCLUI_CAMINHO` ficou sem confirmação no sistema antigo (vale para chamadas, não para o webhook) |
| Pagamento | `POST /api/webhooks/pagamento` | assinatura **do provedor escolhido** (ex.: Mercado Pago `x-signature` com `ts`+`v1` HMAC; Asaas token de header) — provedor ainda mock no sistema antigo | `externalId` → pagamento → pedido → loja | segredo compartilhado sem HMAC só com exceção M6 datada |
| Crons | `POST /api/cron/<tarefa>` (alertas, transcrição, refresh de tokens, limpeza) | `Authorization: Bearer <CRON_SECRET>` comparado em tempo constante; limitador por IP; rastro aceito e recusado | — | preferir worker BullMQ agendado (repeatable job) em vez de cron HTTP: some a superfície (I12) |
| OAuth Bling (conta única da rede) | início: action admin; retorno: `GET /api/integracoes/bling/callback` | `state` = HMAC(`INTEGRATIONS_STATE_KEY`, `nonce.expira.usuarioId`) com validade 5 min **e** `nonce` igual ao do cookie `__Host-merlo.oauth_nonce` (HttpOnly, SameSite=Lax) setado no início; uso único (Redis `SET NX`); PKCE se o Bling suportar (CONFERIR); `redirect_uri` fixo de env | `store_id` nulo (decisão 6) | somente leitura (ADR 0004): teste antigo `tests/bling.test.ts` vira trava (só GET + 2 POST de OAuth) |
| OAuth TikTok Shop | `GET /api/integracoes/tiktok-shop/callback` | mesmo `state` vinculado à sessão do admin | loja escolhida **antes** do redirect e gravada no `state`, não chutada | — |

### 14.2 Requisitos

| REQ | O que construir | Onde | Config BA / armadilha | Trava |
| :--- | :--- | :--- | :--- | :--- |
| **I1** 🔴 | Não há chave de API emitida para terceiros (plugin `api-key` não usado — CVE-2025-61928). Segredos de webhook por integração: gerados no servidor (`randomBytes(32)`), exibidos **uma vez** ao admin, guardados como hash, comparados em tempo constante; nunca concedem papel humano | `actions/integracoes.ts`, `assinaturas.ts` | — | [fonte] sem plugin `api-key`; `stores_integracoes` sem coluna de segredo de webhook em claro; [unit] `iguaisEmTempoConstante` usa `timingSafeEqual` e trata tamanhos diferentes |
| **I2** 🟠 | `rotaDeMaquina({ limite, maxBytes, autenticar, handler })` na ordem: teto por IP → `content-length` → leitura com teto → carregar credencial/integração → validade (`is_deleted`, status) → credencial/assinatura sobre o corpo cru → anti-repetição (id do evento/`ts` ± 5 min) → handler. **Nenhum `JSON.parse` antes de autenticar** | `src/lib/seguranca/maquina.ts` | — | [fonte] todo `route.ts` em `src/app/api/webhooks/**` e `src/app/api/cron/**` exporta via `rotaDeMaquina`; nenhum `req.json()` nesses arquivos |
| **I3** 🟡 | Toda recusa de máquina: `401` corpo nulo (sem `reason`) | `maquina.ts` | contraexemplo HUG `webhook/whatsapp/route.ts:175-178` | [integração] assinatura inválida × ausente × integração inexistente → `cmp` |
| **I4** 🟠 | Balde por **IP** (e só depois da autenticação, balde por integração para anti-loop), nunca só por `client_id`/integração antes de autenticar | `maquina.ts` | HUG `rate-limit.ts:52-64` limita só falhas de assinatura para não estrangular o provedor | [fonte] chave do limitador pré-autenticação contém o IP |
| **I5** 🟠 | `stores_integracoes`: `status`, `expira_em` (token OAuth), `revogada_em` (desconectar), rastro de uso aceito e recusado em `integracoes_eventos` (append-only). `ip_allowlist` não se aplica (Meta/TikTok não publicam faixas estáveis) — decisão escrita | schema + `maquina.ts` | — | [integração] webhook recusado gera evento `webhook_recusado` com IP e integração (sem segredo) |
| **I6** 🔴 | O que docs/telas prometem ("assinatura", "HMAC", "cifrado", "2FA") é o que o código faz; o aviso de banimento do uazapi continua (trava antiga `tests/uazapi.test.ts`) | docs + telas | — | [fonte] `tests/seguranca/promessas.test.ts`: cada rota listada como "HMAC" em `docs/api.md` chama `verificarHmac`; cada tela que diz "cifrado" usa `cifrar` |
| **I7** 🟠 | ⚪ enquanto não houver M2M vindo de CI. Deploy EasyPanel usa webhook de deploy do próprio EasyPanel — segredo fora do repo | — | — | [fonte] workflows sem segredo M2M do app |
| **I8** 🔴 | Webhooks de terceiros: assinatura verificada **antes** de qualquer escrita; idempotência por id do evento (`UNIQUE` em tabela de entrada + `jobId` determinístico, padrão HUG `webhook/whatsapp/route.ts:274-300`); segredo ausente no ambiente → 401 (nunca aceitar) | `src/app/api/webhooks/**`, `assinaturas.ts` | — | [integração] `tests/seguranca/webhooks.test.ts`: POST forjado em cada webhook → 401 e **zero** linhas novas; mesmo evento 2× → 1 processamento; env sem segredo → 401 |
| **I9** 🟠 | Isolamento por integração: evento só escreve na loja da integração resolvida; integração sem loja (TikTok recém-conectado) descarta evento de domínio | roteamento | decisão 5 (contato por loja) | [integração] evento do número do Cerro Azul nunca cria contato no Centro |
| **I10** 🟡 | Sem Swagger/OpenAPI público (plugin `open-api` do BA não registrado; `docs/api.md` só no repo) | — | — | [integração] `GET /api/auth/reference` → 404 |
| **I11** 🟡 | Teto de corpo em todo Route Handler (webhook 256 KB; auth 16 KB; upload de mídia com teto próprio e streaming para o MinIO) | `corpo.ts` | N3 | [fonte] todo `route.ts` com `POST/PUT/PATCH` usa `lerCorpoComTeto` ou `rotaDeMaquina` |
| **I12** 🟠 | Crons: preferir jobs agendados no worker (sem HTTP). Se HTTP: `CRON_SECRET` ≥ 32 bytes, header, `timingSafeEqual`, limitador por IP, rastro aceito/recusado; healthcheck público sem dado (sem telefone de instância — armadilha de campo) | `src/app/api/cron/**` ou `worker/` | — | [fonte] `grep -rn "CRON_SECRET"` só em `maquina.ts`/`env.ts`; nenhuma comparação `===` com segredo (`grep -nE "(SECRET\|TOKEN)[^\n]*(===\|!==)"`) |
| **I13** 🔴 | Worker e app são processos do mesmo serviço, sem identidade propagada por cabeçalho; worker não expõe porta HTTP. Nenhum handler lê `x-user-id`/`x-loja-id` de cabeçalho | `worker/`, handlers | — | [fonte] `grep -rniE "x-user-id\|x-usuario\|x-loja\|x-roles"` em `src/` vazio |
| **I14** 🔴 se aplicável | ⚪ o sistema **não emite** tokens OAuth (sem `oauth-provider`/`oidc`/`mcp`). Como **cliente** de Bling/TikTok: `redirect_uri` fixo por env, `state` assinado + vinculado à sessão + uso único, PKCE S256 quando suportado, troca de `code` só no servidor, `access_token`/`refresh_token` cifrados AES-256-GCM com `INTEGRATIONS_KEY` e versão de chave (`v1:`), refresh por job antes de `expira_em`, desconectar apaga a credencial | `src/lib/integracoes/oauth.ts`, `cofre.ts` | CVE-2026-67335 (state sem PKCE no BA < 1.6.2) mostra o risco do `state` frouxo | [integração] callback com `state` de outra sessão, expirado, reutilizado ou adulterado → 400 sem gravar; [fonte] nenhuma credencial de integração em `process.env` fora de `env.ts` |
| **I15** 🟠 | Credencial de máquina só em cabeçalho; nunca em query/path | `maquina.ts` | armadilha de campo `?secret=` no log do proxy; antigo `verificarWebhookUazapi` aceitava `?segredo=` | [fonte] nenhum `searchParams.get(` com `segredo\|secret\|token\|api_key` em `src/app/api/webhooks\|cron`; [integração] `?segredo=<valido>` sem header → 401 |

## 15. Domínios J, K, L, M

### 15.1 J — Borda: origem, cabeçalhos, CSP, proxy, cookies

| REQ | O que construir | Onde | Config / armadilha | Trava |
| :--- | :--- | :--- | :--- | :--- |
| **J1** 🔴 | `origemEsperada()` = `new URL(env.APP_URL).origin`, única função; usada pelo guard das actions, pelos links de e-mail e pelo BA (`baseURL`/`trustedOrigins`). Nunca `request.url`, `nextUrl.host`, `Host`, `X-Forwarded-Host` | `src/lib/seguranca/origem.ts` | Next compara `Origin` com `x-forwarded-host`/`host` (N2) — atrás do Traefik isso depende do proxy; nossa checagem não | [fonte] `grep -rnE "new URL\(req(uest)?\.url\)\|nextUrl\.(host\|origin)\|headers\.get\(['\"](host\|x-forwarded-host)"` fora de `origem.ts`/`ip.ts` reprova; [homolog] POST de action com origem **correta** sem cookie → 401 (não 403) |
| **J2** 🟠 | `trustedOrigins: [env.APP_URL]`; sem CORS aberto (nenhum `Access-Control-Allow-Origin: *`); `experimental.serverActions.allowedOrigins` só se o Traefik não repassar `x-forwarded-host` (medir) | `auth.ts`, `next.config.ts` | — | [config] |
| **J3** 🟠 | `callbackURL`/`redirectTo`/`?volta=` só caminho relativo de lista interna (`/^\/(?!\/)[\w\-\/]*$/` + prefixos permitidos); BA valida `callbackURL` contra `trustedOrigins` (`origin-check.mjs:48-66`) | `origem.ts` `destinoSeguro()` + páginas de login | CVE-2025-53535 (open redirect BA < 1.2.10), CVE-2025-27143, CVE-2026-64645 (rewrites/redirects com host do request) | [integração] `?volta=https://evil.example`, `//evil.example`, `/\evil.example` → `/`; [fonte] `next.config` `rewrites/redirects` sem destino montado a partir de parâmetro |
| **J4** 🟠 | `headers()` no `next.config.ts`: `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (ou `no-referrer`; BA 1.7.2 aceita form same-origin com `no-referrer`), `X-Frame-Options: DENY` + `frame-ancestors 'none'`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self)` | `next.config.ts` | — | [config] `tests/seguranca/cabecalhos.test.ts` importa `headers()`; [fumaça] `curl -I` em homolog |
| **J5** 🟡 | CSP com nonce por requisição gerado no `proxy.ts` para páginas (`script-src 'self' 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `base-uri 'none'`, `img-src` com o host público do MinIO); começar em `Report-Only` com coletor limitado (`/api/csp` 16 KB, limitador, TTL) e data de enforce no ADR | `proxy.ts`, `src/app/api/csp/route.ts` | CVE-2026-44581 (XSS com nonce CSP, corrigido 16.2.5) | [fonte] sem `'unsafe-inline'` em `script-src` (ou exceção M6 datada) |
| **J6** 🟢 | Matcher do `proxy.ts` exclui `/api/webhooks`, `/api/cron`, `/api/auth`, `_next/static`, `_next/image` | `proxy.ts` | — | [unit] `unstable_doesProxyMatch` (Next ≥ 15.1) para rotas de máquina → `false` |
| **J7** 🟠 | Toda Server Action mutante chama `conferirOrigem()` (dentro de `exigirSessao`): exige `Origin` = `origemEsperada()` **ou** `Sec-Fetch-Site: same-origin`; `Origin` ausente → recusa. Cookie `SameSite=Lax` | `guard.ts` | N2 (Next deixa passar sem `Origin`); CVE-2026-27978 (`Origin: null`, corrigido 16.1.7) | [integração] action com `Origin: https://evil.example` → 403; sem `Origin` e sem `Sec-Fetch-Site` → 403 |

### 15.2 K — Segredos, criptografia, armazenamento

| REQ | O que construir | Onde | Config / armadilha | Trava |
| :--- | :--- | :--- | :--- | :--- |
| **K1** 🔴 | `env.ts` com zod: toda variável obrigatória por ambiente; ausente = `throw` no boot (exceto na fase de build, com checagem em runtime — padrão HUG `auth.ts:41-48` sem o fallback de `baseURL` `?? "http://localhost:3000"`) | `src/lib/env.ts` | — | [fonte] `grep -rnE "process\.env\.\w+\s*(\|\||\?\?)\s*['\"\`]"` em `src/` reprova; `process.env` só em `env.ts` |
| **K2** 🟠 | Segredos dedicados ≥ 32 bytes: `BETTER_AUTH_SECRETS` (versionados), `INTEGRATIONS_KEY` (AES-256-GCM, formato `v1:iv:tag:dados`), `INTEGRATIONS_STATE_KEY`, `CRON_SECRET`, `META_APP_SECRET`, `TIKTOK_SHOP_APP_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `WHATSAPP/INSTAGRAM/FACEBOOK_VERIFY_TOKEN`; HML ≠ PRD; runbook de rotação | `.env.example` (sem valor), `docs/seguranca/runbook.md` | não derivar chave de outro segredo (contra HUG `secrets.ts:30-38`) | [fonte] `.env.example` lista todas sem valor; `git log --all --oneline -S` dos nomes no CI de segredo (gitleaks) |
| **K3** 🔴 | Nada de valor em claro: token de reset/convite/troca (hash), OTP (não usado), semente TOTP (cifrada pelo BA), códigos de resgate (não existem), credenciais de integração (cifradas), segredo de webhook (hash), sessão (projeção sem token) | schema + `cofre.ts` | G1, G4 | [integração] `tests/seguranca/sem-segredo-em-claro.test.ts`: exercita convite, reset, TOTP, conexão de integração e depois faz `SELECT` nas tabelas procurando os valores emitidos |
| **K4** 🟠 | Erro do driver `pg` nunca vai cru ao log: `sanitizarErroBanco(e)` remove `detail`, `where`, `parameters` (o `detail` de UNIQUE traz `Key (email)=(valor)`) | `src/lib/db/erros.ts` + logger | — | [unit] erro 23505 sintético → log sem o valor |
| **K5** 🟠 | `timestamp({ precision: 3, withTimezone: true })` em todas as colunas de instante; servidor e banco em UTC; comparação de expiração no SQL (`> now()`) | schema | armadilha nº 1 (optimistic locking) | [fonte] `tests/seguranca/timestamps.test.ts`: todo `timestamp(` no schema tem `precision: 3` e `withTimezone: true` |
| **K6** 🟡 | Índices: `usuarios_sessoes(usuario_id)`, `usuarios_sessoes(token)` único, `usuarios_sessoes(expira_em)`, `usuarios_verificacoes(identificador)`, `usuarios_verificacoes(expira_em)`, `usuarios_contas(usuario_id)`, `usuarios_passkeys(usuario_id)`, `usuarios_passkeys(credential_id)` único, `usuarios_totp(usuario_id)`, `auth_eventos(usuario_id, criado_em)`, `auth_eventos(tipo, criado_em)`, `lower(usuarios.email)` único parcial `WHERE is_deleted=false` | migration | — | [integração] `\d` via `information_schema`/`pg_indexes` confere a lista |
| **K7** 🟡 | ⚪ Não se aplica (sem Mongo) | — | — | — |
| **K8** 🟠 | Backup (`pg_dump` da regra da casa) cifrado (`age`/`gpg`) antes de sair do servidor; dump não contém segredo legível porque K3 vale; acesso restrito | `docs/deploy` + script de backup | — | [fumaça] restauração em HML e `grep` do token de teste no dump = 0 |

### 15.3 L — Auditoria, monitoria e resposta

Tabela `auth_eventos` (append-only, sem FK, sem soft delete — marcador `APPEND_ONLY` do compliance): `id uuid`,
`criado_em timestamptz(3)`, `tipo text` (enum de aplicação), `usuario_id text null`, `email_hash text null` (HMAC do
e-mail para falha de login sem expor o e-mail), `sessao_id text null`, `meio text` (`senha`, `senha+totp`, `passkey`,
`convite`, `reset`, `admin`, `sistema`), `ip text`, `agente text`, `ator_id text null`, `alvo_id text null`,
`resultado text`, `detalhes jsonb` (sem segredo). Ações de negócio vão para `auditoria_eventos` (mesma forma, com
`antes`/`depois`).

| REQ | O que construir | Onde | Config / armadilha | Trava |
| :--- | :--- | :--- | :--- | :--- |
| **L1** 🔴 | Registrar: `login_sucesso` (meio, IP, agente), `senha_aceita_aguardando_2fa`, `login_falha`, `conta_bloqueada`, `conta_destravada`, `logout`, `sessao_encerrada` (motivo), `reset_solicitado`, `reset_concluido`, `senha_trocada`, `fator_adicionado/removido`, `passkey_*`, `papel_alterado`, `usuario_desativado`, `admin_promovido`, `recusa_403` (rota/action, papel), `sonda_caminho_desligado`, `webhook_recusado`, `recuperacao_assistida`. Banco: `REVOKE UPDATE, DELETE, TRUNCATE ON auth_eventos, auditoria_eventos FROM <papel_app>` + trigger `BEFORE UPDATE OR DELETE ... RAISE EXCEPTION`; sem TTL | `trilha.ts`, migration | regra da casa: trilha append-only | [integração] `UPDATE auth_eventos` com o usuário da app → erro; [fonte] nenhum `.update(authEventos` / `.delete(` sobre as tabelas de trilha |
| **L2** 🔴 | Entrada registrada no **funil único**: `databaseHooks.session.create.after` (todo caminho que cria sessão: senha pós-2FA, passkey, convite). Distinguir sessão pré-2FA (criada e apagada pelo plugin — `two-factor/index.mjs:287-288`) pelo `ctx.path === "/sign-in/email"` com `user.twoFactorEnabled` → `senha_aceita_aguardando_2fa`, não `login_sucesso` | `auth.ts` hooks + `trilha.ts` | G8, G25 | [fonte] `registrarEventoAuth("sessao_criada"` só em `databaseHooks`; nenhuma lista de rotas decide login; [integração] login senha+TOTP gera 1 `senha_aceita_aguardando_2fa` + 1 `login_sucesso(meio=senha+totp)`; passkey gera `login_sucesso(meio=passkey)` |
| **L3** 🔴 | `registrarEventoAuth` nunca lança: `try/catch` em volta de **tudo**, `.catch` na promessa de gravação e `Promise.race` com teto de 3 s; falha → log CRITICAL. Exceção fail-closed: `promoverAAdmin`, `iniciarResetDeSenha`, `recuperarAcessoAssistido` gravam na **mesma transação** do efeito | `trilha.ts` | — | [unit] banco da trilha rejeitando depois de 5 s → hook retorna em ≤ 3,1 s e sem rejeição não tratada |
| **L4** 🟡 | IP da trilha = `sessao.ipAddress` resolvido pelo BA ou `ipDoCliente()` (mesma regra, C6) | `trilha.ts` | G21 | [fonte] `trilha.ts` não lê `x-forwarded-for` |
| **L5** 🔴 | Nunca na trilha/log: senha, hash, token de sessão/reset/convite, OTP/TOTP, semente, segredo de integração, corpo cru de webhook com token | `trilha.ts` (lista branca de campos em `detalhes`), logger com `redact` (`password`, `newPassword`, `currentPassword`, `token`, `code`, `secret`, `authorization`, `cookie`) | — | [unit] `registrarEventoAuth` com `detalhes` contendo chave proibida → removida; [fonte] logger configurado com `redact` |
| **L6** 🟡 | Tela de monitoria (admin/gerente leem — decisão 7) com filtro por tipo, usuário, período; campo ausente = "—" | `src/app/(app)/configuracoes/seguranca/` | — | [unit] |
| **L7** 🟠 | Alertas deduplicados (Redis `SET NX EX 3600`) para: `conta_bloqueada`, `email_seguranca_falhou`, `sonda_caminho_desligado`, `senha_aceita_aguardando_2fa` sem `login_sucesso` em 10 min, `webhook_recusado` em rajada, `admin_promovido`, `limitador_indisponivel`, `hibp_indisponivel`. Canal: e-mail aos admins (e Discord da equipe, ferramenta da casa) | `src/lib/seguranca/alertas.ts` + worker | — | [unit] 2 eventos iguais em 1 h → 1 alerta |
| **L8** 🟠 | `docs/seguranca/runbook.md`: revogar todas as sessões (SQL via BA/script), rotacionar `BETTER_AUTH_SECRETS` (nova versão primeiro), destravar conta, desligar passkey/TOTP por variável (`AUTH_PASSKEY_HABILITADA`, M3), trocar `INTEGRATIONS_KEY` (reconectar), responder a número uazapi banido | doc | — | [fonte] `docs-check` acusa ausência do runbook |
| **L9** 🟡 | Caminho desligado responde idêntico a inexistente e grava `sonda_caminho_desligado` | Route Handler §5.2 passo 1 | G19 | coberto por A2 |

### 15.4 M — Travas e operação

| REQ | O que construir | Onde | Trava |
| :--- | :--- | :--- | :--- |
| **M1** 🟠 | Cada 🔴 com teste que lê o fonte ou de integração; varreduras para rota/action nova (§16) | `tests/seguranca/` + `docs/seguranca/matriz-req-teste.md` (REQ → arquivo de teste) | [fonte] `matriz-req-teste.test.ts`: todo REQ do portão aparece na matriz com um arquivo de teste existente |
| **M2** 🔴 | Versões ≥ mínimas (§17) conferidas no **lockfile**; `npm audit --omit=dev --audit-level=high` limpo; Renovate/Dependabot semanal para `next`, `better-auth`, `@better-auth/*`, `drizzle-orm` | CI | [fonte] `tests/seguranca/versoes.test.ts` lê `package-lock.json` e compara com `VERSOES_MINIMAS`; pacotes `@better-auth/*` com a **mesma** versão do `better-auth` |
| **M3** 🟡 | Interruptores por env com default seguro escrito: `AUTH_PASSKEY_HABILITADA` (default `true`), `AUTH_HIBP_HABILITADO` (default `true`, fail-open), `EMAIL_SEGURANCA_PROVEDOR` | `env.ts` | [config] defaults |
| **M4** 🟡 | Fumaça pós-deploy (HML e PRD): `GET /api/auth/get-session` 200 (schema BA ok, G27); action com origem certa sem cookie → 401; origem forjada → 403; `POST /api/auth/sign-up/email` → 404 sem corpo; cabeçalhos J4; SQL D1 = 0 | `scripts/fumaca-seguranca.mjs` no pipeline de deploy | pipeline falha se algum item falhar |
| **M5** 🟢 | `docs/seguranca-login.md` da base + este documento relidos a cada troca de minor do BA/Next; checklist no PR de atualização | `.github/pull_request_template.md` | — |
| **M6** 🟡 | Toda exceção (ADR 3.1 delete físico, D7 sem códigos, H1 admin = máximo, CSP report-only, pagamento sem HMAC) com **motivo + quem decidiu + até quando** no código (comentário `// EXCECAO-SEG: REQ-X | motivo | decidido por | ate AAAA-MM-DD`) e no ADR | código + `docs/adr/` | [fonte] `excecoes.test.ts`: todo `EXCECAO-SEG` tem as 4 partes e data futura (data vencida reprova o CI) |

---

## 16. Travas de CI (lista consolidada)

Pipeline obrigatório da casa: lint + `tsc --noEmit` → testes → build → deploy. As travas abaixo rodam no passo
"testes"; as [integração] sobem `docker compose` (Postgres 5437 com banco `merlostore_test`, Redis 6382) no job.

| # | Arquivo | Tipo | Cobre | Reprova quando |
| :-- | :--- | :--- | :--- | :--- |
| T1 | `tests/seguranca/guarda.test.ts` | fonte | A3, A5, H5 | handler de escrita ou export `'use server'` sem guarda (identidade de função, piso de handlers) |
| T2 | `tests/seguranca/inventario.test.ts` | fonte | A1, A6 | rota/action fora do manifesto público e sem guarda; item do manifesto sem linha no doc |
| T3 | `tests/seguranca/caminhos-ba.test.ts` | fonte | A2, L9 | caminho instalado pelo BA (varrido em `node_modules`) fora de `EM_USO ∪ CAMINHOS_DESLIGADOS` |
| T4 | `tests/seguranca/auth-config.test.ts` | config | §4, B1, B2, C8, D5, D8, D15, E2, E3, F2, F9, G1–G28 | qualquer valor da §4 divergente; plugin proibido registrado; `nextCookies` fora do fim |
| T5 | `tests/seguranca/recusa-unica.test.ts` | integração | C3, C4, E1 | corpos/cabeçalhos diferentes ou p50 fora de ±50 ms entre as recusas |
| T6 | `tests/seguranca/bloqueio-conta.test.ts` | integração | C1, C5, C7, C9, E14 | 8 falhas paralelas ≠ 8; reset alimentando bloqueio; passkey sem zerar |
| T7 | `tests/seguranca/caminhos-desligados.test.ts` | integração | A2, D7, D10, G13, G17, H11, L9 | caminho desligado com corpo ou status ≠ inexistente |
| T8 | `tests/seguranca/reset.test.ts` | integração | E2, E3, E4, E9, F12 | token em claro, dois consumos, `Set-Cookie`, sessão sobrevivente, link com `?token`, senha fraca queimando token |
| T9 | `tests/seguranca/sessoes.test.ts` | integração | F1–F6, F9, F14, H6 | token na projeção, sessão sobrevive a desativação/troca de papel, renovação, frescor ignorado |
| T10 | `tests/seguranca/passkey-uv.test.ts` | fonte + unit | D8, D9 | hook de UV ausente ou não lança com `userVerified:false` |
| T11 | `tests/seguranca/perfil-sem-userid.test.ts` e `perfil-proibidos.test.ts` | fonte | G2, G8 | `userId`/`usuarioId` em action do perfil; chamada a desligar 2FA/códigos |
| T12 | `tests/seguranca/rbac.test.ts` | fonte | H1, H5, integracoes.md "CAUTION" item 4 | invariantes de papel; gerente alcançando configuração/usuário; papel inventado passando |
| T13 | `tests/seguranca/escopo-loja.test.ts` | fonte + integração | H10, H12, I9 | handler/action de domínio sem escopo de loja (fatiado por handler, piso); id de outra loja ≠ 404 |
| T14 | `tests/seguranca/admin-actions.test.ts` | integração | E7, E8, H2, H3, H4, H9, F5, F7 | sem motivo; trilha depois do efeito; zero admins possível por corrida; sessões do alvo vivas |
| T15 | `tests/seguranca/webhooks.test.ts` | integração | I2, I3, I8, I11, I15 | POST forjado escreve; recusa com corpo; `?segredo=` aceito; corpo acima do teto lido |
| T16 | `tests/seguranca/oauth-integracoes.test.ts` | integração | I14, J3 | `state` reutilizado/expirado/de outra sessão aceito |
| T17 | `tests/seguranca/segredos.test.ts` | fonte | K1, K2, I12 | `process.env.X \|\| "literal"`; `process.env` fora de `env.ts`; `===` com segredo; `.env.example` incompleto |
| T18 | `tests/seguranca/sem-segredo-em-claro.test.ts` | integração | K3, E2, D6 | valor emitido encontrado em claro no banco |
| T19 | `tests/seguranca/timestamps.test.ts` | fonte | K5, armadilha nº 1 | `timestamp(` sem `precision: 3` e `withTimezone: true` |
| T20 | `tests/seguranca/trilha.test.ts` | integração + unit | L1–L5 | UPDATE/DELETE permitido na trilha; evento faltando no funil; hook que lança; campo proibido gravado |
| T21 | `tests/seguranca/origem.test.ts` | fonte + integração | J1, J7, C6 | origem derivada da requisição fora de `origem.ts`; `x-forwarded-for` fora de `ip.ts`; action aceita `Origin` forjado/ausente |
| T22 | `tests/seguranca/cabecalhos.test.ts` | config | J4, J5, J6, F13 | cabeçalho ausente; `'unsafe-inline'` sem exceção; matcher cobrindo rota de máquina |
| T23 | `tests/seguranca/versoes.test.ts` | fonte (lockfile) | M2 | versão abaixo de §17; `@better-auth/*` com versão ≠ `better-auth` |
| T24 | `tests/seguranca/excecoes.test.ts` + `matriz-req-teste.test.ts` | fonte | M1, M6 | exceção sem as 4 partes ou vencida; REQ do portão sem teste mapeado |
| T25 | `tests/soft-delete.test.ts` (varredura da base) | fonte | regra da casa | `db.delete`/`deleteMany` no código; `select` de domínio sem `is_deleted=false`; delete sobre tabela de trilha |
| T26 | `tests/bling-somente-leitura.test.ts` (herdado do ADR 0004) | fonte | I6, ADR 0004 | cliente Bling com `PUT/PATCH/DELETE` ou mais de 2 `POST` |
| CI-1 | `node scripts/check-compliance.mjs` | script da base | regras absolutas | violação (precisa aprender o marcador de tabela de framework — §3.1) |
| CI-2 | `npm audit --omit=dev --audit-level=high` + `gitleaks detect` | ferramenta | M2, K2 | advisory alto em dependência de runtime; segredo no histórico |
| CI-3 | `scripts/fumaca-seguranca.mjs` (pós-deploy HML/PRD) | fumaça | M4, D1, D2, J4, G27 | qualquer item de M4 |

Regra de engajamento para T5/T6/T8/T14 (skill `engagement-safety.md`): antes de rodar, o teste confere que o host do
`DATABASE_URL` é `localhost`/container e o nome do banco contém `test`; senão aborta.

---

## 17. Advisories e versões mínimas

**Busca feita em 15/09/2026.** Fontes: OSV API `api.osv.dev/v1/query` (pacotes npm `better-auth`,
`@better-auth/passkey`, `@better-auth/core`, `next`, `drizzle-orm`, `drizzle-kit`); GitHub Security Advisories
(`github.com/better-auth/better-auth/security/advisories`, `github.com/advisories/GHSA-g38m-r43w-p2q7`,
`GHSA-qq9h-g4jm-xgf3`); `better-auth.com/blog/security-update-june-2026`; `nextjs.org/blog/may|july|august-2026-security-release`
(`vercel.com/changelog/next-js-may-2026-security-release`); `github.com/better-auth/better-auth/releases` (v1.7.0–v1.7.5);
GitHub Advisory `GHSA-gpj5-g38j-94v9` (Drizzle); issue `drizzle-team/drizzle-orm#5481`; npm registry (`npm view`).

### 17.1 Versões a fixar

| Pacote | Última publicada (15/09/2026) | **Mínima aceitável** | Por quê |
| :--- | :--- | :--- | :--- |
| `next` | 16.3.5 | **16.3.3** (recomendado 16.3.5) | GHSA-2xp9-vwfh-vxw4 (RCE no otimizador de imagem AVIF via libheif/sharp, crítico) e CVE-2026-75604 / GHSA-p293-qw3h-jr36 (RCE sem autenticação em servidor **Windows** — as máquinas de dev da equipe são Windows) |
| `react` / `react-dom` | — | a que o `next` 16.3.x exige | RSC é empacotado pelo Next; advisories de RSC seguem a versão do Next (GHSA-9qr9-h5gf-34mp, CVE-2026-23870) |
| `better-auth` | 1.7.5 (14/09) · linha 1.6: 1.6.33 | **1.7.3** (recomendado 1.7.5) | v1.7.3 corrige re-enroll de TOTP substituindo autenticador ativo e liga validação de schema no boot (sem GHSA); todas as correções da série jun/jul/2026 (≤ 1.6.22 / 1.7.0-beta.10) já estão na 1.7.0 estável |
| `@better-auth/passkey` | 1.7.5 | **= versão do `better-auth`** | CVE-2025-71400 (IDOR em delete-passkey, < 1.4.0); advisory do blog: atualizar todos os pacotes `@better-auth/*` juntos |
| `drizzle-orm` | 0.45.2 | **0.45.2** | CVE-2026-39356 / GHSA-gpj5-g38j-94v9 (SQL injection via `sql.identifier()`/`.as()` com nome não confiável, CVSS 7.5; afeta Postgres) |
| `drizzle-kit` | 0.31.10 | 0.31.10 (só `devDependencies`) | sem advisory próprio no OSV; puxa `@esbuild-kit/*` e `esbuild` antigos (issue #5481) — manter fora da imagem de runtime e fora do `npm audit --omit=dev` |
| `@node-rs/argon2` | CONFERIR | última estável | KDF de B1 |

### 17.2 Next.js — advisories relevantes à linha 16 (desde 2025)

| Publicado | ID | O quê | Corrigido na linha 16 | Impacto no desenho |
| :--- | :--- | :--- | :--- | :--- |
| ago/2026 (25/08) | GHSA-2xp9-vwfh-vxw4 | RCE via AVIF no Image Optimization | 16.3.3 | mídia de cliente passa por `next/image`? preferir servir do MinIO sem otimização de AVIF de terceiros |
| ago/2026 | CVE-2026-75604 | RCE em servidor Windows (Pages + App Router sem Cache Components) | 16.3.3 | dev local em Windows |
| jul/2026 (20/07) | CVE-2026-64641 | DoS por CPU em Server Actions | 16.2.11 | — |
| jul/2026 | CVE-2026-64642 | bypass de middleware/proxy (Turbopack + um único locale) | 16.2.11 | A5 |
| jul/2026 | CVE-2026-64645 | SSRF/open redirect em `rewrites`/`redirects` com host do request | 16.2.11 | J3 |
| jul/2026 | CVE-2026-64649 | SSRF em Server Actions com servidor custom | 16.2.11 | não usar servidor custom |
| jul/2026 | CVE-2026-64643 | divulgação de IDs de Server Function | 16.2.11 | N5/A3 |
| jul/2026 | CVE-2026-64644, 64646, 64647, 64648 | DoS SVG, payload sem teto no Edge, confusão de cache de `fetch` com corpo | 16.2.11 | não usar Edge em actions |
| mai/2026 (11/05) | CVE-2026-45109, CVE-2026-44575 | bypass de middleware/proxy via segment-prefetch | 16.2.6 / 16.2.5 | A5 |
| mai/2026 | CVE-2026-44574, CVE-2026-44573 | bypass por injeção de parâmetro dinâmico; i18n do Pages Router | 16.2.5 | A5 |
| mai/2026 | CVE-2026-44578, 44579, 44576, 44580, 44581, 44582, 44572, 44577 | SSRF em WebSocket upgrade, DoS, cache poisoning, XSS (`beforeInteractive`, nonce CSP) | 16.2.5 | J5 |
| mar/2026 | CVE-2026-27978 | `Origin: null` burla CSRF de Server Actions | 16.1.7 | J7 |
| mar/2026 | CVE-2026-29057, 27979, 27980 | request smuggling em rewrites; DoS | 16.1.7 | — |
| dez/2025 | GHSA-9qr9-h5gf-34mp | RCE no protocolo React Flight | 16.0.7 | — |
| dez/2025 | GHSA-w37m-7fhw-fmv9, GHSA-mwv6-3258-q52c, GHSA-5j59-xgg2-r9c4 | exposição de código de Server Action; DoS RSC | 16.0.10 | — |
| mar/2025 | CVE-2025-29927 | `x-middleware-subrequest` pula o middleware | (linhas 12–15) | lição de A5 |

Nenhum advisory publicado para 16.3.4/16.3.5 até a data da busca; o blog de setembro/2026 não existia.

### 17.3 Better Auth — advisories (todas as linhas; nenhum aberto contra 1.7.3+ na data)

| Publicado (OSV) | ID | O quê | Corrigido | Relevância aqui |
| :--- | :--- | :--- | :--- | :--- |
| 24/07/2026 | GHSA-qq9h-g4jm-xgf3 / CVE-2026-67327 | pré-sequestro via magic link/email-OTP com cadastro aberto | 1.6.22 · 1.7.0-beta.10 | plugins não usados, cadastro fechado (C10) |
| 07/07/2026 | GHSA-g38m-r43w-p2q7 / CVE-2026-53516 | ATO por auto-link OAuth a e-mail não verificado | 1.6.11 | `accountLinking` desligado |
| 07/07/2026 | GHSA-fmh4-wcc4-5jm3 / CVE-2026-53514 | aceitar convite de organização com e-mail não verificado | 1.6.11 | plugin `organization` não usado |
| 07/07/2026 | GHSA-9h47-pqcx-hjr4 / CVE-2026-67336 | defaults cripto inseguros em `oidcProvider` (`alg:none`, PKCE `plain`) | 1.6.11 | não emitimos tokens (I14) |
| 07/07/2026 | GHSA-pw9m-5jxm-xr6h / CVE-2026-53512 (crítico) | replay de refresh token sem autenticação de cliente (oidc/mcp) | 1.6.11 | idem |
| 07/07/2026 | GHSA-86j7-9j95-vpqj / CVE-2026-67333 | XSS armazenado via `javascript:` em `redirect_uri` (oidc/mcp) | 1.6.13 · 1.7.0-beta.4 | idem |
| 07/07/2026 | GHSA-7w99-5wm4-3g79 / CVE-2026-53518; GHSA-392p-2q2v-4372 / CVE-2026-53517 | corrida em redenção de code e rotação de refresh (`oauth-provider`) | 1.6.11 | idem |
| 07/07/2026 | GHSA-2vg6-77g8-24mp / CVE-2026-67334 | sessões sobrevivem à exclusão de usuário (admin/anonymous/SCIM) | 1.6.11 | usuário nunca é excluído (ADR 3.1) |
| 04/06/2026 | GHSA-cq3f-vc6p-68fh / CVE-2026-45337 | device authorization aprova com qualquer sessão | 1.6.11 | plugin não usado |
| jun/2026 (blog) | GHSA-5rr4-8452-hf4v (crítico), GHSA-gv74-j8m3-fg5f, GHSA-prpr-5gj3-qqhg, GHSA-8c5h-wx78-2cfg (11/08) | falhas do `@better-auth/sso` | `@better-auth/sso` ≥ 1.6.11 / 1.6.30 | SSO não usado. (A skill cita CVE-2026-53513 como SSRF no SSO — não localizado no OSV do pacote `better-auth`; está no pacote `@better-auth/sso`, não verificado) |
| 15/05/2026 | GHSA-wxw3-q3m9-c3jr / CVE-2026-67335 | callback OAuth aceita `state` divergente sem PKCE | 1.6.2 | sem login social; mesma lição para OAuth de integração (I14) |
| 15/05/2026 | GHSA-p6v2-xcpg-h6xw / CVE-2026-45364 | limitador por IPv6 individual, burlável por rotação de prefixo | 1.4.17 | `ipv6Subnet: 64` (G21) |
| 03/04/2026 | GHSA-xg6x-h9c9-2m83 / CVE-2026-67337 (crítico) | bypass de 2FA por cache prematuro de sessão (`cookieCache`) | 1.4.9 | `cookieCache` desligado (F/H6) |
| 16/12/2025 | GHSA-x732-6j76-qmhm / CVE-2025-71399 | barra dupla burla `disabledPaths` e rate limit (rou3) | 1.4.5 | Route Handler também normaliza (A2) |
| 25/11/2025 | GHSA-4vcf-q4xf-f48m / CVE-2025-71400 | IDOR em delete de passkey | 1.4.0 | G5 |
| 26/11/2025 | GHSA-wmjr-v86c-m9jj / CVE-2025-71402 | multi-session sign-out revoga sessão arbitrária | 1.4.0 | plugin não usado |
| 01/12/2025 | GHSA-569q-mpph-wgww / CVE-2025-71401 | DoS por `basePath` externo | 1.4.2 | — |
| 09/10/2025 | GHSA-99h5-pjcv-gr6v / CVE-2025-61928 | criação de API key sem autenticação | 1.3.26 | plugin `api-key` não usado |
| 07/07/2025 | GHSA-36rg-gfq2-3h56 / CVE-2025-53535 | open redirect no `originCheck` | 1.2.10 (a skill dizia "1.3.x") | J3 |
| 24/02/2025 | GHSA-vp58-j275-797x / CVE-2025-71403; GHSA-hjpm-7mrm-26w8 / CVE-2025-27143 | bypass de `trustedOrigins` (ATO); open redirect sem esquema | 1.1.21 / 1.1.20 | J2/J3 |

### 17.4 Drizzle

| Publicado | ID | O quê | Corrigido | Relevância |
| :--- | :--- | :--- | :--- | :--- |
| 08/04/2026 | GHSA-gpj5-g38j-94v9 / CVE-2026-39356 | escape de identificador em `escapeName()` (Postgres/SQLite/SingleStore) permite SQLi via `sql.identifier()`/`.as()` | 0.45.2 · 1.0.0-beta.20 | ordenação/colunas dinâmicas em listas (conversas, pedidos) devem usar **mapa fechado** de colunas, nunca nome vindo do cliente — trava [fonte]: `sql.identifier(` e `.as(` só com literal ou chave de mapa |
| — | drizzle-kit | esbuild/`@esbuild-kit` desatualizados (issue #5481) | sem correção | dev-only |

---

## 18. Pendências marcadas `CONFERIR` e decisões a validar

1. Subpaths de import na 1.7.5 (`createAuthMiddleware`, chave de `schema` do passkey, nome exato do endpoint de login por passkey) — ler `node_modules` após instalar.
2. Se `@better-auth/core` exporta a função de IP (evitar 2ª implementação, C6).
3. Se `hooks.after` consegue retirar `backupCodes` da resposta de `/two-factor/enable` e se `storeBackupCodes` custom que descarta não quebra o enable (D7).
4. Se o BA 1.7.5 já faz anti-replay do mesmo passo TOTP (D6) e invalida reset anterior ao emitir novo (D18).
5. `advanced.cookies.session_token.name` para prefixo `__Host-` (F1).
6. Topologia real do Traefik no EasyPanel: apenda ou sobrescreve `x-forwarded-for`; faixas de rede para `trustedProxies` (medir em HML — C6/G21).
7. Formato vigente das assinaturas de webhook do TikTok Shop e do provedor de pagamento escolhido; suporte a PKCE no OAuth do Bling e do TikTok Shop.
8. Decisões para Paulo: (a) `admin` como privilégio máximo × criar `dono` (H1); (b) exceção de delete físico em `usuarios_sessoes`/`usuarios_verificacoes` (ADR 3.1); (c) sem OTP por e-mail e sem códigos de resgate (ADR 3.5); (d) teto de sessão 12 h e inatividade 60 min (F2/F3); (e) até 3 sessões simultâneas (F14); (f) marcador de "tabela de framework" no `check-compliance.mjs`.

### 18.1 Cobertura do catálogo

A1–A8 (§6) · B1–B10 (§7) · C1–C11 (§8) · D1–D18 (§9) · E1–E14 (§10) · F1–F14 (§11) · G1–G8 (§12) · H1–H12 (§13) ·
I1–I15 (§14) · J1–J7, K1–K8, L1–L9, M1–M6 (§15). Marcados ⚪ por decisão ou inexistência, com a decisão escrita:
A7, A8, C10, D3, D7, D17 (parcial), H11, I7, I14 (parcial: só como cliente OAuth), K7.
