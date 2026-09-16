# 06 — Análise das skills e ferramentas (para o Paulo)

> Escopo: todas as skills e ferramentas que a equipe tem hoje, com foco na de segurança (`audit-auth-security`),
> avaliadas contra a reconstrução do MerlostoreChat (Next 16.3 + Better Auth 1.7.5 + Drizzle 0.45 + PostgreSQL 16).
> Base: levantamentos 07 (régua de segurança), 08 (skills e ferramentas da base), 09 (referências e versões)
> e 10 (skills de design). Data: 15/09/2026. Tudo abaixo é leitura; nenhum arquivo dos repositórios foi alterado.

---

## 1. Resumo executivo

1. **A skill de segurança é a mais madura do conjunto e é a única que já vira contrato.** Ela é READ-ONLY, agnóstica
   de stack, tem catálogo de requisitos com IDs estáveis (`REQ-A1` a `REQ-M6`), portão de entrega explícito e relatório
   em sinaleira. O levantamento 07 já a converteu de régua de *auditoria* em régua de *construção*: para cada REQ existe
   o que construir, onde, a config exata do Better Auth e a trava (teste) que impede a regressão. Isso significa que a
   reconstrução não precisa "passar na auditoria depois" — ela nasce dentro da régua, e a auditoria vira conferência.

2. **As demais skills da base são boas de fluxo, mas estão uma stack atrás.** `criar-tabela`, `criar-crud` e
   `criar-componente` foram escritas antes de Next 16, Better Auth, Tailwind v4, multi-loja e antes das três armadilhas
   que já custaram caro (precisão de timestamp, delete físico do Better Auth, Server Action como POST aberto). Elas
   precisam ser reescritas **antes** de gerar o primeiro arquivo do repo novo, senão cada entidade nasce com o mesmo
   defeito repetido.

3. **O enforcement real hoje tem um buraco: o CI.** As regras são bloqueadas por hooks que só existem dentro do Claude
   Code (`base/.claude/hooks/*`). Codex, Antigravity, qualquer pessoa da equipe e qualquer commit vindo de fora passam
   por baixo — e o `deploy.yml` da base **não roda o auditor** (`base/.github/workflows/deploy.yml:48-61`). A correção é
   barata: acrescentar `compliance`, `test:compliance`, `docs:check` e `ai-marks --check` ao pipeline.

4. **O auditor (`check-compliance.mjs`) cobra menos do que o CLAUDE.md promete.** Ele exige 4 colunas de auditoria
   (`base/scripts/check-compliance.mjs:130`), não as 5 — `modified_by` é só convenção. Também não vê FK, `onDelete`,
   `precision`/`withTimezone`, nome hierárquico nem idioma. E tem brechas que o código novo não pode usar: `tx.delete(`,
   `sql\`DELETE\``, `pgTable` na forma callback e `db.query.*.findMany` escapam.

5. **Falta uma decisão que trava o schema inteiro: como o auditor trata as tabelas do Better Auth.** A lib apaga
   sessões e verificações fisicamente; a regra da casa proíbe. Não existe marcador de "tabela de framework" na base (só
   `compliance:append-only`); o HUG resolveu com uma lista fixa que a base não tem. Sem essa decisão (ADR + marcador
   novo), ou o schema reprova ou alguém usa `append-only` como gambiarra.

6. **As skills de design existem, são genéricas e já foram traduzidas em valores concretos.** São 32 skills em quatro
   plugins (design-systems, ui-design, interaction-design, visual-critique), com 20 a 60 linhas cada e nenhum valor de
   produto. O levantamento 10 fez o trabalho que elas não fazem: paleta com contraste calculado por fórmula WCAG,
   7 tokens de texto, escala de espaçamento, layout responsivo da tela de Conversas, spec do modal block e um checklist
   de crítica visual com prioridade P1/P2/P3. É isso que entra na UI, não as skills cruas.

7. **Há conteúdo de outro cliente dentro da base.** A cópia de `how-to-use-guide` em
   `base/.claude/skills/how-to-use-guide/SKILL.md:13` é a do **ERP Auto Peças**. Não pode ser copiada para o repo novo
   como está.

8. **Recomendação de sequência:** commit zero com ferramentas corrigidas e skills reescritas → ADRs (incluindo o do
   delete físico do Better Auth) → schema → CRUD → UI → auth endurecido → `/audit-auth-security` antes de entregar.

---

## 2. `audit-auth-security` — a skill de segurança

### 2.1 O que é

Auditoria **agnóstica de stack** de autenticação e conta: login, senha, MFA/2FA (e-mail, TOTP, passkey/WebAuthn),
reset e recuperação, sessão, tela "meu perfil", super-admin, RBAC, público × privado, API/M2M/webhooks, borda e
auditoria. Ela **descobre** a stack e a biblioteca de auth (Better Auth, Auth.js, Clerk, Supabase, Auth0, Django,
Laravel, Spring, JWT caseiro) em vez de assumir. É **READ-ONLY** e **reexecutável**: roda quantas vezes quiser sem
efeito colateral no sistema auditado.

Material da skill: `SKILL.md` + `references/` com `requirements-catalog`, `threat-catalog`, `library-gotchas`,
`standards-and-recency`, `stack-recon`, `engagement-safety` e `report-template`. Os padrões de referência são
NIST SP 800-63B-4, OWASP ASVS 5.0 e OWASP Top 10:2025.

Na casa ela anda junto com `estrutura base/docs/seguranca-login.md`, que é a régua curta (5 princípios, portão de
entrega em 9 blocos, tabela de armadilhas reais e 3 varreduras que devem ficar no repo).

### 2.2 Como funciona — as 5 fases

| Fase | O que faz | Por que importa aqui |
|---|---|---|
| 1. Reconhecimento | Descobre stack e lib de auth, lê a **versão instalada pelo lockfile** (não o `package.json`), e inventaria **todos** os caminhos que criam sessão — inclusive endpoints que a biblioteca instala sem ninguém chamar | É o que pega o buraco clássico: o HUG declara `^1.2.0` e tem 1.6.25 instalado. E o Better Auth instala dezenas de rotas por plugin |
| 2. Catálogo | Percorre `REQ-A1..M6` com IDs estáveis, marcando cada um | IDs estáveis = a auditoria de hoje é comparável com a do trimestre que vem |
| 3. Ataques simulados | Sem dano, **só em local ou HML** | `engagement-safety` exige que o teste confira que o host do `DATABASE_URL` é local/container e que o nome do banco contenha `test` antes de rodar |
| 4. Armadilhas e advisories | Armadilhas conhecidas da lib + CVEs/GHSAs abertos contra a versão instalada | Foi essa fase que rendeu as 28 armadilhas confirmadas no `dist` do `better-auth@1.7.5` |
| 5. Relatório | Sinaleira com evidência, em `~/Downloads/auth-audit-<repo>-<data>.md` | Entregável para o cliente e para o histórico |

### 2.3 O catálogo A..M

| Domínio | Assunto | Onde está detalhado para o Merlo |
|---|---|---|
| **A** (A1–A8) | Inventário e isonomia de caminhos de acesso | 07 §6 |
| **B** (B1–B10) | Senha: KDF, comprimento, vazadas, política, troca | 07 §7 |
| **C** (C1–C11) | Login, anti-automação, bloqueio, oráculos de existência | 07 §8 |
| **D** (D1–D18) | Segundo fator e fatores resistentes a phishing | 07 §9 |
| **E** (E1–E14) | Recuperação de conta, reset, troca de e-mail | 07 §10 |
| **F** (F1–F14) | Sessão: cookie, teto, inatividade, revogação, frescor | 07 §11 |
| **G** (G1–G8) | Tela "Meu perfil › Segurança" | 07 §12 |
| **H** (H1–H12) | Administração, privilégio máximo, RBAC, escopo | 07 §13 |
| **I** (I1–I15) | Área pública e canal de máquina: webhooks, crons, OAuth | 07 §14 |
| **J** (J1–J7) | Borda: origem, cabeçalhos, CSP, proxy, cookies | 07 §15.1 |
| **K** (K1–K8) | Segredos, criptografia, armazenamento | 07 §15.2 |
| **L** (L1–L9) | Auditoria, monitoria e resposta a incidente | 07 §15.3 |
| **M** (M1–M6) | Travas, versões, interruptores e exceções | 07 §15.4 |

### 2.4 Sinaleira e portão de entrega

Cada REQ recebe uma cor: **vermelho** (item de portão — reprova a entrega se não atendido ou sem evidência),
**laranja** (importante), **amarelo** (recomendado), **verde** (polimento) e **branco** (não se aplica, com a decisão
escrita).

O portão de entrega, isto é, o que **bloqueia** a entrega de um sistema com login:

```
A2 A3 A5 · B1 B9 B10 · C1 C4 · D1 D2 D5 D7 D8 D10 · E1 E2 E3 E4 E8 ·
F1 F2 F4 F5 F6 · G2 G8 · H1 H2 H3 H5 · I1 I6 I8 · J1 J3 J4 · K1 K3 · L1 L2 L3 L5 · M1 M2
```

Um item de portão só passa como "não" com **exceção escrita: motivo + quem decidiu + até quando**, no código e em ADR.
O formato combinado é `// EXCECAO-SEG: REQ-X | motivo | decidido por | ate AAAA-MM-DD`, e existe uma trava que reprova
o CI quando a data vence (07 §15.4 M6).

### 2.5 Os três tipos de trava

A skill não aceita "está feito" sem prova executável. Cada requisito de portão vira um teste:

- **[fonte]** — Vitest que lê arquivos do repositório (regex/AST) e reprova padrão proibido ou ausência de padrão
  obrigatório. Roda sem banco. Exemplo: toda Server Action começa pelo guard, por **identidade de função** (resolve o
  import, não o nome), com piso mínimo de handlers encontrados para o teste não passar vazio.
- **[integração]** — Vitest contra o Postgres de teste (docker, 5437, banco `*_test`) e Redis (6382), medindo resposta
  real: status, bytes, `Set-Cookie`, linhas no banco.
- **[config]** — importa o objeto de config do Better Auth / `next.config` e confere valores.

São 26 arquivos de trava mapeados (07 §16, `T1`..`T26`) mais três passos de CI: `check-compliance`,
`npm audit --omit=dev --audit-level=high` + `gitleaks`, e `scripts/fumaca-seguranca.mjs` pós-deploy.

### 2.6 O que ela exige de um sistema como o Merlo e como a reconstrução atende

O ponto importante: **o Better Auth default reprova em vários itens de portão**. As 28 armadilhas foram lidas no `dist`
publicado do `better-auth@1.7.5` (não na documentação). As que mais mudam o desenho:

| Exigência da skill | Default que reprova | O que a reconstrução faz |
|---|---|---|
| **B1** KDF no piso OWASP | scrypt N=16384, r=16 (~32 MiB), `@better-auth/utils@0.4.2 dist/password.node.mjs:4-7` | Argon2id m=19456, t=2, p=1 via `@node-rs/argon2` em `emailAndPassword.password.hash/verify` — só KDF ali, nunca política (o hash roda também no login) |
| **C1** bloqueio por conta atômico | Não existe: o rate limit do BA é por IP e o `accountLockout` do plugin `twoFactor` só conta falha do 2º fator (`verify-two-factor.mjs:118-122`) | `src/lib/auth/bloqueio.ts` com um único `UPDATE` condicional (5 falhas / 15 min), chamado pelo Route Handler |
| **C4** recusa única byte-a-byte | Conta banida responde `BANNED_USER`, e-mail não verificado responde 403 **depois** da senha certa (`sign-in.mjs:318-336`, `admin.mjs:33-47`) — oráculo "existe + senha certa + desativada" | Normalização de **toda** recusa de `/sign-in/*` no Route Handler: 401, corpo fixo, mesmos cabeçalhos, piso de tempo |
| **A2** caminho sem chamador desligado | `disabledPaths` responde 404 **com corpo** `"Not Found"`, caminho inexistente responde 404 **sem corpo** (`api/index.mjs:166-168`) — oráculo "existe e foi desligado" | Route Handler devolve `new Response(null, {status:404})` antes de chamar o BA; trava varre `node_modules` atrás de `createAuthEndpoint` e reprova rota nova não classificada |
| **D1** 2º fator obrigatório | **Não existe nativamente** no Better Auth (só para quem já ativou) | Provisionamento por convite: conta só vira `ativo=true` com passkey (UV) ou TOTP verificado; gate `precisa_configurar_fator` no guard |
| **D8/D9** passkey não pode furar o 2FA | O 2º fator só intercepta `/sign-in/email|username|phone-number`; **login por passkey cria sessão direto**, e o plugin cabeia `requireUserVerification: false` | `userVerification: "required"` + hooks `registration.afterVerification` e `authentication.afterVerification` que recusam `!userVerified` |
| **D7** códigos de resgate | Guardados como **JSON em claro** por default; "encrypted" é reversível e a verificação faz `codes.includes(code)` — hash é impossível com o plugin | Não usar os códigos do plugin: `storeBackupCodes` que descarta, rotas desligadas, perda de fator vira recuperação assistida por admin (E7) |
| **D10** não dá para desligar fator por HTTP | `/two-factor/enable` pede só sessão + senha, sem frescor; `disable`, `get-totp-uri` e `generate-backup-codes` vivos | Os 4 caminhos desligados; troca de fator só por Server Action com reautenticação pelo fator atual |
| **E2/E3** reset seguro | Link com token em **path e query**, o POST consome o token **antes** do hash, `revokeSessionsOnPasswordReset` default `false` | Link próprio em **fragmento** (`#t=`), GET bloqueado, política em `hooks.before` (antes do consumo), revogação ligada |
| **F2/F9** teto de sessão e frescor | 7 dias renovados para sempre; `freshAge` de **1 dia**; `sensitiveSessionMiddleware` **não confere frescor** | `expiresIn: 43200` (12 h) + `disableSessionRefresh: true`, `freshAge: 900`, inatividade de 60 min no guard, `exigirSessaoFresca()` próprio |
| **F6** sessão sem vazar token | `/list-sessions` devolve o objeto com `token` e `/revoke-session` recebe o token no corpo | Rotas desligadas; listagem por Server Action com projeção sem token e alvo por `id` |
| **H1/H5** privilégio máximo e RBAC | Plugin `admin` dá **bypass total** a `adminUserIds`, `set-user-password` não revoga sessões, `remove-user` apaga fisicamente, impersonação instalada | Plugin `admin` **não registrado**; papel/loja/ativo são colunas nossas em `additionalFields` com `input: false`; `pode()` fail-closed |
| **H10/H12** escopo de loja | Não é assunto da lib | `src/lib/auth/loja.ts`: vendedor/viewer usam a loja da sessão (parâmetro ignorado), gestão usa cookie validado; fora do escopo = 404 idêntico a inexistente |
| **C2/C6** limitador e IP | Rate limit em **memória** (`Map`) e, sem IP resolvido, tudo cai num balde único `no-trusted-ip` — um atacante tranca o login de todos | `customStorage` em Redis (`INCR` + `EXPIRE NX`, fail-open com alerta) + `advanced.ipAddress.trustedProxies` com as redes medidas do EasyPanel |
| **I8** webhooks | Assunto nosso | HMAC do corpo cru antes de qualquer escrita, idempotência por id de evento, segredo ausente = 401, nunca `?segredo=` |
| **L1/L2** trilha append-only | O BA não registra login/logout | Funil único em `databaseHooks.session.create.after` / `delete.before`; `auth_eventos` com `REVOKE UPDATE, DELETE` + trigger |
| **K5** precisão de timestamp | Coluna `timestamp` do PG tem precisão de microssegundo; `Date` do JS tem milissegundo | `timestamp({ precision: 3, withTimezone: true })` em **todas** as colunas, com trava [fonte] |
| **M2** versão no lockfile | — | `next` ≥ 16.3.3 (2 RCE críticos em ago/2026, um deles em servidor **Windows**, que é a máquina de dev), `better-auth` ≥ 1.7.3, `@better-auth/*` na mesma versão do core, `drizzle-orm` 0.45.2 (CVE-2026-39356, SQLi via `sql.identifier()`) |

Três itens da skill dependem de **decisão sua** e não de código (07 §18.8): (a) `admin` como privilégio máximo ou criar
um papel `dono` acima dele; (b) a exceção escrita para o delete físico de `usuarios_sessoes` e `usuarios_verificacoes`;
(c) teto de sessão de 12 h com inatividade de 60 min, e até 3 sessões simultâneas.

### 2.7 Quando rodar

1. **Antes de entregar** qualquer sistema com login — é o portão, e está no `definition-of-done` da base.
2. **A cada troca de versão minor** do Better Auth ou do Next (M5). Justificativa concreta: a v1.7.3 ligou validação de
   schema no boot e rejeita requisições de auth se o schema divergir; uma atualização também pode instalar uma rota nova
   que a trava `caminhos-ba.test.ts` acusa.
3. **A cada trimestre em produção**.
4. **Depois de qualquer mudança em auth**: papel novo, rota pública nova, webhook novo, mudança na tela de perfil.
5. Nesta reconstrução, **também agora**: o arquivo 07 já é a régua de construção. A auditoria formal no fim só confere
   o que as travas de CI já garantem diariamente.

### 2.8 Limitações da própria skill (achadas no levantamento)

- O documento-fonte `~/Documents/tools/login-e-seguranca-de-conta.md`, citado pela skill como o "porquê" extenso,
  **não existe nesta máquina** (07 linhas 43-44). As `references/` bastaram, mas a referência quebrada deve ser
  corrigida ou removida do `SKILL.md`.
- Dois advisories citados pela skill não bateram com a fonte: `CVE-2026-53513` como SSRF no SSO não foi localizado no
  OSV do pacote `better-auth` (está no `@better-auth/sso`), e o fix do `CVE-2025-53535` é 1.2.10, não "1.3.x".
- A skill entrega o relatório em `~/Downloads/`. Para o Merlo vale fixar uma cópia versionada em
  `docs/seguranca/` (sem dado sensível), senão a auditoria anterior se perde.

---

## 3. Skills e ferramentas da base, uma a uma

Legenda de "Estado": **OK** = usar como está · **Ajustar** = copiar com correções · **Reescrever** = refazer antes de usar.

### 3.1 Hooks (`.claude/hooks/pre-write-guard.mjs`, `post-write-check.mjs`) — Ajustar

**Para que serve.** São o único enforcement de verdade: `settings.json` liga os dois em `PreToolUse` e `PostToolUse`
com matcher `Write|Edit|MultiEdit`. O `pre-write-guard` **bloqueia** (exit 2) a gravação que traz Prisma, SQLite,
delete físico (`\bdb\.delete\s*\(|\.deleteMany\s*\(`, `base/.claude/hooks/pre-write-guard.mjs:37`) ou edição de `.env`.
O `post-write-check` roda o auditor só no arquivo gravado e devolve os erros para a IA corrigir.

**Como será usada.** Instalados no **commit zero**, antes de qualquer código, para que tudo nasça auditado.

**Lacunas e melhorias.**
- São **fail-open**: qualquer erro interno sai com exit 0 e a regra some sem aviso.
- O `pre-write` não pega `drizzle….delete(` (o auditor pega) e deixa passar `.env.local` (o HUG bloqueia).
- `SKIP_PATH` casa `.claude` em **qualquer ponto** do caminho: worktree dentro de `.claude/worktrees/` desliga os dois
  hooks em silêncio (`:22`, `:111-113`). Conferir onde os worktrees serão criados.
- Bloqueiam `db.delete(` também em `tests/` e `scripts/`: falta estratégia escrita de limpeza de banco em teste
  (transação com rollback ou `TRUNCATE` em banco de teste, registrado em ADR).
- No modo `--file` o auditor **não aplica** `IGNORE_DIRS`: um `.sql` gravado à mão em `migrations/` com `DROP TABLE` é
  acusado pelo hook, embora a varredura completa ignore a pasta.
- **Levar para o repo novo:** versão da base + regra `texto-cru` (que só o Merlo tem, `merlo/.claude/hooks/pre-write-guard.mjs:48-58`)
  + `.env.local` + `drizzle….delete`, **sem** a flag `MIGRACAO_ORM_EM_ANDAMENTO`.

### 3.2 `scripts/check-compliance.mjs` — Ajustar (decisão pendente)

**Para que serve.** Auditor das regras absolutas: Prisma, SQLite, delete físico, `DROP` em `.sql`, segredo, `cascade`
(aviso), arquivo grande, tabela sem auditoria e consulta sem filtro de soft delete. Exit 1 se houver erro.

**Como será usada.** `npm run compliance` local, no post-hook e **no CI** (passo novo). O levantamento 08 §3 documenta
as convenções exatas para passar limpo de primeira — vale colar no `CLAUDE.md` do repo novo:
- `pgTable("nome", { ... })` com **objeto literal** no 2º argumento (a forma callback escapa da checagem);
- as 4 colunas de auditoria com **nome literal em inglês** no corpo ou via spread `...colunasAuditoria` de um
  `export const NOME = {` **sem anotação de tipo** (`const cols: X = {` não é reconhecido, e `audit()` do HUG reprova);
- **um** pacote de auditoria só no projeto inteiro (o mapa é global por nome);
- arquivo com **no máximo 499 linhas** (500 linhas com newline final contam 501 e reprovam).

**Lacunas e melhorias** (08 §6.1, `A1`..`A12`): não cobra `modified_by`; não checa FK ausente, `onDelete`, `precision`,
`withTimezone`, nome hierárquico nem idioma; `tx.delete(` e `sql\`DELETE\`` escapam; `pgTable` callback e
`pgSchema().table()` não são analisados; `db.query.*.findMany` e `.selectDistinct(` não entram na heurística de soft
delete; a regex de segredo não pega `sk-ant-...`, `sk-proj-...` nem PEM PKCS#8; varre só `src/`.

**Decisão obrigatória antes do primeiro schema:** isenção para tabela de framework (Better Auth). Opções: (a) colocar
`...colunasAuditoria` nas tabelas do BA (a lib ignora colunas extras com default) para `usuarios` e `usuarios_contas`;
(b) criar um marcador novo `compliance:framework` na base + trava; (c) lista fixa como a do HUG. A recomendação do
levantamento é (a) + (b), com ADR explicando o delete físico da lib.

### 3.3 `tests/check-compliance.test.mjs` — OK, com um ajuste

**Para que serve.** É a trava do auditor: cria um projeto temporário, roda o auditor com `--json` e prova 6 casos —
que os helpers da casa (`...colunasAuditoria`, `vivos(t)`, `eq(t.isDeleted,false)`) **passam** e que as violações
(tabela sem nada, spread que não é de auditoria, consulta sem filtro) **são acusadas**.

**Como será usada.** Script `test:compliance` no CI. Toda mudança nas regras do auditor (isenção de framework, helper
novo, regex de segredo ampliada) exige um caso novo aqui — é essa a disciplina que impede o auditor de virar enfeite.

**Lacuna.** Não é Vitest (usa `node:assert`) e o `include` do Vitest do Merlo (`tests/**/*.test.{ts,tsx}`) **não o
pega**. Precisa de script npm próprio. **Não existe no repo do Merlo hoje**: instalar.

### 3.4 `scripts/project-map.mjs` — OK

**Para que serve.** Gera `docs/PROJECT_MAP.md` com árvore, tabelas `pgTable` e colunas, actions, rotas, páginas e
componentes. É o mapa que a IA lê antes de sair explorando o repo.

**Como será usada.** `npm run map` no fim de cada fase; nunca editar o arquivo à mão.

**Lacunas.** Heurísticas restritas: action só é vista com `^"use server"` + `export async function nome`
(`export const x = async` não entra); rota só com `export async function GET|POST|...` (`export const GET =`, HEAD e
OPTIONS não entram); route group só é removido se o nome for `\w+` (então `(area-admin)` fica na rota). Não conhece
`proxy.ts` nem workers. **Consequência prática:** vira convenção do repo novo escrever actions e handlers como
`export async function`, e evitar route group com hífen.

### 3.5 `scripts/docs-check.mjs` — Ajustar (usar a versão do Merlo)

**Para que serve.** Detecta drift entre código e documentação: referência quebrada (caminho citado em doc que não
existe) e falta de cobertura (tabela, rota ou action que nenhum doc menciona). Tem `--json` e `--strict` (exit 1).

**Como será usada.** `docs:check` no fim de cada fase e `--strict` no CI a partir do momento em que os docs forem
reescritos. É a prova objetiva que a skill `repo-docs-sync` usa.

**Melhoria já pronta:** a versão do Merlo é **melhor** que a da base — exclui `PROJECT_MAP.md` do corpus (senão tudo
parece documentado) e remove blocos de código antes de procurar refs (caminho dentro de exemplo não é drift). Levar a
versão do Merlo e devolver a correção para a base.

### 3.6 `scripts/remove-ai-marks.mjs` + skill `remove-ai-marks` — OK

**Para que serve.** Remove marcas invisíveis de texto gerado por IA: zero-width, BOM, soft hyphen, tag chars
(`U+E0000–E007F`), variation selectors fora de emoji, bidi e espaços exóticos. Preserva ZWJ entre emoji, VS16 e
acentos. Tem `--write`, `--check`, `--dir`, stdin e `--selftest` (20/20 passando).

**Como será usada.** `ai-marks --check --dir docs` no CI; rodar em `src/` quando houver código colado de fora; rodar
antes de publicar qualquer material que vá para o cliente (proposta, guia, release notes).

**Lacuna.** Nenhuma relevante. É a ferramenta mais redonda do conjunto.

### 3.7 `scripts/limpar-lixo-raiz.mjs` — OK (instalar; falta no Merlo)

**Para que serve.** Move para `.lixo-quarentena/` (com `INVENTARIO.txt`) os arquivos-lixo da raiz gerados por shell mal
escapado — `y.id)`, `console.log('`, `{`, `0`, `undefined)`. Só age na raiz, só em arquivo regular, **nunca toca arquivo
versionado** (`git ls-files -z`, `base/scripts/limpar-lixo-raiz.mjs:115`) e por padrão é dry-run: move, não apaga.

**Como será usada.** Instalar, pôr `.lixo-quarentena/` no `.gitignore`, rodar antes de cada commit de fase. O problema
é real e recorrente: a raiz da própria base tem ~150 arquivos de 0 byte com nomes como `y.id)` e `timestamptz(3)`, e o
espaco-flow tem os mesmos resíduos.

**Melhoria.** Vem acompanhado da regra 13.1 do `AGENTS.md:37-41` (nunca `node -e "..."` ou `psql -c "..."` inline no
PowerShell). Manter a regra visível no `CLAUDE.md` do repo novo — a ferramenta limpa o sintoma, a regra evita a causa.

### 3.8 `templates/` (schema, server-action, component, component.test) — Reescrever

**Para que serve.** Arquivos-ouro para copiar e ajustar. O auditor ignora a pasta `templates/`, então eles podem
mostrar o padrão sem interferir.

**Lacunas (08 §6.3) — todos os quatro estão defasados:**
- `schema.ts:27-36`: `timestamp()` **sem `precision: 3`/`withTimezone`** (é exatamente a armadilha nº 1, que quebra o
  optimistic locking em silêncio); índices na forma objeto `(t) => ({...})`, deprecada no Drizzle desde 0.36 (o atual
  exige **array**); `modified_by` uuid NOT NULL sem estratégia para job/webhook; import de `./contratos` inexistente.
- `server-action.ts`: `temPermissao(session,"operador")` (`:38`) contra `temPermissao(role, recurso, acao)` de
  `docs/rbac.md:50` contra `session.user.role` de `docs/back.md:129` — **três assinaturas diferentes** para a mesma
  função; sem escopo de loja; auditoria **fora da transação** (`:47`, `:92`); `excluir` **sem trava de colisão**
  (`:105-132`); sem `revalidatePath`; sem retorno tipado para a UI.
- `component.tsx`: usa `alert()` (`:47`) contra o toast do padrão; importa `@/components/modal-confirmacao-block`, que
  a base **não entrega**.
- `component.test.tsx:45-56`: `vi.useFakeTimers()` + `waitFor` (a Testing Library só detecta fake timers do Jest; com
  Vitest o `waitFor` pode travar) e cita um `config/vitest.config.ts` que a base não tem.

**Faltam templates de:** route handler de webhook (HMAC em tempo constante + idempotência), worker/fila, helper de
escopo de loja, `proxy.ts`, página server com RBAC, formulário com `updated_at` oculto para o lock, e paginação.

### 3.9 Skill `criar-tabela` — Reescrever

**Para que serve.** Fluxo guiado de tabela Drizzle: nome hierárquico, copiar o template, colunas de auditoria, FK
`restrict`, índices, `drizzle-kit generate`, auditor verde.

**Como será usada.** Para toda tabela do repo novo, **depois** de reescrita.

**Lacunas.** Diz "5 colunas" (`base/.claude/skills/criar-tabela/SKILL.md:18-25`) enquanto o auditor cobra 4; não fala do
pacote único de auditoria, de `precision: 3`, de nomes em PT-BR, de `loja_id`, de `check()` constraints, de índice único
parcial `WHERE is_deleted = false` (e-mail/telefone únicos **por loja**), nem da diferença entre `generate` e `push`
(o `AGENTS.md:247` da base ainda manda `drizzle-kit push`, que não serve para um projeto com migração versionada).

### 3.10 Skill `criar-crud` — Reescrever

**Para que serve.** CRUD completo de uma entidade centralizado em uma server action: validador Zod, `listar/criar/
atualizar/excluir`, autenticação, RBAC, soft delete, optimistic locking, auditoria e teste.

**Lacunas.** Não cobre nada do que este sistema tem de específico: sessão Better Auth; escopo por loja (vendedor/viewer
**com** loja, admin/gerente **sem**); transação envolvendo a auditoria; **Server Action como POST aberto** (validar tudo
dentro, incluindo ids secundários do corpo); route handlers de webhook; integração **somente leitura** (Bling); ponte
manual do Masc (pedido nasce pendente de lançamento); mídia no MinIO; filas; teste da trilha.

**Melhoria sugerida.** A skill reescrita deve gerar, junto com a action, a **trava** correspondente — é o que diferencia
"CRUD que funciona" de "CRUD que não regride".

### 3.11 Skill `criar-componente` — Ajustar

**Para que serve.** Componente React no padrão da casa: colocation, server vs client, props tipadas, 4 estados
obrigatórios, shadcn/ui, modal block para ação crítica, acessibilidade mínima.

**Lacunas.** Não conhece Tailwind v4 (CSS-first, `@theme inline`, sem `tailwind.config.ts`), tokens semânticos, toast
(`sonner`), formatação PT-BR de moeda e data, telas em tempo real (chat) nem estado otimista convivendo com o lock.

**Como será usada.** Reescrita com as seções 3 a 11 do levantamento 10 (tokens, cor, tipografia, espaçamento, raio,
movimento, ícones) como referência obrigatória, e com o `ModalConfirmacaoBlock` entregue como **arquivo de verdade**
(hoje só existe como snippet em `AGENTS.md`/`Agente.md`).

### 3.12 Skill `repo-docs-sync` — Ajustar (fundir as duas versões)

**Para que serve.** Auditar e sincronizar toda a documentação técnica do repositório em 6 fases: descoberta, arqueologia
no git, análise de lacunas, execução, scaffolding e relatório.

**Como será usada.** Ao fim de cada fase da reconstrução, usando `docs-check --json` como prova objetiva.

**Lacuna.** Existem duas versões divergentes: a do Merlo (17/08) é PT-BR e usa os geradores, mas afirma que "esta base
NÃO usa `.agents/`" — o que é falso no Merlo; a da base (19/08) é genérica em inglês, com nota de espelhos e varredura
do working tree. **Fundir**: base + a tabela de geradores da versão Merlo, corrigindo a nota sobre `.agents/`.

### 3.13 Skill `how-to-use-guide` — Reescrever (e cuidado)

**Para que serve.** Guia "como usar" em PDF de um recurso, escrito para quem **vai usar** (operador de loja, dono,
suporte), com prints reais da aplicação rodando e dados pessoais anonimizados.

**Dois problemas sérios.**
1. **A cópia que está na base é do ERP Auto Peças** (`base/.claude/skills/how-to-use-guide/SKILL.md:13`) — conteúdo de
   outro cliente dentro do template padrão. Não copiar para o repo novo; e vale limpar da base.
2. A versão do Merlo está amarrada ao **NextAuth**: seletores `/login`, `#email`, `#password`
   (`capturar-prints.mjs:210-216`), porta 3005, e o grep de vazamento procura `NextAuth|prisma` (`SKILL.md:179`).

**Impacto novo que ninguém tinha notado:** com **segundo fator obrigatório**, o roteiro de captura quebra — ele faz
login só com e-mail e senha. Vai precisar de conta de teste com TOTP (semente conhecida, em banco de HML) ou de um modo
de captura controlado, **sem afrouxar a régua de segurança**. Readaptar depois que as telas novas existirem, atualizar o
grep de vazamento (`Better Auth`, `drizzle`, `uazapi`, `Bling`, `Masc`) e **versionar a skill** (hoje não está no git).

### 3.14 Skill global `skill-authoring` — OK

**Para que serve.** Criar, posicionar, atualizar, verificar e espelhar skills nesta máquina. Codifica o padrão: skill
**global** em `C:\Users\Paulo\.claude\skills\` (fonte da verdade); skill de **projeto** em `<repo>/.claude/skills/`
(canônica) **copiada** — nunca symlink — para `<repo>/.agents/skills/` (Codex + Antigravity); frontmatter só com `name`
e `description`; verificação obrigatória de estrutura, refs, gatilho e espelho.

**Como será usada.** Depois de reescrever `CLAUDE.md`/`AGENTS.md`, rodar `gen-agents.mjs` para regerar `.agents/`
(hoje legado e **não versionado** no Merlo), `espelhar-todas.sh` e `verificar.py`.

**Armadilhas já registradas nela:** espelhamento ingênuo destruiu 13 skills; `cpSync` falha com acento no caminho
(e o caminho do projeto tem "MERLO"/"SOLUÇÕES" em outros repos); caminho do Chrome com barra normal.

**Atenção nova (Next 16):** o `next dev` escreve e mantém um bloco gerenciado dentro do `AGENTS.md`
(`<!-- BEGIN:nextjs-agent-rules -->`, 09 §2.2). Se o bloco não for commitado, ele reaparece como diff a cada `dev` e
briga com o `AGENTS.md` da base e com o `gen-agents.mjs`. Combinar isso antes da primeira execução.

---

## 4. Skills de design e como entram na UI

### 4.1 O que existe

São **32 skills** em quatro plugins, em `C:\Users\Paulo\.claude\plugins\cache\designer-skills\`:

| Plugin | Skills | O que rendeu |
|---|---|---|
| **design-systems** (8) | design-token, theming-system, component-spec, accessibility-audit, pattern-library, naming-convention, motion-system, icon-system | Tokens em 3 camadas, regras de nome, 4 a 6 durações, reduced motion global, ícone sempre com rótulo, WCAG 2.2 |
| **ui-design** (9) | color-system, dark-mode-design, typography-scale, spacing-system, layout-grid, visual-hierarchy, responsive-design, data-visualization, law-of-proximity | 4,5:1 e 3:1, superfície mais clara no escuro, base 4px, densidade compacta, proximidade, breakpoints |
| **interaction-design** (8) | form-design, loading-states, error-handling-ux, feedback-patterns, navigation-patterns, search-ux, state-machine, micro-interaction-spec | Validação no blur, faixas de tempo de carregamento, formato de erro, toast 3-5 s, sidebar no desktop e tab bar no celular |
| **visual-critique** (7 + 2 comandos) | critique-* + `critique-screen`, `critique-ux` | Formato Observação/Problema/Correção, nota pass/minor/major, prioridade P1/P2/P3 |

**Característica importante:** elas são genéricas (20 a 60 linhas cada) e **não trazem nenhum valor de produto**. Elas
dizem "contraste ≥ 4,5:1", não dizem qual violeta. Sozinhas, não produzem UI consistente.

### 4.2 Como entram nesta reconstrução

O levantamento 10 fez a ponte: pegou cada skill e derivou o valor concreto para este domínio (loja de moda, vendedora
6-9 h por dia, tela densa, desktop primeiro, celular funcional), **calculando** todo contraste pela fórmula de
luminância relativa do WCAG por script, em vez de estimar. O que entra na UI, na prática:

- **Tokens em 3 camadas** (global → semântico → componente), com o contrato shadcn em inglês e as extensões em PT-BR.
  Proibido em TSX: hex, `rgb()`, `oklch()`, classe de paleta crua (`bg-white`, `text-neutral-500`) e valor arbitrário
  (`text-[10px]`, `bg-[#141414]`) — isso vira regra de grep no compliance.
- **Cor:** marca violeta `#7C3AED` (ação) e `#5B21B6` (texto), neutro zinc, 6 tons de estado com par claro/escuro
  verificado, tokens de domínio (`--balao-entrada`, `--balao-saida`, `--nota-interna-*`, `--canal-*`) e um mapa único
  "estado de negócio → tom" (conversa, SLA, pedido/Masc, pagamento, integração, estoque) em `src/lib/ui/tons.ts`.
  Regra: violeta em no máximo ~10% da tela e **cor nunca sozinha**.
- **Tipografia:** 7 tokens (12/13/14/14-16/16/20/24), três pesos (400/500/600), piso de 12 px com uma exceção
  (contador 11 px/600), formatação PT-BR centralizada num módulo.
- **Espaçamento:** base 4 px com passos fixos; alvo mínimo 24 px (44 px com `pointer: coarse`); densidade compacta na
  operação e confortável em formulário.
- **Layout:** tabela de breakpoints da tela de Conversas (de 1536 px até < 768 px), `h-dvh`, composer com
  `safe-area-inset`, container queries dentro dos painéis.
- **Movimento:** 4 durações (100/150/200/300 ms), 3 curvas, lista do que **não** anima (rota, chegada de mensagem,
  reordenação, contadores), e `prefers-reduced-motion` tratado **globalmente** no `globals.css`. `framer-motion` sai.
- **Componentes e padrões de tela:** lista de conversas, cabeçalho, linha do tempo com máquina de estados de entrega,
  composer (com os 4 motivos de bloqueio sempre explicados), painel do contato, tabelas, funil, integrações.
- **`ModalConfirmacaoBlock`:** spec completa (anatomia com resumo obrigatório, props, estados, comportamento durante o
  bloqueio com `aria-disabled` em vez de `disabled`, foco, leitor de tela, teste com timers falsos). E uma regra que
  concilia a base com a skill `feedback-patterns`: **block de 3 s** para irreversível/visível para fora; **executa já +
  toast com "Desfazer"** para reversível e interno (resolver, arquivar, transferir, etiquetar).
- **Acessibilidade AA (WCAG 2.2):** tabela critério a critério com como verificar (axe + teclado + NVDA).
- **Voz e glossário PT-BR:** "Conversa" e não "ticket", "Modelo" e não "template", "Campanha" e não "broadcast".
- **Checklist de crítica visual:** telas-alvo, matriz de captura (viewport × tema × extra) e itens com severidade
  padrão (P1 bloqueia entrega, P2 corrige na sprint, P3 polimento).

### 4.3 Desvios conscientes (registrados, não acidentais)

| Skill | O que ela pede | O que foi decidido | Por quê |
|---|---|---|---|
| `typography-scale` | corpo de 16 px | 14 px no desktop, 16 px no celular | ferramenta operacional densa; 16 px em input no celular evita o zoom do iOS |
| `dark-mode-design` | escurecer imagem no tema escuro | foto de produto nunca filtrada | a cor da peça é informação de venda |
| `components.md:105` da base | "tema dark por padrão" | padrão `system` | loja física é ambiente claro |
| `feedback-patterns` | preferir "desfazer" a "tem certeza?" | tabela block × desfazer | a base exige block em ação crítica |
| `form-design` | contador de caracteres sempre visível | só a partir de 90% do limite | em chat seria ruído permanente |

### 4.4 Lacuna das skills de design

`critique-brand-consistency` exige `mood.md`, `voice.md` e `tokens.md`; sem eles ela **pula** a dimensão inteira em
silêncio. O levantamento 10 cumpre esse papel (tokens nas seções 3-11, voz e mood na 21), mas isso precisa morar no
repo. Recomendação: seção em `docs/front.md` (a base proíbe criar doc novo sem pedido).

Pendências de cliente que travam parte da UI: logos negativo, tinta e ícone estão **faltando**
(`marca/LEIA-ME.md:10-12`), e o nome está escrito de duas formas — "Merlo Store" em `marca.json:3` e "Merlos Store" no
código atual. Confirmar com o cliente antes de desenhar login, favicon e título.

---

## 5. Problemas encontrados nas próprias skills e ferramentas

### 5.1 Cópias desatualizadas e conteúdo de outro cliente

| Problema | Evidência | Recomendação |
|---|---|---|
| `how-to-use-guide` da base é do **ERP Auto Peças** | `base/.claude/skills/how-to-use-guide/SKILL.md:13` | Remover da base ou marcar como específica do ERP; nunca copiar para repo novo |
| `check-compliance.mjs` do Merlo está **atrás** da base (sem pré-passada de pacotes, sem `HELPERS_SOFT_DELETE`, sem `isDeleted`) e carrega legado (`PRISMA_EXT`, `NIVEL_LEGADO`, `delete-fisico-legado`, `skipIfLine`/LGPD) | 08 §4 | Substituir pela versão da base + isenção de framework; apagar a flag `MIGRACAO_ORM_EM_ANDAMENTO` inteira |
| `definition-of-done.md` do Merlo **sem** a seção "Login e Conta" | 08 §4 | Usar a da base |
| `CLAUDE.md`/`AGENTS.md`/`Agente.md` do Merlo sem as seções de segurança, de higiene da raiz e das ferramentas novas | `merlo/CLAUDE.md:6-32` | Reescrever a partir da base + stack real |
| Faltam no Merlo: `limpar-lixo-raiz.mjs`, `tests/check-compliance.test.mjs`, `docs/seguranca-login.md` | 08 §4 | Instalar os três no commit zero |
| `docs-check.mjs` e a regra `texto-cru` do Merlo estão **à frente** da base | 08 §4 | Levar para o repo novo **e devolver para a base** |
| `.agents/` do Merlo não está versionado; `.claude/settings.local.json` **está** versionado | 08 §4 | Inverter os dois: versionar `.agents/`, tirar `settings.local.json` do git |
| Índice de ADR do Merlo lista só 0002 e 0003, mas 0004–0007 existem | `merlo/docs/adr/README.md` | Refazer o índice |
| `scripts/seed.ts` da base é arquivo de **0 byte**; a raiz da base tem ~150 arquivos de 0 byte | 08 §1 | Apagar o seed vazio; rodar `limpar-lixo-raiz` na própria base |

### 5.2 Regras que existem no papel e o auditor não cobre

| Regra prometida | Realidade | Recomendação |
|---|---|---|
| "5 colunas de auditoria" | O auditor cobra 4 (`base/scripts/check-compliance.mjs:130`); `modified_by` é só convenção | Pôr `modified_by` no pacote único + trava própria, ou acrescentar ao auditor com isenção explícita |
| "FK com `ON DELETE RESTRICT`" | Só `cascade` gera **aviso**; FK ausente ou `no action` passa | Cobrir na skill `criar-tabela` reescrita + teste de schema |
| "optimistic locking" | Nada checa `precision`/`withTimezone` — e é a armadilha nº 1 | Trava [fonte] `timestamps.test.ts`: todo `timestamp(` com `precision: 3` e `withTimezone: true` |
| "nunca delete físico" | `tx.delete(`, `sql\`DELETE\`` e delete dentro de `node_modules` (Better Auth) escapam | Acrescentar as regex; ADR para o delete da lib; varredura de soft delete de verdade |
| "nomes hierárquicos em PT-BR" | Não verificado em lugar nenhum | Regra no auditor ou item de revisão na skill |
| "não commitar segredo" | Regex sem `sk-ant-`, `sk-proj-` e PKCS#8 | Ampliar a regex + caso na trava + `gitleaks` no CI |
| "toda tabela auditada" | `pgTable` na forma callback escapa da checagem inteira | Regra que **acusa** `pgTable("x", (` e obriga a forma objeto |

### 5.3 Buracos de enforcement

1. **CI não roda o auditor** (`base/.github/workflows/deploy.yml:48-61`). Como os hooks só existem no Claude Code, hoje
   não há nenhuma barreira comum para Codex, Antigravity e pessoas. **Corrigir primeiro** — é a melhoria de maior
   retorno de todo este documento.
2. **`npm run lint` pressupõe `next lint`, removido no Next 16.** Vira `eslint .` com `eslint.config.mjs` (flat config).
3. **Node 20 fixo no workflow** (`:45`); Next 16 exige ≥ 20.9 e o resto da stack pede 24 (jsdom 30 exige ≥ 24.15, e a
   máquina do Paulo está em 24.12.0 — ou atualiza o Node, ou fixa `jsdom@29.1.1`).
4. **Deploy por SSH + pm2 na base × EasyPanel com Dockerfile no Merlo.** Decidir: CI do Actions para verificação +
   deploy pelo EasyPanel, com backup PRD como passo obrigatório nos dois caminhos.
5. **As 3 varreduras obrigatórias do `seguranca-login.md` não existem como código em lugar nenhum.** São elas: (1) toda
   Server Action e todo route handler de escrita chama o portão de sessão; (2) nenhum `select` sem soft delete e nenhum
   delete em tabela de auditoria; (3) recusa de login única. Escrever no commit zero.

### 5.4 Documentos da base obsoletos ou contraditórios para esta stack

| Doc | Problema | Recomendação |
|---|---|---|
| `base/docs/oauth.md` | `db.delete(sessoes)` (`:112`) — a própria base violando a regra absoluta; bcrypt 12 (`:194`) contra o Argon2id da régua; tabela `sessoes` sem colunas de auditoria (`:42-50`); middleware que só confere a presença do cookie (`:171-178`), exatamente a armadilha que `seguranca-login.md` condena | **Não copiar.** Reescrever para Better Auth ou marcar como histórico |
| `base/docs/front.md` | `startsWith('/(auth)')` (`:99`) — route group não aparece na URL, a guarda **nunca dispara**; fala em `middleware.ts` (Next 16 usa `proxy.ts`) | Reescrever |
| `base/docs/back.md` | tabela `auditoria` sem marcador (`:253-263`) — reprova no próprio auditor da casa; `atualizarEntidade` sem lock (`:192-198`); `getSession()` sem checar nulo | Reescrever |
| `base/docs/rbac.md` | papéis `super_admin/admin/operador/visualizador` contra os papéis reais do Merlo (`admin/gerente/vendedor/viewer` com escopo de loja) | Reescrever com os papéis do cliente |
| `base/AGENTS.md` | Docker na 5432 (`:234`, o Merlo usa 5437); manda `drizzle-kit push` (`:247`) | Corrigir |
| `base/docs/git-commits.md` | rodapé `Co-Authored-By: Claude` (`:47-51`) **colide com a sua regra "commits sem coautoria"** | Decidir e alinhar o doc à sua preferência |
| `base/CLAUDE.md` | árvore de pastas ainda com `middleware`; o bloco SQL lista 4 colunas e cita `modified_by` à parte, o que gera a confusão do "5 colunas" | Corrigir a árvore e unificar o texto das colunas |

### 5.5 Problemas dentro da skill de segurança

Já listados em §2.8: referência a um documento-fonte inexistente, dois advisories citados com dado impreciso
(`CVE-2026-53513` e a versão de correção do `CVE-2025-53535`), e o relatório indo só para `~/Downloads`. São defeitos
pequenos, mas a skill é a régua de entrega — vale corrigi-los para não gerar dúvida sobre o resto.

### 5.6 Ordem sugerida das correções

| Prioridade | O quê | Esforço |
|---|---|---|
| **P1** | CI rodando `compliance` + `test:compliance` + `docs:check` + `ai-marks --check`; decisão do marcador de tabela de framework; templates `schema.ts` e `server-action.ts` corrigidos | baixo, destrava tudo |
| **P1** | Reescrever `criar-tabela` e `criar-crud` antes do primeiro schema | médio |
| **P2** | Reescrever `criar-componente` com os tokens do levantamento 10; entregar `ModalConfirmacaoBlock` como arquivo com teste | médio |
| **P2** | Ampliar o auditor (`modified_by`, `tx.delete`, `pgTable` callback, regex de segredo, varrer `tests/` e `scripts/`), sempre com caso novo na trava | médio |
| **P2** | Reescrever `docs/{rbac,back,front,oauth}.md`; fundir `repo-docs-sync`; limpar `how-to-use-guide` da base | médio |
| **P3** | Readaptar `how-to-use-guide` do Merlo (depois das telas, com o problema do 2FA resolvido); regerar e versionar `.agents/`; devolver as melhorias do Merlo para a base | depois |
