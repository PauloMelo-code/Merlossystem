# Architecture Decision Records (ADR)

Registro das decisoes de arquitetura do projeto. Cada decisao significativa
(escolha de tecnologia, padrao estrutural, trade-off relevante) vira um ADR
numerado e imutavel: se a decisao muda, cria-se um novo ADR que supersede o
anterior.

## Por que

- Novos devs (e a IA) entendem **por que** o codigo e do jeito que e.
- Evita rediscutir decisoes ja fechadas.
- Da contexto historico para mudancas futuras.

## Como criar

1. Copie `0000-template.md` para `NNNN-titulo-curto.md` (proximo numero).
2. Preencha contexto, decisao, consequencias.
3. Status inicial: `Proposto`. Apos aprovado: `Aceito`.
4. Se uma decisao nova substitui esta, marque como `Substituido por ADR-XXXX`.

## Indice

### Reconstrucao (branch `refactor/reconstrucao-estrutura-base`)

| ADR | Titulo | Status |
|-----|--------|--------|
| [0008](0008-better-auth-endurecido.md) | Better Auth 1.7.5 endurecido: tabelas em PT-BR, de-para unico e delete fisico de framework | Aceito |
| [0009](0009-timestamps-e-trava-de-colisao.md) | Timestamps `timestamptz(3)`, trava de colisao por `updated_at` e predicado literal em indice parcial | Aceito |
| [0010](0010-enum-text-com-check.md) | Listas fechadas como `text` + `CHECK`, nao `pgEnum` | Aceito |
| [0011](0011-dinheiro-numeric.md) | Dinheiro em `numeric(12,2)`, string na fronteira e centavos em `formato.ts` | Aceito |
| [0012](0012-trilha-append-only.md) | Trilha unica append-only, papeis de banco e trilhas sem FK | Aceito |
| [0013](0013-lgpd-por-anonimizacao.md) | LGPD por anonimizacao, nao por exclusao fisica | Aceito |
| [0014](0014-fila-bullmq-sem-tabela-jobs.md) | Fila BullMQ sobre Redis, sem tabela generica de jobs | Aceito |
| [0015](0015-catalogo-alimentado-pelo-bling.md) | Catalogo local alimentado pelo Bling, somente leitura | Aceito |
| [0016](0016-conversa-com-integracao-obrigatoria.md) | Sem conta de ambiente: `conversas.integracao_id` NOT NULL | Aceito |
| [0017](0017-diario-de-ingestao.md) | `lojas_integracoes_eventos` como diario de ingestao | Aceito |
| [0018](0018-etiquetas-como-catalogo.md) | Etiquetas como catalogo por loja; fim dos arrays de ids | Aceito |
| [0019](0019-numeracao-de-pedido.md) | Numeracao de pedido por contador atomico, sigla cadastrada e PK composta | Aceito |
| [0020](0020-papeis-escopo-e-semeadura.md) | Cinco papeis, escopo de loja no banco e semeadura do primeiro dono | Aceito |
| [0021](0021-uuid-em-todas-as-tabelas.md) | `uuid` como id em todas as tabelas, inclusive as do Better Auth | Aceito |
| [0022](0022-fk-composta-e-modified-by.md) | FK composta `(id, loja_id)` e FK de `modified_by` por SQL na migracao | Aceito |
| [0023](0023-fila-sse-borda-e-banco-de-teste.md) | SSE com assinante unico, teto de corpo, anti-SSRF, worker empacotado e `db-teste` recriando schema | Aceito |
| [0024](0024-excecao-de-tamanho-em-components-ui.md) | Excecao de caminho no auditor: `src/components/ui/` fora da regra de 499 linhas | Aceito |
| [0025](0025-colunas-do-plugin-em-usuarios-totp.md) | Tres colunas do plugin `twoFactor` em `usuarios_totp` (migracao 0017) | Aceito |
| [0026](0026-campos-ba-com-fields-dos-plugins.md) | `CAMPOS_BA` com `fields` tambem nos modelos dos plugins | Aceito |
| [0027](0027-carimbo-de-reautenticacao.md) | Reautenticacao carimba a sessao corrente em vez de criar outra | Aceito |
| [0028](0028-server-only-e-condicao-react-server.md) | `server-only` fica; fora do Next, o processo liga `--conditions=react-server` | Aceito |
| [0029](0029-politica-de-fatores.md) | Dono e admin cadastram passkey E aplicativo; conta so-passkey entra pela passkey | Aceito |
| [0030](0030-familia-de-permissao-conta.md) | Familia `conta:*` na matriz de permissao | Aceito |
| [0031](0031-ator-de-sistema.md) | Ator de sistema com linha propria e contexto de gravacao sem sessao | Aceito |
| [0032](0032-helpers-de-sistema-e-migracao-0018.md) | Helpers de sistema em `mutacoes-sistema.ts` e listas fechadas da 0018 | Aceito |
| [0033](0033-alcance-da-anonimizacao.md) | Alcance completo da anonimizacao LGPD | Aceito |
| [0034](0034-ritmo-constante-por-provedor.md) | Ritmo de envio constante por provedor | Aceito |
| [0062](0062-email-desligado.md) | E-mail desligado como modo de operacao (0035 a 0061 sao do R2, registrados no FR14) | Aceito |

### Historico (sistema anterior)

Ficam no repositorio porque explicam **por que** o codigo antigo era como era.
Nenhum deles vale para o codigo atual.

| ADR | Titulo | Status |
|-----|--------|--------|
| [0001](0001-stack-base.md) | Stack base: Next.js + Drizzle + PostgreSQL | Substituido por ADR-0008..0024 |
| [0002](0002-orm-transicao-prisma-drizzle.md) | Transicao de Prisma para Drizzle | Substituido por ADR-0008..0024 |
| [0003](0003-multi-loja-em-prisma.md) | Multi-loja implementada em Prisma | Substituido por ADR-0020 |
| [0004](0004-fontes-da-verdade.md) | Fontes da verdade por dominio | Substituido por ADR-0015 |
| [0005](0005-soft-delete.md) | Soft delete | Substituido por ADR-0013 |
| [0006](0006-midia-no-minio.md) | Midia no MinIO | Substituido por ADR-0023 |
| [0007](0007-fila-no-postgres.md) | Fila de disparo no PostgreSQL, nao em BullMQ | Substituido por ADR-0014 |

## Onde cada decisao e cobrada

O ADR explica; quem cobra e o CI. O mapa de requisito de seguranca para teste
esta em `docs/seguranca/matriz-req-teste.md`; as travas por projeto do Vitest
estao em `docs/definition-of-done.md`.
