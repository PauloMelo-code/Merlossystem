# ADR 0005 — Soft delete no cliente, nao em cada consulta

- **Status**: Substituído por ADR-0008..0024 (reconstrução na branch `refactor/reconstrucao-estrutura-base`)
- **Data**: 17/08/2026
- **Contexto**: o [ADR 0002](0002-orm-transicao-prisma-drizzle.md) registrou 25 deletes fisicos em 10 rotas como divida a pagar

## Contexto

A base determina soft delete em toda tabela. O MerlostoreChat nasceu antes
disso: `DELETE /api/contacts/[id]` apagava o contato, e junto o nome de quem
comprou nos pedidos antigos; `DELETE /api/deals/[id]` levava os eventos do
funil; `DELETE /api/media/[id]` destruia o arquivo no Cloudinary sem volta.

Nenhum dos 8 models envolvidos tinha `is_deleted`.

## Decisao

### 1. O filtro mora no cliente do Prisma, nao nas consultas

`src/lib/db/soft-delete.ts` estende o cliente e injeta `isDeleted: false` em
`findMany`, `findFirst`, `findFirstOrThrow`, `count` e `aggregate` dos models
marcados.

A alternativa era escrever o filtro nas ~50 consultas destes models. **Esquecer
uma faz registro excluido reaparecer** — e e um erro que nao aparece em revisao,
so quando o cliente pergunta por que o contato que ele apagou voltou. Num lugar
so, rota nova ja nasce filtrada sem ninguem precisar lembrar.

Regra do guard: **se quem chamou nao mencionou `isDeleted`, entra
`isDeleted: false`**. Se mencionou, respeita. Isso da de graca a saida para a
tela de auditoria ("o que foi excluido, por quem") sem precisar de um segundo
cliente sem guard — que alguem acabaria usando para outra coisa.

### 2. `findUnique` fica de fora, e por isso e proibido nestes models

O `where` do `findUnique` so aceita campo unico; injetar `isDeleted` ali e erro
de runtime do Prisma. Entao o guard nao cobre — e um teste proibe `findUnique`
nos 8 models, para o buraco nao existir no codigo.

Foi assim que apareceu um caso real: `POST /api/messages` buscava a midia por
`findUnique`, e arquivo ja excluido continuaria enviavel para a cliente.

### 3. Models migrados

`Contact`, `Deal`, `MediaFile`, `Lookbook`, `KnowledgeArticle`, `QuickReply`,
`WhatsappTemplate`, `Broadcast` — os 8 que tinham caminho de exclusao. Cada um
ganhou `deleted_at`, `is_deleted`, `modified_by` e, onde faltava, `updated_at`.

Os outros 16 models **nao** foram migrados: nenhum tem rota de exclusao, e
adicionar `is_deleted` sem filtrar as leituras seria pior do que nao ter — cria
a impressao de protecao sem a protecao. Quando algum ganhar exclusao, entra na
lista do guard junto.

### 4. Excluir grava quem e quando

`{ isDeleted: true, deletedAt: new Date(), modifiedBy: usuario.id }`. Sem os
tres, a tabela sabe que algo sumiu mas nao quem tirou — que e metade do motivo
de existir soft delete.

### 5. Filhos nao sao apagados nem marcados

`deal_events` e `broadcast_recipients` nao tem `store_id` nem `is_deleted`: sao
alcancados pelo pai. Marcar o pai basta, e eles sao justamente o rastro (como o
funil andou, para quem a campanha JA foi enviada). Apagar reescreveria o que
aconteceu.

### 6. Midia: a linha e marcada, o binario fica

Apagar no Cloudinary e marcar a linha como excluida seria um soft delete
mentiroso — restaurar devolveria registro apontando para URL morta, e as
mensagens ja enviadas que referenciam a midia ficariam com imagem quebrada no
historico.

**Custo aceito**: arquivo excluido continua ocupando espaco. A limpeza
definitiva e rotina separada, que le `is_deleted = true` com idade suficiente —
nao o clique da vendedora.

## A excecao: LGPD

`DELETE /api/lgpd` **apaga de verdade**, e continua assim. A LGPD (art. 18, VI)
da ao titular direito a **eliminacao**; soft delete nao cumpre, porque o dado
continuaria no banco. E o unico delete fisico do sistema, marcado linha a linha
com `compliance:delete-fisico-lgpd`, e um teste garante que e o unico.

Ou seja, sao duas exclusoes com significados diferentes, e a interface precisa
refletir isso: `DELETE /api/contacts/[id]` tira o contato da operacao;
`DELETE /api/lgpd` cumpre um pedido legal do titular e nao tem volta.

## Consequencias

- Consulta que precisa ver excluido passa `isDeleted` explicito. Sem isso, nao ve.
- `prisma/seed.ts` continua apagando de verdade — e script de recriar base, nao
  operacao de usuario.
- **Sob Drizzle isto muda**: nao ha equivalente de extensao de cliente. O guard
  viraria helper de query ou view no banco. Ver [ADR 0002](0002-orm-transicao-prisma-drizzle.md).
