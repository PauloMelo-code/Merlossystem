---
name: criar-componente
description: Cria um componente React seguindo o padrao da base (colocation, server vs client, props tipadas, estados obrigatorios, shadcn/ui, modal block para acoes criticas). Use quando o usuario pedir uma tela, componente, formulario, lista ou UI.
---

# Criar Componente

Segue o padrao definido em `docs/components.md`. Arquivo-ouro:
`templates/component.tsx`.

## Decisao 1: Server ou Client?

- **Server** (padrao, sem `"use client"`): so busca dados / resolve RBAC / repassa props.
- **Client** (`"use client"`): so se precisa de `useState`/`useEffect`/eventos/browser API.

Padrao: `page.tsx` (server) busca dados e passa para um client component pequeno.

## Decisao 2: Onde mora?

- Usado por 1 rota -> `src/app/<rota>/_components/`.
- Generico (Button, Card) -> `src/components/ui/` (shadcn).
- Compartilhado entre features -> `src/components/`.

## Passos

1. Copie `templates/component.tsx` como ponto de partida.
2. Nome do arquivo em kebab-case; componente em PascalCase; export nomeado.
3. `interface <Nome>Props` explicita; reuse tipos do schema (`$inferSelect`).
4. Trate os 4 estados: carregando, vazio, erro, sucesso.
5. Acao critica -> `<ModalConfirmacaoBlock>` (block 3s, sem fechar por ESC/fora).
6. Estilize com Tailwind + shadcn; tema dark; nao edite primitivos shadcn.
7. Acessibilidade minima: labels, foco visivel, contraste.
8. Teste o caminho critico (ver `templates/component.test.tsx`).

## Checklist

- [ ] Server por padrao; client so quando necessario?
- [ ] Export nomeado, PascalCase, 1 por arquivo?
- [ ] Props tipadas (sem `any`), reusando tipos do schema?
- [ ] 4 estados tratados?
- [ ] Acao critica com modal block 3s?
- [ ] Local correto (_components / ui / components)?
- [ ] Acessibilidade minima + teste do caminho critico?
