# Passagem da reconstrução para o Codex

> Leia `AGENTS.md` inteiro primeiro. Depois, este arquivo. Ele diz **onde a reconstrução parou**,
> **onde está a especificação** e **o que falta, na ordem**. Escrito em 16/09/2026, na passagem do
> Claude Code para o Codex.

Branch: `refactor/reconstrucao-estrutura-base` (nunca commitar em `master` nem em `develop` direto).
Remoto do Paulo: `paulo` → `https://github.com/PauloMelo-code/Merlossystem.git`.

---

## 1. Onde está a especificação

Tudo em `docs/reconstrucao/`. É a fonte da verdade da reconstrução; o código antigo (commit
`5e902d4`) é só referência de **domínio**.

| Pasta | Conteúdo | Nos documentos aparece como |
|---|---|---|
| `r1/00-visao.md` | escopo, decisões principais, perguntas ao cliente | `final/00-visao.md` |
| `r1/01-dados.md`, `r1/01-dados-dominio.md` | modelo de dados (dono dos nomes de tabela, coluna, papel, enum) | `final/01-dados*.md`, `01-dados.md §x` |
| `r1/02-seguranca.md` | política de auth, sessão, 2FA, permissões, borda, travas | `final/02-seguranca.md` |
| `r1/03-arquitetura.md` | forma do código, camadas, fila, SSE, adaptadores, CI | `final/03-arquitetura.md` |
| `r1/04-ui.md` | design system, telas, componentes | `final/04-ui.md` |
| `r1/05-plano-construcao.md` | plano do R1: **§2 contrato de paralelismo**, §3.4 comandos, §6 formato de pacote | `final/05-plano-construcao.md` |
| `r1/06-analise-skills.md` | análise das skills e ferramentas da base | — |
| `r1/onda2-resultado.md` | relatório dos 8 módulos do R1 (histórico) | — |
| `r2/00-plano-r2.md` | **plano do R2** — vence os finais quando divergir; leia sempre a §2.1 | `r2/00-plano-r2.md` |
| `r2/final-r2{a..e}-*.md` | especificação de cada pacote do R2 | `r2/final-*.md` |
| `levantamento/*.md` | como era o sistema antigo, defeitos e regras (contexto) | `levantamento/NN-*.md` |

Precedência quando dois textos divergem: **ADR no repositório** (registra desvio já decidido) >
`r2/00-plano-r2.md` > `r2/final-*` > `r1/*`. Os caminhos citados nos documentos com o prefixo
`spec/` ou com a pasta temporária do Claude correspondem às pastas acima.

---

## 2. Estado em 16/09/2026

### 2.1 Pronto e verificado — R1 inteiro

Fundação (onda 1) + 8 módulos (onda 2) + consolidação, integrados e verdes no commit `16a8784`:

- lint e typecheck com zero erro; compliance limpo; **1.586 testes** (605 de integração sem pulo,
  669 de componentes, 262 de unidade, 50 travas);
- build de produção verde; worker sobe com os agendamentos e desliga limpo;
- login com senha + TOTP e as **25 telas do R1 respondendo 200** no build de produção;
- 48 tabelas (hoje 50, com o R2), FKs `RESTRICT`, trilhas append-only com `REVOKE`, ator de sistema.

Módulos do R1: conversas/canais (WhatsApp oficial, uazapi, Instagram, SSE), contatos + LGPD,
mídias/galeria (MinIO privado), catálogo (Bling leitura) + pedidos (ponte Masc), lojas/integrações/
webhooks, campanhas/modelos/respostas rápidas/agendadas, equipe/convites, alertas/auditoria/relatórios.
Documentação de cada um em `docs/modulos/*.md`; decisões em `docs/adr/0008..0034`.

### 2.2 Pronto — F-R2, blocos FR-1 e FR-2 (commits 1 a 11 do `r2/00-plano-r2.md §5`)

Commits `7bde20e` .. `939cd0a`:

- SDK da Anthropic fixado; mutações em pasta (`src/lib/db/mutacoes/`, importar sempre de `@/lib/db/mutacoes`);
- listas fechadas, tabelas `lojas_ia_usos` e `lojas_sla`, `src/lib/sla/prazo.ts` completo;
- migrações `0019_r2`, `0020_r2_integridade`, `0021_aviso_seguranca` (próxima livre: **0022**),
  aplicadas no banco de dev (`db:verificar`: 50 tabelas);
- escritas do R2 na porta única, famílias de permissão do R2, `executarAcaoExterna`, borda para os
  provedores do R2, variáveis do R2 desligadas por padrão, filas `pos-venda`/`pagamentos`/`ia`,
  navegação/selos/ícones do R2;
- **modo sem e-mail** (`EMAIL_PROVEDOR=desligado`, ADR 0062): convite por link mostrado uma vez a quem
  convidou, recuperação assistida, avisos de conta no sino de dono/admin;
- `.env.example` completo com as variáveis do R2 (trava T17 verde).

**Numeração de ADR (plano B do C1):** a consolidação usou 0031–0034, então os ADRs do R2 estão
deslocados **+4**: 0031–0057 dos finais = **0035–0061** no repositório; 0062 = e-mail desligado.
Nos comentários de código use sempre o número do repositório.

### 2.3 Parcial, NÃO commitado — FR-3 (commits 12 a 20)

O bloco FR-3 foi interrompido no meio. A árvore tem, sem commit (typecheck verde, **testes não
rodados**):

```
M  tests/seguranca/escopo-loja.test.ts
?? src/app/(app)/configuracoes/integracoes/_components/conectar-canais-extras.tsx
?? src/app/(app)/conversas/_components/ia/
?? src/app/(app)/conversas/_components/seletor-lookbook.tsx
?? src/components/comum/pagamentos/
?? src/lib/actions/{inteligencia,negocios}.ts
?? src/lib/alertas/fontes-r2.ts
?? src/lib/canais-extras/  src/lib/canais/facebook/  src/lib/canais/tiktok/  src/lib/canais/regras-de-envio.ts
?? src/lib/{inteligencia,negocios,pagamentos,pesquisas}/
?? tests/unidade/{inteligencia-puras,pagamentos-situacao,regras-de-envio}.test.ts
```

São os arquivos-costura da `r2/00-plano-r2.md §2.3` (assinatura final; job agendado no-op, job sob
demanda com `throw naoImplementado`) e pedaços da fundação do R2. A mesma árvore foi publicada na
branch **`wip/fr3-parcial`** (backup; não é para merge). Confira cada arquivo contra a §2.3 antes de
commitar: o agente foi interrompido e algum pode estar incompleto.

---

## 3. O que falta, na ordem

Cada passo fecha com `npm run lint && npm run typecheck && npm run compliance && npm run test:travas`
verdes, e com os testes de integração do que foi tocado. Commits na ordem da `r2/00-plano-r2.md §5`.

### 3.1 Terminar o FR-3 (commits 12 a 20)

`r2/00-plano-r2.md §2.2` (commits 12–20) e `§2.3`. Pendências anotadas pelos blocos anteriores:

- **Diário de ingestão** (diverge do C5 do plano): não existe `src/lib/integracoes/diario.ts` nem
  `registrarEventoRecebido`. Use `registrarEventoDeIngestao(e, exec?)` (aceita `eventoExternoId: null`)
  e `registrarProcessamentoEvento(tx, eventoId, { tipo, erro?, projecao? })` de `@/lib/db/mutacoes`;
  `cabecalhosDoDiario` vem de `@/lib/integracoes` (já aceita `tiktok-signature`). Reescreva nesse
  sentido as referências do R2-B e do R2-D.
- `atualizarComTrava(tx, tabela, alvo, ctx, acao, { trilhaAntes?, motivo? })` — motivo vai no objeto
  de opções (6º parâmetro), não solto.
- FR13.1: `src/lib/canais/tipos.ts` ainda sem `tiktok` (o ícone já foi corrigido).
- FR13.7: recusar a troca de e-mail pela própria pessoa quando `emailDesligado()`.
- FR13.8: `listarAlertas` exige `papel` em `FiltrosAlertas` e `contarAlertas(escopo, papel, leitor)`;
  `/alertas` ainda sem o link "Alterar prazos"/`podeAlterarPrazos`; comentários de `alertas/page.tsx` e
  `alertas/gerador.ts` ainda dizem 15 min (agora é 5). Use `alertasVisiveis(escopo, papel)` em toda
  consulta nova de alertas.
- Até a onda 3, os itens de menu Funil, Trocas, Satisfação, Lookbooks e Base de conhecimento já estão
  `entregue` e dão 404 (as telas nascem na onda 3).

### 3.2 FR-4 (commits 21 e 22)

- ADRs **0035–0061** (tabela "número do final → número no repo" no `docs/adr/README.md`, incluindo 0062);
- `docs/regras-negocio.md` com as regras do R2; runbook;
- `docs/seguranca/caminhos-de-acesso.md`: faltam `/funil/[id]`, `/trocas/nova`, `/trocas/[id]`,
  `/base-de-conhecimento/[id]`, `/configuracoes/pagamentos`, `/configuracoes/inteligencia`;
- ADRs 0032 e 0033 ainda citam `mutacoes-sistema.ts` (agora `mutacoes/sistema.ts`);
- `.github/workflows/deploy.yml` ainda usa `EMAIL_PROVEDOR=nenhum`: trocar por `desligado`;
- `npm run map`.

### 3.3 Portão do F-R2

Repositório inteiro: lint, typecheck, compliance, `test:compliance`, `test:travas`;
`node scripts/db-teste.mjs` + `npm run test:integracao` completo; `test:unidade`; `test:componentes`;
`db:migrate` + `db:verificar` no dev (50 tabelas); `npm run build` com `EMAIL_PROVEDOR=desligado`;
worker sobe e desce; app na 3005 com login senha + TOTP e as telas do R1 em 200. Nenhum processo
sobrando, árvore limpa.

### 3.4 Onda 3 — os pacotes do R2

Um pacote por vez (ou em paralelo, se houver mais de um agente — o contrato da `r1/05 §2` e da
`r2/00 §3` vale igual). Cada um lê a sua subseção da `r2/00-plano-r2.md §3`, a §2.1 e o seu final
inteiro (menos a §10, já aplicada).

| Pacote | Final | Banco de teste (`db-teste.mjs --sufixo`) | Redis | Porta |
|---|---|---|---|---|
| R2-A1 funil + trocas | `final-r2a-posvenda.md` (A1, A2) | `r2a` | 13 | 3021 |
| R2-A3 satisfação (CSAT) | `final-r2a-posvenda.md` (A3) | `r2a3` | 18 | 3026 |
| R2-B pagamentos | `final-r2b-pagamentos.md` | `r2b` | 14 | 3022 |
| R2-C inteligência + base de conhecimento | `final-r2c-inteligencia.md` | `r2c` | 15 | 3023 |
| R2-D Messenger + TikTok DM | `final-r2d-canais-extras.md` | `r2d` | 16 | 3024 |
| R2-E lookbooks + SLA | `final-r2e-lookbooks-sla.md` | `r2e` | 17 | 3025 |

Modelos da Anthropic: **só** `claude-sonnet-5` e `claude-haiku-4-5-20251001`; transcrição `whisper-1`.
TikTok Shop está **fora** (ADR 0055/0051 do final → número do repo pela tabela).

### 3.5 Fechamento (R1 + R2 juntos)

`r2/00-plano-r2.md §5` (P-INT-R2) mais o que o R1 deixou:

1. **`tests/seguranca/trilha.test.ts` não existe** e `docs/seguranca/matriz-req-teste.md` aponta para
   ele nos REQ D12–D13, L1–L3, L5–L9. Escrever a trava (login, falha, bloqueio, logout, troca de
   senha e de fator, papel, recusa 403 — todos no funil de sessão, append-only, sem segredo) e
   conferir as linhas ainda marcadas "onda 2" (A4, E7–E8, H1–H4, I1–I15) contra os testes que já
   existem (`webhooks`, `admin-actions`, `oauth-integracoes`).
2. `block-3s.test.tsx`: telas do R2 ligadas e pisos subidos; `tests/travas/piso.json`;
   `caminhos-de-acesso.md` com tudo `entregue` e T2 estrito.
3. `npm run verificar` + integração completa num banco só + fluxos manuais em série na 3005
   (venda → cobrança simulada → pago → troca → estorno registrado; CSAT com `CSAT_ATIVO=true`;
   IA simulada; Messenger/TikTok por webhook simulado).
4. `npm run build` + worker; `npm audit --omit=dev --audit-level=high`; `gitleaks detect`.
5. **Auditoria de segurança** com a skill `audit-auth-security` (cópia em
   `.agents/skills/audit-auth-security/`): siga o `SKILL.md` e as `references/` — é READ-ONLY, só em
   ambiente local, relatório com evidência. Versione o relatório em `docs/seguranca/` sem dado
   sensível. Todo 🔴 vira correção com trava antes do fechamento.
6. `scripts/fumaca-seguranca.mjs` com as rotas públicas novas.
7. `docs:check --strict` verde: excluir `docs/reconstrucao/` do corpus (é especificação histórica),
   marcar `docs/integracoes.md` e os ADRs 0002–0007 como legado; corrigir as refs quebradas restantes.
8. Coletor de CSP (`POST /api/csp`) responde 429 em navegação rápida: rever o limite.
9. **Desativar os usuários de teste** que os portões deixaram no banco de dev:
   `portao2@teste.local` (gerente) e `portao3@teste.local` (admin), pela ação administrativa
   (soft delete/desativação com trilha), nunca por `DELETE`.
10. `npm run map`, `npm run ai-marks`, `npm run lixo`; commits de fechamento da §5.
11. Push da branch e PR para `develop` (nunca `master`). Backup do banco antes de qualquer deploy em PRD.

---

## 4. Ambiente para rodar

- Serviços: `npm run db:up` (Postgres 5437, Redis 6382, MinIO 9002/9003 com bucket privado). As
  imagens da MinIO são as do `quay.io` (as do Docker Hub foram removidas).
- `.env`: copie de `.env.example` e preencha (o Codex **não** lê nem edita `.env`; peça ao Paulo).
- Testes de integração exigem, no ambiente do comando: `NODE_ENV=test`, `DATABASE_URL`,
  `DATABASE_URL_MIGRACAO` (dev: `postgres://dev:dev@localhost:5437/<banco>`), `DATABASE_URL_TESTE`,
  `REDIS_URL` (com o índice do pacote), `APP_URL=http://localhost:3005`, `BETTER_AUTH_SECRETS`
  (`v1:<32+ bytes>`), `AUTH_EMAIL_HASH_KEY`, `INTEGRATIONS_KEY` (32 bytes hex),
  `INTEGRATIONS_STATE_KEY`, `SONDA_SEGREDO`, `S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY/S3_REGION`
  (dev: `dev`/`devdevdev`), `EMAIL_PROVEDOR=desligado`, `AUTH_HIBP_HABILITADO=false`,
  `META_GRAPH_VERSION`, `META_APP_SECRET`, `UAZAPI_BASE_URL`. Gere segredos de teste com
  `openssl rand`; nunca use segredo real em teste.
- Banco de teste: `node scripts/db-teste.mjs --sufixo <x>` recria o schema (nunca dropa banco).
  Nunca rode teste no banco de dev.
- Worker e scripts rodam com `--conditions=react-server` (ADR 0028) — já está nos scripts do
  `package.json`.
- Primeiro dono no dev: `npm run primeiro-dono -- <e-mail>` (imprime o link uma vez).

## 5. Regras de trabalho que os hooks do Claude cobravam

O Codex não roda `.claude/hooks/`. Então, antes de **todo** commit:

- `npm run compliance` e `npm run test:travas` (delete físico, Prisma, SQLite, segredo, arquivo > 499
  linhas, tabela sem auditoria, consulta sem filtro — tudo isso reprova ali);
- nunca `node -e "..."` nem `psql -c "..."` inline (cria lixo na raiz; `npm run lixo` limpa);
- `git add` só por caminho explícito; Conventional Commits em PT-BR, **sem** rodapé de coautoria;
- todo servidor que subir, derrubar antes de terminar (servidor esquecido trava o `.next` e o build).

## 6. Decisões que dependem do Paulo ou do cliente

- **Provedor de e-mail** (hoje `desligado`). Ligar = um `case` em `src/server/processadores/emails.ts`
  + host na allowlist de `src/lib/rede/buscarExterno.ts`.
- **Perguntas ao cliente**: `r1/00-visao.md` (7) e `r2/00-plano-r2.md §7` (25). Nenhuma trava a
  construção; o sistema entra com a resposta padrão de cada linha.
- **Infra antes do 1º deploy**: comportamento do `x-forwarded-for` no Traefik do EasyPanel;
  `npm run medir-kdf` na VPS para fixar `PISO_RECUSA_MS`; EasyPanel com alvo por serviço (`app` e
  `worker` do Dockerfile) e deploy automático **desligado** (`docs/deploy.md`).
- **Itens `CONFERIR`** contra a documentação/instalação real: caminhos e cabeçalho da API uazapi
  (`src/lib/integracoes/uazapi.ts`), endpoints de depósito e saldo do Bling, `mercadopago/config.ts`,
  assinatura do TikTok.
- Limitações conhecidas do R1: Instagram sem anexo de saída (mídia é privada); `usuarios_convites`
  sem coluna de nome; sem ação `agendamento_falhou`.
