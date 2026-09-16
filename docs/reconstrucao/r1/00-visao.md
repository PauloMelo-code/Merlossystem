# 00 — Visão (MerlostoreChat v2)

## O que é o sistema

Plataforma de atendimento multicanal e CRM da **Merlo Store**, uma rede de moda feminina com **duas lojas** (Centro e Cerro Azul). Num lugar só: as conversas de WhatsApp e Instagram de **vários números por loja**, a carteira de contatos por loja, o catálogo espelhado do Bling, os pedidos com a **ponte manual para o Masc** (o ERP onde a venda é lançada), campanhas, mensagens agendadas, alertas, trilha de auditoria e LGPD. Quem usa: vendedora (loja fixa), gerente (as duas lojas, sem configuração), administrador e dono.

## Escopo desta reconstrução

O sistema atual (Next 14 + Prisma 7 + NextAuth v4, 30 models, ~50 route handlers, ~20 telas, dados **mock**) **será apagado e reconstruído do zero** no branch `refactor/reconstrucao-estrutura-base`. O código antigo continua no git (commit `5e902d4`) e serve **só** como referência de domínio e regra de negócio — nunca de implementação. **Não há migração de dados**: banco novo, vazio.

- **Stack alvo**: Next 16.3.5 (App Router, `src/proxy.ts`), React 19.3, TypeScript strict, Drizzle 0.45.2 + drizzle-kit 0.31.10, PostgreSQL 16 (docker, 5437), Redis 6382 (BullMQ 6), MinIO 9002/9003, Tailwind v4 + shadcn/ui sobre Radix, Zod 4, Vitest 5, Better Auth 1.7.5 **endurecido**. App na 3005. Código, banco, docs e UI em **PT-BR**.
- **R1 (entrega 1)**: autenticação endurecida + equipe/convite · lojas · integrações (WhatsApp oficial, uazapi, Instagram, Bling leitura) · contatos · conversas com tempo real · mídia e galeria · catálogo (leitura) + disponibilidade · pedidos + ponte Masc · campanhas · agendadas · alertas · auditoria · LGPD · relatórios básicos.
- **Fora do R1** (tabela criada, sem tela, sem rota, sem módulo): trocas/devoluções, funil, lookbooks, base de conhecimento, CSAT, pagamentos, IA, transcrição, TikTok, Facebook, SLA configurável.

## Decisões principais (e onde elas moram)

| Assunto | Decisão | Documento |
|---|---|---|
| Modelo de dados | **48 tabelas** em PT-BR hierárquico, 5 colunas de auditoria, soft delete, FK `RESTRICT` + **FK composta `(id, loja_id)`**, `timestamptz(3)`, enums por `text` + `CHECK`, dinheiro `numeric(12,2)` como string, trava de colisão por padrão | [01-dados.md](01-dados.md) |
| Domínio | contato isolado por loja, casamento de contato em 3 passos, conversa com `integracao_id NOT NULL` (responde pela conta de entrada), conversa resolvida **reabre**, catálogo alimentado pelo Bling (leitura), numeração de pedido por contador atômico, LGPD por **anonimização** | [01-dados-dominio.md](01-dados-dominio.md) |
| Segurança | Better Auth 1.7.5 endurecido, **5 papéis** (`dono > admin > gerente > vendedor > viewer`), 2º fator obrigatório (passkey/TOTP), bloqueio por conta atômico, recusa única de login, sessão 12 h + inatividade 60 min, escopo de loja fail-closed, CSP em enforce, trilha `auth_eventos` + `auditoria_eventos` append-only, 28 travas de CI | [02-seguranca.md](02-seguranca.md) |
| Arquitetura | módulo por domínio, Server Actions centralizadas, **`mutacoes.ts` como única porta de escrita**, 10 Route Handlers só, BullMQ em processo separado, SSE com subscriber único, adaptador de canal, migrações versionadas, 4 projetos Vitest | [03-arquitetura.md](03-arquitetura.md) |
| UI | shadcn sobre Radix, tokens em `globals.css` (violeta `#7C3AED`), tema `system`, formulário único (Server Action + `useActionState` + Zod), paginação por cursor, **nenhuma tela de fachada**, modal block de 3 s em 20 ações listadas, AA/WCAG 2.2 | [04-ui.md](04-ui.md) |
| Plano de execução | 1 pacote **fundação** sequencial → 8 pacotes de módulo **em paralelo** → 1 pacote de **integração** | [05-plano-construcao.md](05-plano-construcao.md) |
| Ferramentas e skills | auditor com marcador `compliance:framework`, skills da base reescritas, CI rodando compliance | [06-analise-skills.md](06-analise-skills.md) |

Fontes de negócio que continuam valendo: `docs/integracoes.md` e `docs/adr/0004-fontes-da-verdade.md` do repositório.

## Perguntas abertas ao cliente

| # | Pergunta | Quando precisa de resposta | O que vale enquanto isso |
|---|---|---|---|
| 1 | **Todas as vendedoras têm aparelho próprio para passkey ou TOTP?** O 2º fator é obrigatório e não se flexibiliza; TOTP em aparelho compartilhado da loja é inaceitável | **30 dias antes do deploy em PRD** — sem resposta, o primeiro acesso de toda a operação trava no dia da entrega | plano B: **chave de segurança física (FIDO2) por pessoa**, comprada antes do deploy |
| 2 | Grafia da marca: "Merlo Store" ou "Merlos Store"? | antes da entrega visual | `src/lib/marca.ts` com "Merlo Store" (é o que está no `marca.json`); trocar é uma linha |
| 3 | Logo em SVG (positivo, negativo, símbolo) e favicon | antes da entrega visual | wordmark tipográfico + monograma gerado |
| 4 | No Bling, o SKU é **por modelo** ou **por tamanho**? | antes da 1ª venda com reserva | `produtos_variacoes.sku` fica nulo e a reserva degrada para o nível do produto (é o comportamento de hoje); passar a preencher não exige migração |
| 5 | Ritmo de envio por número (proposto: 1 msg/s uazapi, 10 msg/s oficial) | antes da 1ª campanha | os valores acima, configuráveis por integração |
| 6 | `bling_deposito_id` de cada loja e a sigla de 3 letras que entra no número do pedido (`MS2609-CEN-0042`) | antes do 1º pedido real | cadastro pela tela `/configuracoes/lojas`; a sigla não muda depois que a loja tem pedido |
| 7 | Quem recebe os avisos de segurança (conta bloqueada, promoção a admin) e qual o contato de "não fui eu"? | antes do 1º convite real | e-mails vão para `dono`/`admin`; texto genérico |

**Pendências de infra (Paulo, não do cliente)**: comportamento do `x-forwarded-for` no Traefik do EasyPanel (antes do 1º deploy em HML) · p95 do Argon2id na VPS para calibrar `PISO_RECUSA_MS` (antes do 1º deploy em PRD) · provedor de e-mail transacional com SPF/DKIM/DMARC (antes do 1º convite real) · ambiente de produção e presença do Redis. Nenhuma delas bloqueia começar a construir.
