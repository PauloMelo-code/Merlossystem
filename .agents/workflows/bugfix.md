# Workflow — corrigir bug no MerlostoreChat

## 1. Ler antes de tocar

- `CLAUDE.md` na raiz — **seção "Estado Atual do Projeto"**, que lista honestamente o que ainda diverge do padrão da base
- `docs/api.md` — as 50 rotas, com validação, efeitos colaterais e desvios conhecidos. **Obrigatório antes de mexer em qualquer rota**
- `docs/adr/` — 0002 transição Prisma→Drizzle, 0003 multi-loja, 0005 soft delete, 0007 fila no Postgres
- `docs/regras-negocio.md` e `docs/rbac.md`
- O arquivo real que você vai alterar

## 2. Localizar a camada

| Sintoma | Comece por |
| :--- | :--- |
| Dado de uma loja apareceu na outra | `src/lib/loja.ts` — **trate como incidente**, é o pior defeito aqui |
| Rota se comportando fora do esperado | a seção dela em `docs/api.md` — os desvios conhecidos já estão listados |
| Autoria errada em registro | `usuarioDaSessao()` em `src/lib/sessao.ts` |
| Usuário acessa o que não devia | `src/lib/rbac.ts` — o middleware cobre a API; **as páginas ainda não** |
| Registro sumiu | soft delete: a query filtrou `is_deleted`? |
| Edição sobrescrita | optimistic locking por `updated_at` |
| Ação do usuário não ficou registrada | a trilha só grava se o front chamar `/api/activity-logs` — é lacuna conhecida |
| Mídia não abre | S3/MinIO, `docs/adr/0006-midia-no-minio.md` |
| Job não rodou | fila no Postgres, `docs/adr/0007-fila-no-postgres.md` |

## 3. Diagnosticar sem escrever

Reproduza e leia o estado antes de editar. Confira a trilha de auditoria: quem fez, o quê, quando.
Se for escrever script de diagnóstico, ele tem que percorrer **o mesmo caminho do código de
produção** — script que testa por fora mente.

## 4. Corrigir a causa, não o sintoma

Antes de editar, `grep` por **todos os chamadores** da função que você vai tocar. A guarda certa
fica na função compartilhada, não em cada chamador — senão o bug continua vivo nos irmãos.

## 5. Provar

```bash
npm run typecheck
npm test
npm run compliance
npm run docs:check
```

## 6. Reportar

Sintoma × causa raiz · arquivos lidos e alterados · invariantes tocados · saída dos comandos acima ·
risco residual.
