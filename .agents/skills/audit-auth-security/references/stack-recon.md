# Reconhecimento — descobrir a stack, a biblioteca e TODOS os caminhos

> Nunca escreva um achado antes de fechar esta fase. O erro que mais custa numa auditoria é
> julgar o que você **acha** que o sistema tem. Aqui você descobre o que ele **tem**, com
> evidência, e agnóstico de linguagem.

## Passo 1 — Stack e hospedagem

Descubra, com comando + saída:

- **Runtime e gerenciador**: `node --version`, lockfile presente (`package-lock`, `yarn.lock`,
  `pnpm-lock`, `bun.lockb`), ou `python --version`/`ruby -v`/`go version`/`java -version`.
- **Framework HTTP / meta-framework**: Next, Express, Fastify, Hono, Nest, SvelteKit, Nuxt,
  Django, Flask, FastAPI, Rails, Laravel, Spring, ASP.NET.
- **Banco e camada de acesso**: Postgres/MySQL/SQLite/Mongo; Drizzle/Prisma/Kysely/`pg`,
  SQLAlchemy, ActiveRecord, Hibernate.
- **Hospedagem e proxy** — isto decide se `x-forwarded-for` é confiável (C6, J1): Vercel, Cloud
  Run, ALB, Nginx, Cloudflare. **Meça**, não suponha: duas requisições com `X-Forwarded-For`
  diferentes gravam o mesmo IP? (a plataforma sobrescreve) ou o valor do cliente? (forjável).

## Passo 2 — Biblioteca de auth e VERSÃO INSTALADA

A versão é do **lockfile / `node_modules`**, nunca do `package.json` (que traz o intervalo, não o
resolvido). A versão importa: metade das armadilhas de `library-gotchas.md` é específica de versão,
e a documentação oficial descreve a mais nova.

| Sinal | Confiável? | Por quê |
| :--- | :--- | :--- |
| **Pacote / dependência** | ✅ afirma | `@clerk/nextjs`, `better-auth`, `next-auth`, `devise`, `django.contrib.auth` só existem se instalados |
| **Variável de ambiente** | ✅ afirma | `CLERK_SECRET_KEY`, `BETTER_AUTH_SECRET`, `NEXTAUTH_SECRET`, `AUTH0_DOMAIN` |
| **Nome de cookie** | ⚠️ só confirma | configurável |
| **Nome de tabela** (`session`, `users`) | ⚠️ só confirma | genérico, colide entre soluções |

Cobertura: Better Auth, Auth.js/NextAuth, Clerk, Supabase, Auth0, WorkOS, Lucia, Passport,
`iron-session`, Devise, Django auth, Laravel Fortify/Sanctum, Spring Security, ASP.NET Identity,
Keycloak/Ory, ou **JWT/sessão caseiro** (o caso mais comum e menos visível: `jsonwebtoken`/`jose`
+ `bcrypt`/`argon2` + tabela própria; sinais `JWT_SECRET`, um `middlewares/auth`, `Authorization:
Bearer` montado à mão).

## Passo 2b — Quando a autenticação é um IdP hospedado (Auth0, Clerk, WorkOS, Cognito, Okta, Entra)

Se o Passo 2 identificou um IdP hospedado, boa parte do catálogo (política de senha, bloqueio,
MFA, blocklist de senha vazada, sessão) vive na **configuração do locatário**, fora do
repositório. O método de "duas passadas" e os comandos de enumeração de rotas (`router.stack`,
`show_urls`, `rails routes`) não encontram nada ali — sem este passo o auditor marcaria ⚪ em
cascata por falta de evidência, quando a evidência correta está no painel/API do provedor.

Leia a configuração do locatário (painel administrativo ou Management API, nunca o SDK do
cliente) e registre como evidência (print datado, ou resposta da API mascarando segredos):

| Item do catálogo | Onde fica, por provedor |
| :--- | :--- |
| Política de senha (B1–B10) | Auth0: *Authentication › Database › Password Policy* + *Attack Protection*; Clerk: *User & Authentication › Password*; Cognito: `UserPoolPolicies.PasswordPolicy`; Okta: *Security › Authenticators › Password*; Entra: *Authentication methods › Password protection* |
| Bloqueio por tentativa (C1) | Auth0 *Attack Protection › Brute-force*; Cognito não tem lockout nativo — **ausência é achado**, não suposição de que existe; Okta *ThreatInsight*; Entra *Smart Lockout* |
| Blocklist de senha vazada (B3) | Auth0 *Attack Protection › Breached Password Detection* (desligado por padrão); Entra *Password protection › Custom banned passwords* |
| MFA obrigatório / fatores (D1–D18) | Auth0 *Guardian*/*MFA policies*; Cognito `MfaConfiguration` (`OFF`/`OPTIONAL`/`ON`); Okta *Authenticators*/*Sign-On Policy*; Entra *Conditional Access* — "ligado" no painel é o único jeito de confirmar D1, não a presença do SDK |
| Sessão (F1–F14) | Auth0 *Sessions* (idle/absolute); Cognito token TTLs no App Client; Okta/Entra política de sessão do IdP |
| Callback/redirect permitidos (I14, J3) | *Allowed Callback URLs*/*Redirect URIs* do client — testar um sufixo/subdomínio não listado |
| Rastro/logs (L1) | Exportação para SIEM próprio — a retenção nativa do painel costuma ser curta (dias); ausência de exportação é ❌ em L1 |
| Domínio customizado / e-mail (D16, J1) | domínio de auth próprio configurado, ou o padrão do provedor (`*.auth0.com`) some do link de e-mail? |

`G1` ("tela de segurança existe") também muda de forma aqui: se a tela **é** a UI hospedada do
provedor (Auth0 Universal Login/My Account, Clerk `<UserProfile>`), isso conta como ✅ — o
catálogo já prevê essa leitura em G1.

## Passo 3 — TODOS os caminhos que criam sessão ou concedem acesso

O problema central da auditoria: quase todo sistema real tem mais de um caminho vivo, e o
esquecido é a brecha. Enumere **por evidência**, não por memória:

senha · OTP/código por e-mail · TOTP · código de resgate · passkey/WebAuthn · login social ·
magic link · convite/auto-cadastro · callback de IdP · impersonação/admin · API key · OIDC de CI ·
webhook · Server Action · cron · SSO/SAML.

**Método de duas passadas** (agnóstico):

```bash
# PASSADA 1 — descobrir o vocabulário de guardas DESTE projeto (não adivinhar nomes)
grep -rohE "\b[a-zA-Z_]+(Auth|Guard|Middleware|Permission|Protect|Verify|require[A-Z]\w*)\b" \
  src/ app/ 2>/dev/null | sort | uniq -c | sort -rn | head -20

# PASSADA 2 — inverter: listar rotas/handlers que NÃO citam nenhum guarda do vocabulário achado
#   (substitua o alternation pelos nomes reais da passada 1)
```

Enumerar rotas **em runtime**, por framework:

- **Express**: percorrer `router.stack`, comparando a **identidade da função** de guarda
  (`s.handle === authMiddleware`), **nunca** `fn.name` (arrow anônima marca protegida como
  desprotegida).
- **Next**: `find app -name 'route.ts'` + toda pasta com `page.tsx` sob rota protegida; e a
  varredura de Server Actions abaixo.
- **Django**: `manage.py show_urls`. **Rails**: `rails routes`. **Spring**:
  `RequestMappingHandlerMapping`. **Laravel**: `php artisan route:list`.

**Server Actions do Next não aparecem em inventário de rota** — cada `export` de módulo
`'use server'` é um endpoint POST público:

```bash
grep -rln "'use server'" src/ app/ 2>/dev/null | while read f; do
  grep -qE "require(User|Route)?(Permission|Access)|getSession|auth\(" "$f" || echo "SEM GUARDA: $f"
done
```

## Passo 4 — Inventário dos endpoints que a BIBLIOTECA instala

Este passo pega o que a tela não mostra. A biblioteca de auth instala rotas que ninguém pediu e
que respondem a `curl` (foi assim que `/two-factor/disable` ficou vivo — N11.4 do doc; e a
CVE-2025-61928 do Better Auth criava API key sem autenticação).

- **Better Auth**: ler `node_modules/better-auth/dist/**/routes*.mjs` e os plugins registrados
  (`node_modules/@better-auth/*`); listar cada `path`. Cruzar com o que o app chama.
- **Django/Rails/Laravel**: as rotas que o pacote de auth registra por padrão.
- Para cada endpoint **instalado sem chamador**: ele está **desligado no servidor** (404/403) ou
  **justificado**? Se não, é achado (A2). Endpoints perigosos por padrão a procurar: desligar 2FA,
  ler segredo TOTP, regenerar códigos de resgate, criar/rotacionar API key, impersonar.

## Passo 5 — As três superfícies e o portão de cada uma

Mapeie **pública** (checkout, cadastro por convite, docs, coletores), **privada** (workspace
autenticado) e **máquina** (API/M2M, cron, webhook, CI). Cada uma tem portão diferente (domínio N6
do doc). O erro recorrente é aplicar a régua de uma à outra — ex.: exigir sessão de um webhook, ou
deixar uma Server Action "interna" sem permissão porque "só a tela privada chama".

## Passo 6 — Inventário de dados (antes de qualquer conclusão sobre migração)

Se a auditoria acompanha uma migração/substituição, saber o tamanho muda o plano: quantos usuários,
quantos com senha, formato dos hashes (classificação por regex — ver B1 em `requirements-catalog.md`),
quantos com 2FA, quantos inativos há mais de um ano.

## Saída desta fase

Um mapa, com evidência, que alimenta as fases seguintes:

- stack + hospedagem (e a resposta medida sobre `x-forwarded-for`);
- biblioteca de auth **e versão instalada**;
- lista completa dos caminhos que criam sessão (com o guarda de cada um, ou a ausência dele);
- lista dos endpoints que a biblioteca instala × chamadores (os órfãos marcados);
- as três superfícies e seus portões.
