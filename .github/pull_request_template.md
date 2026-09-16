# Descrição

<!-- O que esta PR faz e por quê. Link para a etapa do plano, issue ou ADR. -->

## Tipo

- [ ] feat (nova funcionalidade)
- [ ] fix (correção de bug)
- [ ] refactor
- [ ] test
- [ ] docs
- [ ] build / ci / chore

## Checklist (Definition of Done)

> Detalhes em `docs/definition-of-done.md`. Item que não se aplica: marque e escreva o porquê.

### Banco e dados
- [ ] Tabela nova (se houver) com as 5 colunas de auditoria e `timestamptz(3)`.
- [ ] FK com `onDelete: "restrict"` e `onUpdate: "restrict"`, explícitos.
- [ ] Exclusão é lógica; leitura filtra `is_deleted` e escopo de loja.
- [ ] Escrita passa por `src/lib/db/mutacoes.ts`; edição tem trava por `updated_at`.
- [ ] Migração revisada à mão (CHECK, índice parcial com SQL cru, FK composta).

### Segurança e auditoria
- [ ] Toda action passa por `executarAcao`; todo handler tem portão próprio.
- [ ] Permissão na matriz de `src/lib/auth/permissoes/`, não `if` solto.
- [ ] Entrada validada com Zod; nada de `{ ...input }` sobre a linha.
- [ ] Mutação gera trilha, na mesma transação — e **antes** do efeito quando o efeito
      destrói o estado anterior.
- [ ] Ação crítica com modal block de 3 s (ou desfazer, se reversível e interna).
- [ ] Nenhum segredo, `.env` ou senha literal no diff.
- [ ] Mudou auth, borda, webhook ou papel? `/audit-auth-security` rodada.
- [ ] Trocou versão minor do Better Auth ou do Next? Régua relida (REQ-M5) e
      `caminhos-ba.test.ts` verde.

### Qualidade
- [ ] `npm run verificar` verde (lint, typecheck, compliance, travas, testes, docs).
- [ ] `npm run build` verde.
- [ ] Caminho crítico coberto por teste — e a trava escrita junto, não "depois".
- [ ] Arquivo com no máximo 499 linhas (exceto `src/components/ui/`).
- [ ] `npm run lixo` rodado; raiz sem resíduo.

### Processo
- [ ] Regra de negócio nova em `docs/regras-negocio.md`.
- [ ] Decisão de arquitetura em `docs/adr/` e índice atualizado.
- [ ] Rota nova com linha em `docs/seguranca/caminhos-de-acesso.md`.
- [ ] Commits em Conventional Commits PT-BR, **sem rodapé de coautoria**.
- [ ] Nada commitado fora do escopo do pacote.

## Como testar

<!-- Passos para o revisor validar localmente, com o comando exato. -->

## Evidências

<!-- Saída dos comandos de aceite. Screenshot se mudou UI (claro e escuro). -->
