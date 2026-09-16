# Workflow — construir funcionalidade no MerlostoreChat

## 1. Confirmar que ela cabe

- Está no **R1**? A lista está em `AGENTS.md` e em `docs/regras-negocio.md`. Item fora do
  R1 **não tem arquivo**: sem tela, sem rota, sem item de navegação, sem módulo.
- Precisa de tabela, coluna, permissão, enum ou rota nova? O modelo é **fechado**:
  **pare e reporte**, com ADR. Nenhum pacote de módulo gera migração.
- Já existe algo parecido? `npm run map` e `docs/PROJECT_MAP.md` antes de escrever a
  primeira linha.

## 2. Construir de baixo para cima

| Ordem | Onde | Skill |
|---|---|---|
| 1 | tabela e migração (só se autorizado) | `/criar-tabela` |
| 2 | validador Zod em `src/lib/validadores/<dominio>.ts` | `/criar-crud` |
| 3 | regra de negócio em `src/lib/<dominio>/` — leitura com `vivos()` + `condicaoDeLoja()`, escrita só por `mutacoes.ts` | `/criar-crud` |
| 4 | Server Action em `src/lib/actions/<dominio>.ts`, `export async function` + `executarAcao` | `/criar-crud` |
| 5 | tela em `src/app/(app)/<rota>/`, server por padrão | `/criar-componente` |
| 6 | trava de teste, escrita **junto** | — |
| 7 | `docs/modulos/<dominio>.md` + linha em `docs/seguranca/caminhos-de-acesso.md` | `/repo-docs-sync` |

## 3. O que este sistema cobra e a base genérica não

- Escopo de loja em toda consulta; registro de outra loja responde **404**.
- Server Action é POST alcançável direto: valide tudo, inclusive ids do corpo, contra a
  loja resolvida. Nunca espalhe o corpo sobre a linha.
- Trilha na mesma transação — e **antes** do efeito quando ele destrói o estado anterior.
- Job só é enfileirado **depois do commit**.
- Nenhuma tela de fachada: se o backend não faz, a tela não existe ou é só leitura.
- Ação crítica: modal block de 3 s. Reversível e interna: desfazer por toast.

## 4. Provar

```bash
npm run lint && npm run typecheck && npm run compliance
npm run test:travas && npm run test:unidade && npm run test:componentes
node scripts/db-teste.mjs --sufixo <pacote> && npm run test:integracao
npm run map && npm run docs:check
npm run lixo
```

`npm run build` só na fundação e na integração — o `.next` é único no diretório.

## 5. Reportar

O que foi construído e por quê · arquivos criados e alterados · a **saída real** de cada
comando de aceite · o que ficou vermelho · o que falta decidir · o que a próxima etapa
precisa saber.

Commit em Conventional Commits PT-BR, escopo igual ao nome do módulo,
**sem rodapé de coautoria**. Nunca commite arquivo de outro pacote.
