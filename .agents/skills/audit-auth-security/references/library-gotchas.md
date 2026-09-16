# Armadilhas por biblioteca e framework — o que os defaults escondem

> A regra que gera esta lista: **o default não é seguro por definição, e a documentação oficial
> descreve a versão mais nova.** Confira contra a versão **instalada** (lockfile). Muitas destas
> não aparecem em code review nem no `tsc` — só na requisição real.

## Better Auth (todas as linhas)

Verificado em campo na 1.7.2 (projeto `bahtech-checkout`). Cada item foi medido no pacote
instalado.

| Armadilha | Efeito | Onde conferir |
| :--- | :--- | :--- |
| `verification.storeIdentifier` default **`"plain"`** | token de reset, verificação de e-mail e código 2FA ficam **legíveis** na tabela `verification` — quem lê o banco monta o link de reset de qualquer conta | ler config; `SELECT identifier FROM verification` |
| `twoFactor.otpOptions.storeOTP` default **`"plain"`** | código de 6 dígitos em claro no banco | config |
| `otpOptions.period` é em **MINUTOS** (`totpOptions.period` é em segundos, mesmo plugin) | `period: 180` = 3 h de código válido | config; o valor certo é fração (45 s = `45/60`) |
| `emailAndPassword.autoSignIn` default **`true`** | cadastro e reset **criam sessão** e pulam o segundo fator | config deve ser `false` |
| `session` sem bloco → **renovação infinita** (7 dias renovados a cada uso, sem teto) | cookie copiado nunca expira; **`disableSessionRefresh: true` é o ÚNICO teto absoluto** (a renovação é binária, não há "renove até X") | ler `session:` em auth |
| `rateLimit.storage` default **`"memory"`** (`Map` no módulo) | em serverless o teto vira `max × instâncias`; exige tabela `rate_limit` que o pacote **não cria** — e a coluna `id` (ausente na declaração do núcleo) faz o limitador entrar em **recursão infinita**; `id` `serial` em vez de `text` derruba **todo** `/api/auth/**` com 500 | config + schema da tabela |
| **plugin `twoFactor` NÃO conta falha de SENHA** (`accountLockout` conta falha de 2º fator) | ligar 2FA **não** dá bloqueio por tentativa de senha — é preciso módulo próprio | `grep` do lockout de senha |
| `password.hash`/`verify` **rodam no login** (equalização de tempo p/ e-mail inexistente) | plugar política de senha ali reprova tentativas de login e vira **oráculo**; use `hooks.before` com lista branca | onde a política está pendurada |
| no `/reset-password` o **token é consumido antes** do `password.hash` | recusar senha fraca dentro do hash **queima o link** | ordem do hook (deve ser `before`) |
| plugin **passkey** cabeia `requireUserVerification: false` nas duas verificações (sem opção) | sem gancho `afterVerification` que exija `userVerified`, a conta cai para "posse do aparelho" — o `userVerification: "required"` é só pedido ao navegador | ler `afterVerification` |
| `getRpID` do passkey deriva de `baseURL` (cadeia de 6 env vars); `expectedOrigin` cai no header `Origin`/`trustedOrigins` | `rpID` divergente **inutiliza todas as chaves de uma vez** (hash SHA-256 exato, sem sufixo) — fixar da **mesma** variável do `trustedOrigins` | config do passkey |
| `setUserPassword` (plugin admin) **não revoga** sessões do alvo e **não** consulta `revokeSessionsOnPasswordReset` | admin reseta senha de conta comprometida e **não** expulsa o invasor | parear com `revokeUserSessions` |
| `onPasswordReset` dispara **só** no `/reset-password`, nunca no `/change-password` | histórico/auditoria/limpeza de `must_change` perdem a troca do usuário logado | usar `databaseHooks.account.update.before` |
| plugin admin: `ac` é **inerte no servidor** (autoriza por `roles`); `adminUserIds` é **bypass total**; `listUsers` engole erro e devolve lista vazia com 200; `createUser` sem `headers` pula a permissão | escalonamento e falha silenciosa | ler `has-permission.mjs`, `routes.mjs` |
| `disabledPaths` responde 404 **com corpo** ("Not Found"), enquanto caminho inexistente responde 404 **sem corpo** | a diferença de bytes é um oráculo de "este caminho existe e foi desligado" — o Route Handler precisa devolver 404 de corpo nulo | `curl -i` comparativo |
| `sendEmail` (deste projeto) **retorna** `{success:false}`, não lança; e o plugin de OTP **engole** a falha e responde `{status:true}` | "código enviado", código não chega, **nada** no log — conferir o **retorno**, não só `try/catch` | ler o `sendOTP`/`sendResetPassword` |
| 1.7: `account.issuer` — identidade de conta passou a ser `issuer`+`accountId` com índice único, **exige backfill**; scripts de migração da doc escrevem `issuer` e quebram em 1.4/1.6 | migração e login | §26/§27 do doc |

**Advisories** (detalhe e versões em `standards-and-recency.md`): CVE-2025-61928 (API key sem
auth), CVE-2025-53535 (open redirect no `originCheck`), CVE-2026-53513 (SSRF no `@better-auth/sso`),
CVE-2026-67336 (defaults cripto inseguros em `oidcProvider`/`mcp`).

## Next.js

| Armadilha | Efeito |
| :--- | :--- |
| **Middleware não é fronteira de segurança** | CVE-2025-29927: `x-middleware-subrequest` forjado **pula o middleware inteiro**. Mai/2026: 3 CVEs de bypass via segment-prefetch e `[locale]` padrão. A checagem vive na **página, no handler e na action** |
| **Server Actions são endpoints POST abertos** | todo `export` de `'use server'` responde a `curl`; `disabled`/ocultar botão não protege; identificadores de action são determinísticos e legíveis no bundle |
| `middleware.ts` → `proxy.ts` no Next 16 | mesma lição, nome novo |
| `getSessionCookie()` no middleware "protegendo" rota | a doc escreve *"THIS IS NOT SECURE!"* — o cookie só diz que existe, não valida |
| body parser antes do handler de auth (não-Next) | corpo chega vazio sem erro claro |
| `nextCookies()` fora do fim do array de plugins | Server Action não grava cookie |

## Auth.js / NextAuth · Clerk · Supabase · Auth0 · WorkOS

- **Auth.js**: tabelas no plural; o callback `[...nextauth]` some; o hash da senha é **seu** (era o
  `authorize` que hasheava).
- **Clerk**: exportar hash exige **CSV do dashboard** + Backend API (as contas sociais só vêm da
  API); `password_hasher` diz o algoritmo.
- **Supabase**: hash bcrypt em `auth.users`; **RLS e 2FA não migram sozinhos** — se a autorização
  depende de `auth.uid()`, reescrever.
- **Auth0**: export de hash é **só Enterprise** (free abre ticket).
- **WorkOS**: **não exporta hash** — todo mundo reseta a senha.
- **Firebase/Cognito/Okta**: guardam o verificador **fora** do seu banco — plano que assume
  `SELECT password_hash` morre no dia da execução.

## Django · Rails · Laravel · Spring · ASP.NET (agnóstico)

- **Django**: `PASSWORD_HASHERS` (PBKDF2 padrão; Argon2 disponível); `SESSION_COOKIE_SECURE`,
  `SESSION_COOKIE_HTTPONLY`, `SESSION_COOKIE_SAMESITE`, `SESSION_EXPIRE_AT_BROWSER_CLOSE`;
  `login_required`/`permission_required` em **toda** view — DRF: `permission_classes` (o default
  `AllowAny` global é achado); admin em `/admin/` exige 2FA (pacote externo); `django-hijack`
  (impersonação) tem `HIJACK_PERMISSION_CHECK` default `superusers_only` — mas
  `HIJACK_ALLOW_GET_REQUESTS` deixado em `True` permite iniciar a troca por um link comum, sem
  confirmação de intenção.
- **Rails/Devise**: `config.stretches`; `:lockable`, `:timeoutable`, `:trackable` ligados?
  `protect_from_forgery`; strong parameters não deixam `role`/`admin` passar por mass-assignment.
  ⚠️ `sign_in_after_reset_password` tem **default `true`**: o link de recuperação cria sessão e
  pula qualquer segundo fator (E3/E4) — ligar `false` explicitamente. `switch_user` (gem
  `pretender` ou nativo) só libera em `development` por padrão via `config.controller_guard`;
  confira se algum inicializador afrouxou isso para produção.
- **Laravel**: Fortify/Sanctum; `throttle` nas rotas de login/reset; `hashed` cast na senha;
  `EnsureEmailIsVerified`. Remoção de 2FA por autoatendimento existe por desenho
  (`password_timeout` do Fortify define a janela de reautenticação — medir o valor real, não
  supor); `lab404/impersonate` expõe `canImpersonate`/`canBeImpersonated` — confirme que nenhum
  dos dois aceita `true` incondicional.
- **Spring Security**: `SecurityFilterChain` — `permitAll()` largo demais é achado; CSRF ligado
  para sessão; `BCryptPasswordEncoder` custo ≥ 10; método com `@PreAuthorize`. `SwitchUserFilter`
  (impersonação) — `switchUserUrl` sem `hasRole('ADMIN')` na cadeia de filtros é achado direto.
  ⚠️ Frameworks de admin/baixo código sobre Spring (ex. **Casdoor**) e alguns starters chegam com
  **conta padrão documentada** (usuário/senha do primeiro boot) — testar login com ela antes de
  assumir que "não existe conta padrão" (C8).
- **ASP.NET Identity**: `Password`/`Lockout`/`SignIn` options; `[Authorize]` por controller;
  cookie `SecurePolicy`.
- **Auth hospedado (Keycloak, Ory, Clerk, Supabase, Auth0)**: ao contrário do Better Auth (onde
  desligar 2FA é endpoint que NINGUÉM deveria chamar — D10), estes ecossistemas oferecem a
  remoção do fator **por desenho**, como autoatendimento do usuário. O requisito não muda de cor
  por isso — muda o que se mede: a **janela de reautenticação real** antes da remoção (Keycloak
  `requiredActions`, Ory `privileged_session_max_age`, Clerk/Supabase/Auth0 — ler a config do
  painel, nunca supor pelo valor de exemplo da documentação).

## JWT / sessão caseiro

- Segredo forte, algoritmo fixo (rejeitar `alg: none` e a confusão HS256/RS256), `exp`/`aud`/`iss`
  validados; **revogação no servidor** (JWT stateless não revoga — é preciso versão de credencial
  ou lista curta); rotação de refresh token; nada sensível no payload (é base64, não cifra).

## Cliente nativo (iOS/Android) e API pura sem cookie de navegador

O vocabulário de F1/J7 (`HttpOnly`, `SameSite`, `Origin`, `Sec-Fetch-Site`) não existe nesse
modelo — o token fica fora do navegador e o risco equivalente é **exfiltração do dispositivo**,
não CSRF:

- **Armazenamento**: iOS Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` ou mais
  estrito) / Android Keystore — nunca `UserDefaults`/`SharedPreferences` em claro, nunca
  `AsyncStorage` sem camada de criptografia própria.
- **Transporte**: certificate pinning reduz o risco de MITM que substitui o papel do CSP/CORS do
  navegador; TTL de access token curto, refresh com rotação (mesma régua de I14 se o app é OAuth
  client).
- **Reautenticação sensível**: biometria/PIN do sistema operacional antes de ações críticas
  (mudar senha, ver código de resgate) é o equivalente móvel da sessão fresca (F9).
- **Engenharia reversa**: segredo de cliente (`client_secret`, chave de API) embutido no binário
  do app **não é segredo** — decompila em minutos; use PKCE (público, sem `client_secret`) e
  nunca confie em ofuscação como controle de segurança.

## Como usar esta referência

Confirme cada item **na versão instalada** — leia o pacote quando preciso (`node_modules`), não a
documentação. O achado é da versão; registre-a. O que não está aqui, mas a biblioteca em uso
introduz, vira lição nova: registre no relatório e, se recorrente, proponha adicionar aqui
(mantendo a skill — ver `authoring-checklist` da `skill-authoring`).
