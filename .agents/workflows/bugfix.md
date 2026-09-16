# Workflow — corrigir bug no MerlostoreChat

## 1. Ler antes de tocar

- `AGENTS.md` na raiz — regras absolutas
- `docs/PROJECT_MAP.md` — onde a coisa mora
- `docs/modulos/<dominio>.md` do domínio do defeito
- `docs/adr/` — a decisão que talvez explique o comportamento que parece errado
- O arquivo real que você vai alterar

## 2. Localizar a camada

| Sintoma | Comece por |
| :--- | :--- |
| Dado de uma loja apareceu na outra | `src/lib/auth/loja.ts` e o `condicaoDeLoja()` da consulta — **trate como incidente**, é o pior defeito possível aqui |
| Edição sobrescreveu outra | trava de colisão: o `updated_at` original chegou à action? |
| Registro sumiu | soft delete: a consulta filtrou `is_deleted` com `vivos()`? |
| Usuário acessa o que não devia | matriz de `src/lib/auth/permissoes/` — `pode()` é fail-closed, então falta entrada |
| Login recusado com mensagem diferente | `src/lib/auth/` — a recusa é única, byte a byte, com piso de tempo |
| Autoria errada no registro | `ctx` do `executarAcao`; `modified_by` nunca vem do corpo |
| Ação não ficou na trilha | a gravação é dentro da transação, em `mutacoes.ts` |
| Mensagem não saiu / saiu pela conta errada | `integracao_id` da conversa decide a conta; não existe fallback de ambiente |
| Mídia não abre | `/api/midias/[id]` — é o único endereço; `url_externa` nunca vai a DTO |
| Job não rodou | BullMQ: nome da fila em `src/lib/fila/filas.ts`, worker em `src/server/worker.ts` |

## 3. Diagnosticar sem escrever

Reproduza e leia o estado antes de editar. Confira a trilha: quem fez, o quê, quando.
Script de diagnóstico tem de percorrer **o mesmo caminho do código de produção** — script
que testa por fora mente. Nada de `node -e "..."` inline: escreva um `.mjs`.

## 4. Corrigir a causa, não o sintoma

Antes de editar, procure **todos** os chamadores da função que você vai tocar. A guarda
certa fica na função compartilhada, não em cada chamador — senão o defeito continua vivo
nos irmãos. Se a correção exigir coluna, permissão ou rota nova, **pare e reporte**: o
modelo é fechado.

## 5. Provar

Escreva a trava que **falharia** com o bug vivo, e só então corrija.

```bash
npm run lint && npm run typecheck && npm run compliance
npm run test:travas && npm run test:unidade
node scripts/db-teste.mjs --sufixo <pacote> && npm run test:integracao
```

## 6. Reportar

Sintoma × causa raiz · arquivos lidos e alterados · invariantes tocados · a **saída real**
dos comandos acima · risco residual.
