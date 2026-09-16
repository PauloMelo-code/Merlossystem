---
name: criar-componente
description: Cria um componente React do MerlostoreChat no padrão da casa (server por padrão, colocation, tokens do Tailwind v4 sem hex nem valor arbitrário, primitivos shadcn não editáveis, os 8 estados obrigatórios, modal block de 3 s × desfazer, acessibilidade AA). Use quando o usuário pedir uma tela, componente, formulário, lista, tabela ou qualquer UI.
---

# Criar Componente

## Decisão 1 — server ou client?

- **Server** (padrão, sem `"use client"`): busca dados pelo módulo de domínio, resolve
  permissão, repassa props.
- **Client** (`"use client"`): só quando precisa de estado, efeito, evento ou API do
  navegador. `page.tsx` server + client pequeno por baixo.

Nunca use `react-hook-form`: formulário é `<form action={...}>` + `useActionState`.

## Decisão 2 — onde mora?

| Alcance | Pasta |
|---|---|
| uma rota só | `src/app/(app)/<rota>/_components/` |
| compartilhado entre telas | `src/components/comum/` |
| shell (navegação, cabeçalho, seletor de loja) | `src/components/layout/` |
| primitivo do shadcn | `src/components/ui/` — **vendorizado, não se edita** |

Precisa variar um primitivo? **Compõe por cima** em `comum/`. O CLI do shadcn roda uma
vez; re-rodar sem revisão de diff é proibido.

## Regras de estilo (viram grep no CI)

Proibido em `src/**/*.tsx` fora de `src/components/ui/`:

- hex (`#141414`), `rgb(`, `oklch(`;
- classe de paleta crua (`bg-white`, `text-neutral-500`);
- valor arbitrário (`text-[10px]`, `bg-[#141414]`).

Só token semântico do `globals.css` (Tailwind v4, CSS-first — **não existe**
`tailwind.config.ts`). Toda variável de `:root` existe em `.dark` e tem `--color-*` no
`@theme`. Cor nunca sozinha: estado tem ícone ou texto junto.

- **Rótulo e tom de enum**: só por `src/lib/ui/tons.ts` (que importa os valores de
  `db/schema/_enums/`) e só renderizado por `<SeloStatus>`. Nunca `className` solto.
- **Moeda, data, hora, telefone**: só por `src/lib/formato.ts`. Dinheiro chega como
  string `"1234.56"` e é renderizado por `<Dinheiro valor="1234.56" />`.
- **Toast**: `sonner`, um `Toaster` no root.
- **Movimento**: 4 durações (100/150/200/300 ms). Rota, chegada de mensagem,
  reordenação e contador **não animam**. `prefers-reduced-motion` é global no CSS.

## Os 8 estados obrigatórios

Os 4 da casa — **carregando, vazio, erro, sucesso** — e mais 4 que este domínio exige:

| Estado | Como aparece |
|---|---|
| **sem permissão** | "Você não tem acesso a esta área. Fale com o administrador." A página **não** renderiza o conteúdo por baixo, e o item some da navegação |
| **reautenticação necessária** | `<ModalReautenticacao>`, nunca um 403 seco |
| **dado desatualizado** | horário da leitura sempre visível; acima do limite, tom `aviso` "Leitura antiga" |
| **desconectado** | faixa discreta "Atualização automática pausada. [Recarregar]" e a lista cai para polling |

Registro de outra loja usa a **mesma tela de "não encontrado"**. Vazio sempre com a
próxima ação ("Nenhuma conversa com esses filtros." [Limpar filtros]).
Erro é **o que aconteceu + por quê + o que fazer**, sem código cru e sem culpar a pessoa.

| Tempo esperado | Padrão |
|---|---|
| < 100 ms | nada |
| 100 ms – 1 s | skeleton ou botão pendente |
| 1 – 10 s | spinner + o que está acontecendo |
| > 10 s ou fila | progresso determinado, dá para sair da tela, avisa ao terminar |

## Confirmação: block de 3 s × desfazer

- **`<ModalConfirmacaoBlock>` (3 s)** para o que é irreversível ou visível para fora:
  disparar campanha, anonimizar contato, desconectar integração, mudar papel, lançar no
  Masc. Resumo obrigatório do que vai acontecer; `role="alertdialog"`; sem X; Esc e
  clique-fora inertes durante o bloqueio; botões com `aria-disabled` (não `disabled`,
  que tira do foco); foco inicial em Cancelar; liberação anunciada em `aria-live`.
- **Executa já + toast com "Desfazer"** para o reversível e interno: resolver, arquivar,
  transferir, etiquetar, marcar como lida.

Otimista: enviar mensagem, marcar como lida, etiquetar. **Não otimista**: pedido/Masc,
LGPD, desconectar integração, papel de usuário — esperam o servidor.

## Acessibilidade (AA, bloqueante)

Foco visível sempre · nada clicável que não seja `<a>`/`<button>` · botão-ícone com
`aria-label` · campo com `label` e `autoComplete` · nenhum estado só por cor ·
landmarks e um `h1` por página · `aria-live` para toast e novidade · zoom 200 % e reflow
a 320 px · textos de sistema em PT-BR ("Close" do primitivo vira "Fechar").

## Passos

1. Arquivo em **kebab-case**, componente em **PascalCase**, **export nomeado**, um por
   arquivo, no máximo 499 linhas. Página com mais de ~150 linhas de JSX vira
   `page.tsx` + `_components/`.
2. `interface <Nome>Props` explícita, sem `any`, reusando tipo do schema.
3. Trate os 8 estados. Ação crítica escolhe block ou desfazer pela tabela acima.
4. Teste em `tests/componentes/` cobrindo os 4 estados base e, no block, com timers
   falsos do Vitest.
5. `npm run test:componentes && npm run compliance`.

## Checklist

- [ ] Server por padrão; client só quando precisa?
- [ ] Local correto (`_components` / `comum` / `layout` / `ui`)?
- [ ] Zero hex, `rgb(`, `oklch(`, classe crua e valor arbitrário?
- [ ] Rótulo e tom vindos de `tons.ts`; formatação vinda de `formato.ts`?
- [ ] Os 8 estados tratados, com vazio que oferece a próxima ação?
- [ ] Block de 3 s **ou** desfazer, conforme a tabela — não os dois, não nenhum?
- [ ] Teclado, `aria-label`, foco visível e nenhum estado só por cor?
