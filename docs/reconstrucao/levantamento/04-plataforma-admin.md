# Levantamento 04 — Plataforma e Administracao (sistema antigo)

Repo: `C:\Users\Paulo\Documents\MerlostoreChat` (commit `5e902d4`, branch `refactor/reconstrucao-estrutura-base`).
Stack antiga: Next 14.2.35 + React 18 + Prisma 7.5 + NextAuth 4.24.13 + bcryptjs 3.0.3 + Zod 4.3.6 (versoes do `package-lock.json:3217-15314`).
Todos os caminhos abaixo sao relativos a raiz do repo. Formato de citacao: `arquivo:linha`.

Este documento serve de REFERENCIA de dominio e regra de negocio. Nada aqui e implementacao a copiar.

---

## 0. Sumario executivo

- **Multi-loja** e implementado por uma coluna `store_id` e duas funcoes (`escopoDaLoja`, `lojaParaGravar`) chamadas em cada handler. Gestao (admin/gerente) tem `store_id` nulo e escolhe a loja por cookie `loja_ativa` ou `?loja=`; vendedor/viewer ficam presos a loja do cadastro. A regra papel x loja tambem mora num CHECK no banco.
- **Integracoes** vivem em `stores_integracoes` (uma linha por CONTA, nao por provedor), com credencial cifrada AES-256-GCM. Bling e conta da rede (`store_id` nulo, deposito por loja), TikTok Shop e Bling conectam por OAuth com `state` assinado, WhatsApp oficial/uazapi/Instagram/Facebook por token colado. Bling e TikTok sao somente leitura (travado por teste).
- **Auth** e NextAuth v4 Credentials + JWT de 30 dias com `role` e `storeId` no token; RBAC por caminho+metodo **so no middleware**. Sem 2FA, sem bloqueio, sem rate limit, sem reset de senha, sem "Meu perfil", sem trilha de login. O primeiro admin nasce por `/api/register` publico.
- **Trilha de auditoria** existe (`activity_logs` + `registrar()`), mas cobre 7 pontos do sistema, grava depois do efeito, engole falha, aceita POST forjado de qualquer vendedor e nao e append-only.
- **Alertas** sao um motor por cron (`/api/alerts/check`) com 7 regras hardcoded; varias regeneram o alerta depois de reconhecido. A tela de SLA e de LGPD em `/settings` sao falsas (salvar so mostra toast).
- **IA** (sugerir/classificar/resumir via Anthropic) esta escondida da UI por decisao de 18/08/2026, mas as rotas continuam ativas e a sugestao vaza catalogo e respostas rapidas entre lojas.
- Secao 13 lista **34 falhas de seguranca** e a secao 14 **24 bugs/inconsistencias**. A secao 15 lista as regras de negocio que precisam sobreviver ao rebuild.

---

## 1. Fontes lidas

| Area | Arquivos |
|------|----------|
| Auth/borda | `src/lib/auth.ts`, `src/middleware.ts`, `src/lib/rbac.ts`, `src/lib/api-publica.ts`, `src/lib/webhook-auth.ts`, `src/lib/sessao.ts`, `src/types/next-auth.d.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/api/register/route.ts`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/register/page.tsx` |
| Lojas/escopo | `src/lib/loja.ts`, `src/app/api/lojas/route.ts`, `src/app/api/lojas/[id]/route.ts`, `src/app/(dashboard)/settings/lojas/page.tsx`, `src/components/layout/SeletorLoja.tsx`, `src/components/layout/Header.tsx`, `src/components/layout/Sidebar.tsx` |
| Usuarios | `src/lib/usuarios.ts`, `src/app/api/usuarios/route.ts`, `src/app/api/usuarios/[id]/route.ts`, `src/app/(dashboard)/settings/team/page.tsx` |
| Integracoes | `src/lib/cofre.ts`, `src/lib/integracoes-catalogo.ts`, `src/lib/integracoes.ts`, `src/lib/roteamento.ts`, `src/lib/bling/{estado,config,cliente}.ts`, `src/lib/tiktok/{config,assinatura,cliente}.ts`, `src/lib/uazapi/{config,instancia}.ts`, `src/app/api/integracoes/**`, `src/app/api/webhooks/uazapi/route.ts`, `src/app/(dashboard)/settings/integracoes/**` |
| Alertas/SLA | `src/lib/alerts/engine.ts`, `src/lib/alerts/rules.ts`, `src/app/api/alerts/**`, `src/app/(dashboard)/alerts/page.tsx`, `src/app/(dashboard)/settings/sla/page.tsx` |
| Auditoria | `src/lib/auditoria.ts`, `src/app/api/activity-logs/route.ts` |
| IA | `src/lib/ai/{client,prompts,suggest,classify,summarize}.ts`, `src/app/api/ai/**`, `src/components/inbox/ChatWindow.tsx:389-399` |
| Utilitarios | `src/lib/paginacao.ts`, `src/lib/db/soft-delete.ts`, `src/lib/db/prisma.ts`, `src/components/modal-confirmacao-block.tsx` |
| Banco/infra | `prisma/schema.prisma`, `prisma/sql/constraints.sql`, `prisma/seed.ts`, `scripts/db-bootstrap.mjs`, `scripts/db-constraints.mjs`, `scripts/db-backup.mjs`, `Dockerfile`, `docker-compose.yml`, `next.config.mjs`, `package.json`, `.env.example`, `docs/deploy-easypanel.md` |
| Docs/decisoes | `docs/integracoes.md`, `docs/rbac.md`, `docs/oauth.md`, `docs/api.md`, `docs/adr/0004-fontes-da-verdade.md`, `docs/adr/0005-soft-delete.md`, `docs/adr/0007-fila-no-postgres.md` |
| Testes | `tests/rbac.test.ts`, `tests/api-publica.test.ts`, `tests/escopo-loja.test.ts`, `tests/usuarios-fase4.test.ts`, `tests/robustez-fase5.test.ts`, `tests/middleware-proxy.test.ts` (existem ainda `cofre`, `webhook-auth`, `bling`, `tiktok-assinatura`, `uazapi`, `autoria`) |
| Regua | `C:\Users\Paulo\Documents\estrutura base\docs\seguranca-login.md` |

`.env` NAO foi lido.

---

## 2. Mapa da plataforma (rotas e telas do escopo)

### 2.1 Rotas de API

| Rota | Metodos | Autentica por | Quem (RBAC efetivo) | Escopo de loja |
|------|---------|---------------|---------------------|----------------|
| `/api/auth/[...nextauth]` | GET, POST | fluxo NextAuth | publica | — |
| `/api/register` | POST | nenhum (so banco vazio) | publica | — |
| `/api/lojas` | GET | sessao | todos | vendedor ve so a dele |
| `/api/lojas` | POST | sessao | admin | — (loja e o recurso) |
| `/api/lojas/[id]` | PUT, DELETE | sessao | admin | — |
| `/api/usuarios` | GET | sessao | todos (`?detalhe=1` so admin, checado no handler) | gestao: loja ativa ou todas; vendedor: a dele + gestao |
| `/api/usuarios` | POST | sessao | admin | — |
| `/api/usuarios/[id]` | PUT, DELETE | sessao | admin | — |
| `/api/integracoes` | GET, POST | sessao | admin | loja ativa + rede |
| `/api/integracoes/[id]` | GET, PUT, DELETE | sessao | admin | nenhum (por id) |
| `/api/integracoes/bling/autorizar` | GET | sessao | admin | — |
| `/api/integracoes/bling/callback` | GET | `state` assinado | publica | — |
| `/api/integracoes/bling/catalogo` | GET | sessao | admin | loja ativa (deposito) |
| `/api/integracoes/bling/depositos` | GET | sessao | admin | — |
| `/api/integracoes/tiktok/autorizar` | GET | sessao | admin | — |
| `/api/integracoes/tiktok/callback` | GET | `state` assinado | publica | — |
| `/api/integracoes/uazapi/[id]/sessao` | GET, POST | sessao | admin | — |
| `/api/alerts` | GET | sessao | todos | loja ativa (contagem global: ver S23) |
| `/api/alerts/[id]` | PUT | sessao | admin, gerente, vendedor | loja ativa |
| `/api/alerts/check` | POST | `Bearer CRON_SECRET` | publica | global (cron) |
| `/api/activity-logs` | GET | sessao | todos | loja ativa |
| `/api/activity-logs` | POST | sessao | admin, gerente, vendedor | loja de gravacao |
| `/api/ai/suggest` | POST | sessao | admin, gerente, vendedor | conversa escopada; contexto NAO |
| `/api/ai/classify` | POST | sessao | admin, gerente, vendedor | mensagem escopada |
| `/api/ai/summarize` | POST | sessao | admin, gerente, vendedor | conversa escopada |
| `/api/transcription` | POST | `Bearer CRON_SECRET` | publica | global (cron) |

Lista publica: `src/lib/api-publica.ts:15-26` (12 rotas, travadas em `tests/api-publica.test.ts:15-40`).

### 2.2 Telas

| Tela | Arquivo | Estado |
|------|---------|--------|
| `/login` | `src/app/(auth)/login/page.tsx` | funcional; "Esqueci a senha" e botao sem acao (`:90-92`); link publico "Criar conta" (`:121-126`) |
| `/register` | `src/app/(auth)/register/page.tsx` | so serve para o bootstrap; depois responde 403 |
| `/settings` (indice) | `src/app/(dashboard)/settings/page.tsx` | Server Component; filtra cartoes `soAdmin` por papel (`:57-60`) |
| `/settings/lojas` | `settings/lojas/page.tsx` | CRUD real; usa `ModalConfirmacaoBlock` (`:281-314`) |
| `/settings/integracoes` | `settings/integracoes/page.tsx` + `_components/conectar-conta.tsx` | real; desconectar usa `window.confirm` (`:114-118`), nao o modal de 3 s |
| `/settings/team` | `settings/team/page.tsx` | real; modal de 3 s so em desativar (`:414-425`) |
| `/settings/sla` | `settings/sla/page.tsx` | **falsa**: estado local, "Salvar" so dispara toast (`:37-39`) |
| `/settings/lgpd` | `settings/lgpd/page.tsx` | **falsa**: mesmo padrao (`:41-43`) |
| `/alerts` | `src/app/(dashboard)/alerts/page.tsx` | lista/reconhece; botao "verificar agora" quebrado (F07) |
| Cabecalho | `src/components/layout/Header.tsx` | seletor de loja, sino de alertas (polling 15 s, `:48-52`), menu "Meu Perfil" sem acao (`:192-195`), sair (`:198`) |

Nao existe tela de trilha de auditoria (nenhuma pagina consome `/api/activity-logs`).

---

## 3. Lojas

### 3.1 Modelo (`prisma/schema.prisma:18-57`, tabela `stores`)

| Coluna | Tipo | Regra |
|--------|------|-------|
| `id` | uuid | PK |
| `nome` | text | obrigatorio |
| `slug` | text UNIQUE (total) | gerado do nome; comentario diz "usado na URL de webhook e no seletor" |
| `ativo` | bool default true | duplica o significado de `is_deleted` (F13) |
| `bling_deposito_id` | text nulo | de-para com o deposito do Bling (decisao 6) |
| `created_at`, `updated_at`, `deleted_at`, `is_deleted`, `modified_by` | auditoria | `modified_by` sem FK |

Relacionamentos: praticamente toda tabela operacional aponta para `stores` (20 relacoes, `:35-54`).

### 3.2 Regras implementadas

- **Slug**: `gerarSlug` (`src/lib/loja.ts:11-19`) remove acento, troca espaco por hifen, minusculo, corta em 40. POST recusa slug vazio (`lojas/route.ts:57-63`); PUT nao (`lojas/[id]/route.ts:43`).
- **Unicidade de slug**: P2002 vira 409 (`lojas/route.ts:82-87`, `lojas/[id]/route.ts:59-64`).
- **Listar** (`lojas/route.ts:25-43`): filtra `ativo: true, isDeleted: false`; gestao ve todas + `blingDepositoId`; vendedor/viewer ve so a propria (sem `blingDepositoId`). Devolve `podeTrocar` (= e gestao), que liga o seletor.
- **Desativar** (`lojas/[id]/route.ts:77-112`): recusa 409 se houver usuario ativo OU qualquer pedido na loja (`:90-104`); senao grava `ativo=false, isDeleted=true, deletedAt, modifiedBy`.
- **Tela** (`settings/lojas/page.tsx`): lista, alerta de "loja sem deposito" (`:147-161`), dialogo com nome + deposito; deposito vira `Select` quando o Bling esta conectado (`:233-245`, alimentado por `/api/integracoes/bling/depositos`), senao texto livre. Confirmacao com bloqueio de 3 s e aviso quando o deposito muda (`:305-312`).
- **Sem trilha** em criar/editar/desativar loja (nao ha acao de loja em `ACOES`, `src/lib/auditoria.ts:23-35`).
- **Sem optimistic locking.**

### 3.3 `bling_deposito_id`

- Sem ele, `/api/integracoes/bling/catalogo` responde 409 (`bling/catalogo/route.ts:53-58`) e a disponibilidade da tela de venda perde estoque ao vivo. Decisao registrada: "saldo do deposito errado e pior que saldo nenhum" (ADR 0004).
- Saldo e lido **por deposito** (`src/lib/bling/config.ts:56-58`, path param) e o valor usado e `depositos[].saldoFisico ?? saldoVirtual` do deposito da loja (`src/lib/bling/cliente.ts:311-315`), nunca `saldoFisicoTotal` (soma da rede).
- `disponivel = max(0, saldo - reservado)`, onde `reservado` = pedidos do canal ainda `masc_status='pendente'` casados por SKU (`bling/catalogo/route.ts:86-107, 131-139`). `null` quando o Bling nao informou saldo (nao vira zero).

---

## 4. Escopo por loja (`src/lib/loja.ts`) e cookie `loja_ativa`

| Funcao | Linha | Comportamento |
|--------|-------|---------------|
| `PAPEIS_GESTAO` / `ehGestao` | `:34-38` | admin, gerente |
| `escopoDaLoja(usuario, lojaPedida)` | `:58-68` | vendedor/viewer -> `{storeId: usuario.storeId ?? "__sem_loja__"}` (ignora o pedido); gestao -> `{storeId: lojaPedida}` ou `{}` (todas) |
| `lojaParaGravar(usuario, lojaPedida)` | `:77-83` | vendedor -> loja do cadastro; gestao -> loja pedida ou `null` (rota responde 400 `faltaLoja`) |
| `COOKIE_LOJA` | `:86` | `"loja_ativa"` |
| `lojaAtiva(req)` | `:98-109` | `?loja=` tem prioridade; senao le o cookie |
| `faltaLoja()` | `:112-117` | 400 "Informe a loja (?loja=<id>)" |
| `foraDaLoja(oQue)` | `:131-136` | 404 "<x> nao encontrado nesta loja" — registro de outra loja responde igual a inexistente |
| `lojaDoWebhook` | `:151-159` | **codigo morto** (roteamento migrou para conta, `src/lib/roteamento.ts`) |

Seletor (`src/components/layout/SeletorLoja.tsx`): cookie gravado por JS, `path=/; max-age=31536000; SameSite=Lax`, sem `HttpOnly` (`:63-70`); trocar recarrega a pagina. Vendedor ve etiqueta fixa da loja (`:73-85`).

Regra documentada (docs/rbac.md:51-72): ids que chegam no corpo (`contactId`, `templateId`, `mediaFileIds`...) tambem precisam ser conferidos contra a loja resolvida — o `where` do registro principal nao cobre.

Pontos fracos: gestao pode mandar qualquer string em `loja_ativa`/`?loja=` e `lojaParaGravar` nao valida se a loja existe ou esta ativa (S24). O escopo e aplicado a mao em cada handler, so garantido por teste estatico (`tests/escopo-loja.test.ts:148-194`).

---

## 5. Usuarios e papeis

### 5.1 Modelo (`prisma/schema.prisma:110-143`, tabela `users`)

`id`, `store_id` (nulo), `name`, `email` UNIQUE, `password_hash`, `role` (text, default `"vendedor"`), `avatar_url`, `is_active` (default true), `last_login_at`, `created_at`, `updated_at`.
**Nao tem** `deleted_at`, `is_deleted`, `modified_by` (F20). Nao ha tabela de sessao, conta, verificacao, fator ou tentativa de login.

CHECK no banco (`prisma/sql/constraints.sql:9-14`):
```
(role IN ('admin','gerente') AND store_id IS NULL) OR (role IN ('vendedor','viewer') AND store_id IS NOT NULL)
```

### 5.2 Papeis (`src/lib/usuarios.ts:18-36`, `src/lib/rbac.ts:12`)

| Papel | Rotulo | Loja | Pode |
|-------|--------|------|------|
| `admin` | Administrador | nula | tudo, inclusive integracoes, lojas e usuarios |
| `gerente` | Gerente | nula | ve as duas lojas e opera tudo, **menos configuracao e usuario**; exclui; LGPD; le trilha |
| `vendedor` | Vendedor | obrigatoria | atende e vende na loja dele; nao exclui (excecao: cancelar agendamento) |
| `viewer` | Somente leitura | obrigatoria | so leitura na loja dele |

Fonte duplicada: `PAPEIS` (`usuarios.ts:18`) e `ROLES` (`rbac.ts:12`) sao duas listas iguais; `PAPEIS_SEM_LOJA` (`usuarios.ts:22`) e `PAPEIS_GESTAO` (`loja.ts:34`) tambem.

### 5.3 Regras de cadastro (`src/lib/usuarios.ts`)

- `lojaCombinaComPapel` (`:46-49`) espelha o CHECK; erro amigavel 422 (`:52-56`).
- Senha minima 8 (`:64`), sem maximo, sem outra politica.
- `criarUsuarioSchema` (`:66-73`): name >= 2, email, password, role enum, storeId nullable.
- `editarUsuarioSchema` (`:75-82`): name, role, storeId, isActive, password opcionais. Email nao muda.
- `deixariaSemAdmin` (`:94-113`): funcao pura; bloqueia rebaixar ou desativar o ultimo admin ativo.
- `CAMPOS_PUBLICOS` (`:116-122`): id, name, role, avatarUrl, storeId. `CAMPOS_DE_GESTAO` (`:125-131`): + email, isActive, lastLoginAt, createdAt. Nunca `passwordHash`.

### 5.4 Rotas

- **GET `/api/usuarios`** (`usuarios/route.ts:28-61`): sem `detalhe` devolve colegas ativos (seletor de transferencia do chat, `src/components/inbox/CabecalhoConversa.tsx:36`); com `?detalhe=1` exige admin no proprio handler (`:35-40`) e inclui desativados. Filtro: `OR [{storeId: loja}, {storeId: null}]` (gestao aparece nas duas lojas).
- **POST** (`:75-139`): valida papel x loja (422), confere que a loja existe **sem filtrar `is_deleted`/`ativo`** (`:95`), normaliza email `trim().toLowerCase()` (`:101`), 409 se existe, `bcrypt.hash(senha, 12)` (`:112`), `registrar("usuario_criado")` depois de criar (`:118-127`). Nao ha convite: admin define a senha inicial e entrega a pessoa.
- **PUT `/api/usuarios/[id]`** (`[id]/route.ts:30-129`): avalia papel e loja no estado FINAL (`:58-64`), trava ultimo admin (`:79-95`), troca senha se vier (`:104`), registra `usuario_alterado` ou `usuario_reativado` com diff campo a campo e `senhaTrocada: bool` (`:109-126`). **Nao impede auto-alvo** (admin pode se rebaixar/desativar via PUT se houver outro admin).
- **DELETE** (`:139-198`): so desativa (`isActive=false`), bloqueia auto-desativacao (`:156-161`) e ultimo admin, registra `usuario_desativado`. Nao derruba sessoes (JWT).

### 5.5 Tela Equipe (`settings/team/page.tsx`)

Tabela nome/e-mail/papel/loja/ultimo acesso; dialogo cria/edita com senha em `<Input type="text">` (`:350-359`, a senha fica visivel na tela); papel e loja via `<select>` de `PAPEIS`; loja desabilitada para gestao. Desativar passa pelo modal de 3 s; criar, trocar papel e trocar senha **nao**.

### 5.6 Bootstrap `/api/register` (`src/app/api/register/route.ts`)

- Publica (`api-publica.ts:18`). Se `prisma.user.count() === 0` cria `admin` (`:31-45`); senao 403 "O sistema ja tem administrador" (`:33-41`).
- Email gravado como veio (sem lowercase, `:47-67`); senha min 8; hash custo 12.
- Sem trilha, sem rate limit, sem transacao/lock (TOCTOU: S04).
- `docs/deploy-easypanel.md:186-188` instrui usar `/register` apos o primeiro deploy, com a app ja exposta na internet.

---

## 6. Autenticacao (NextAuth v4)

### 6.1 Configuracao (`src/lib/auth.ts`)

| Item | Valor | Linha |
|------|-------|-------|
| Estrategia | `session.strategy = "jwt"` (sem `maxAge` -> default NextAuth 30 dias) | `:7-9` |
| Pagina | `signIn: "/login"` | `:10-12` |
| Provider | Credentials (email, password) | `:14-54` |
| Busca | `user.findUnique({ where: { email: credentials.email } })` — email exatamente como digitado | `:25-27` |
| Recusa | `null` se nao existe ou `!isActive` **antes** do bcrypt | `:29-31` |
| Verificacao | `bcrypt.compare` | `:33-36` |
| Efeito | `lastLoginAt = now()` | `:38-41` |
| Token | `id`, `role`, `storeId` gravados no JWT no login e nunca relidos | `:57-73` |

Tipos: `src/types/next-auth.d.ts:3-20`.

Mensagem de recusa na UI e unica ("Email ou senha invalidos", `login/page.tsx:34-37`) e o NextAuth v4 devolve `CredentialsSignin` para todo `null`; o **tempo** de resposta, porem, difere (S08).

Logout: `signOut({ callbackUrl: "/login" })` no cliente (`Header.tsx:198`); JWT nao e revogavel no servidor.

### 6.2 `usuarioDaSessao` (`src/lib/sessao.ts:22-30`)

Le `getServerSession(authOptions)` (decodifica cookie; nao vai ao banco) e devolve `{id, role, storeId}` do token. `semSessao()` responde 401 (`:37-39`). Todas as rotas do escopo usam este helper para autoria (`modifiedBy`, `userId` da trilha, `acknowledgedBy`), nunca o corpo (travado por `tests/autoria.test.ts`).

### 6.3 Ausencias (confirmadas por leitura e busca)

Sem: segundo fator (TOTP/passkey/e-mail), bloqueio por conta, rate limit (nenhuma ocorrencia de limitador em `src`), lista de senhas vazadas, reset/recuperacao de senha, troca da propria senha, listagem/encerramento de sessoes, `must_change_password`, trilha de login/falha/logout, tabela de sessoes, expiracao por inatividade, papel `owner`/super-admin separado.

---

## 7. Borda: middleware, RBAC, rotas publicas e segredos de maquina

### 7.1 `src/middleware.ts`

1. Rota de API publica (`ehApiPublica`) passa direto (`:26-28`).
2. `getToken` valida o JWT (assinatura, nao so presenca) (`:30`).
3. Sem token: API -> 401 JSON (`:32-35`); pagina -> redirect `/login?callbackUrl=<caminho relativo>` (`:36-49`). Caminho relativo e proposital: atras do proxy `href` virava `https://0.0.0.0:3000` e abria open redirect por `Host` forjado (travado em `tests/middleware-proxy.test.ts`).
4. `/` com sessao -> `/inbox` num salto (evitava "React error #310") (`:58-60`).
5. **RBAC so para `/api`** (`:62-69`). Paginas nao tem RBAC.
6. Matcher explicito de paginas (`:74-95`); rota nova de pagina fora da lista nao e protegida pelo middleware.

### 7.2 `src/lib/rbac.ts`

- Padrao por metodo (`:34-40`): GET todos; POST/PUT/PATCH admin+gerente+vendedor; DELETE admin+gerente. HEAD/OPTIONS = GET; metodo desconhecido = so admin (`:92-103`).
- Excecoes, primeira que casa vence (`:47-89`):
  - `/api/scheduled/[id]` DELETE tambem vendedor (cancelamento logico);
  - `/api/integracoes(/...)` todos os metodos so admin;
  - `/api/lojas(/...)` escrita so admin (leitura segue padrao);
  - `/api/usuarios(/...)` escrita so admin (leitura segue padrao).
- `podeAcessar(role, path, metodo)` (`:106-109`): role ausente/desconhecida nega.
- Decisao explicita no comentario do topo (`:4-6`): "Nao ha checagem espalhada por route handler". Os handlers **nao** conferem papel (excecao: `?detalhe=1` em usuarios).
- `tests/rbac.test.ts` le as 57 rotas protegidas do disco e trava invariantes (admin passa em tudo, viewer nunca escreve, vendedor so exclui agendamento, leituras fechadas ao viewer = exatamente as 7 de integracoes, token sem role nao passa).

### 7.3 `src/lib/api-publica.ts`

Regex exatas (`:15-26`): `/api/auth/`, `/api/webhooks/`, `/api/register`, `/api/alerts/check`, `/api/transcription`, `/api/integracoes/bling/callback`, `/api/integracoes/tiktok/callback`.

### 7.4 `src/lib/webhook-auth.ts`

| Funcao | Mecanismo | Sem segredo | Linha |
|--------|-----------|-------------|-------|
| `iguaisEmTempoConstante` | `timingSafeEqual` com checagem previa de tamanho | — | `:21-26` |
| `verificarAssinaturaMeta` | HMAC-SHA256 do **corpo cru** com `META_APP_SECRET`, header `X-Hub-Signature-256` | 403 | `:41-55` |
| `verificarChallenge` | token de verificacao por canal (`WHATSAPP_/INSTAGRAM_/FACEBOOK_/TIKTOK_VERIFY_TOKEN`) | 403 | `:63-91` |
| `verificarWebhookUazapi` | segredo compartilhado global `UAZAPI_WEBHOOK_SECRET` em header `x-uazapi-secret` **ou `?segredo=`** | 403 | `:110-120` |
| `verificarWebhookPagamento` | `PAYMENT_WEBHOOK_SECRET` em `x-webhook-secret`/`asaas-access-token` | 403 | `:135-144` |
| `verificarSegredoCron` | `Authorization: Bearer CRON_SECRET` | 403 | `:154-164` |

TikTok Shop webhook: HMAC-SHA256 de `app_key + corpo cru` com `app_secret`, hex minusculo no header `Authorization` (`src/lib/tiktok/assinatura.ts:94-111`).

Pontos positivos a manter: segredo ausente = recusa; comparacao em tempo constante; HMAC sobre corpo cru; token de verificacao por canal.

---

## 8. Integracoes

### 8.1 Modelo `stores_integracoes` (`prisma/schema.prisma:62-104`)

| Coluna | Regra |
|--------|-------|
| `store_id` nulo | nulo = integracao da rede (hoje so Bling; TikTok via OAuth tambem nasce nulo, ver F03) |
| `provedor` | `bling`, `tiktok_shop`, `instagram`, `facebook`, `whatsapp_oficial`, `uazapi` |
| `rotulo` | nome que o operador ve ("WhatsApp Vendas Centro") |
| `status` | `desconectado`, `conectado`, `expirado`, `erro` |
| `credenciais_cifradas` | `v1:<iv>:<tag>:<cifrado>` base64url; JSON de pares chave/valor |
| `referencia_externa` | identificador NAO secreto da conta; chave de roteamento do webhook |
| `expira_em`, `ultimo_erro`, `ultima_sincronizacao` | operacao |
| auditoria | 5 colunas |
| UNIQUE `(provedor, referencia_externa)` | **total**, nao parcial por `is_deleted` (F01) |
| indices | `store_id`; `(provedor, referencia_externa)` (redundante com o unique) |

Relacionada a `conversations.store_integracao_id` (responde pela conta de entrada) e `broadcasts.store_integracao_id` (conta de saida da campanha; coluna adicionada por SQL sem FK, `constraints.sql:50-52`).

### 8.2 Catalogo (`src/lib/integracoes-catalogo.ts`, sem imports para caber no bundle do cliente)

| Constante | Conteudo | Linha |
|-----------|----------|-------|
| `PROVEDORES` | 6 provedores | `:21-30` |
| `PROVEDORES_DE_CANAL` | instagram, facebook, whatsapp_oficial, uazapi, tiktok_shop | `:34-40` |
| `CANAL_DO_PROVEDOR` | whatsapp_oficial/uazapi -> `whatsapp`; instagram; facebook; tiktok_shop -> `tiktok` | `:49-55` |
| `STATUS` | 4 estados | `:58` |
| `PROVEDORES_DA_REDE` | `["bling"]` | `:64-68` |
| `CHAVES_ESPERADAS` | whatsapp_oficial: `phone_id`, `access_token`; uazapi: `token`; instagram/facebook: `page_access_token` | `:79-85` |
| `REFERENCIA_DO_PROVEDOR` | rotulo + ajuda: phone_number_id / id da conta IG (`entry.id`) / id da pagina FB / nome da instancia uazapi (`body.instance`) | `:101-121` |
| `AJUDA_DA_CHAVE` | textos de ajuda por chave | `:124-129` |

`src/lib/integracoes.ts`: `chavesFaltando` (`:8-12`), `integracaoSchema` (`:14-21`), `atualizacaoSchema` (rotulo, status, credenciais, expiraEm — sem storeId) (`:23-28`), `paraApi` (`:53-71`: devolve `escopo: loja|rede`, credenciais mascaradas, `expirada`).

### 8.3 Cofre (`src/lib/cofre.ts`)

- AES-256-GCM, IV 12 bytes aleatorio, tag de autenticacao, prefixo `v1` (`:18-20, 65-72`).
- Chave `INTEGRATIONS_KEY` lida a cada uso; aceita 64 hex ou base64 de 32 bytes; ausente/tamanho errado lanca `CofreError` (`:45-62`). Rotas respondem 503 e **nunca** gravam em texto plano.
- `decifrar` falha em qualquer adulteracao, mensagem generica (`:80-104`).
- `ehCofreError` compara por `name` (atravessa bundles do Next) (`:37-39`).
- `mascarar`: 4 marcadores + ultimos 4 caracteres (`:130-133`); `resumoPublico` decifra tudo so para mascarar e devolve `{erro:"ilegivel"}` se falhar (`:139-149`).
- `segredosIguais` exportado e sem uso (`:152-157`).
- Sem AAD (dado associado) e sem suporte a mais de uma chave (S28).

### 8.4 CRUD de contas (`/api/integracoes`, `/api/integracoes/[id]`)

- **GET lista** (`integracoes/route.ts:16-33`): com loja ativa traz as da loja + as de rede (`storeId null`).
- **POST** (`:35-129`): provedor da rede nasce sem loja; demais exigem loja de gravacao (`:44-48`); 409 se a conta ja existe viva, dizendo "nesta loja"/"em outra loja" (`:50-67`); recusa credencial incompleta (`:73-81`); status `conectado` se veio credencial, senao `desconectado`; `registrar("integracao_conectada")` com provedor/rotulo/referencia (`:102-114`). Permite criar `bling` manualmente, contornando o OAuth.
- **PUT** (`[id]/route.ts:33-81`): rotulo, status livre, expiraEm, e **substitui o JSON inteiro** de credenciais sem conferir chaves (F02); limpa `ultimoErro`. Sem trilha.
- **DELETE** (`[id]/route.ts:91-128`): apaga a credencial de verdade (`credenciaisCifradas=null`) e faz soft delete da linha; registra `integracao_desconectada`. Tela usa `window.confirm`.
- Nenhuma rota por id tem escopo de loja (aceitavel so porque e so admin).

### 8.5 OAuth — `state` assinado (`src/lib/bling/estado.ts`)

- Conteudo `{u: usuarioId, t: emitidoMs, n: nonce 8 bytes}` em base64url + `.` + HMAC-SHA256 com **`NEXTAUTH_SECRET`** (`:15-42`).
- Validacao: assinatura em tempo constante, JSON, idade <= `VALIDADE_STATE_MS` = 60 s (`bling/config.ts:67`), usuario presente (`:48-76`).
- Nao ha registro de uso (replay possivel dentro de 60 s), nao ha amarracao ao navegador que iniciou, e o callback nao reconfere se `u` ainda e admin ativo (S18).
- TikTok reusa o mesmo mecanismo (`tiktok/autorizar/route.ts:4`).

### 8.6 Bling (conta unica da rede, somente leitura)

- Config do app por ambiente: `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `BLING_REDIRECT_URI` (`bling/config.ts:90-101`).
- Endpoints (`bling/config.ts:33-58`): base `https://api.bling.com.br/Api/v3`; `/oauth/authorize`, `/oauth/token`, `/produtos`, `/depositos`, `/estoques/saldos/{idDeposito}` (confirmado em OpenAPI oficial em 17/08/2026). Limites: 3 req/s, 120 mil/dia, bloqueio de IP em 600 req/10 s ou 300 erros/10 s, sem `Retry-After`, sem idempotencia (`:29-31`).
- **Autorizar** (`bling/autorizar/route.ts:16-37`): devolve `{url}` JSON (a tela faz `window.location`).
- **Callback** (`bling/callback/route.ts:22-89`): trata `?error`, valida state, troca code (Basic auth com client_id:client_secret; nunca no body — `bling/cliente.ts:52-77`), cifra `{access_token, refresh_token, expira_em}`, atualiza a linha viva existente ou cria com `referenciaExterna: "rede"` e `rotulo: "Bling da rede"` (`:47-74`); redireciona para `/settings/integracoes?ok|erro=<codigo>` usando `NEXTAUTH_URL` (`:16-20`). **Sem trilha.**
- **Renovacao** (`bling/cliente.ts:132-164`): se faltar menos de 5 min (`MARGEM_RENOVACAO_MS`, `config.ts:64`), renova e regrava no cofre; Bling invalida o refresh anterior; sem lock (F04). Refresh vale 30 dias; `expires_in` ausente assume 1 h.
- **Chamada** (`bling/cliente.ts:167-210`): em erro grava `ultimoErro = "HTTP <status> em <path>"` e status `expirado` (401) ou `erro`; em sucesso `ultimaSincronizacao`. Corpo de erro (200 chars) sobe ate o cliente HTTP.
- Leituras: `listarProdutos` (`:245-251`), `listarProdutosPorCodigo` (`codigos[]`, `:259-269`), `listarDepositos` (`:272-275`), `listarSaldos` (`idsProdutos[]` obrigatorio, `:288-303`), `saldoNoDeposito` (`:311-315`).
- `GET /api/integracoes/bling/catalogo` (admin): exige Bling conectado (409), exatamente uma loja no escopo (400), deposito preenchido (409); pagina validada; 401 do Bling vira 409 (`catalogo/route.ts:21-122`).
- `GET /api/integracoes/bling/depositos` (admin): Bling desconectado = `{conectado:false, depositos:[]}` (`depositos/route.ts:17-48`).
- **Travas**: nenhum metodo de escrita; `tests/bling.test.ts` aceita so os dois POST do OAuth (ADR 0004).

### 8.7 TikTok Shop (por loja, somente leitura)

- Config: `TIKTOK_SHOP_APP_KEY`, `TIKTOK_SHOP_APP_SECRET`, `TIKTOK_SHOP_REDIRECT_URI` (`tiktok/config.ts:79-90`).
- Endpoints (`:41-54`, marcados CONFERIR): authorize `services.tiktokshop.com/open/authorize`; token/refresh `auth.tiktok-shops.com/api/v2/token/{get,refresh}`; `/authorization/202309/shops`, `/product/202309/products/search`, `/order/202309/orders/search`.
- Assinatura (`tiktok/assinatura.ts:28-78`): params menos `sign`/`access_token`, ordenados, `{k}{v}` concatenados, envoltos por `app_secret` (+ caminho se `ASSINATURA_INCLUI_CAMINHO=true`, `config.ts:38`, **nao confirmado**), HMAC-SHA256 hex maiusculo; `timestamp` em segundos; token no header `x-tts-access-token`.
- Troca de code manda `app_secret` na query string (exigencia do provedor, `tiktok/cliente.ts:61-75`).
- Callback (`tiktok/callback/route.ts:20-88`): referencia = `shop_id || shop_cipher` (recusa sem); cria com `storeId: null` e rotulo `TikTok Shop <ref>`; sem trilha. Na pratica `shop_id/shop_cipher` nao sao preenchidos por `montarTokens` (`cliente.ts:41-58` so devolve access/refresh/expira) — o callback provavelmente sempre cai em `token-sem-loja`. (Inferencia de leitura; nao executado.)
- Comentario de `tiktok/autorizar/route.ts:13-15` diz que a loja ativa entra no fluxo; o codigo nao a usa.
- Renovacao preserva `shop_cipher` (`cliente.ts:118-130`); margem 10 min; mesma corrida do Bling.

### 8.8 uazapi (WhatsApp nao oficial, por numero)

- Config: `UAZAPI_BASE_URL` (host proprio por cliente, `uazapi/config.ts:47-55`), endpoints `/send/text`, `/send/media`, `/instance/status`, `/instance/connect`, `/instance/disconnect` e header `token` — todos NAO confirmados (`:58-75`).
- Token da instancia (credencial `token`) da acesso total ao numero.
- Sessao (`api/integracoes/uazapi/[id]/sessao/route.ts`): GET consulta estado e **grava** status no banco (`:53-77`); POST inicia pareamento e devolve QR base64 (`:79-93`); falha de config grava `status=erro`. Estados normalizados em `uazapi/instancia.ts:28-44`.
- Riscos de negocio documentados e exibidos na tela: numero pode ser banido, sessao cai, sem template aprovado (`integracoes/page.tsx:277-288`, `conectar-conta.tsx:137-142`).
- Webhook: segredo global, conta resolvida por `body.instance` via `contaDoEvento("uazapi", ...)` (`webhooks/uazapi/route.ts:17-45`); conta desconhecida = 200 e descarta.

### 8.9 Roteamento por conta (`src/lib/roteamento.ts`)

- `contaDoEvento(provedor, referencia)` (`:29-42`): busca viva por `(provedor, referencia_externa)`; devolve `null` se nao houver ou se `storeId` for nulo (mensagem de canal sempre pertence a loja).
- `contaDaUrl` (`:51-53`): `?conta=<referencia>` na URL (usado pelo TikTok).
- `credenciaisDaConta` (`:61-75`): decifra na hora; ilegivel = `null`.
- `contaDaConversa` (`:86-99`): responde pela conta de entrada; conversa sem conta cai no adapter de ambiente.

---

## 9. Alertas e SLA

### 9.1 Modelo `alerts` (`prisma/schema.prisma:586-609`)

`store_id`, `type`, `severity` (low/medium/high/critical), `conversation_id`, `contact_id`, `order_id`, `message`, `acknowledged_by`, `acknowledged_at`, `created_at`. **Sem** `updated_at`, `deleted_at`, `is_deleted`, `modified_by`.

### 9.2 Regras (`src/lib/alerts/rules.ts`)

SLA por canal em minutos, hardcoded (`:7-12`): whatsapp 5, instagram 15, facebook 30, tiktok 60.

| Tipo | Severidade | Gatilho implementado (`engine.ts`) | Dedup | Marca origem? |
|------|------------|-------------------------------------|-------|---------------|
| `sla_breach` | high | conversa `open`, `sla_breached=false`, `unread>0`, `last_message_at < agora - SLA do canal` (`:25-77`) | alerta nao reconhecido da conversa | sim, `sla_breached=true` |
| `review_risk` | critical | instagram/facebook `open`, `unread>0`, sem mensagem ha 2 h (`:82-124`) | alerta nao reconhecido | **nao** -> regenera apos reconhecer |
| `deal_stale` | high | deal `negotiating`/`closing` sem atividade ha 3 dias (`:129-171`) | nao reconhecido e criado < 3 dias | **nao** |
| `first_contact` | medium | contato criado < 5 min com `total_orders=0` (`:176-211`) | qualquer alerta do contato | — |
| `returning_customer` | medium | conversa criada < 5 min de contato com ultimo contato > 30 dias e pedidos > 0 (`:216-262`) | janela 5 min | — |
| `payment_pending` | medium | pix `pending` criado ha 20+ min e nao expirado (`:267-313`) | nao reconhecido do pedido | **nao** |
| `follow_up_due` | high | mensagem agendada `scheduled` vencida (`:318-358`) | nao reconhecido na ultima 1 h | **nao** |
| `hot_lead` | medium | declarado (`rules.ts:31-35`), **sem gerador** (so o seed cria) | — | — |
| `low_stock` | low | declarado (`rules.ts:41-45`), **sem gerador** | — | — |

`PURCHASE_INTENT_KEYWORDS` (`rules.ts:69-88`) sem uso. `take` de 20-50 por regra; `findFirst` por item (N+1); motor global (todas as lojas) e o alerta herda `store_id` da origem.

### 9.3 Rotas e tela

- `POST /api/alerts/check` (`alerts/check/route.ts:9-22`): cron com `Bearer CRON_SECRET`; devolve `{created}`. Doc sugere a cada 1 min no codigo e a cada 5 min no deploy.
- `GET /api/alerts` (`alerts/route.ts:7-48`): filtros type/severity/acknowledged, paginado (padrao 30); `unacknowledgedCount` **sem escopo de loja** (`:44`).
- `PUT /api/alerts/[id]` (`alerts/[id]/route.ts:14-38`): reconhece com `acknowledgedBy` da sessao, dentro do escopo; nao impede reconhecer de novo; sem trilha.
- Tela `/alerts`: filtros, reconhecer, polling 30 s, botao "verificar agora" chama `/api/alerts/check` sem Bearer (`alerts/page.tsx:102-109`) -> sempre falha em silencio.
- `/settings/sla`: campos de SLA por canal, por prioridade (urgent 2, high 5, medium 15, low 60) e toggles de notificacao — **nada persiste** (`sla/page.tsx:12-39`). O indice de configuracoes descreve a tela como "Somente leitura" (`settings/page.tsx:46`). Prioridade e notificacao nao existem no backend.

---

## 10. Trilha de auditoria

### 10.1 Modelo `activity_logs` (`prisma/schema.prisma:861-883`)

`store_id` nulo (acao de rede), `user_id` nulo (webhook/rotina), `action` text, `entity_type`, `entity_id`, `details` jsonb default `{}`, `ip_address`, `created_at`. FKs para users e stores. Sem politica append-only no banco. `store_id` virou nulo por `constraints.sql:41`.

### 10.2 `src/lib/auditoria.ts`

- `ACOES` lista fechada (`:23-35`): `usuario_criado`, `usuario_alterado`, `usuario_desativado`, `usuario_reativado`, `integracao_conectada`, `integracao_desconectada`, `conversa_resolvida`, `conversa_transferida`, `pedido_lancado_masc`, `contato_apagado_lgpd`, `campanha_disparada`.
- `limparDetalhes` troca por `[omitido]` o valor de chaves que casam `/senha|password|token|secret|credencia|authorization|apikey|api_key/i` (`:39-47`) — so no primeiro nivel do objeto.
- `ipDaRequisicao`: primeiro item de `x-forwarded-for`, senao `x-real-ip` (`:56-60`).
- `registrar` (`:62-89`): `activityLog.create`; em erro so `console.error` (**nunca derruba a operacao**, decisao explicita `:14-17`).
- `diferenca(antes, depois)` (`:98-108`): so campos presentes em `depois`, formato `{campo: {de, para}}`.

### 10.3 Pontos que chamam `registrar` (busca em `src`)

`usuarios/route.ts:118`, `usuarios/[id]/route.ts:109, 187`, `integracoes/route.ts:102`, `integracoes/[id]/route.ts:117`, `conversations/[id]/route.ts:134`, `broadcasts/[id]/disparar/route.ts:63`.
**Declaradas e nunca chamadas**: `pedido_lancado_masc`, `contato_apagado_lgpd`.
**Sem acao declarada**: login, falha de login, logout, bootstrap de admin, 403, loja criar/editar/desativar, troca de credencial (PUT), OAuth Bling/TikTok, pareamento uazapi, reconhecer alerta, exportar LGPD.

### 10.4 `/api/activity-logs`

- GET (`:8-36`): filtros `userId`, `action`, `entityType`, paginado (padrao 50), escopo de loja; inclui nome do usuario. RBAC padrao: **vendedor e viewer tambem leem**.
- POST (`:44-69`): qualquer papel de escrita grava entrada com `action`, `entityType`, `entityId`, `details` vindos do corpo, sem Zod, sem `ACOES`, sem `limparDetalhes`; IP por `x-forwarded-for` duplicado (`:61-64`). Nenhuma tela usa.

---

## 11. IA (Anthropic)

- Cliente singleton com `ANTHROPIC_API_KEY` (`src/lib/ai/client.ts:5-12`). Modelo fixo `claude-sonnet-4-20250514` em tres arquivos (`suggest.ts:76`, `classify.ts:23`, `summarize.ts:30`).
- Prompts (`src/lib/ai/prompts.ts`): `MERLOS_SYSTEM_PROMPT` (tom da marca, grade Slim PP-GG 34-44 e Plus 46-58, categorias, "nunca invente estoque/preco"); `SUGGEST_PROMPT`; `CLASSIFY_PROMPT` (JSON: intent em 11 valores, urgency, sentiment, product_mentioned, tags_suggested); `SUMMARIZE_PROMPT` (2-3 frases).
- **suggest** (`suggest.ts:11-89`; rota `ai/suggest/route.ts:12-51`): ultimas 20 mensagens; produtos `active` (top 10 por destaque) e respostas rapidas ativas **de todas as lojas** (`:40-44, 60-63`); nome e tamanho do contato. Nao persiste.
- **classify** (`classify.ts:12-53`; rota `ai/classify/route.ts:13-80`): texto da cliente interpolado no prompt entre aspas (`:28`); JSON extraido por regex com fallback; grava `messages.ai_classification` e **acrescenta tags sugeridas no contato** sem revisao (`:57-70`).
- **summarize** (`summarize.ts:5-42`; rota `ai/summarize/route.ts:12-46`): le **todas** as mensagens (sem `take`), grava `conversations.ai_summary`.
- Rotas escopam a conversa/mensagem por loja e respondem 404 fora do escopo. Sem rate limit, sem controle de custo, sem trilha.
- UI: `AiSuggestion` comentado em `ChatWindow.tsx:389-399` — "FORA DE ESCOPO neste projeto (decisao de 18/08/2026)", rotas mantidas.

---

## 12. Utilitarios, banco, scripts e infra

### 12.1 Paginacao (`src/lib/paginacao.ts`)

`LIMITE_MAXIMO = 100` (`:19`); `limiteDaPagina(valor, padrao)`: ausente/vazio/nao numerico -> padrao, < 1 -> 1, trunca fracao, teto 100 (`:25-37`); `paginaAtual`: >= 1 (`:40-45`); `pular` exportado e sem uso (`:48-50`). Testes em `tests/robustez-fase5.test.ts:29-78`.

### 12.2 Soft delete (`src/lib/db/soft-delete.ts`)

Extensao do Prisma injeta `isDeleted:false` em `findMany/findFirst/findFirstOrThrow/count/aggregate` de 8 models (`Contact`, `Deal`, `MediaFile`, `Lookbook`, `KnowledgeArticle`, `QuickReply`, `WhatsappTemplate`, `Broadcast`) quando o chamador nao mencionou `isDeleted` (`:18-48`). `findUnique`, `update*`, `upsert` e os demais models ficam de fora; `Store` e `StoreIntegracao` filtram a mao. Excecao legal: `DELETE /api/lgpd` apaga fisicamente ~20 tabelas fora de transacao (`src/app/api/lgpd/route.ts:117-151`, ADR 0005). Sob Drizzle nao ha extensao de cliente: a base usa helper `vivos()`.

### 12.3 `prisma/sql/constraints.sql` (reaplicavel)

| Item | Linha |
|------|-------|
| CHECK `users_loja_por_papel` | `:9-14` |
| UNIQUE parcial `messages (store_id, external_id) WHERE external_id IS NOT NULL` (idempotencia de webhook) | `:30-32` |
| `activity_logs.store_id DROP NOT NULL` | `:41` |
| `broadcasts.store_integracao_id` + indice, **sem FK** | `:50-52` |

### 12.4 Seed (`prisma/seed.ts`)

- `limpar()` faz `deleteMany` em 24 tabelas, incluindo `activity_logs` e `users` (`:25-53`).
- Cria lojas Centro (`centro`) e Cerro Azul (`cerro-azul`) sem deposito (`:205-211`).
- Senha literal **`admin123`** para 5 contas (`:213-237`): admin, gerente (sem loja), 2 vendedoras (uma por loja), 1 viewer (Centro) — e imprime a lista com a senha (`:243-254`).
- Dados propositalmente repetidos entre lojas para provar isolamento: telefone `5511999001001`, SKU `VLC-001`, pedido `MS2608-0001`, atalho `/frete` (`:108-117, 172-181`).
- Nao roda no entrypoint (`Dockerfile:95` e so `node server.js`). `docs/deploy-easypanel.md:180` proibe em producao.

### 12.5 Scripts

| Script | Faz | Observacao |
|--------|-----|------------|
| `scripts/db-bootstrap.mjs` | aplica `prisma/schema.sql` (gerado no build) so em banco vazio, em transacao; **sempre** aplica `constraints.sql` | falha de constraint so gera AVISO e a app sobe (`:60-76`) |
| `scripts/db-constraints.mjs` | aplica `constraints.sql`; le `DATABASE_URL` do ambiente ou regex no `.env` (`:22-32`) | usado por `npm run db:push` |
| `scripts/db-backup.mjs` | `pg_dump --no-owner --no-acl --clean --if-exists` para `~/Documents/DB_backups/backup_DD_MM_YYYY_HH_MM.sql`; reprova dump < 1 KB (`:54-71`) | URL com senha vai em argv do `pg_dump` |

### 12.6 Dockerfile

Multi-estagio `node:20-slim` + openssl (`:10-14`); `prisma generate` + `next build` (`:36-37`); gera `schema.sql` com `prisma migrate diff --from-empty` (`:44-46`); runtime `NODE_ENV=production`, `HOSTNAME=0.0.0.0`, `PORT=3000` (`:52-66`); usuario nao-root `nextjs` com home (`:71-73, 92`); copia `prisma/` e `scripts/` para a imagem (`:89-90`); sem `HEALTHCHECK`; CLI do Prisma fora da imagem por tamanho (48 MB vs +800 MB).

### 12.7 `docs/deploy-easypanel.md` (estado e desatualizacoes)

- Servicos: app (Dockerfile, porta 3000), Postgres 16, MinIO privado; Redis declarado como NAO usado (`:9-14`). Health check: `GET /login` (`:53-54`).
- Alertas uteis: nao passar segredo como build-arg (`:40-50`); `NEXTAUTH_URL` https exige HTTPS real (cookie `__Secure-`, `:72-76`); `INTEGRATIONS_KEY` 64 hex, diferente em HML/PRD e imutavel (`:78-95`); `S3_ENDPOINT` publico (URL assinada para Meta/uazapi) (`:84-89`).
- Primeira subida: `/register` publico para criar admin (`:186-188`).
- Crons com `curl -H` (GET) para rotas so-POST (`:211-212`).
- Desatualizado: "Next.js 14" (`:11`), "26 tabelas" (`:154`), "ActivityLog nenhuma rota escreve" e "bling_deposito_id sem tela" (`:236-240`); expor porta do Postgres para `db push` (`:177-178`).

### 12.8 `.env.example`

`DATABASE_URL` porta 5437; `NEXTAUTH_URL` 3005, `NEXTAUTH_SECRET`; `CRON_SECRET`; `INTEGRATIONS_KEY`; WhatsApp Cloud (`WHATSAPP_PHONE_ID/ACCESS_TOKEN/VERIFY_TOKEN/BUSINESS_ACCOUNT_ID`); Meta (`META_APP_ID/APP_SECRET/PAGE_ACCESS_TOKEN/INSTAGRAM_ACCOUNT_ID`, `INSTAGRAM_/FACEBOOK_VERIFY_TOKEN`); TikTok mensagens (`TIKTOK_CLIENT_KEY/SECRET/VERIFY_TOKEN`); TikTok Shop (`TIKTOK_SHOP_APP_KEY/APP_SECRET/REDIRECT_URI`); uazapi (`UAZAPI_BASE_URL`, `UAZAPI_WEBHOOK_SECRET`); `ANTHROPIC_API_KEY`; `OPENAI_API_KEY`; S3/MinIO (`S3_ENDPOINT` 9002, bucket `merlostore-midia`, chaves dev); Bling (`BLING_CLIENT_ID/SECRET/REDIRECT_URI`); `REDIS_URL` 6382; pagamento (`PAYMENT_PROVIDER`, `MERCADOPAGO_ACCESS_TOKEN`, `ASAAS_API_KEY`, `PAYMENT_WEBHOOK_SECRET`). Nao lidos pelo codigo segundo o deploy doc: `REDIS_URL`, `META_APP_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `TIKTOK_CLIENT_KEY/SECRET`, `MERCADOPAGO_ACCESS_TOKEN`, `ASAAS_API_KEY`.

### 12.9 `docker-compose.yml` e `next.config.mjs`

Compose: Postgres 16 `5437:5432` (dev/dev, db `merlostore_dev`), Redis 7 `6382:6379` com AOF, MinIO `9002` API / `9003` console (dev/devdevdev), `minio-init` cria bucket privado. Imagens `minio:latest` sem versao fixa.
`next.config.mjs:2-18`: so `output: "standalone"` e `remotePatterns` para `i.pravatar.cc`. **Sem cabecalhos de seguranca.**

### 12.10 Testes existentes que leem o fonte (padrao a preservar no rebuild)

| Teste | Trava |
|-------|-------|
| `tests/api-publica.test.ts` | exatamente 12 rotas publicas; prefixo parecido nao libera |
| `tests/rbac.test.ts` | invariantes de papel sobre todas as rotas do disco |
| `tests/escopo-loja.test.ts` | cada handler que toca model de loja chama `escopoDaLoja`/`lojaParaGravar` e le a sessao; criar define `storeId` |
| `tests/usuarios-fase4.test.ts` | papeis, loja x papel = CHECK, ultimo admin, auto-desativacao, register so bootstrap, tela sem mock |
| `tests/robustez-fase5.test.ts` | teto de paginacao, upload, idempotencia de webhook, constraints no bootstrap, acoes auditadas, menu filtrado |
| `tests/middleware-proxy.test.ts` | callbackUrl relativo; raiz em um salto |
| `tests/autoria.test.ts`, `webhook-auth`, `cofre`, `bling`, `tiktok-assinatura`, `uazapi` | autoria da sessao; segredos; cofre; Bling sem escrita; assinatura; aviso de banimento |

---

## 13. Falhas de seguranca (comparadas com `estrutura base/docs/seguranca-login.md`)

Severidade: **C** critica, **A** alta, **M** media, **B** baixa. "Secao" = bloco do portao da regua.

| ID | Sev | Secao da regua | Falha | Evidencia | Impacto |
|----|-----|----------------|-------|-----------|---------|
| S01 | C | Sessao | Papel, loja e ativo moram no JWT e nunca sao relidos; desativar ou rebaixar nao derruba a sessao; sessao dura 30 dias (default NextAuth, sem `maxAge`), sem inatividade | `auth.ts:7-9, 57-73`; `middleware.ts:30, 64`; `sessao.ts:22-30`; `usuarios/[id]/route.ts:181-185` (comentario `:136-137` supoe que `isActive` barra) | demitido segue operando ate 30 dias; rebaixado mantem privilegio; vendedor transferido de loja segue vendo a antiga |
| S02 | C | Segundo fator | Nao existe segundo fator de nenhum tipo | ausencia em `auth.ts`, schema sem tabela de fator | senha vazada = conta tomada, inclusive admin que controla credenciais de pagamento e WhatsApp |
| S03 | C | Login e bloqueio | Sem bloqueio por conta e sem rate limit em login, register, reset (inexistente) ou IA | `auth.ts:20-53`; nenhuma ocorrencia de limitador em `src` | forca bruta ilimitada em senha de 8 caracteres |
| S04 | C | Caminhos e guardas / Administracao | Bootstrap de admin por rota publica: qualquer um que acesse um deploy novo antes do operador vira admin; checagem `count()==0` sem lock permite dois admins em corrida; sem trilha | `register/route.ts:31-67`; `api-publica.ts:18`; `deploy-easypanel.md:186-188`; link publico `login/page.tsx:121-126` | tomada total da instalacao no primeiro deploy (HML/PRD novos) |
| S05 | C | Administracao | Admin escolhe a senha definitiva de outra pessoa (criar e editar); sem `must_change_password`, sem expiracao, sem motivo, sem revogar sessoes; senha digitada em campo visivel | `usuarios/route.ts:112`; `usuarios/[id]/route.ts:104`; `team/page.tsx:350-359` | admin (ou quem roubou a conta dele) assume qualquer identidade sem rastro de "quem sabia a senha" |
| S06 | C | Caminhos e guardas | Autorizacao por papel existe **so no middleware**; handlers nao conferem papel; paginas sem RBAC; matcher de paginas e lista manual | `rbac.ts:4-6`; `middleware.ts:62-69, 74-95`; `docs/rbac.md:101-105` | um desvio da borda (bug, rota fora do matcher, Server Action no rebuild) abre escrita administrativa; no Next 16 o proxy nao e fronteira |
| S07 | C | Login e bloqueio (sem contas padrao) | Senha literal `admin123` no seed para admin/gerente/vendedoras/viewer, impressa no console; seed apaga todas as tabelas | `seed.ts:213-254, 25-53` | quem rodar o seed num ambiente acessivel entrega a rede; nao roda no entrypoint (ponto positivo, `Dockerfile:95`) |
| S08 | A | Login e bloqueio | Oraculo de tempo: e-mail inexistente ou conta desativada retornam antes do bcrypt | `auth.ts:29-31` vs `:33` | enumeracao de contas e de contas desativadas pelo tempo |
| S09 | A | Senha | Minimo 8 com fator unico (regua: 15), sem teto de entrada (bcrypt trunca em 72 bytes), sem lista de vazadas | `usuarios.ts:64`; `register/route.ts:9` | senhas fracas aceitas; bytes apos 72 ignorados silenciosamente |
| S10 | A | Trilha | Nenhum evento de login, falha, logout, troca de senha, mudanca de papel como evento proprio, recusa 403; so `lastLoginAt` sobrescrito | `auth.ts:38-41`; `middleware.ts:64-69` (403 sem registro) | incidente de conta nao e investigavel |
| S11 | A | Trilha / Administracao | `registrar` roda **depois** do efeito e engole a falha, inclusive em mudanca de papel e senha por admin | `auditoria.ts:73-88`; `usuarios/[id]/route.ts:97-126` | acao administrativa destrutiva pode ficar sem prova; regua exige trilha antes e "falhou a trilha, nao concede" |
| S12 | A | Trilha | Acoes sensiveis sem trilha: bootstrap de admin, criar/editar/desativar loja, trocar credencial (PUT), conectar Bling/TikTok por OAuth, parear uazapi, reconhecer alerta, exportar e apagar LGPD (acao `contato_apagado_lgpd` declarada e nunca chamada), lancamento Masc (`pedido_lancado_masc` nunca chamada) | `lojas/route.ts:51-91`; `lojas/[id]/route.ts:23-112`; `integracoes/[id]/route.ts:33-81`; `bling/callback/route.ts:43-76`; `tiktok/callback/route.ts:33-75`; `lgpd/route.ts:85-154`; `auditoria.ts:23-35` | troca da conta Bling da rede ou apagamento de cliente sem autor registrado |
| S13 | A | Trilha | Trilha forjavel: `POST /api/activity-logs` aceita de vendedor acao e detalhes livres, sem Zod, sem lista fechada, sem filtro de segredo | `activity-logs/route.ts:44-69`; `rbac.ts:36` | falsificacao/poluicao da prova; segredo pode ser gravado e exibido |
| S14 | A | Trilha | Trilha nao e append-only: nenhuma restricao de `DELETE`/`UPDATE` para o usuario da aplicacao; seed apaga `activity_logs` | `seed.ts:46`; schema sem politica | prova destruivel pela propria aplicacao |
| S15 | A | Login e bloqueio (IP canonico) / principio 4 | IP lido de `x-forwarded-for` cru (primeiro item, forjavel), em duas implementacoes | `auditoria.ts:56-60`; `activity-logs/route.ts:61-64` | IP da trilha sem valor; base errada para qualquer limitador futuro |
| S16 | A | Administracao | Trilha legivel por vendedor e viewer (RBAC padrao GET), com IP e acoes dos colegas; decisao 7 previa gestao | `activity-logs/route.ts:8-36`; `rbac.ts:35, 86-88`; `tests/rbac.test.ts:83-98` | exposicao de dado de auditoria a papel operacional |
| S17 | A | Caminhos e guardas (segredo de maquina) | Webhook uazapi aceita segredo em query `?segredo=`; um segredo global para todas as instancias | `webhook-auth.ts:110-120`; `.env.example:61-64` | segredo cai em log de proxy; vazou um, todas as lojas/numeros aceitam evento forjado |
| S18 | A | Caminhos e guardas | `state` OAuth assinado com `NEXTAUTH_SECRET` (reuso de chave), sem uso unico, sem amarracao ao navegador, e o callback nao reconfere se o emissor ainda e admin ativo | `bling/estado.ts:24-28, 48-76`; `bling/callback/route.ts:32-59`; `tiktok/callback/route.ts:23-56` | URL de autorizacao vazada em 60 s permite conectar conta Bling/TikTok de terceiro na rede |
| S19 | A | Borda e versao | Sem HSTS, CSP, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`; respostas autenticadas sem `Cache-Control: no-store` | `next.config.mjs:2-18` | clickjacking, cache de dado sensivel em proxy/navegador |
| S20 | A | Tela "Meu perfil > Seguranca" | Nao existe: item "Meu Perfil" sem acao, sem trocar a propria senha, sem ver/encerrar sessoes; "Esqueci a senha" e botao morto | `Header.tsx:192-195`; `login/page.tsx:90-92` | usuario nao reage a comprometimento; reset so via admin (que escolhe a senha, S05) |
| S21 | A | Administracao | Sem separacao dono x admin: qualquer admin promove qualquer um a admin; unica trava e "ultimo admin"; PUT permite auto-rebaixamento/desativacao (DELETE bloqueia auto-alvo, PUT nao) | `usuarios/[id]/route.ts:79-95` vs `:156-161` | escalada lateral sem controle; inconsistencia entre caminhos |
| S22 | A | (isolamento de loja) | IA de sugestao monta contexto com produtos e respostas rapidas de todas as lojas | `ai/suggest.ts:40-44, 60-63` | catalogo/preco/atalhos de uma loja aparecem na sugestao da outra |
| S23 | M | (isolamento de loja) | `unacknowledgedCount` de alertas sem escopo; sino do cabecalho mostra total da rede | `alerts/route.ts:44`; `Header.tsx:37-41` | vendedor ve volume operacional da outra loja |
| S24 | M | (isolamento de loja) | Loja pedida pela gestao (`cookie`/`?loja=`) nao e validada; usuario pode ser vinculado a loja desativada | `loja.ts:77-83, 98-109`; `usuarios/route.ts:95`; `usuarios/[id]/route.ts:67-70` | registros em loja inexistente/desativada (500 por FK ou dado orfao) |
| S25 | M | (integridade) | Prompt injection com efeito persistente: texto da cliente vai ao prompt e as tags sugeridas sao gravadas no contato sem revisao; tags segmentam campanha | `ai/classify.ts:28`; `ai/classify/route.ts:57-70`; `docs/api.md:491-494` | cliente manipula a propria segmentacao/marcacao |
| S26 | M | (invariantes no banco) | `db-bootstrap` sobe a aplicacao mesmo se o CHECK papel x loja falhar | `db-bootstrap.mjs:60-76` | producao pode rodar sem a regra "so gestao fica sem loja" |
| S27 | M | (vazamento de detalhe) | Mensagem crua de configuracao (tamanho da chave do cofre) e corpo de erro do Bling repassados ao cliente | `integracoes/route.ts:121-125`; `bling/catalogo/route.ts:113-118`; `bling/cliente.ts:199` | detalhe interno exposto (a admin; baixo alcance) |
| S28 | M | (cofre) | GCM sem AAD: `credenciais_cifradas` pode ser movido entre linhas e decifra normalmente; so uma chave (`v1`) sem rotacao efetiva; lista decifra todas as credenciais para mascarar | `cofre.ts:65-72, 80-104, 139-149` | quem escreve no banco troca token de conta sem detecao; rotacao de chave = reconectar tudo |
| S29 | M | Trilha / Administracao | `DELETE /api/lgpd` apaga fisicamente ~20 tabelas fora de transacao, sem trilha, sem confirmacao no servidor; gerente pode | `lgpd/route.ts:117-151`; `rbac.test.ts:110-115` | apagamento parcial irrecuperavel e sem autor |
| S30 | M | (SSRF) | Transcricao faz `fetch` servidor-servidor de URL vinda de payload de webhook (`externalUrl`) sem allowlist | `transcription/whisper.ts:13, 60` | requisicao a rede interna disparada por payload externo (depende do parser de webhook) |
| S31 | B | Caminhos e guardas | GET com efeito colateral (`uazapi/[id]/sessao` grava status); CSRF depende so de `SameSite=Lax`, sem checagem de `Origin`; handlers fazem `req.json()` sem exigir `Content-Type` | `uazapi/[id]/sessao/route.ts:65-72`; `lojas/route.ts:56` (padrao) | superficie de CSRF se algum cookie mudar para `None` |
| S32 | B | (operacao) | Doc de deploy manda expor a porta do Postgres para `db push`; `pg_dump` recebe URL com senha em argv | `deploy-easypanel.md:174-178`; `db-backup.mjs:54-57` | banco exposto temporariamente; senha visivel na lista de processos |
| S33 | B | Borda e versao | Troca de token do TikTok envia `app_secret` na query (exigencia do provedor); corpo de erro do provedor em log | `tiktok/cliente.ts:61-75` | segredo do app em log de saida |
| S34 | B | Borda e versao | Versoes atuais (next 14.2.35, next-auth 4.24.13) estao acima do fix do bypass de middleware de 2025, mas nao ha rotina de conferencia de advisories pelo lockfile | `package-lock.json:10494-10546` | no rebuild, conferir Next 16.3.x e Better Auth 1.7.x no lockfile |

### 13.1 Controles que ja funcionam (manter a intencao)

- Segredo de maquina ausente = recusa 403; comparacao `timingSafeEqual`; HMAC da Meta e do TikTok sobre corpo cru; token de verificacao por canal (`webhook-auth.ts`).
- Cron em header `Authorization: Bearer` (nao query).
- Credenciais de integracao cifradas, nunca devolvidas, mascaradas na tela; desconectar apaga a credencial (`cofre.ts`, `integracoes/[id]/route.ts:104-113`).
- Autoria sempre da sessao (`sessao.ts`), travada por teste.
- Registro de outra loja responde 404 igual a inexistente (`loja.ts:131-136`).
- `callbackUrl` relativo (sem open redirect por `Host`).
- API de usuarios nunca devolve hash; e-mail so para admin (`usuarios.ts:116-131`).
- Trava de ultimo admin como funcao pura testada.
- Bling e TikTok sem metodo de escrita, travado por teste.
- Seed nao roda no entrypoint; imagem roda como nao-root.
- Testes que leem o fonte para guarda, escopo e superficie publica (regua: "as tres varreduras").

---

## 14. Bugs funcionais e inconsistencias

| ID | Achado | Evidencia | Consequencia |
|----|--------|-----------|--------------|
| F01 | UNIQUE total `(provedor, referencia_externa)` + soft delete: reconectar uma conta ja desconectada estoura P2002 | `schema.prisma:99`; `integracoes/[id]/route.ts:104-113`; `integracoes/route.ts:50-58, 83-97` (500 generico); `bling/callback/route.ts:47-50, 64-73` (`referenciaExterna:"rede"` fixa -> "erro-inesperado") | **Bling nunca mais reconecta depois de desconectado**; mesma coisa para numero de WhatsApp. A spec (`docs/integracoes.md:255-258`) previa indice parcial `WHERE is_deleted=false` |
| F02 | PUT de integracao substitui o JSON inteiro de credenciais sem conferir chaves | `integracoes/[id]/route.ts:48, 58-63` | trocar so `access_token` apaga `phone_id`; canal para no proximo envio |
| F03 | TikTok Shop via OAuth nasce `storeId` nulo, aparece como "Toda a rede", roteamento descarta eventos (`storeId` nulo) e nao ha rota/tela para atribuir loja (`atualizacaoSchema` nao tem `storeId`); `montarTokens` nao devolve `shop_id/shop_cipher` | `tiktok/callback/route.ts:39-43, 61-73`; `roteamento.ts:40`; `integracoes.ts:23-28, 58`; `tiktok/cliente.ts:41-58` | integracao TikTok Shop inoperante ponta a ponta |
| F04 | Corrida na renovacao de token (Bling e TikTok) sem lock; o provedor invalida o refresh anterior | `bling/cliente.ts:148-163`; `tiktok/cliente.ts:115-130` | requisicoes simultaneas marcam a integracao como `expirado` e exigem reconectar |
| F05 | Alertas regeneram depois de reconhecidos (`review_risk`, `deal_stale`, `payment_pending`, `follow_up_due`) | `engine.ts:99-106, 146-153, 289-295, 333-340` | reconhecer nao resolve; alerta volta a cada execucao do cron |
| F06 | `hot_lead` e `low_stock` sem gerador; `PURCHASE_INTENT_KEYWORDS` sem uso | `rules.ts:31-45, 69-88` | tela oferece filtros de tipos que nunca aparecem (fora do seed) |
| F07 | Botao "verificar agora" chama o cron sem Bearer | `alerts/page.tsx:102-109` | sempre 401/403, sem mensagem |
| F08 | Doc de deploy agenda cron com GET em rota so-POST | `deploy-easypanel.md:211-212`; `alerts/check/route.ts:9` | cron retorna 405; alertas e transcricao nunca rodam em producao |
| F09 | Telas de SLA e LGPD em `/settings` sao falsas (salvar = toast); SLA real hardcoded; SLA por prioridade e notificacoes inexistentes; indice diz "Somente leitura" | `sla/page.tsx:12-39`; `lgpd/page.tsx:41-43`; `rules.ts:7-12`; `settings/page.tsx:46` | operador acredita ter configurado algo |
| F10 | Desativar loja conta todo pedido historico | `lojas/[id]/route.ts:90-104` | loja com qualquer pedido nunca pode ser desativada; nao verifica integracoes/contatos |
| F11 | PUT de loja aceita slug que vira vazio (POST valida); comentarios dizem que slug entra na URL de webhook, mas o roteamento atual e por conta e `lojaDoWebhook` esta morto | `lojas/[id]/route.ts:43`; `lojas/route.ts:57-63`; `loja.ts:151-159` | slug vazio/duplicado; documentacao enganosa |
| F12 | `stores.slug` UNIQUE total com soft delete | `schema.prisma:21` | nome/slug de loja desativada nao pode ser reutilizado |
| F13 | `ativo` e `is_deleted` duplicados em `stores`; PUT pode religar `ativo` sem desfazer `is_deleted` | `lojas/[id]/route.ts:48, 106-109`; `lojas/route.ts:31-33` | loja "ativa" e invisivel |
| F14 | Nenhum optimistic locking em lojas, usuarios, integracoes, alertas | todos os PUT do escopo | edicao concorrente sobrescreve em silencio |
| F15 | Resumo por IA le a conversa inteira; modelo fixo em tres arquivos | `ai/summarize.ts:10-18`; `suggest.ts:76`; `classify.ts:23`; `summarize.ts:30` | custo e timeout em conversa longa; troca de modelo em varios lugares |
| F16 | Motor de alertas global, N+1, `take` fixo por regra | `engine.ts:31-72` | lojas grandes perdem alertas alem dos primeiros 20-50 por execucao |
| F17 | Acoes criticas sem modal de 3 s: desconectar integracao (`window.confirm`), criar usuario, trocar papel/senha, reconhecer alerta | `integracoes/page.tsx:114-118`; `team/page.tsx:139-177` | viola regra da base |
| F18 | Polling agressivo: cabecalho 15 s, pagina de alertas 30 s | `Header.tsx:48-52`; `alerts/page.tsx:90-93` | carga constante no banco por usuario logado |
| F19 | E-mail: `/api/register` grava com a caixa original, login busca exato, `/api/usuarios` normaliza | `register/route.ts:47-67`; `auth.ts:25-27`; `usuarios/route.ts:101` | admin do bootstrap com maiuscula so entra digitando identico; duplicata por caixa possivel |
| F20 | Colunas de auditoria faltando: `users` (sem `deleted_at/is_deleted/modified_by`), `alerts` (sem `updated_at/deleted_at/is_deleted/modified_by`), `activity_logs`; `modified_by` sem FK | `schema.prisma:110-143, 586-609, 861-883, 33, 93` | viola regra absoluta da base |
| F21 | `broadcasts.store_integracao_id` criado por SQL sem FK | `constraints.sql:50-52` | integridade referencial so no ORM |
| F22 | Codigo morto: `pular`, `segredosIguais`, `lojaDoWebhook`; listas de papeis duplicadas (`PAPEIS`/`ROLES`, `PAPEIS_SEM_LOJA`/`PAPEIS_GESTAO`) | `paginacao.ts:48`; `cofre.ts:152`; `loja.ts:151`; `usuarios.ts:18,22`; `rbac.ts:12`; `loja.ts:34` | divergencia futura |
| F23 | Vendedor de loja desativada: `GET /api/lojas` filtra `ativo` e o seletor some, mas o login continua | `lojas/route.ts:30-35` | usuario opera sem saber a loja |
| F24 | Documentacao desatualizada: `docs/api.md` ainda fala do papel `agent`, `/api/register` com role opcional e `acknowledgedBy` do body; deploy doc cita Next 14, 26 tabelas, trilha inexistente, deposito sem tela | `docs/api.md:57-65, 136, 517`; `deploy-easypanel.md:11, 154, 236-240` | arquitetos devem confiar no codigo, nao nesses docs |

---

## 15. Regras de negocio que continuam valendo (checklist para o rebuild)

### Lojas e escopo
1. Rede com N lojas (hoje Centro e Cerro Azul); cardinalidade livre, sem mudanca de schema para a terceira.
2. Toda entidade operacional pertence a uma loja; indice por loja em toda tabela que tem a coluna.
3. `admin` e `gerente` nao tem loja e alcancam todas; escolhem a loja ativa no cabecalho; sem escolha, veem todas.
4. `vendedor` e `viewer` tem loja obrigatoria e o servidor ignora qualquer loja pedida pelo cliente.
5. Invariante papel x loja garantida no banco.
6. Criar registro como gestao sem loja escolhida = recusa (nao chutar loja).
7. Registro de outra loja responde igual a inexistente (404).
8. Ids referenciados no corpo tambem sao conferidos contra a loja.
9. Loja nunca e apagada; desativar exige nao haver pessoas ativas vinculadas (a regra atual de "nenhum pedido" e defeito, F10).
10. `bling_deposito_id` por loja; sem ele, estoque ao vivo indisponivel (409), nunca saldo de outro deposito.

### Usuarios e papeis
11. Quatro papeis: admin (tudo), gerente (tudo menos configuracao e usuario; exclui; LGPD; le trilha), vendedor (opera a loja; nao exclui; pode cancelar agendamento), viewer (le a loja).
12. Configuracao = integracoes, lojas, SLA/automacao/canal; usuario = criar/editar/desativar/trocar papel. Ambos so admin; leitura de lojas e da lista minima de colegas aberta a todos (seletor de transferencia).
13. Usuario nunca e apagado (e autor de mensagens, pedidos e trilha); desativar.
14. Nunca zero administradores ativos; ninguem desativa o proprio acesso.
15. Lista de colegas para transferencia devolve so id/nome/papel/avatar/loja, filtrada pela loja de quem pergunta, incluindo gestao.
16. Nao ha convite por e-mail hoje (decisao atual; o rebuild endurecido deve trocar "admin define senha" por fluxo de primeiro acesso — ver S05).

### Integracoes
17. Uma linha por CONTA conectada (N numeros de WhatsApp por loja), com rotulo legivel.
18. A mesma conta externa nao pode estar conectada em duas lojas ao mesmo tempo (unicidade entre as vivas).
19. `referencia_externa` e a chave de roteamento do webhook; conta desconhecida = 200 e descarta.
20. Conversa responde pela conta em que entrou; campanha escolhe explicitamente a conta de saida.
21. Contato isolado por loja (mesma pessoa em duas lojas = dois contatos; nao sugerir merge).
22. Bling: conta unica da rede, separacao por deposito, **somente leitura** (Masc e dono da venda; Bling e autoridade de estoque; ADR 0004). `disponivel = saldo do deposito - reservado (pedidos pendentes de lancamento no Masc)`, `null` quando desconhecido.
23. TikTok Shop: por loja, somente leitura, OAuth com state.
24. uazapi convive com WhatsApp oficial no mesmo canal; aviso de banimento obrigatorio na tela; sem template aprovado (`sendTemplate` falha de proposito); sessao com QR sob demanda, so admin.
25. Credenciais cifradas, nunca devolvidas nem logadas, mascaradas (ultimos 4); desconectar apaga a credencial e mantem o registro.
26. `INTEGRATIONS_KEY` diferente em HML e PRD.
27. Chaves exigidas por provedor declaradas num catalogo compartilhado por tela e servidor (hoje `CHAVES_ESPERADAS`, `REFERENCIA_DO_PROVEDOR`).

### Alertas, SLA, IA, auditoria
28. Tipos de alerta e severidades da secao 9.2; SLA por canal (5/15/30/60 min) como padrao; o rebuild precisa decidir se SLA vira configuracao persistida (tela existe, backend nao).
29. Alerta herda a loja da origem; reconhecer grava quem e quando pela sessao.
30. IA esta fora de escopo desde 18/08/2026 (decidir se entra no rebuild; se entrar, contexto escopado por loja e sem escrita automatica em contato).
31. Trilha: quem (sessao), o que (acao de lista fechada + diff campo a campo), quando, IP; acao de rede com loja nula; nunca segredo nos detalhes.
32. LGPD: exportar e apagar sao operacao (gerente pode); apagar e por loja e e o unico delete fisico permitido.

### Operacao
33. Dados atuais sao mock; seed deve provar isolamento (dados repetidos entre lojas, pelo menos dois numeros na mesma loja).
34. Crons autenticados por header; paginacao com teto 100.

---

## 16. Insumos para o desenho (armadilhas especificas deste dominio)

Nao sao decisoes; sao pontos que o desenho precisa responder explicitamente.

1. **Sessao com papel/loja/ativo relidos do banco a cada requisicao** (ou revogacao imediata): S01 e a falha mais cara hoje. No Better Auth, sessao em banco + checagem de `is_active` e papel no funil do servidor; desativar e trocar papel revogam sessoes.
2. **Better Auth apaga sessoes e verificacoes fisicamente**: precisa de ADR explicito e de trilha de login append-only separada (a regua exige login, falha, bloqueio, logout, troca de senha, fator, papel e 403).
3. **Guarda em toda rota e Server Action**, nao so no `proxy.ts`; manter as tres varreduras de teste (guarda por identidade de funcao, soft delete/escopo, recusa unica).
4. **Bootstrap do primeiro admin** sem rota publica (script/CLI com segredo de instalacao ou convite de uso unico), atomico, auditado.
5. **Dono x admin**: decidir se existe papel `owner` (regua exige separacao) e como convive com "nunca zero admins".
6. **Primeiro acesso / reset**: admin inicia, nunca escolhe a senha definitiva; `must_change_password`; motivo registrado.
7. **Unicidade parcial com soft delete** (`WHERE is_deleted = false`) em `lojas_integracoes (provedor, referencia_externa)` e `lojas.slug`, senao F01/F12 voltam.
8. **Segredo de webhook por conta** (uazapi e TikTok com URL/segredo por integracao), so em header; `state` OAuth persistido, de uso unico, com chave propria e amarrado a sessao.
9. **Renovacao de token com lock** (advisory lock no Postgres ou `UPDATE ... WHERE expira_em = <lido>`), aproveitando o optimistic locking da base.
10. **Cofre com AAD = id da integracao** e suporte a mais de uma versao de chave.
11. **Trilha append-only no banco** (sem `DELETE/UPDATE` para o papel da aplicacao) e gravada **antes** do efeito em acao administrativa destrutiva; IP por funcao canonica com numero de saltos de proxy configurado.
12. **Timestamp com precisao 3** (e decisao de `withTimezone`) para o optimistic locking funcionar com `Date` do JS.
13. **Cabecalhos de seguranca e `no-store`** definidos no rebuild (hoje zero).
14. **Motor de alertas**: marcar a origem ou deduplicar por "alerta aberto ou reconhecido enquanto a condicao persiste"; decidir se SLA e prioridades viram configuracao por loja; decidir fila (ADR 0007 usa Postgres; Redis 6382 existe no compose).
15. **Tabelas sem colunas de auditoria hoje** (users, alerts, activity_logs, filhos) precisam nascer com as 5 colunas; decidir tratamento da trilha (append-only com `created_at`, sem soft delete) e registrar em ADR.
16. **Nomenclatura PT-BR sugerida** (mapa do antigo para referencia): `stores` -> `lojas`; `stores_integracoes` -> `lojas_integracoes`; `users` -> `usuarios`; `alerts` -> `alertas`; `activity_logs` -> `auditoria`/`auditoria_eventos`; tabelas de auth (sessoes, contas, verificacoes, fatores) sob `usuarios_*`; estado OAuth -> `lojas_integracoes_autorizacoes`. Nomes finais sao decisao do arquiteto.

### 16.1 Variaveis de ambiente usadas pelo codigo antigo neste escopo

| Variavel | Uso |
|----------|-----|
| `DATABASE_URL` | Prisma/pg |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | sessao; `NEXTAUTH_SECRET` tambem assina o state OAuth (S18); `NEXTAUTH_URL` monta o redirect do callback |
| `INTEGRATIONS_KEY` | cofre |
| `CRON_SECRET` | `/api/alerts/check`, `/api/transcription` |
| `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `BLING_REDIRECT_URI` | OAuth Bling |
| `TIKTOK_SHOP_APP_KEY`, `TIKTOK_SHOP_APP_SECRET`, `TIKTOK_SHOP_REDIRECT_URI` | OAuth/assinatura TikTok Shop |
| `UAZAPI_BASE_URL`, `UAZAPI_WEBHOOK_SECRET` | uazapi |
| `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `INSTAGRAM_VERIFY_TOKEN`, `FACEBOOK_VERIFY_TOKEN`, `TIKTOK_VERIFY_TOKEN` | webhooks |
| `PAYMENT_WEBHOOK_SECRET` | webhook de pagamento |
| `ANTHROPIC_API_KEY` | IA |
| `OPENAI_API_KEY` | transcricao |
