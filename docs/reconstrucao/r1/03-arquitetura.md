# 03 — Arquitetura da aplicação (FINAL) — MerlostoreChat v2

- **Alvo**: reconstrução completa do `MerlostoreChat` (branch `refactor/reconstrucao-estrutura-base`). O código antigo (commit `5e902d4`) é referência de **domínio**, nunca de implementação. Banco novo, sem migração de dados.
- **Status**: este documento **substitui** `spec/rascunho/03-arquitetura.md`. Ele decide **forma do código**: pastas, fronteiras de módulo, camada de dados, fila, tempo real, adaptadores, mídia, infra, migrações, CI e testes.
- **Autoridade**: onde este documento tocar em nome de tabela, coluna, papel, enum, helper, rota, módulo compartilhado, escopo do R1 ou variável de ambiente, ele **cita** `spec/final/01-dados.md` (§13 e §16) e `spec/final/01-dados-dominio.md` — o modelo de dados é o dono desses nomes. A política de autenticação e permissão é do desenho de segurança; a navegação e o layout são do desenho de UI. Este documento diz **onde o código mora e quem chama quem**.
- **Regra de leitura**: **não existe "a definir" aqui.** O agente construtor implementa o que está escrito. Reabrir exige achado novo e ADR. As três pendências que dependem de terceiros estão na §23, com dono, data e plano B — nenhuma bloqueia começar a construir.
- Citações `01/D-04`, `06/INV-13`, `07/REQ-H6`, `08/§3.3`, `09/§2.5` remetem a `spec/levantamento/`.

---

## 1. Stack e premissas que não reabro

Versões **exatas** (conferidas no lockfile pela trava T23; fonte `09/§1`):

| Camada | Pacote e versão |
|---|---|
| Runtime | Node **24 LTS ≥ 24.15** (imagem `node:24-slim`) |
| Framework | `next 16.3.5` (App Router, `proxy.ts`, Turbopack padrão), `react`/`react-dom 19.3.0` |
| Linguagem | `typescript 6.0.3` (strict), `eslint 9.39.5` + `eslint-config-next 16.3.5` (flat config) |
| Banco | PostgreSQL **16** (docker, porta **5437**), `drizzle-orm 0.45.2`, `drizzle-kit 0.31.10`, driver **`pg 8.23.0`** (único) |
| Auth | `better-auth 1.7.5` + `@better-auth/passkey 1.7.5` (mesma versão exata), `@node-rs/argon2 2.2.1` |
| Fila | `bullmq 6.3.6` + `ioredis 5.11.1`, Redis **6382** |
| Mídia | `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner 3.1133.0`, `sharp 0.35.4`, MinIO **9002** (API) / **9003** (console) |
| UI | Tailwind **v4.3.3** + shadcn/ui **sobre Radix** (`style: new-york`, `baseColor: zinc`, `iconLibrary: lucide`) — **não** `base-nova` (decisão da UI, U1) |
| Validação | `zod 4.6.5` (`z.strictObject`, `z.email()`, `z.treeifyError`) |
| Testes | `vitest 5.0.1` + `vite 8.3.0` explícito, `jsdom 29.1.1`, `@testing-library/react 16.3.3` |
| Log | `pino 10.3.1` com `redact` |

Restrições fixas:

- App na porta **3005**. Código, banco, docs e UI em **PT-BR**.
- Regras absolutas da base: Drizzle, Postgres, soft delete, 5 colunas de auditoria, FK `RESTRICT`, nomes hierárquicos, optimistic locking, trilha de auditoria, modal block de 3 s, arquivo < 500 linhas, SOLID.
- **`proxy.ts` não é fronteira de segurança** e **Server Action é POST alcançável direto** (`09/§2.4`, `09/§2.8`, N1/N5). Toda page, handler e action confere sessão por conta própria.
- `cacheComponents` e `partialPrefetching` **desligados** na primeira entrega (recomendação oficial, `09/§8.2` item 13).

---

## 2. Decisões desta camada

| ID | Decisão | Motivo |
|---|---|---|
| **A-01** | Um **módulo por domínio** em `src/lib/<dominio>/`, com a regra de negócio inteira; `src/lib/actions/<dominio>.ts` só orquestra | SOLID/S: a regra muda num lugar só |
| **A-02** | Server Actions **centralizadas** em `src/lib/actions/`, nunca coladas na tela (`_actions.ts` proibido) e **sempre** como `export async function` | colocation espalha o portão; `scripts/project-map.mjs:124-126` e `docs-check.mjs` só enxergam `export async function` em arquivo com `"use server"` — ver §4.3 |
| **A-03** | Route Handler **só** para: `/api/auth/[...all]`, 3 webhooks, 1 callback OAuth, upload de mídia, leitura de mídia, SSE, `/api/saude` e `/api/pronto` | tudo que é tela usa action; menos superfície pública. As ~69 rotas do sistema antigo somem |
| **A-04** | **Sem rota HTTP de cron**: tarefa repetida é *job scheduler* do BullMQ | some `CRON_SECRET` da borda (`07/I12`) |
| **A-05** | Driver único **`pg`** (Pool); `postgres.js` descartado | peer do Better Auth e do backend PG do BullMQ; dois drivers = dois pools e dois dialetos |
| **A-06** | **Só `src/lib/db/`, os módulos de domínio e `src/lib/auth|seguranca|fila|rede|armazenamento` importam `db`** | action e componente não alcançam o banco: o escopo de loja não tem como ser esquecido |
| **A-07** | Mutação de domínio passa **obrigatoriamente** por `src/lib/db/mutacoes.ts` | garante num lugar só: transação, `updated_at`/`modified_by`, trava por `updated_at`, soft delete e trilha |
| **A-08** | `timestamp({ precision: 3, withTimezone: true, mode: "date" })` em **toda** coluna de instante, via `instante()` de `_compartilhado.ts` | µs do Postgres nunca bate com `Date` em ms e o optimistic locking falharia em silêncio |
| **A-09** | **BullMQ 6 + Redis**, worker em **processo separado** (ADR 0014, substitui o ADR 0007 antigo) | 8 tipos de trabalho assíncrono, retentativa, DLQ e agendamento. **Sem tabela `jobs`** |
| **A-10** | Tempo real por **SSE** (`GET /api/eventos`) alimentado por Redis pub/sub, com **um subscriber por processo** e degradação para polling de 15 s | 1 container Next + 1 worker; WebSocket exigiria servidor custom e mataria o `standalone` |
| **A-11** | **Adaptador de canal** com interface (3 implementações no R1); **sem** interface de provedor para pagamento, IA, transcrição e armazenamento | interface com uma implementação é peso morto |
| **A-12** | **Sem fallback de ambiente** no envio: conta sem credencial falha fechado | `01/D-04`, `01/D-12` |
| **A-13** | Migrações **`drizzle-kit generate` + `migrate`** em passo de release, com o papel **`merlo_migracao`**; `push` proibido fora do dev | `06/T-02`; constraints que o ORM não expressa vão dentro da migração |
| **A-14** | Imagem única, **dois alvos** (`app`, `worker`); worker empacotado com esbuild (`dist/worker.mjs`, `CMD ["node", ...]`); **nada de seed, migração ou bootstrap no entrypoint** | `npx` em runtime é falha de deploy; `07/C8` |
| **A-15** | Actions devolvem **`Resultado<T>` tipado**, nunca linha crua do banco | a UI precisa de erro legível por campo, não de exceção |
| **A-16** | **`experimental.serverActions.bodySizeLimit: "1mb"`**; upload de mídia vai por **Route Handler dedicado** com teto por tipo | 110 MB global valeria também para as actions públicas (login, convite, reset) e seria DoS barato contra o Argon2id (`07/B8`, `07/I11`). Trava: `bodySizeLimit` acima de 1 MB reprova |
| **A-17** | Toda busca HTTP a endereço que veio de terceiro passa por **`src/lib/rede/buscarExterno.ts`** (allowlist, DNS sem faixa privada, 1 redirecionamento revalidado, timeout, teto de bytes) | sem isso o job `baixar-de-url` alcança Postgres 5437, Redis 6382, MinIO 9002 e a rede interna do EasyPanel |
| **A-18** | `revalidatePath` na primeira entrega; **nada** de `revalidateTag`/`updateTag` | não há `'use cache'`/`cacheTag` no R1, então não existe tag para invalidar; `updateTag` só pode ser chamado de Server Action, nunca do webhook ou do worker (`09/§2.5`) |
| **A-19** | **`scripts/check-compliance.mjs` do repositório novo nasce com o marcador `compliance:framework`** (fork local no commit 0), com 2 casos novos em `tests/check-compliance.test.mjs`; PR para a estrutura base depois | decisão em ferramenta de terceiro não trava o commit 0 (`01-dados.md §4.3`) |
| **A-20** | **`src/lib/navegacao.ts`** é o catálogo único de itens de menu, com campo `fase: "R1" \| "R2"`; item `R2` não renderiza e não tem rota | mudar o corte do R1 é editar uma linha, não cinco arquivos |

---

## 3. Árvore de pastas

`(…)` = route group. **Nada de pasta "para depois"**: item fora do R1 não tem arquivo.

```
merlostore-chat/
  CLAUDE.md  AGENTS.md  Agente.md  README.md
  docker-compose.yml  Dockerfile  .dockerignore  .gitignore  .env.example
  drizzle.config.ts  next.config.ts  eslint.config.mjs  postcss.config.mjs
  tsconfig.json  components.json  package.json  package-lock.json

  .claude/
    settings.json                hooks Pre/PostToolUse (cópia da base)
    launch.json                  dev na 3005
    hooks/pre-write-guard.mjs    base + `texto-cru` + `.env.local` + `drizzle….delete`
    hooks/post-write-check.mjs   base, sem alteração
    skills/{criar-tabela,criar-crud,criar-componente,repo-docs-sync,remove-ai-marks}/
  .agents/                       espelho versionado
  .github/workflows/deploy.yml   .github/pull_request_template.md

  config/vitest.config.ts        4 projetos (§20)   config/vitest.setup.ts

  scripts/
    check-compliance.mjs         base + marcador `compliance:framework` (A-19)
    project-map.mjs  docs-check.mjs  remove-ai-marks.mjs  limpar-lixo-raiz.mjs
    verificar-schema.mjs         confere o banco depois da migração 0016
    db-backup.mjs                pg_dump com DATABASE_URL_MIGRACAO
    db-teste.mjs                 recria o SCHEMA do banco de teste (3 guardas, §17)
    primeiro-dono.ts             CLI: emite o convite de semeadura (§5, §16)
    medir-kdf.mjs                p95 do Argon2id na VPS → PISO_RECUSA_MS
    fumaca-seguranca.mjs         pós-deploy (07/M4)

  templates/                     arquivos-ouro (schema, action, componente, teste, webhook, job)
  tests/
    check-compliance.test.mjs    trava do auditor (node:assert, fora do Vitest)
    unidade/  integracao/  travas/  componentes/  seguranca/  ajuda/
  docs/
    adr/                         0008..0023 (§17) + índice
    seguranca/{caminhos-de-acesso.md,runbook.md,matriz-req-teste.md}
    regras-negocio.md  rbac.md  back.md  front.md  components.md
    integracoes.md  definition-of-done.md  git-commits.md  deploy.md
    PROJECT_MAP.md               gerado, nunca editado à mão

  src/
    proxy.ts                     só UX: redireciona sem cookie, injeta nonce de CSP. NÃO decide acesso
    app/
      layout.tsx  globals.css  not-found.tsx  error.tsx
      (publico)/
        layout.tsx
        entrar/page.tsx                entrar/verificar/page.tsx
        primeiro-acesso/page.tsx       esqueci-a-senha/page.tsx
        redefinir-senha/page.tsx       ← SEM [token]: o token vem do hash, no corpo do POST
      (app)/
        layout.tsx  loading.tsx  error.tsx  not-found.tsx
        conversas/{page.tsx,[id]/page.tsx,_components/}
        contatos/{page.tsx,[id]/page.tsx,_components/}
        pedidos/{page.tsx,[id]/page.tsx,_components/}
        produtos/{page.tsx,[id]/page.tsx,_components/}
        galeria/{page.tsx,_components/}
        campanhas/{page.tsx,nova/page.tsx,[id]/page.tsx,_components/}
        modelos/page.tsx  respostas-rapidas/page.tsx  agendadas/page.tsx
        alertas/page.tsx  relatorios/page.tsx
        auditoria/{layout.tsx,page.tsx,qualidade/page.tsx,excluidos/page.tsx,seguranca/page.tsx}
        perfil/{page.tsx,seguranca/page.tsx,_components/}
        configuracoes/{page.tsx,lojas/page.tsx,usuarios/page.tsx,
                       integracoes/{page.tsx,[id]/page.tsx},_components/}
      api/
        auth/[...all]/route.ts             único handler do Better Auth
        webhooks/whatsapp/route.ts         GET challenge + POST (HMAC Meta)
        webhooks/instagram/route.ts        idem, token de verificação próprio
        webhooks/uazapi/[integracaoId]/route.ts   segredo por integração, só header
        integracoes/bling/callback/route.ts
        midias/route.ts                    POST: upload (streaming, teto por tipo)
        midias/[id]/route.ts               GET/HEAD: binário (?miniatura=1)
        eventos/route.ts                   SSE
        saude/route.ts                     liveness público, sem tocar dependência
        pronto/route.ts                    readiness: segredo em header + limitador + cache 10 s
    components/
      ui/                          primitivos shadcn (não editar lógica interna)
      layout/{navegacao-lateral.tsx,cabecalho.tsx,seletor-loja.tsx,busca-global.tsx,
              sino-alertas.tsx,menu-usuario.tsx,tab-bar.tsx}
      comum/{modal-confirmacao-block.tsx,confirmar-exclusao.tsx,selo-status.tsx,icone-canal.tsx,
             cabecalho-pagina.tsx,tabela-dados.tsx,barra-ferramentas.tsx,paginacao-cursor.tsx,
             campo.tsx,resumo-de-erros.tsx,botao-enviar.tsx,estado-vazio.tsx,estado-erro.tsx,
             faixa-aviso.tsx,tempo.tsx,dinheiro.tsx,avatar-contato.tsx,copiar.tsx,chip-filtro.tsx,
             esqueletos/}
    lib/
      env.ts                       zod de TODA env; sem `||` literal; throw no boot
      logger.ts                    pino com redact
      erros.ts                     classes de erro + `Resultado<T>` (§14)
      formato.ts                   moeda, data, hora, telefone pt-BR **e** aritmética em centavos
      marca.ts                     NOME_CURTO, NOME_COMPLETO, TITULO_ABA
      navegacao.ts                 catálogo de menu com `fase: "R1" | "R2"` (A-20)
      ui/tons.ts                   rótulo PT-BR + tom por enum (importa os valores de `_enums`)
      db/
        client.ts                  Pool pg singleton (`server-only`)
        schema/                    ver 01-dados.md §2 (lista literal, copiada abaixo)
          _compartilhado.ts  _enums/  _ba-fields.ts
          auth/  auth-eventos.ts  auditoria.ts  lojas.ts  integracoes.ts  alertas.ts
          contatos.ts  conversas/  midias.ts  catalogo/  conteudo/  campanhas.ts
          negocios.ts  pedidos/  devolucoes.ts  lgpd.ts  index.ts
        consultas.ts               vivos, vivosE, travaDeColisao, marcaDeExclusao, condicaoDeLoja
        mutacoes.ts                §6.4 (único arquivo com `.insert(` / `.update(`)
        erros.ts                   `sanitizarErroBanco`
        migrations/                drizzle-kit + SQL manual
        migrate.ts                 runner do passo de release (DATABASE_URL_MIGRACAO)
      auth/                        (desenho de segurança é o dono do conteúdo)
        auth.ts  guard.ts  permissoes/  loja.ts  bloqueio.ts  politica-senha.ts
        senha-gravada.ts  trilha.ts  sessoes.ts  emails.ts
      seguranca/
        ip.ts  origem.ts  limite.ts  corpo.ts  maquina.ts  assinaturas.ts
        alertas.ts  cofre.ts  rotas-publicas.ts
      rede/buscarExterno.ts        A-17: allowlist + anti-SSRF
      lojas/  usuarios/  integracoes/  contatos/  conversas/  midias/
      catalogo/  pedidos/  campanhas/  agendamentos/  conteudo/  alertas/
      auditoria/  lgpd/  relatorios/       ← um módulo por domínio (§4.2)
      canais/
        tipos.ts                   contratos do adaptador (sem I/O)
        registro.ts                `criarAdaptador(conta)` — única fábrica
        whatsapp-oficial.ts  uazapi.ts  instagram.ts
        normalizacao.ts            telefone BR, instantes, tipos de conteúdo
      integracoes/
        catalogo-provedores.ts     puro, sem import (vai para o bundle do cliente)
        roteamento.ts              evento → conta → loja
        oauth.ts                   state assinado, uso único, PKCE quando houver
        bling/{config.ts,cliente.ts,leitura.ts,cache.ts}
        meta/{graph.ts,templates.ts}
      armazenamento/
        s3.ts                      cliente S3 (`forcePathStyle`)
        midia.ts                   chave, subir, ler, assinar, miniatura (sharp)
        limites.ts                 allowlist de MIME, magic bytes e tetos
      fila/
        conexao.ts                 conexões Redis dedicadas (fila, publisher, subscriber, lock, limite)
        filas.ts                   nomes canônicos + defaultJobOptions + `enfileirar()`
        agendamentos.ts            `upsertJobScheduler` (BullMQ 6 — `repeat` não existe mais)
        idempotencia.ts            `assertJobIdPart` + `jobId` determinístico
      actions/
        _base.ts                   `executarAcao()` — portão + Zod + transação + resultado
        conversas.ts  contatos.ts  pedidos.ts  catalogo.ts  campanhas.ts  midias.ts
        conteudo.ts  integracoes.ts  usuarios.ts  convites.ts  lojas.ts  alertas.ts
        seguranca.ts  lgpd.ts  relatorios.ts
      validadores/
        comum.ts                   uuid, paginação, `updated_at`, telefone, dinheiro
        <dominio>.ts               schemas Zod por domínio
      tempo-real/
        publicar.ts                worker/action publica evento no Redis
        canal.ts                   nomes de canal e filtro por loja/usuário
    server/
      worker.ts                    bootstrap + shutdown do worker
      sse.ts                       subscriber único do processo + fan-out (§9)
      processadores/
        mensagens-entrada.ts  mensagens-saida.ts  midia.ts  campanhas.ts
        agendamentos.ts  integracoes.ts  manutencao.ts  emails.ts
    types/                         tipos compartilhados (sem lógica)
```

**Por que `src/proxy.ts` e não na raiz**: com `src/`, o Next procura `src/proxy.ts`. Ele só redireciona quem não tem cookie e injeta o nonce da CSP; **não importa `db` nem `auth`** (trava T21/A5). O matcher exclui `/api/webhooks`, `/api/auth`, `/api/eventos`, `/api/midias`, `/api/saude`, `/api/pronto`, `_next/static`, `_next/image`.

---

## 4. Fronteiras de módulo

### 4.1 Camadas e regra de importação (vira teste de varredura)

```
página / componente  →  action           →  módulo de domínio  →  db | fila | canais | armazenamento | rede
route handler        →  (portão) domínio →  idem
worker/processador   →  módulo de domínio →  idem
```

| Pode importar | `db/*` | `emTransacao` | `fila/*` | `canais/*` | domínio | action |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `app/**` (página, componente) | ❌ | ❌ | ❌ | ❌ | ❌ (só tipo) | ✅ |
| `app/api/**` (handler) | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ |
| `lib/actions/*` | ❌ | ✅ | ✅ | ❌ | ✅ | — |
| `lib/<dominio>/*` | ✅ | ✅ | ✅ | ✅ | ✅ (outro domínio, só pela API pública) | ❌ |
| `server/**` | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ |

- `emTransacao(ctx, fn)` é exportado por `src/lib/db/mutacoes.ts`. É assim que a action abre transação **sem** importar `db` — a regra "`lib/actions/*` não importa `db`" continua absoluta e a trava de camada não reprova o arquivo central do projeto.
- Todo módulo de domínio expõe **API pública** por `index.ts`; o resto é privado (`_consultas.ts`, `_regras.ts`).
- Domínio **não** importa de `app/`, não conhece `FormData`, `Request` nem `revalidatePath`.
- `import "server-only"` no topo de `db/client.ts`, de todo `lib/<dominio>/index.ts`, de `auth/*`, `seguranca/*`, `rede/*` e `armazenamento/*`.
- `catalogo-provedores.ts` é a única exceção isomórfica: constante pura, sem import, porque a tela gera os campos a partir dela (`06/INV-58`).

### 4.2 Domínios (um módulo cada)

| Módulo | Responsabilidade | R1 |
|---|---|:--:|
| `lojas` | loja, slug, sigla, depósito Bling, desativação | ✅ |
| `usuarios` | equipe, convite, papel × loja, último dono/admin | ✅ |
| `integracoes` | conta por canal, cofre, OAuth, roteamento, diário de ingestão, modelos | ✅ |
| `contatos` | carteira por loja, etiquetas, opt-out, normalização de telefone | ✅ |
| `conversas` | conversa, mensagem, envio, reenvio, nota, transferência, não lidas | ✅ |
| `midias` | upload, allowlist, miniatura, vínculo com mensagem, exclusão lógica | ✅ |
| `catalogo` | produto, variação, disponibilidade (saldo Bling − reservado) | ✅ |
| `pedidos` | pedido, itens, numeração, ponte Masc, reserva | ✅ |
| `campanhas` | segmento, destinatários, lote, conta de saída | ✅ |
| `agendamentos` | mensagem agendada e gatilhos | ✅ |
| `conteudo` | respostas rápidas + modelos do WhatsApp | ✅ |
| `alertas` | regras, geração, reconhecimento, resolução pelo gerador | ✅ |
| `auditoria` | trilha de negócio (`auditoria_eventos`) e leituras de qualidade/excluídos | ✅ |
| `lgpd` | exportar dossiê, consentimento, anonimizar | ✅ |
| `relatorios` | indicadores por loja e período | ✅ |

Fora do R1 (tabela criada, **sem módulo, sem action, sem tela, sem rota**): negócios/funil, devoluções, lookbooks, base de conhecimento, CSAT, pagamentos, IA, transcrição, TikTok, Facebook, SLA configurável (`01-dados.md §13.4`). A única regra de negócio dessas áreas que nasce agora é a de `negocios` descrita em `01-dados-dominio.md §6.1` (pedido com `negocio_id` move o negócio para `ganho` na mesma transação) — três linhas dentro do módulo `pedidos`, porque sem elas o dado nasce errado no dia em que a tela ligar.

### 4.3 Anatomia de uma Server Action

**Toda action é `export async function`.** `scripts/project-map.mjs:124-126` só reconhece `export async function` dentro de arquivo que começa com `"use server"`; `export const x = acao({...})` faria o `PROJECT_MAP.md` nascer vazio de actions e o `docs-check` acusar "sem cobertura" em série. Em vez de alterar a ferramenta compartilhada, o wrapper é **chamado dentro do corpo**:

```ts
// src/lib/actions/pedidos.ts
"use server";
import { executarAcao } from "./_base";
import { registrarLancamentoMasc } from "@/lib/pedidos";
import { lancarNoMascSchema } from "@/lib/validadores/pedidos";
import type { Resultado } from "@/lib/erros";

export async function lancarNoMasc(dadosBrutos: unknown): Promise<Resultado<{ numero: string }>> {
  return executarAcao(
    { permissao: "pedidos:lancar_masc", entrada: lancarNoMascSchema, loja: "grava", revalidar: ["/pedidos"] },
    dadosBrutos,
    (dados, ctx, tx) => registrarLancamentoMasc(dados, ctx, tx),
  );
}

// formulário com useActionState: a assinatura é (estadoAnterior, FormData)
export async function salvarPedido(_anterior: Resultado<Pedido>, form: FormData) {
  return executarAcao({ permissao: "pedidos:editar", entrada: salvarPedidoSchema, loja: "grava" }, form, salvar);
}
```

`executarAcao` (em `_base.ts`) faz, **nesta ordem**:

1. `exigirSessao()` — ou `exigirSessaoFresca()` quando `cfg.fresca === true` (troca de senha, fator, sessões, ação administrativa sobre conta alheia). Confere origem e inatividade.
2. `exigirPermissao(sessao, cfg.permissao)` — grava `recusa_403` e lança.
3. `cfg.entrada.safeParse(dadosBrutos)` (`FormData` normalizado antes) → `ErroDeValidacao` com `erros` por campo.
4. `contextoDe(sessao, lojaPedida)` → resolve escopo (`cfg.loja`: `"grava" | "le" | "nenhuma"`).
5. `emTransacao(ctx, (tx) => executar(dados, ctx, tx))`.
6. Traduz exceção em `Resultado` (§14) — nada vaza, exceto `redirect`/`notFound`, que são fluxo do Next.
7. `revalidatePath(...)` para cada caminho de `cfg.revalidar`.

**Limite conhecido, escrito** (I2 parcialmente atendido): o runtime do Next desserializa o corpo da Server Action **antes** de `executarAcao` rodar. Não existe ordem de guarda anterior ao corpo em Server Action — é por isso que `bodySizeLimit` fica em 1 MB (A-16) e que toda action alcançável sem sessão (fluxos de `(publico)/`) tem limitador por IP como primeira instrução. Os Route Handlers de máquina **não** têm esse limite: neles a ordem de `rotaDeMaquina` é integral (§11).

---

## 5. Route Handler × Server Action

**Regra**: se um navegador logado dispara, é **Server Action**. Se quem chama é máquina, o protocolo é imposto por terceiro, ou a resposta não é HTML/RSC (binário, stream), é **Route Handler**.

| Rota | Método | Por que é handler | Portão |
|---|---|---|---|
| `/api/auth/[...all]` | GET/POST | protocolo do Better Auth | próprio (`07/§5`), teto de corpo 16 KB |
| `/api/webhooks/whatsapp` | GET, POST | challenge + HMAC Meta sobre corpo cru | `rotaDeMaquina` |
| `/api/webhooks/instagram` | GET, POST | idem, token de verificação próprio | `rotaDeMaquina` |
| `/api/webhooks/uazapi/[integracaoId]` | POST | segredo por integração, só header | `rotaDeMaquina` |
| `/api/integracoes/bling/callback` | GET | redirect do provedor | `state` assinado, uso único |
| `/api/midias` | POST | upload grande, streaming, progresso | `exigirSessao` + `exigirPermissao("midia:enviar")` + escopo |
| `/api/midias/[id]` | GET, HEAD | binário, `Range`, `Content-Type` controlado | `exigirSessao` + escopo |
| `/api/eventos` | GET | stream SSE | `exigirSessao` + revalidação a cada heartbeat (§9) |
| `/api/saude` | GET | liveness do orquestrador | público; responde 200 **sem tocar em dependência** |
| `/api/pronto` | GET | readiness (db, redis, minio) | segredo em header comparado com `timingSafeEqual` + limitador por IP + cache de 10 s |

Tudo o mais é action. **Não existem** `/api/conversations`, `/api/messages`, `/api/cron/*`, `/api/webhooks/facebook`, `/api/webhooks/pagamento`, `/api/webhooks/tiktok-shop`.

Consequências obrigatórias:

- Toda action valida **tudo** que recebe, inclusive ids de referência contra a loja resolvida (`06/INV-10`).
- Todo handler de escrita usa `lerCorpoComTeto` (webhook 256 KB, auth 16 KB, upload por tipo) — Route Handler não tem `bodySizeLimit`.
- **`/api/saude` × `/api/pronto`**: o liveness público não abre conexão de pool nem responde versão/topologia; o readiness real só responde a quem manda `x-merlo-sonda` correto, e o resultado fica 10 s em cache. Uma rota pública que consulta db+redis+minio a cada chamada é amplificação barata contra o banco.

---

## 6. Camada de acesso a dados

### 6.1 Cliente

```ts
// src/lib/db/client.ts
import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { env } from "@/lib/env";

const global_ = globalThis as unknown as { _pool?: Pool };            // HMR do Next
export const pool = global_._pool ?? new Pool({ connectionString: env.DATABASE_URL, max: env.DB_POOL_MAX });
if (env.NODE_ENV !== "production") global_._pool = pool;
export const db = drizzle(pool, { schema });
```

- `DATABASE_URL` aponta **sempre** para o papel `merlo_app`. `DB_POOL_MAX`: app 10, worker 5.
- **`DATABASE_URL_MIGRACAO`** (papel `merlo_migracao`) é usada **só** por `src/lib/db/migrate.ts`, `scripts/db-backup.mjs` e `scripts/db-teste.mjs`. Nenhum pool da aplicação a abre; `env.ts` a exige em HML/PRD e a trava T17 reprova qualquer leitura dela fora desses três arquivos. As tabelas são criadas por `merlo_migracao`, que é o dono — `merlo_app` **nunca** é dono, senão o `REVOKE UPDATE, DELETE, TRUNCATE` das trilhas (`01-dados.md §7.3`) seria decorativo.
- **Não existe `DATABASE_URL_MANUTENCAO`**: o papel de manutenção foi eliminado junto com o `DELETE` de retenção. A retenção de `lojas_integracoes_eventos` é **anonimização por `UPDATE`** (`01-dados.md §6.4`), que o papel da aplicação pode executar — o job roda no worker, com a conexão normal.
- Durante `next build` (`NEXT_PHASE=phase-production-build`) o módulo **não** conecta.

### 6.2 Schema

A definição literal de `_compartilhado.ts`, a lista de arquivos e as regras de escrita estão em `01-dados.md §2, §3 e §4` e valem como estão. O que a arquitetura acrescenta, e que vira trava:

1. `pgTable("nome_pt", { ... }, (t) => [ ... ])` — 2º argumento **objeto literal**, 3º **array**.
2. Nome de coluna **sempre explícito**; nunca `casing: "snake_case"`.
3. `colunasAuditoria` importado **sem alias** e espalhado como `...colunasAuditoria`.
4. **`updated_at` não tem `$onUpdate`.** Quem escreve `updated_at` é `atualizarComTrava()`/`inserirAuditado()`; `atualizarContador()` e `atualizarEstado()` **não o tocam**. Com `$onUpdate`, cada mensagem que chega envelheceria o `updated_at` da conversa e toda edição humana falharia com "Registro alterado por outro usuário".
5. FK sempre `{ onDelete: "restrict", onUpdate: "restrict" }`; `cascade` proibido.
6. Tabela append-only — **`auth_eventos`, `auditoria_eventos`, `consentimentos`, `usuarios_senhas_historico`, e só elas** — leva o comentário `compliance:append-only` com justificativa nos 600 caracteres anteriores (`check-compliance.mjs:212`). **Não existem** `pedidos_eventos`, `negocios_eventos` nem `integracoes_eventos`: a linha do tempo de pedido e de negócio sai de `auditoria_eventos` por `(entidade, entidade_id, criado_em)`, e o diário de ingestão chama-se **`lojas_integracoes_eventos`** (nome hierárquico) e é **tabela normal, com as 5 colunas**.
7. As **4** tabelas de framework (`usuarios_sessoes`, `usuarios_verificacoes`, `usuarios_totp`, `usuarios_passkeys`) levam `compliance:framework`, marcador que o auditor do repositório reconhece desde o commit 0 (A-19).

### 6.3 Leitura

`src/lib/db/consultas.ts` exporta **exatamente** os nomes que o auditor reconhece (`check-compliance.mjs:250-251`): `vivos`, `vivosE`, `travaDeColisao`, `marcaDeExclusao` — mais `condicaoDeLoja`, que não precisa estar na regex porque nunca aparece sozinho.

```ts
// toda consulta de tabela com loja_id tem esta forma
const linhas = await db.select(projecao).from(conversas)
  .where(vivosE(conversas, condicaoDeLoja(conversas, ctx.escopo), eq(conversas.status, "aberta")));
```

**Não existe `ativosPorLoja()`** — `ativos` seguido de `PorLoja` não casa com a regex do auditor e geraria aviso `query-sem-filtro` em todo arquivo de consulta, que é exatamente o ruído que a lista da base foi criada para evitar. Nome novo de helper exige editar `scripts/check-compliance.mjs` **e** `tests/check-compliance.test.mjs` no mesmo commit.

A trava `tests/travas/escopo-loja.test.ts` fatia por função exportada de domínio e exige **piso mínimo** de funções encontradas — senão uma varredura que não acha nada passa vazia.

### 6.4 Mutação

`src/lib/db/mutacoes.ts` é o **único** arquivo do repositório com `.insert(`, `.update(` e `.set(marcaDeExclusao(...))` sobre tabela de domínio. Exporta:

```ts
emTransacao(ctx, fn)                                            // abre a transação; é o que a action importa
inserirAuditado(tx, tabela, dados, ctx, acao)
atualizarComTrava(tx, tabela, { id, escopo, updatedAtOriginal, dados }, ctx, acao)
excluirLogico(tx, tabela, { id, escopo, updatedAtOriginal }, ctx, acao)
atualizarContador(tx, tabela, { id, escopo }, incrementos)      // só pares de CONTADORES
atualizarEstado(tx, tabela, { id, escopo }, novoEstado)         // só pares de ESTADOS_DE_SISTEMA
// --- as quatro operações atômicas que o modelo de dados exige em SQL, nomeadas aqui e SÓ aqui:
proximoNumeroDePedido(tx, lojaId, anoMes)                       // 01-dados-dominio.md §6.2
upsertContatoPorCanal(tx, lojaId, identificadores, agora)       // 01-dados-dominio.md §2.1 (3 passos)
avancarStatusDeEntrega(tx, mensagemId, novoStatus, ocorridoEm)  // monotônico, comparação no where
reivindicarReenvio(tx, mensagemId)                              // claim atômico de 'falhou' → 'pendente'
reservarDestinatarios(tx, campanhaId, lote)                     // FOR UPDATE SKIP LOCKED + lease
```

- `atualizarComTrava` monta `where(and(travaDeColisao(t, id, updatedAtOriginal), condicaoDeLoja(t, escopo)))`, força `updated_at = new Date()` e `modified_by = ctx.autorId`, e, quando `returning()` vem vazio, **lê a linha atual** (`modified_by`, `updated_at`), resolve o nome do autor e lança `ErroDeColisao({ mensagem, porQuem, quando })`. É esse dado que a faixa de conflito da UI mostra ("Este registro foi alterado por **Bia** às **14:32**"); sem ele a faixa mentiria.
- **Optimistic locking é o padrão**, com a lista fechada de exceções de `01-dados.md §4.7`. `conversas` está na lista de alvos obrigatórios **e** os contadores dela (`nao_lidas`, `ultima_mensagem_em`, `ultima_mensagem_previa`, `ultima_entrada_em`, `primeira_resposta_em`, `sla_estourado_em`) passam por `atualizarContador()`, que não escreve `updated_at` nem grava trilha — os dois relógios são separados e não colidem.
- A trilha de negócio entra na **mesma transação** do efeito. Em ação administrativa destrutiva (promoção a admin, transferência de posse, reset iniciado por admin, recuperação assistida, anonimização LGPD, dispensa do Masc) a trilha é gravada **antes** do efeito, ainda na mesma transação, fail-closed. **`auth_eventos` é o único best-effort** (nunca lança, teto de 3 s) — não pode impedir alguém de entrar —, com as mesmas exceções fail-closed. Isto encerra o conflito que o rascunho declarava aberto: a política é a de `01-dados.md §7.4`.
- Ator de sistema: webhook e worker gravam com `ctx.autorId = ATOR_SISTEMA` (uuid fixo semeado, com linha própria em `usuarios` para satisfazer a FK de `modified_by`) e `origem: "webhook" | "worker"`.
- **Travas**: (a) `.insert(`/`.update(` fora de `mutacoes.ts` reprova; (b) nenhum `db.delete(`, `.deleteMany(`, `tx.delete(` ou `DELETE FROM` em lugar nenhum do repositório (T25) — **a única exclusão física do sistema é de objeto no MinIO**; (c) `atualizarContador`/`atualizarEstado` com par fora das constantes reprovam em execução e no teste de fonte; (d) toda função exportada de domínio que muda estado recebe `ctx` (identidade de tipo, não nome).

### 6.5 Concorrência e idempotência

| Caso | Mecanismo |
|---|---|
| Edição simultânea de registro | optimistic locking por `updated_at` (precisão 3) |
| Número do pedido | `proximoNumeroDePedido` — `INSERT ... ON CONFLICT DO NOTHING` + `UPDATE ... RETURNING` |
| Entrada de webhook | `UNIQUE (provedor, evento_externo_id)` em `lojas_integracoes_eventos` + `jobId` determinístico |
| Mensagem de canal | único parcial `(loja_id, externo_id) WHERE externo_id IS NOT NULL` |
| Envio pela UI | `(conversa_id, chave_idempotencia)` — uuid gerado na bolha otimista |
| Reenvio de mensagem falhada | `reivindicarReenvio` — `UPDATE ... WHERE status_entrega = 'falhou' RETURNING`; zero linhas = 409, nada acontece |
| Destinatário de campanha | `UNIQUE (campanha_id, contato_id)` + reserva `FOR UPDATE SKIP LOCKED` + lease |
| Contato na entrada de mensagem | `upsertContatoPorCanal` — 3 passos na mesma transação (`01-dados-dominio.md §2.1`) |
| Refresh de token OAuth | `pg_advisory_xact_lock` por integração |

---

## 7. Portão de autorização (interface)

O contrato é o de `01-dados.md §13.1` e está reproduzido aqui **sem alteração**. É publicado como arquivo de interface (só tipos e assinaturas) no commit 0, **antes** de qualquer action. A **política** — matriz `recurso:acao`, tempo de sessão, 2FA, bloqueio — é do desenho de segurança.

```ts
// src/lib/auth/guard.ts  e  src/lib/auth/loja.ts
export type Papel = "dono" | "admin" | "gerente" | "vendedor" | "viewer";
export type Sessao = {
  usuarioId: string; sessaoId: string; papel: Papel;
  lojaId: string | null; ativo: true;
  precisaTrocarSenha: boolean; precisaConfigurarFator: boolean;
};
export type EscopoLoja = { tipo: "todas" } | { tipo: "uma"; lojaId: string } | { tipo: "nenhuma" };
export type Contexto = { sessao: Sessao; escopo: EscopoLoja; autorId: string; origem: "ui" | "webhook" | "worker" };

export function pode(papel: Papel, recurso: string, acao: string): boolean;   // PURO: sem I/O, sem trilha
export function exigirSessao(opcoes?): Promise<Sessao>;
export function exigirSessaoFresca(): Promise<Sessao>;
export function exigirPermissao(s: Sessao, chave: `${string}:${string}`, lojaId?: string): void;
export function ehPrivilegioMaximo(papel: Papel): boolean;   // papel === "dono", comparação literal
export function escopoDeLoja(s: Sessao, lojaPedida?: string): EscopoLoja;
export function lojaParaGravar(s: Sessao, lojaPedida?: string): string;
export function contextoDe(s: Sessao, lojaPedida?: string): Contexto;
export function rotaDeMaquina(cfg: ConfigMaquina): (req: Request) => Promise<Response>;
export function rotaPublica(cfg: ConfigPublica): (req: Request) => Promise<Response>;

export type ConfigPublica = {
  motivo: string;            // OBRIGATÓRIO: é o que entra no manifesto `seguranca/rotas-publicas.ts` (trava T2)
  limite: { janela: number; max: number };
  maxBytes: number;
  handler: (req: Request) => Promise<Response>;
};
```

- **`escopoDeLeitura()` e `exigirLoja()` não existem** (eram nomes do rascunho de segurança). `condicaoDeLoja()` fica em `src/lib/db/consultas.ts`.
- **`pode()` é exportado puro** porque a navegação e o índice de Configurações renderizam no servidor já filtrados: usar `exigirPermissao()` para montar menu inundaria `auth_eventos` de `recusa_403` a cada page view. `exigirPermissao()` é `pode()` + trilha + lançamento.
- A matriz vive em **`src/lib/auth/permissoes/`** (pasta por família de recurso, com `index.ts`), não num arquivo único: ~30 recursos × 5 papéis estoura 499 linhas por construção.
- A matriz **não tem** `produtos:criar|editar|excluir`: o catálogo é alimentado pelo job `sincronizar-bling` e a tela `/produtos` é 100% leitura (`01-dados-dominio.md §4`).

Invariantes que a **arquitetura** garante (o resto é política):

1. Toda página de `(app)`, todo handler de escrita e **toda** action começam por um desses portões — `layout.tsx` não substitui a checagem da action.
2. Canal humano e canal de máquina não se misturam: `exigirSessao` nunca aceita `Authorization`; `rotaDeMaquina` nunca aceita cookie.
3. Registro fora do escopo responde **404**, nunca 403: `ErroDeEscopo` é traduzido em `notFound()`.
4. Papel desconhecido = nenhuma permissão (fail-closed).
5. Nenhum handler lê identidade de cabeçalho (`x-user-id`, `x-loja-id`).

---

## 8. Fila de trabalhos (ADR 0014)

**BullMQ 6.3.6 + Redis 6382** (ioredis 5.11.1), worker em **processo separado**. **Sem tabela `jobs`** — a idempotência é `jobId` determinístico do BullMQ mais os índices únicos que já existem no modelo; o estado da DLQ é consultado no próprio BullMQ, não no Postgres. Plano B escrito: se o ambiente de produção não puder ter Redis, trocar a conexão pelo backend PostgreSQL do BullMQ 6 (`createPostgresBackend`, PG ≥ 13) — mesma API, mesmo worker, throughput ~1,5–2× menor.

### 8.1 Filas

| Fila | Jobs | Concorrência | Limiter |
|---|---|---|---|
| `mensagens-entrada` | `processar-evento` | 8 | — |
| `mensagens-saida` | `enviar-mensagem`, `reenviar` | 4 | por **conta** (§8.4) |
| `midia` | `baixar-de-url`, `gerar-miniatura` | 4 | — |
| `campanhas` | `processar-lote` | 1 por campanha | por conta |
| `agendamentos` | `enviar-agendada` | 2 | por conta |
| `integracoes` | `sincronizar-bling`, `sincronizar-templates`, `renovar-token`, `conferir-sessao-uazapi` | 2 | 3 req/s por conta Bling |
| `manutencao` | `gerar-alertas`, `retencao-eventos`, `limpar-midia`, `expirar-convites`, `limpeza-auth`, `reconciliacao`, `resumo-diario` | 1 | — |
| `emails` | `email-seguranca` | 2 | — |

- `processar-evento` lê o evento cru já persistido, resolve contato/conversa/mensagem e, ao terminar com sucesso, chama `registrarProcessamentoEvento()`, que no **mesmo `UPDATE`** grava `processado_em` e substitui `corpo` pela projeção mascarada.
- `retencao-eventos` (diário) anonimiza `corpo`, `cabecalhos` e `ip` de linhas com mais de 30 dias por `UPDATE`. **Nenhuma linha é apagada** e nenhum papel extra de banco é necessário.
- `limpar-midia` remove do MinIO o objeto de linha excluída há mais de **90 dias**, e é o job que a anonimização LGPD enfileira depois do commit (idempotente: objeto ausente = sucesso).
- `sincronizar-templates` mantém o status dos modelos do WhatsApp em dia (§12.2) — sem ele a campanha por número oficial nasce morta.
- `reconciliacao` (noturno) confere espelho `contatos.opt_out` × última linha de `consentimentos` e os contadores de `contatos` × `pedidos`, e **gera alerta** quando diverge; **não corrige em silêncio**.

### 8.2 Garantias

- **FIFO**: uma prioridade só por fila; ordenação de negócio continua no banco.
- **Idempotência**: `jobId` determinístico **sem `:`** (`assertJobIdPart` reprova id vazio, `"TODO"` ou com `:`). Reprocessar não duplica porque a gravação bate nos únicos: `lojas_integracoes_eventos (provedor, evento_externo_id)`, `conversas_mensagens (loja_id, externo_id)`, `conversas_mensagens (conversa_id, chave_idempotencia)`, `campanhas_destinatarios (campanha_id, contato_id)`.
- **Retentativa**: `attempts: 5`, backoff exponencial 2 s → 32 s; erro classificado em `permanente` (credencial inválida, contato sem identificador, payload irrecuperável — não retenta) e `transitório`.
- **DLQ**: esgotadas as tentativas, o job vai para `<fila>:dlq`, `removeOnFail: false`, e sai alerta (job morto = cliente sem resposta).
- **Agendamento**: `upsertJobScheduler` (BullMQ 6 removeu `repeat`), `{ tz: "America/Sao_Paulo" }`.
- **Desligamento**: `SIGTERM` → `worker.close()` espera o job corrente; `Queue.close()`; sem `process.exit` seco.

### 8.3 Worker

`src/server/worker.ts` monta as filas, registra processadores, **não expõe porta HTTP** e loga com o mesmo pino. Roda como segundo processo da mesma imagem. Em dev: `npm run worker` (`tsx watch`).

### 8.4 Ritmo por conta

O limitador do BullMQ é por fila; o ritmo por **conta** (número) é aplicado no processador com o limitador Redis de `seguranca/limite.ts` (`INCR` + `EXPIRE NX`): **1 msg/s por conta uazapi** e **10 msg/s por conta oficial**, configurável por integração. O limitador de **3 req/s por conta Bling** é o mesmo objeto usado pelo caminho síncrono da tela (§12.1) — senão a tela de venda derruba a integração da rede em horário de pico.

---

## 9. Tempo real

`GET /api/eventos` (Route Handler, runtime Node) abre um stream SSE por aba. O worker e as actions publicam em canais Redis (`loja:<id>`, `usuario:<id>`, `usuario:<id>:revogar`); o handler reemite para quem tem escopo.

**Eventos**: `mensagem-nova`, `mensagem-atualizada` (status de entrega), `conversa-atualizada`, `integracao-atualizada` (número caiu/voltou), `alerta-novo`, `campanha-progresso`, `sessao-invalidada`.

Regras de implementação, todas obrigatórias:

- **Um subscriber por processo.** `src/server/sse.ts` mantém **uma** conexão Redis em `psubscribe` de `loja:*` e `usuario:*` e faz o fan-out em memória por um `Map<lojaId, Set<conexao>>`; a limpeza acontece no `abort` do request. Um `createSubscriber()` por aba seriam 200 conexões Redis por instância e o Redis cairia muito antes do teto de conexões SSE.
- **Teto por usuário antes do teto global**: `EVENTOS_MAX_POR_USUARIO` (padrão **3**; **2** para `dono` e `admin`, alinhado ao limite de sessões simultâneas). Ao exceder, a conexão **mais antiga do mesmo usuário** é fechada. Só depois vale `EVENTOS_MAX_CONEXOES` por instância (padrão 200), que responde 503 e faz a UI degradar. Cada corte registra `sse_limite_atingido`.
- **A sessão é reavaliada no laço.** O portão na abertura não basta: um stream vive horas. A cada heartbeat de 25 s (`: ping`), o handler reconsulta a sessão (sem renovar atividade) e compara `sessaoId`, `ativo`, `papel` e `lojaId` com os do handshake. Divergiu, sumiu, expirou ou passou do teto absoluto de 12 h → emite `sessao-invalidada` e fecha. O canal `usuario:<id>:revogar`, publicado por `auth/sessoes.ts`, fecha na hora. Teste: desativar a conta com o stream aberto → o stream fecha em ≤ 30 s.
- `X-Accel-Buffering: no` (proxy não pode bufferizar) e `Cache-Control: no-store`.
- Reconexão com `Last-Event-ID`; a UI **sempre** reconcilia com uma leitura completa ao reconectar.
- Degradação: 2 falhas seguidas de conexão → polling de 15 s da action `resumoDoAtendimento`.
- SSE **não** carrega conteúdo sensível: manda `{ tipo, conversaId, lojaId, versao }`; a tela busca o dado pela action, que reaplica o portão.

---

## 10. Adaptador de canal

### 10.1 Contrato (`src/lib/canais/tipos.ts`)

```ts
export type Canal = "whatsapp" | "instagram";
export type Provedor = "whatsapp_oficial" | "uazapi" | "instagram" | "facebook" | "tiktok_shop" | "bling";
//  ↑ a união repete PROVEDORES (01-dados.md §16.3). `facebook`, `tiktok_shop` e `bling` NÃO têm adaptador
//    de canal no R1: `criarAdaptador()` lança ErroDeConfiguracao("provedor não habilitado").

export type MidiaRecebida = { idExterno?: string; url?: string; mime?: string; nome?: string; legenda?: string };

export type MensagemNormalizada = {
  contaExterna: string; externoId: string; remetenteId: string; remetenteNome?: string;
  tipo: "texto" | "imagem" | "video" | "audio" | "documento" | "sticker" | "localizacao";
  texto?: string;
  midias?: MidiaRecebida[];        // 1:N — vários anexos com o mesmo id externo viram UMA mensagem com N mídias
  respondendoA?: string;           // citação (reply)
  deMim: boolean;                  // eco do próprio número (uazapi)
  ocorridoEm: Date; bruto: unknown;
};
export type AtualizacaoDeStatus = { externoId: string; status: "enviada"|"entregue"|"lida"|"falhou"; motivo?: string; ocorridoEm: Date };
export type EventoDescartado = { motivo: "grupo" | "eco_de_pagina" | "tipo_nao_suportado" | "sem_remetente"; tipoOriginal?: string };

export interface AdaptadorDeCanal {
  readonly provedor: Provedor;
  readonly limites: { imagemMb: number; videoMb: number; audioMb: number; documentoMb: number; textoMax: number };
  readonly exigeJanela24h: boolean;                  // Meta sim, uazapi não
  enviarTexto(destino: string, texto: string): Promise<ResultadoEnvio>;
  enviarMidia?(destino: string, m: MidiaParaEnvio): Promise<ResultadoEnvio>;   // binário, não URL (§13.3)
  enviarModelo?(destino: string, modelo: ModeloParaEnvio): Promise<ResultadoEnvio>;  // ausente no uazapi
  baixarMidia?(ref: string): Promise<{ bytes: Buffer; mime: string }>;
  marcarComoLida?(externoId: string): Promise<void>;
  estadoDaSessao?(): Promise<{ estado: "conectada"|"conectando"|"desconectada"; qr?: string }>;  // uazapi
  verificarAssinatura(corpoCru: string, cabecalhos: Headers): boolean;
  interpretarWebhook(corpoCru: string): {
    mensagens: MensagemNormalizada[]; status: AtualizacaoDeStatus[];
    descartados: EventoDescartado[]; sessao?: EventoDeSessao;
  };
}
export type ResultadoEnvio = { ok: true; externoId: string } | { ok: false; motivo: string; permanente: boolean };
```

Decisões embutidas:

- **Capacidade = presença do método.** `enviarModelo` ausente no uazapi impede mandar o nome do template como texto, sem `if (provedor === ...)` espalhado.
- **`tipo` usa os valores de `TIPOS_CONTEUDO`** (`01-dados.md §16.3`), inclusive **`sticker`** — é o valor que vai ao `CHECK` do banco. O rótulo PT-BR ("Figurinha") vive em `src/lib/ui/tons.ts`, que é o único lugar que traduz enum para tela. `template` e `sistema` existem no CHECK mas **nunca** vêm de adaptador: são produzidos internamente.
- **`midias` é lista.** Vários anexos de uma mensagem compartilham o mesmo id externo no provedor; o parser agrupa e grava **uma** mensagem com N linhas em `conversas_mensagens_midias`. Tratar como singular fazia só o primeiro anexo sobreviver ao dedupe (`01/D-14`).
- **`deMim` é gravado, não descartado.** Mensagem que a vendedora mandou pelo próprio celular entra como `direcao = 'saida'`, `autor_tipo = 'usuario'`, `autor_usuario_id = NULL` (não há como saber quem digitou) e a bolha mostra "enviada pelo aparelho". Descartar deixava o histórico sem a resposta e os colegas sem saber o que foi prometido à cliente (`01/D-08`).
- **Descarte é registrado.** Remetente de grupo (`@g.us`), eco de página do Instagram (`is_echo`) e tipo legível mas não suportado (reação, botão, lista, contato, pedido do catálogo, anúncio) **não** viram contato nem conversa: entram em `lojas_integracoes_eventos` com `tipo = 'descartado'` e o motivo/tipo original no corpo. Payload **ilegível** continua devolvendo listas vazias sem lançar.
- Fábrica única `criarAdaptador(conta)` recebe a **credencial da conta** decifrada; adaptador nunca lê `process.env` e **não existe fallback de ambiente** (A-12).
- Erro de rede vira resultado, não exceção. `interpretarWebhook` recebe o **corpo cru** (a assinatura é sobre ele) e nunca lança.

### 10.2 O que ganha interface e o que não ganha

| Provedor | Interface? | Motivo |
|---|---|---|
| Canal de mensagem (3 implementações no R1) | **Sim** | polimorfismo real, já exercitado |
| Bling (leitura) | **Não** — módulo `integracoes/bling` | uma implementação; a trava T26 é "nenhum método de escrita" |
| Armazenamento S3/MinIO | **Não** — módulo `armazenamento/s3` | MinIO em dev e prod, mesmo SDK |
| Pagamento, IA, transcrição, TikTok Shop | **Não** — fora do R1 | interface especulativa para zero implementações |

---

## 11. Roteamento de webhook por conta

Ordem obrigatória dentro de `rotaDeMaquina` (**nenhum `JSON.parse` antes de autenticar**):

```
limite por IP → content-length → ler corpo cru com teto (256 KB) → resolver credencial/integração →
verificar assinatura/segredo sobre o corpo cru → anti-repetição (id do evento) →
persistir evento cru em lojas_integracoes_eventos → enfileirar → 200
```

| Provedor | Como a conta é achada | Segredo |
|---|---|---|
| `whatsapp_oficial` | `metadata.phone_number_id` → `(provedor, referencia_externa)` | HMAC-SHA256 do corpo cru com `META_APP_SECRET` |
| `instagram` | `entry[].id` → `(provedor, referencia_externa)` | HMAC do mesmo app; token de challenge próprio |
| `uazapi` | `integracaoId` **na URL** | segredo por integração (SHA-256 em `lojas_integracoes.segredo_webhook_hash`), só header |

- Lote com entradas de contas diferentes: o handler **agrupa por conta** e enfileira um job por `(conta, mensagem)` — o antigo roteava o lote inteiro pela primeira entrada.
- Conta desconhecida, com `status = 'erro'` ou sem loja: **200**, evento gravado com `tipo = 'recusado'` ou `'descartado'` e motivo; alerta deduplicado se houver rajada.
- Falha ao **persistir** o evento: **500**, para o provedor reentregar. Falha ao **processar** (já enfileirado): 200, e a fila cuida com retentativa/DLQ.
- `GET` de verificação com token por canal e comparação em tempo constante.
- `META_GRAPH_VERSION` vem de env, **sem default literal no código** — a armadilha registrada é um adaptador com `v18.0` cravado envelhecendo sem ninguém ver.

---

## 12. Integrações externas

### 12.1 Bling (somente leitura, conta única da rede)

- Uma conta `bling` com `loja_id NULL`; o depósito por loja vem de `lojas.bling_deposito_id`.
- **Um só módulo faz a chamada**: `integracoes/bling/cliente.ts`, com o limitador Redis de **3 req/s por conta** e `integracoes/bling/cache.ts` fazendo **cache de 60 s por depósito com single-flight**. O caminho síncrono da tela (disponibilidade na venda, busca com debounce) e o job `sincronizar-bling` usam **o mesmo** cache e o mesmo limitador — sem isso, cada abertura do painel de venda estoura o limite da conta da rede.
- Trava T26: nenhum `PUT`/`PATCH`/`DELETE` no cliente Bling.
- `sincronizar-bling` cria e atualiza `produtos` e `produtos_variacoes` casando por `codigo`/SKU e carimba `sincronizado_em`, com ator `sistema`. **Não existe cadastro manual de produto.**

### 12.2 Modelos do WhatsApp (Meta)

`sincronizar-templates` (fila `integracoes`, a cada 30 min por WABA conectada) lê a Graph API e atualiza `status`, `meta_template_id`, `motivo_rejeicao` e `aprovado_em` em `lojas_integracoes_templates`. O webhook de WhatsApp também trata o campo `message_template_status_update` quando ele chega. Sem um dos dois, o status nunca sai de `enviado`, a campanha oficial nunca acha um modelo aprovado e a tela — que corretamente não oferece "aprovar" manual — vira beco sem saída.

### 12.3 Cofre de credenciais

`src/lib/seguranca/cofre.ts` (**este é o caminho único**): AES-256-GCM, IV de 12 bytes por operação, envelope `v1:<iv>:<tag>:<cifrado>`, AAD = id da integração, chave dedicada `INTEGRATIONS_KEY` — **nunca** derivada do segredo de auth. Chave ausente ou de tamanho errado → `ErroDeConfiguracao` e 503; jamais grava em texto plano.

### 12.4 Busca externa e SSRF (`src/lib/rede/buscarExterno.ts`)

Toda requisição HTTP para endereço que veio de terceiro — hoje `baixar-de-url` e o download de mídia dos provedores — passa por aqui, e só por aqui (trava: `fetch(` com URL não literal fora deste arquivo reprova):

1. **Allowlist de host por provedor** (domínios da Meta, host do `UAZAPI_BASE_URL`, host do Bling). Nada fora dela é buscado.
2. **Somente `https`.** O `CHECK` de `conversas_mensagens_midias.url_externa` aceita `^https?://` por sanidade; a barreira efetiva é aqui.
3. **Resolução de DNS antes de conectar**, recusando loopback, link-local (`169.254.0.0/16`, `fd00::/8`), faixas privadas (`10/8`, `172.16/12`, `192.168/16`) e metadata de nuvem. Sem isso o container alcança Postgres 5437, Redis 6382, MinIO 9002 e a rede interna do EasyPanel.
4. `redirect: "manual"`, **no máximo 1 salto**, e o destino do salto passa por 1–3 de novo.
5. Timeout de 8 s e teto de bytes por tipo; corpo lido em streaming, abortado ao passar do teto.
6. Testes obrigatórios com `http://169.254.169.254`, `http://127.0.0.1:9002` e um redirecionamento de host permitido para host privado.

---

## 13. Mídia

### 13.1 Upload (navegador → app)

`POST /api/midias` (Route Handler): `exigirSessao()` → `exigirPermissao("midia:enviar")` → escopo de loja → corte por `content-length` **antes de ler** (imagem 5 MB, vídeo/áudio 16 MB, documento 100 MB) → leitura em streaming direto para o MinIO → conferência de **magic bytes** contra a allowlist de MIME (sem SVG, HTML ou executável) → `sharp` gera a miniatura → linha em `lojas_midias` com `chave_objeto`, `hash_sha256`, `origem = 'upload'` e `pasta`.

O progresso na UI vem do `upload.onprogress` do `XMLHttpRequest` contra a nossa rota. **Não há presigned PUT para o navegador** e o bucket continua privado: uma rota autenticada a mais é menos superfície do que expor o MinIO à internet com CORS. É também o que mantém `bodySizeLimit` em 1 MB (A-16).

### 13.2 Leitura

**`GET /api/midias/[id]`** (`?miniatura=1`) é a **única** forma de ler binário: `exigirSessao()` + escopo, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment` para não-imagem, suporte a `Range`. Mídia de outra loja responde **404**. Mídia soft-deletada **continua sendo servida** quando referenciada por mensagem (o histórico não pode furar).

Nada de URL é persistido: o banco guarda `chave_objeto`/`chave_miniatura` e a rota é derivada do `id`. `url_externa` é **coluna de trabalho** do job de download, limpa quando `baixada = true`, e **nunca** entra em DTO (trava `tests/travas/dto-midia.test.ts`). `/api/media/[id]/raw` **não existe**. Mídia privada não passa por `next/image` (`unoptimized`).

### 13.3 Envio ao provedor

O **binário** é enviado ao provedor: WhatsApp/Instagram pelo endpoint de mídia da Graph API (que devolve `media_id`), uazapi por multipart/base64. Presigned URL (`S3_ENDPOINT_PUBLICO`, TTL 600 s, nunca persistida) fica como caminho de exceção, para provedor que só aceite URL — **nenhum do R1 aceita só URL**. Isso torna o envio de mídia testável em dev e HML sem expor o MinIO, que era o buraco do ADR 0006 ("ciclo real contra MinIO nunca foi testado").

---

## 14. Erros, resultado e logs

### 14.1 Erros tipados (`src/lib/erros.ts`)

`ErroDeValidacao` (campos), `ErroDeColisao` (com `porQuem` e `quando`), `ErroDePermissao`, `ErroDeEscopo` (→ 404), `ErroFaltaLoja`, `ErroDeIntegracao` (com `permanente: boolean`), `ErroDeConfiguracao` (env/cofre → 503).

### 14.2 Resultado das actions

Tipo único, definido em `src/lib/erros.ts` e importado pela UI (`01-dados.md §13.3`):

```ts
export type Resultado<T> =
  | { ok: true; dados: T }
  | { ok: false; codigo: string; mensagem: string;
      erros?: Record<string, string[]>;      // Zod devolve lista
      valores?: Record<string, string> };    // o formulário nunca é limpo
```

- A action **nunca** deixa exceção vazar (exceto `redirect`/`notFound`).
- `dados` é sempre projeção (DTO), nunca `$inferSelect` cru: nada de `chave_objeto`, `token`, `senha_hash`, `credenciais_cifradas` ou `url_externa` saindo para o cliente.
- **`updated_at` sempre no DTO de item editável** — é o que volta na trava de colisão.
- Mensagem em PT-BR e acionável.

### 14.3 Logs

`pino` com `redact` de `password`, `newPassword`, `currentPassword`, `token`, `code`, `secret`, `authorization`, `cookie`, `credenciais`. `sanitizarErroBanco` remove `detail`/`where`/`parameters` do erro do `pg` (o `detail` de UNIQUE carrega o valor, ex. e-mail). **Nunca** logar corpo cru de webhook, só `{ provedor, contaId, eventoId, tamanho }`. Nenhum segredo em URL, query, nome de arquivo de backup ou `argv`. Campos fixos em todo log: `requisicaoId`, `lojaId`, `usuarioId` (quando houver), `origem`.

---

## 15. Variáveis de ambiente

**`src/lib/env.ts` é a dona da verdade**: valida com Zod e **lança no boot**; `process.env` só aparece nesse arquivo; nenhum `process.env.X || "literal"`. `.env.example` é gerado e conferido a partir dela, e a trava T17 reprova (a) `.env.example` incompleto e (b) **variável citada em qualquer documento e ausente de `env.ts`**.

```dotenv
# ── Ambiente ────────────────────────────────────────────────────────────────
NODE_ENV=
APP_URL=                      # única fonte de baseURL, trustedOrigins, rpID e links de e-mail
PORT=

# ── Banco ───────────────────────────────────────────────────────────────────
DATABASE_URL=                 # papel merlo_app — postgres://...@localhost:5437/merlostore_dev
DATABASE_URL_MIGRACAO=        # papel merlo_migracao — só migrate.ts, db-backup.mjs, db-teste.mjs
DATABASE_URL_TESTE=           # ...:5437/merlostore_test (só tests/integracao)
DB_POOL_MAX=

# ── Redis / fila ────────────────────────────────────────────────────────────
REDIS_URL=                    # redis://localhost:6382
FILA_TENTATIVAS=
WORKER_CONCORRENCIA=

# ── Autenticação (Better Auth) ──────────────────────────────────────────────
BETTER_AUTH_SECRETS=          # versionados: v2:valor,v1:valor
AUTH_EMAIL_HASH_KEY=          # HMAC do e-mail em auth_eventos
AUTH_PASSKEY_HABILITADA=
AUTH_HIBP_HABILITADO=
PISO_RECUSA_MS=               # default 450 (p95 do Argon2id medido na VPS)
PROXIES_CONFIAVEIS=           # faixas do Traefik/EasyPanel, medidas
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=   # obrigatória quando houver 2+ instâncias web

# ── Integrações: cofre e OAuth ──────────────────────────────────────────────
INTEGRATIONS_KEY=             # 32 bytes; diferente em HML e PRD; imutável
INTEGRATIONS_STATE_KEY=       # assina o state do OAuth (nunca reusar o segredo de auth)
BLING_CLIENT_ID=
BLING_CLIENT_SECRET=
BLING_REDIRECT_URI=

# ── Canais ──────────────────────────────────────────────────────────────────
META_APP_SECRET=              # HMAC dos webhooks WhatsApp/Instagram
META_GRAPH_VERSION=           # sem default literal no código
WHATSAPP_VERIFY_TOKEN=
INSTAGRAM_VERIFY_TOKEN=
UAZAPI_BASE_URL=              # o segredo do webhook é POR INTEGRAÇÃO, no banco

# ── Mídia (S3/MinIO) ────────────────────────────────────────────────────────
S3_ENDPOINT=                  # interno: app e worker
S3_ENDPOINT_PUBLICO=          # só para URL assinada de provedor externo (opcional no R1)
S3_BUCKET=  S3_ACCESS_KEY=  S3_SECRET_KEY=  S3_REGION=

# ── E-mail (convite, reset, avisos de segurança) ────────────────────────────
EMAIL_PROVEDOR=  EMAIL_REMETENTE=  EMAIL_API_KEY=

# ── Operação ────────────────────────────────────────────────────────────────
LOG_NIVEL=
EVENTOS_MAX_CONEXOES=         # por instância (200)
EVENTOS_MAX_POR_USUARIO=      # 3 (2 para dono/admin)
SONDA_SEGREDO=                # /api/pronto, comparado com timingSafeEqual
DISCORD_WEBHOOK_ALERTAS=
```

Sumiram de propósito: `NEXTAUTH_*`, `CRON_SECRET`, `UAZAPI_WEBHOOK_SECRET` global, `WHATSAPP_PHONE_ID`/`ACCESS_TOKEN`, `META_PAGE_ACCESS_TOKEN` (credencial de loja **nunca** em env), `FACEBOOK_VERIFY_TOKEN`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PAYMENT_*`, `TIKTOK_*`, `DATABASE_URL_MANUTENCAO`.

---

## 16. Infra local, imagem e `next.config.ts`

### 16.1 `docker-compose.yml`

`db` (`postgres:16`, 5437, healthcheck `pg_isready`), `redis` (`redis:7-alpine`, 6382, `--appendonly yes`), `minio` (**tag fixa**, 9002 API / 9003 console), `minio-init` (cria `merlostore-midia` e força `mc anonymous set none`). O banco de teste vive na **mesma** instância Postgres e é criado por `scripts/db-teste.mjs`.

### 16.2 `next.config.ts`

```ts
output: "standalone",
outputFileTracingRoot: import.meta.dirname,          // há outro lockfile em C:\Users\Paulo
serverExternalPackages: ["@node-rs/argon2", "sharp", "pg"],   // addons nativos fora do bundle do Turbopack
experimental: { serverActions: { bodySizeLimit: "1mb" } },    // A-16 — trava reprova valor maior
poweredByHeader: false,
images: { /* remotePatterns; mídia privada NÃO passa por next/image */ },
async headers() { /* HSTS, nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy, CSP */ },
```

Sem `cacheComponents`, sem `partialPrefetching`, sem `webpack` custom (o build falharia com Turbopack).

### 16.3 `Dockerfile`

```
base    node:24-slim + ca-certificates     # slim, não alpine: sharp e @node-rs/argon2 são nativos
deps    npm ci
builder npm run build (Next standalone, Turbopack) + esbuild → dist/worker.mjs
app     runner: standalone + static + public; usuário não-root; CMD ["node","server.js"]
worker  runner: dist/worker.mjs + node_modules de produção;    CMD ["node","dist/worker.mjs"]
```

- O worker é **empacotado no builder**. `npx tsx` em runtime resolve pacote pela rede e recompila a cada boot: é falha de deploy, não questão de tamanho. E `output: standalone` não copia `src/` nem `tsx`, então os dois alvos precisam mesmo de árvores diferentes.
- **Sem seed, sem migração e sem bootstrap no entrypoint.** Migração é **passo de release** (`npm run db:migrate` com `DATABASE_URL_MIGRACAO`, falha aborta o deploy).
- Primeiro operador: `npm run primeiro-dono` — CLI interativo que roda só se `count(*) FROM usuarios WHERE papel = 'dono' AND is_deleted = false` for **0**, emite um convite `bootstrap = true, papel = 'admin'`, imprime o link uma vez e grava `auth_eventos` (`dono_semeado`, `ator_tipo = 'sistema'`). No consumo, na mesma transação, se o convite é `bootstrap` e não há dono ativo, o usuário nasce **`dono`**. `scripts/primeiro-admin.ts` **não existe**. Fumaça pós-deploy: `SELECT count(*) FROM usuarios WHERE papel='dono' AND ativo` = 1.
- `HEALTHCHECK` apontando para `/api/saude`.
- Alvo de produção: **EasyPanel** (app + worker + Postgres + Redis + MinIO). O desenho não muda se for para as 2 VPS Hostinger — mesma imagem, mesmos dois processos.

---

## 17. Migrações

- `drizzle.config.ts`: `dialect: "postgresql"`, `schema: "./src/lib/db/schema"`, `out: "./src/lib/db/migrations"`, `migrations: { schema: "drizzle" }`.
- Fluxo: alterar schema → `npm run db:generate` → **ler o SQL gerado** (o drizzle-kit gera `DROP` quando renomeia; a pasta `migrations/` é ignorada pelo auditor) → complementar → `npm run db:migrate`.
- `drizzle-kit push` só em banco descartável de dev; **proibido** em HML/PRD (o CI reprova `push` em script de deploy).
- A ordem das 17 migrações (`0000_base` … `0016_integridade`) é a de `01-dados.md §9`, e **todas as 48 tabelas nascem nas migrações iniciais**, inclusive as de funcionalidade fora do R1. O que o Drizzle não expressa entra como SQL **dentro da migração**: papéis `merlo_app`/`merlo_migracao`, função `trilha_imutavel()` + triggers, `REVOKE UPDATE, DELETE, TRUNCATE` nas 4 trilhas, CHECKs, índices únicos parciais, FKs compostas `(id, loja_id)`, FK de `modified_by`.
- **Índice único parcial**: predicado **só** com template `sql` cru e literais (`sql\`is_deleted = false\``), nunca `eq()`/`inArray()` — bug reincidente do drizzle-kit. Trava de CI: `grep -n "= \$" src/lib/db/migrations/` tem de vir vazio.
- **`scripts/db-teste.mjs` não dropa banco.** Ele executa `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` **no banco de teste**, com três guardas que abortam antes de qualquer comando: host precisa ser local, nome do banco precisa conter `test`, `NODE_ENV` não pode ser `production`. Roda com `DATABASE_URL_MIGRACAO`. A exceção à regra "NUNCA dropar banco de dados" está no **ADR 0023**, porque `scripts/` fica fora da varredura do auditor e a regra `drop-destrutivo` dele só vale para `.sql`.
- Backup **antes** de todo deploy em PRD (`npm run db:backup`, papel `merlo_migracao`), com restauração testada em HML. O **bucket do MinIO é copiado junto** do `pg_dump` (`01-dados-dominio.md §3.1`).
- Sem migração de dados do antigo: o banco nasce vazio + seed de desenvolvimento (duas lojas, dois números na mesma loja, mesmo telefone nas duas lojas) que **nunca** roda em PRD e **nunca** cria usuário com credencial.
- **ADRs desta camada** (além dos 0008–0022 do modelo de dados): **0023** — fila BullMQ, ausência de tabela `jobs`, SSE com subscriber único, `bodySizeLimit` de 1 MB com upload por Route Handler, `buscarExterno` anti-SSRF, worker empacotado, `db-teste` recriando schema.

---

## 18. `package.json` (scripts)

```json
{
  "dev": "next dev --port 3005",
  "worker": "tsx watch src/server/worker.ts",
  "build": "next build",
  "start": "next start --port ${PORT:-3005}",
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "test": "vitest run --config config/vitest.config.ts",
  "test:unidade": "vitest run --project unidade --config config/vitest.config.ts",
  "test:travas": "vitest run --project travas --config config/vitest.config.ts",
  "test:componentes": "vitest run --project componentes --config config/vitest.config.ts",
  "test:integracao": "vitest run --project integracao --config config/vitest.config.ts",
  "test:compliance": "node tests/check-compliance.test.mjs",
  "compliance": "node scripts/check-compliance.mjs",
  "map": "node scripts/project-map.mjs --out docs/PROJECT_MAP.md",
  "docs:check": "node scripts/docs-check.mjs",
  "ai-marks": "node scripts/remove-ai-marks.mjs --check --dir docs",
  "lixo": "node scripts/limpar-lixo-raiz.mjs",
  "db:up": "docker compose up -d",
  "db:down": "docker compose down",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "tsx src/lib/db/migrate.ts",
  "db:studio": "drizzle-kit studio",
  "db:teste": "node scripts/db-teste.mjs",
  "db:backup": "node scripts/db-backup.mjs",
  "db:seed": "tsx scripts/seed-dev.ts",
  "db:verificar": "node scripts/verificar-schema.mjs",
  "primeiro-dono": "tsx scripts/primeiro-dono.ts",
  "verificar": "npm run lint && npm run typecheck && npm run compliance && npm run test:compliance && npm run test:travas && npm test && npm run docs:check"
}
```

Sumiram: `next lint` (removido no Next 16), `postinstall: prisma generate`, `db:push`, `db:constraints`, `primeiro-admin`.

---

## 19. CI/CD (`.github/workflows/deploy.yml`)

```
job verificar        (todo push e PR)
  node 24 · npm ci
  1  eslint .
  2  tsc --noEmit
  3  check-compliance.mjs
  4  check-compliance.test.mjs
  5  vitest --project travas            ← antes de subir serviço: é o retorno mais rápido
  6  vitest --project unidade
  7  vitest --project componentes
  8  serviços postgres:16 + redis:7 → db:teste → db:migrate → db:verificar
  9  vitest --project integracao (inclui tests/seguranca)
  10 docs-check --strict + ai-marks --check
  11 next build
  12 npm audit --omit=dev --audit-level=high + gitleaks

job hml   (develop, depende de verificar)
  build e publica imagem · db:migrate · deploy app · deploy worker · fumaca-seguranca.mjs

job prd   (master, depende de verificar)
  db:backup OBRIGATÓRIO (falhou → aborta) · db:migrate · deploy app · deploy worker · fumaça · tag
```

O **worker é publicado junto com o app** — senão o sistema sobe sem quem processe a fila.

---

## 20. Testes

| Projeto Vitest | Ambiente | O que cobre | Banco |
|---|---|---|---|
| `unidade` | node | regras puras: mesclagem de mensagens, numeração, disponibilidade, segmento, política de senha, telefone, parsers de webhook com payload fixo, `pode()` | não |
| `travas` | node | leem o **fonte**: portão por handler/action, escopo de loja, `.insert(`/`.update(` fora de `mutacoes.ts`, nenhum delete físico, `timestamp(precision 3)`, rotas públicas exatas, caminhos do Better Auth, `bodySizeLimit`, `fetch` fora de `buscarExterno`, versões no lockfile, limite de linhas | não |
| `componentes` | jsdom | componentes com os 4 estados, modal block 3 s (timers falsos), teclado e a11y (`vitest-axe`, plano B na §23) | não |
| `integracao` | node + `globalSetup` | actions e handlers ponta a ponta: escopo de loja, trava de colisão, soft delete, idempotência de webhook, reserva de campanha, trilha append-only, recusa única de login, `enums-check`, `ba-fields` | **Postgres real** `merlostore_test` + Redis |

Regras:

- Banco de teste é **Postgres real** na mesma instância (5437), nunca SQLite e nunca o banco de dev. O `globalSetup` confere host local, nome com `test` e `NODE_ENV ≠ production` antes de qualquer comando.
- **Isolamento por transação com rollback**, usando a conexão do papel `merlo_app`. É essa forma que prova o `REVOKE`: um teste que tentasse `UPDATE` numa trilha precisa **falhar**. `TRUNCATE` aparece só no `globalSetup`, com `DATABASE_URL_MIGRACAO`. `db.delete()` em teste é proibido (o hook de pre-write bloqueia).
- As travas exigem **piso mínimo** de itens encontrados (ex.: "≥ 40 actions"), senão uma varredura que não acha nada passa vazia.
- Vitest 5: `clearMocks` é `true` por padrão e `resolves/rejects` sem `await` reprovam; `vite@8` instalado; `esbuild:` do config antigo vira `oxc`.
- Cada invariante `INV-xx` e cada `REQ-xx` do portão de segurança vira teste com o ID no título (`docs/seguranca/matriz-req-teste.md`).
- Travas que este documento cria, além das de segurança (T1–T26) e das do modelo de dados: `bodySizeLimit ≤ 1mb`; `fetch(` com URL não literal fora de `rede/buscarExterno.ts`; `export const` em arquivo `"use server"` (reprova — A-02); `ativosPorLoja` ou qualquer helper de soft delete fora da regex do auditor; `S3_ENDPOINT` lido fora de `armazenamento/s3.ts`; nome de tabela filha que não comece pelo nome do pai.

---

## 21. Tamanho de arquivo e convenções

- **Teto de 499 linhas** por arquivo (o auditor conta 500 + newline como 501). Vale para tudo em `src/`.
- **Nasce dividido** o que estoura por construção: `db/schema/_enums/` (por domínio, com `index.ts` de reexport), `auth/permissoes/` (por família de recurso), `db/schema/conversas/`, `catalogo/`, `pedidos/`, `conteudo/`, `auth/`.
- Quando um arquivo se aproxima do teto: dividir por **caso de uso**, não por tipo. `lib/actions/conversas.ts` → `lib/actions/conversas/{enviar.ts,gerir.ts,index.ts}`.
- Página com mais de ~150 linhas de JSX vira `page.tsx` + `_components/`.
- Arquivo em **kebab-case**; componente em PascalCase com export nomeado; um componente por arquivo.
- Função e variável em PT-BR; contrato de biblioteca (shadcn, Better Auth) fica em inglês. Propriedade TS de coluna = nome da coluna em snake_case.
- `schema/index.ts` nasce completo no commit 0: uma linha de reexport por arquivo, ordem alfabética, comentário `// não reordenar`.
- Nada de barril gigante: `index.ts` de domínio reexporta só a API pública.

---

## 22. Escopo do R1 (lista única, igual em todos os documentos)

**Dentro**: autenticação endurecida + equipe/convite · lojas · integrações (WhatsApp oficial, uazapi, Instagram, Bling leitura) · contatos · conversas/atendimento com tempo real · mídia e galeria · catálogo (leitura, alimentado pelo Bling) + disponibilidade · pedidos + ponte Masc · campanhas · mensagens agendadas · alertas · auditoria (trilha, qualidade, excluídos, segurança) · LGPD (exportar/consentimento/anonimizar) · relatórios básicos.

**Fora** (tabela criada, **sem tela, sem rota, sem item de navegação, sem módulo**): trocas/devoluções · funil (negócios) · lookbooks · base de conhecimento · CSAT · pagamentos · IA · transcrição · TikTok · **Facebook** (sem rota e sem adaptador; o valor fica no enum `PROVEDORES` porque custa zero) · SLA configurável (os prazos por canal são constantes no código: 5/15/30/60 min).

As rotas canônicas são as de `01-dados.md §13.2` e vivem numa tabela única em `docs/seguranca/caminhos-de-acesso.md` (caminho, pública/privada, permissão, fase), que é a fonte da trava T2 e do matcher do `proxy.ts`. `docs-check` reprova rota citada em documento que não existe em `src/app`.

---

## 23. Pendências datadas (nenhuma bloqueia construir)

| # | Pendência | Dono | Prazo | Default / plano B se ninguém responder |
|---|---|---|---|---|
| 1 | Medir o comportamento do XFF no Traefik do EasyPanel (apenda ou sobrescreve?) | Paulo + infra | antes do 1º deploy em HML | `MAX_SALTOS_CONFIAVEIS = 1` e queda para o socket com alerta `ip_cadeia_inesperada` |
| 2 | Medir o p95 do Argon2id na VPS (`npm run medir-kdf`) para calibrar `PISO_RECUSA_MS` | Paulo | antes do 1º deploy em HML | `PISO_RECUSA_MS = 450` |
| 3 | Confirmar que **todas** as vendedoras têm aparelho para passkey ou TOTP | cliente, via Paulo | **antes** do dia da entrega | O 2º fator é obrigatório e não se flexibiliza. TOTP em aparelho compartilhado da loja é inaceitável; o plano B é **chave de segurança física por loja**, comprada antes do deploy. Sem uma das duas, o primeiro acesso de toda a operação trava na entrega |
| 4 | Ambiente de produção (EasyPanel × 2 VPS Hostinger) e presença do Redis | Paulo | antes do deploy em PRD | EasyPanel com Redis; plano B do §8 (backend PG do BullMQ) se não houver Redis |
| 5 | Ritmo final de envio por número (1 msg/s uazapi, 10 msg/s oficial) | Paulo com o cliente | antes da 1ª campanha | valores acima, configuráveis por integração |
| 6 | `vitest-axe` com Vitest 5 / Vite 8 (não verificado por ninguém) | UI | no commit que abre o pacote de UI | rodar `npm i` + um teste-piloto; se não suportar, chamar `axe-core` direto no teste (5 linhas) |

`recharts` e `input-otp` entram pelo `npx shadcn add chart input-otp`, que resolve a versão compatível; ambas ficam travadas no lockfile e conferidas por T23.

---

## 24. Problemas rejeitados (e por quê)

| ID | O que a crítica pediu | Decisão | Motivo |
|---|---|---|---|
| R-01 | Adaptador normalizando `figurinha` em vez de `sticker` (PT-BR) | **Rejeitado** | `TIPOS_CONTEUDO` do modelo final é `texto, imagem, video, audio, documento, sticker, localizacao, template, sistema` e a tarefa manda usar **exatamente** os enums de lá. Renomear no adaptador criaria valor que o `CHECK` recusa. O PT-BR é preservado onde a pessoa lê: `src/lib/ui/tons.ts` traduz `sticker` → "Figurinha" |
| R-02 | Acrescentar `OR TRUNCATE` ao trigger `trilha_imutavel` | **Rejeitado** | `BEFORE TRUNCATE` é trigger de statement e não cabe no mesmo objeto do `BEFORE UPDATE OR DELETE` — seria um segundo trigger. O `REVOKE ... TRUNCATE ... FROM merlo_app` já fecha o caminho para a aplicação, e um trigger de TRUNCATE bloquearia também o dono legítimo (`merlo_migracao`), quebrando o `globalSetup` dos testes de integração. Ganho zero, custo real |
| R-03 | `DATABASE_URL_MANUTENCAO` + papel `merlo_manutencao` para a retenção | **Rejeitado** | O modelo final eliminou o `DELETE` de retenção: `lojas_integracoes_eventos` é anonimizada por `UPDATE` e não está no `REVOKE`. O papel de manutenção deixou de existir; sobrou `DATABASE_URL_MIGRACAO`, que é a variável certa e está na §15 |
| R-04 | Upload direto ao MinIO com URL assinada de PUT | **Rejeitado** | Exigiria expor o MinIO à internet, configurar CORS e manter um segundo endpoint público — tudo para evitar um Route Handler autenticado que já precisa existir para a leitura. O progresso determinado que a UI pede funciona igual com `XMLHttpRequest` contra a nossa rota. A URL assinada fica só para provedor externo (§13.3) |
| R-05 | Alterar `scripts/project-map.mjs` para enxergar `export const x = acao({...})` | **Rejeitado** | Mudar ferramenta compartilhada para acomodar um açúcar sintático é o caminho caro. `export async function` + `executarAcao()` no corpo resolve sem tocar em `project-map`, `docs-check` nem na trava de guarda (§4.3) |
| R-06 | Tela `/configuracoes/seguranca` para a trilha de autenticação | **Rejeitado como rota nova** | A rota canônica é `/auditoria/seguranca` (aba), conforme `01-dados.md §13.2`. A pessoa não distingue "trilha de auth" de "trilha de negócio"; duas telas para a mesma pergunta é o que produziu os três mapas divergentes |
| R-07 | Marcar I2 ("corpo nunca lido antes de autenticar") como ✅ para toda a aplicação | **Rejeitado** | É falso em Server Action: o runtime desserializa o corpo antes de a função rodar. Está escrito como limite conhecido na §4.3, compensado por `bodySizeLimit: 1mb` e limitador por IP nas actions públicas. Marcar ✅ seria cobertura fingida |

---

## 25. Contratos que os outros documentos consomem deste

1. **`executarAcao()`** é a única porta de escrita da UI; o retorno é `Resultado<T>` (§14.2), com `erros` por campo e `valores` preservados.
2. **`emTransacao(ctx, fn)`** é como qualquer camada acima do domínio abre transação sem importar `db`.
3. **SSE** publica `{ tipo, conversaId, lojaId, versao }` nos 7 eventos da §9 e fecha o stream com `sessao-invalidada` quando a sessão deixa de valer.
4. **`/api/midias/[id]`** (`?miniatura=1`) é o único endereço de binário que a UI usa em `<img>`/`<a>`; `/api/midias` (POST) é o único de upload.
5. **`src/lib/navegacao.ts`** com `fase: "R1" | "R2"` é a fonte do menu e do índice de Configurações, renderizado no servidor e filtrado por `pode()`.
6. **`src/lib/formato.ts`** é a única fonte de moeda, data, hora, telefone e aritmética em centavos; o DTO leva dinheiro como **string** `"1234.56"`, igual ao banco.
7. **`src/lib/ui/tons.ts`** é o único lugar que traduz valor de enum em rótulo PT-BR + tom, importando os valores de `db/schema/_enums/`.
