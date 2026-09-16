# 10 — Diretrizes de design (skills de design aplicadas ao MerlostoreChat)

> Levantamento para a reconstrução do MerlostoreChat: atendimento multicanal + CRM das lojas Merlo
> (Centro e Cerro Azul), usado o dia inteiro por vendedoras. Tela densa, muita lista e chat, desktop
> primeiro e funcional no celular. Todo valor de cor abaixo teve o contraste **calculado** pela
> fórmula de luminância relativa do WCAG, por script, e não estimado.

---

## 0. Fontes lidas e como usar este arquivo

| Fonte | Caminho | O que rendeu |
|---|---|---|
| Skills design-systems (8) | `C:\Users\Paulo\.claude\plugins\cache\designer-skills\design-systems\1.0.0\skills\{design-token,theming-system,component-spec,accessibility-audit,pattern-library,naming-convention,motion-system,icon-system}\SKILL.md` | Tokens em 3 camadas, nomes, 4-6 durações, reduced motion global, ícones com rótulo, WCAG 2.2 POUR |
| Skills ui-design (9) | `...\ui-design\1.0.0\skills\{color-system,dark-mode-design,typography-scale,spacing-system,layout-grid,visual-hierarchy,responsive-design,data-visualization,law-of-proximity}\SKILL.md` | 4.5:1 e 3:1, superfície mais clara no escuro, base 4px, densidade compacta, proximidade, breakpoints |
| Skills interaction-design (8) | `...\interaction-design\1.0.0\skills\{form-design,loading-states,error-handling-ux,feedback-patterns,navigation-patterns,search-ux,state-machine,micro-interaction-spec}\SKILL.md` | Validação no blur, faixas de tempo de carregamento, formato de erro, toasts 3-5s, sidebar no desktop e tab bar no celular, estado zero da busca |
| Skills visual-critique (7 + 2 comandos) | `...\visual-critique\1.1.0\skills\critique-*\SKILL.md` e `...\commands\{critique-screen,critique-ux}.md` | Formato Observação/Problema/Correção, nota pass/minor/major, priorização P1/P2/P3 (seção 22) |
| Padrão de componentes da base | `C:\Users\Paulo\Documents\estrutura base\docs\components.md` e `templates\component.tsx` | Colocation, server por padrão, 4 estados obrigatórios, modal block 3s, a11y mínima |
| Tokens da marca | `C:\Users\Paulo\Documents\MerlostoreChat\.claude\skills\how-to-use-guide\assets\marca\{tokens.css,marca.json,LEIA-ME.md}` | `--marca: #7C3AED` (preenchimento), `--marca-texto: #5B21B6` (texto); logos faltando |
| Referência de domínio (NÃO de implementação) | MerlostoreChat `src/app/globals.css`, `tailwind.config.ts`, `src/components/{inbox,layout}/*`, `docs/integracoes.md`, `prisma/schema.prisma` | Anti-padrões a não repetir (seção 2) e estados de negócio que viram cor (seção 4.5) |
| Padrão da casa | `HUG\hug-atende\src\app\globals.css`, `tailwind.config.ts`, `src/components/ui/{status-pill,field,modal}.tsx`; `estrutura base\espaco-flow\src\components\{modal-confirmacao-block,excluir-botao}.tsx` | Implementação existente do modal block e do botão de excluir com toast |

Observações sobre as fontes:
- As skills são genéricas (20 a 60 linhas cada), sem valores de produto. Os valores concretos daqui são
  decisões derivadas delas para este domínio; onde o arquivo diverge de uma skill, o desvio está escrito.
- Não há SKILL.md dessas skills em `C:\Users\Paulo\AppData\Roaming\Claude` (Glob sem resultado). As cópias em
  `plugins\marketplaces\designer-skills\` são idênticas às do `cache`.
- A skill `critique-brand-consistency` exige `mood.md`, `voice.md` e `tokens.md`; sem eles ela **pula** a
  dimensão. Este arquivo cumpre esse papel (tokens: seções 3-11; voz e mood: seção 21) até a fase de desenho
  decidir onde isso mora no repo (a base proíbe criar doc sem pedido, então sugiro seção em `docs/front.md`).

---

## 1. Contexto de uso e princípios

**Quem usa:** vendedoras de loja de moda, 6-9h por dia, alternando balcão e tela; gerente e admin olhando as
duas lojas. Ambiente de loja é claro (vitrine, luz forte), então tema claro precisa ser excelente.

**O que fazem:** respondem muitas conversas em paralelo (WhatsApp oficial, WhatsApp uazapi, Instagram,
Facebook, TikTok), consultam produto e saldo (Bling, só leitura), abrem pedido que nasce pendente de
lançamento no Masc, movem cliente no funil.

| # | Princípio | Consequência de desenho |
|---|---|---|
| P1 | **Sempre saber onde estou** | Loja ativa e número de entrada sempre visíveis (integracoes.md:643-645) |
| P2 | **Rápido de verdade** | Resposta visual < 100 ms a toda ação; teclado para o fluxo principal; nada espera animação |
| P3 | **Denso, não apertado** | Densidade compacta nas telas de operação, piso de 12 px de texto, alvos ≥ 24 px (44 px no toque) |
| P4 | **Estado honesto** | Nunca botão mudo (lição de `CabecalhoConversa.tsx:12-15`); ação indisponível mostra o motivo |
| P5 | **Erro caro é difícil de cometer** | Nota interna impossível de confundir com resposta; ação crítica com block 3s |
| P6 | **A marca é acento, não volume** | Violeta só em ação, seleção, foco e mensagem da casa; o resto é neutro |
| P7 | **AA em tudo, nos dois temas** | Tabela de pares aprovados (seção 4); cor nunca é o único sinal |

---

## 2. O que o sistema atual e a casa ensinam (não repetir)

| # | Achado | Onde | Diretriz para o novo |
|---|---|---|---|
| 1 | A marca não existe na UI: paleta "warm neutral", `--primary` quase preto | MerlostoreChat `src/app/globals.css:42-78` | `--primary` = violeta da marca (seção 4) |
| 2 | Dark mode consertado com `!important` sobre classes cruas (`.dark .bg-white`, `.dark .text-neutral-900`) | `globals.css:147-157` | Proibido cor crua em TSX (paleta Tailwind, hex, `bg-white`); só token semântico |
| 3 | Hex solto em layout e canal | `(dashboard)/layout.tsx:24`; `Sidebar.tsx:115,164`; `ChannelBadge.tsx:50,57,58,64,65` | Idem; canal vira token `--canal-*` |
| 4 | Variável CSS sem utilitário gerou "texto transparente" | `tailwind.config.ts:4-15` | Tailwind v4 `@theme inline` + teste que compara variáveis x tema (seção 11) |
| 5 | Texto de 10 px | `ConversationList.tsx:75,149,161,177`; `Sidebar.tsx:75`; `BolhaMensagem.tsx:124` | Piso 12 px; única exceção o contador numérico 11 px/600 |
| 6 | Linha da lista é `div onClick` (sem teclado) | `ConversationList.tsx:125-132` | `<a>`/`<button>` real com `aria-current` |
| 7 | Motivo da falha de envio só em `title` (tooltip, invisível no toque) | `BolhaMensagem.tsx:67-69` | Motivo em texto visível |
| 8 | Ícones de entrega sem nome acessível; lida x entregue só pela cor azul | `BolhaMensagem.tsx:76-78` | `aria-label`/texto `sr-only` + forma distinta |
| 9 | SVG de canal sem `aria-hidden`; canal desconhecido cai em WhatsApp | `ChannelBadge.tsx:9,17,25,33,79,103` | `aria-hidden` + rótulo; fallback neutro "Canal desconhecido" |
| 10 | Mensagem pendente com `opacity-60` (derruba o contraste do texto) | `BolhaMensagem.tsx:109` | Ícone + texto "Enviando", sem opacidade no texto |
| 11 | Hora só relativa ("há 5 minutos") | `ConversationList.tsx:150-155`; `BolhaMensagem.tsx:177-180` | `<time dateTime>` com hora absoluta (seção 5) |
| 12 | Transição animada a cada troca de rota; hover com mola que desloca o item | `(dashboard)/layout.tsx:29-39`; `Sidebar.tsx:83-91` | Sem transição de rota, sem spring; remover `framer-motion` |
| 13 | Rótulos em inglês ou mistos ("Inbox", "Pipeline", "Broadcast", "Analytics", "Templates") | `Sidebar.tsx:38-62` | Glossário PT-BR (seção 21) |
| 14 | Rótulo de seção 10 px, caixa alta, tracking 0.15em | `Sidebar.tsx:75` | 12 px/500, sentence case |
| 15 | Marca escrita "Merlos Store" | `logo.tsx:26`; `src/app/layout.tsx:11` x `marca.json:3` ("Merlo Store") | Confirmar com o cliente antes de desenhar login/título |
| 16 | Logos negativo, tinta e ícone faltando | `assets/marca/LEIA-ME.md:10-12` | Pendência de cliente (favicon, login, tema escuro) |
| 17 | Papel cru na opção de transferir ("Ana (agent)") | `CabecalhoConversa.tsx:77` | Nome + papel traduzido |
| 18 | Template-ouro da base usa `alert()`, `console.error` e `R$ ${toFixed(2)}` | `estrutura base\templates\component.tsx:46-47,65` | Toast + `Intl.NumberFormat('pt-BR')`; referência melhor é `espaco-flow\src\components\excluir-botao.tsx:21-30` |
| 19 | HUG: `StatusPill` com hex inline, não reage ao tema escuro | `hug-atende\src\components\ui\status-pill.tsx:20-27,45` | Tons por token com par claro/escuro |
| 20 | HUG: escala de fonte com meio-passos (`xs+`, `sm+`, `base+`, `md+`, 10-26 px) | `hug-atende\tailwind.config.ts:56-70` | 6 passos nomeados (seção 5) |
| 21 | HUG: rótulo de campo 11 px | `hug-atende\src\components\ui\field.tsx:19` | 13 px |
| 22 | Base diz "Tema dark por padrão" | `estrutura base\docs\components.md:105` | Loja física: padrão `system` (decisão em aberto, seção 23) |
| 23 | shadcn estilo `base-nova` (Base UI) no repo, mas o modal block da casa usa props estilo Radix (`onEscapeKeyDown`, `onPointerDownOutside`) | MerlostoreChat `components.json:3`, `package.json:35`; `espaco-flow\...\modal-confirmacao-block.tsx:75-84` | Escolher o primitivo em ADR; o contrato do modal block precisa de teste com o primitivo escolhido |

O que vale manter (bom no atual): skip link (`(dashboard)/layout.tsx:17-23`), `lang="pt-BR"`
(`src/app/layout.tsx:21`), nome do vendedor na bolha de saída (`BolhaMensagem.tsx:119-121`), lista de
transferência filtrada por loja (`CabecalhoConversa.tsx:33-34`), botão "Tentar de novo" na bolha que falhou.

---

## 3. Arquitetura de tokens

Três camadas (skills design-token e theming-system):

| Camada | O que é | Onde vive | Quem pode usar |
|---|---|---|---|
| 1. Global | Valores crus (hex) da seção 4.1 | Só dentro de `globals.css`, como valor dos tokens semânticos | Ninguém em TSX |
| 2. Semântica | Papel da cor/medida (`--primary`, `--muted-foreground`, `--aviso-fundo`) — **o tema sobrescreve aqui** | `:root` (claro) e `.dark` (escuro) | Todo componente, via utilitário Tailwind (`bg-primary`, `text-aviso`) |
| 3. Componente | Só onde o domínio pede (`--balao-saida`, `--nota-interna-*`, `--canal-*`) | `:root`/`.dark` | Os componentes daquele domínio |

Regras de nome (skill naming-convention: previsível, por propósito, nunca por aparência):
- **Contrato shadcn fica em inglês** (`background`, `foreground`, `card`, `popover`, `primary`, `secondary`,
  `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `sidebar-*`, `chart-*`): os primitivos
  instalados por `npx shadcn add` dependem desses nomes, e a base proíbe editar a lógica interna do primitivo
  (`docs/components.md:103-104`).
- **Extensões em PT-BR**, kebab-case, padrão `{papel}-{variante}`: `sucesso`, `sucesso-fundo`,
  `sucesso-borda`, `aviso-*`, `perigo-*`, `info-*`, `neutro-*`, `marca-texto`, `texto-terciario`,
  `balao-entrada`, `nota-interna-fundo`, `canal-whatsapp`.
- **Não usar a paleta padrão do Tailwind v4 como marca**: na v4 as cores padrão são definidas em oklch com
  croma diferente do hex da v3; `violet-600` da v4 não é `#7C3AED`. Os tokens declaram o valor explícito.

Proibido em TSX (vira regra de grep no compliance):
- hex, `rgb()`, `oklch()` e `style={{ color }}`;
- classe de paleta crua: `bg-violet-600`, `text-neutral-500`, `bg-white`, `border-zinc-200`;
- valor arbitrário de cor, tamanho de fonte ou espaçamento: `text-[10px]`, `p-[13px]`, `bg-[#141414]`.
  Exceção única: `env(safe-area-inset-*)`.

---

## 4. Cor

### 4.1 Paleta global (camada 1)

Marca = escala violeta; `#7C3AED` (600) e `#5B21B6` (800) são exatamente os tokens do cliente. Neutro = zinc,
cujo matiz (~286) conversa com o violeta (~293).

| Passo | Marca (hex / oklch) | Neutro (hex / oklch) |
|---|---|---|
| 0 | — | `#FFFFFF` / oklch(1 0 0) |
| 50 | `#F5F3FF` / oklch(0.969 0.016 293.8) | `#FAFAFA` / oklch(0.985 0 0) |
| 100 | `#EDE9FE` / oklch(0.943 0.028 294.6) | `#F4F4F5` / oklch(0.967 0.001 0) |
| 200 | `#DDD6FE` / oklch(0.894 0.055 293.3) | `#E4E4E7` / oklch(0.920 0.004 286.3) |
| 300 | `#C4B5FD` / oklch(0.811 0.101 293.6) | `#D4D4D8` / oklch(0.871 0.005 286.3) |
| 400 | `#A78BFA` / oklch(0.709 0.159 293.5) | `#A1A1AA` / oklch(0.712 0.013 286.1) |
| 450 (borda de campo) | — | `#8A8A93` / oklch(0.636 0.013 286.0) |
| 500 | `#8B5CF6` / oklch(0.606 0.219 292.7) | `#71717A` / oklch(0.552 0.014 285.9) |
| 600 | **`#7C3AED`** / oklch(0.541 0.247 293.0) | `#52525B` / oklch(0.442 0.015 285.8) |
| 700 | `#6D28D9` / oklch(0.491 0.241 292.6) | `#3F3F46` / oklch(0.370 0.012 285.8) |
| 800 | **`#5B21B6`** / oklch(0.432 0.211 292.8) | `#27272A` / oklch(0.274 0.005 286.0) |
| 900 | `#4C1D95` / oklch(0.380 0.178 293.7) | `#18181B` / oklch(0.210 0.006 285.9) |
| 950 | `#2E1065` / oklch(0.283 0.135 291.1) | `#09090B` / oklch(0.141 0.004 285.8) |

Estados (hex): verde `#F0FDF4 #BBF7D0 #4ADE80 #15803D`; âmbar `#FFFBEB #FDE68A #FBBF24 #B45309`;
vermelho `#FEF2F2 #FECACA #F87171 #DC2626 #B91C1C`; azul `#EFF6FF #BFDBFE #60A5FA #1D4ED8`;
amarelo (nota) `#FEF9C3 #FDE047 #FEF08A #713F12`. Fundos escuros resolvidos: verde `#1A3225`, âmbar `#392C19`,
vermelho `#381F21`, azul `#1D283C`, marca `#29223C`, neutro `#252529`, nota `#312B19`, seleção `#2A233E`
(cor-500 a 15-16% sobre `#18181B`, calculado em sRGB e fixado como hex).

Nota do cliente (`LEIA-ME.md:18-20`): `#7C3AED` foi descrito como só preenchimento. O cálculo mostra que ele
**passa** como texto sobre branco (5,70:1) e sobre `#FAFAFA` (5,46:1); mesmo assim o token de texto da marca
fica `#5B21B6` (8,98:1), que aguenta fundo tingido.

### 4.2 Tokens semânticos (camada 2)

| Token | Claro | Escuro | Uso | Contraste verificado (claro / escuro) |
|---|---|---|---|---|
| `--background` | `#FAFAFA` | `#09090B` | Canvas do app | — |
| `--foreground` | `#18181B` | `#F4F4F5` | Texto principal | 16,97 s/ `#FAFAFA`, 17,72 s/ branco / 18,10 s/ `#09090B`, 16,12 s/ `#18181B` |
| `--card` | `#FFFFFF` | `#18181B` | Lista, painel, tabela, sidebar | — |
| `--popover` | `#FFFFFF` | `#27272A` | Menu, dialog, sheet, toast | escuro: `foreground` 13,55 |
| `--muted` | `#F4F4F5` | `#27272A` | Fundo rebaixado, hover neutro, skeleton, canvas do chat (claro) | — |
| `--muted-foreground` | `#52525B` | `#A1A1AA` | Texto secundário, preview, rótulo, cabeçalho de tabela | 7,73 branco, 7,41 `#FAFAFA`, 7,03 `#F4F4F5` / 6,91 `#18181B`, 5,81 `#27272A`, 7,76 `#09090B` |
| `--texto-terciario` | `#71717A` | `#A1A1AA` | Hora, contagem, helper | 4,83 branco, 4,63 `#FAFAFA`; **reprova 4,40 sobre `#F4F4F5`** — nunca sobre `--muted` / escuro: `#71717A` reprova (3,67), por isso é igual ao muted |
| `--primary` | `#7C3AED` | `#A78BFA` | Botão primário, contador de não lidas | limite do botão escuro vs `#18181B` ok |
| `--primary-foreground` | `#FFFFFF` | `#09090B` | Texto sobre primário | 5,70 / 7,31 |
| `--primary-hover` | `#6D28D9` | `#C4B5FD` | Hover do primário | branco 7,10 / `#09090B` 10,78 |
| `--marca-texto` | `#5B21B6` | `#A78BFA` | Link, item de nav ativo, divisor "Novas mensagens" | 8,98 branco, 8,19 `#F5F3FF`, 7,57 `#EDE9FE` / 6,51 `#18181B`, 5,47 `#27272A`, 5,48 seleção |
| `--secondary` | `#F4F4F5` | `#27272A` | Fundo de botão secundário | texto `foreground` |
| `--accent` | `#F5F3FF` | `#2A233E` | Linha/item selecionado (+ barra 3 px `--ring`) | texto 16,15 / 13,57; muted-fg escuro 5,82; barra 5,20 / 5,48 |
| `--border` | `#E4E4E7` | `#3F3F46` | Divisor decorativo (sem exigência de contraste) | 1,27 / 1,70 — nunca como único limite de controle |
| `--input` | `#8A8A93` | `#71717A` | Borda de input, checkbox, radio, switch desligado (WCAG 1.4.11 ≥ 3:1) | 3,42 branco, 3,28 `#FAFAFA`, 3,11 `#F4F4F5` / 3,67 `#18181B`, 4,12 `#09090B`, 3,08 `#27272A` |
| `--ring` | `#7C3AED` | `#A78BFA` | Anel de foco, barra de seleção | 5,70 branco, 5,46 `#FAFAFA` / 6,51, 7,31 |
| `--destructive` | `#DC2626` | `#DC2626` | Botão destrutivo sólido (texto branco) | 4,83; limite vs `#18181B` 3,67; hover `#B91C1C` 6,47 |
| `--sidebar*` | = `card`, `muted-foreground`, `marca-texto`, `accent` | idem | Navegação | herdado |

Reprovados que parecem óbvios e **não** podem virar token: `#A1A1AA` como borda de input no claro (2,56),
`#D4D4D8` como borda (1,48), texto `#8B5CF6` sobre `#18181B` (4,18), branco sobre `#8B5CF6` (4,23),
`#71717A` como texto no escuro (3,67), `#A1A1AA` como hora sobre `#4C1D95` (4,27).

### 4.3 Tons de estado (badge, alerta, faixa)

Regra: texto/ícone do tom sobre o fundo do tom, borda do tom decorativa, **sempre com ícone ou rótulo**.

| Tom | Claro: texto / fundo / borda | Contraste claro | Escuro: texto / fundo | Contraste escuro |
|---|---|---|---|---|
| `sucesso` | `#15803D` / `#F0FDF4` / `#BBF7D0` | 4,79 (5,02 s/ branco) | `#4ADE80` / `#1A3225` | 7,89 |
| `aviso` | `#B45309` / `#FFFBEB` / `#FDE68A` | 4,84 (5,02 s/ branco) | `#FBBF24` / `#392C19` | 8,12 (8,92 s/ `#27272A`) |
| `perigo` | `#B91C1C` / `#FEF2F2` / `#FECACA` | 5,91 (6,47 s/ branco) | `#F87171` / `#381F21` | 5,48 (5,38 s/ `#27272A`) |
| `info` | `#1D4ED8` / `#EFF6FF` / `#BFDBFE` | 6,16 (6,70 s/ branco) | `#60A5FA` / `#1D283C` | 5,81 |
| `neutro` | `#3F3F46` / `#F4F4F5` / `#E4E4E7` | 9,50 | `#A1A1AA` / `#252529` | 5,96 |
| `marca` | `#5B21B6` / `#F5F3FF` / `#DDD6FE` | 8,19 | `#A78BFA` / `#29223C` | 5,56 |

Armadilha medida: `#B45309` sobre `#FEF3C7` (âmbar-100) dá 4,51 e `#15803D` sobre `#DCFCE7` dá 4,57 — no
limite. Por isso os fundos claros são os de passo 50.

### 4.4 Tokens de domínio (camada 3)

| Token | Claro | Escuro | Contraste |
|---|---|---|---|
| `--chat-fundo` | `#F4F4F5` | `#09090B` | separador de data em `muted-foreground`: 7,03 / 7,76 |
| `--balao-entrada` (cliente) | `#FFFFFF` + borda `--border` | `#27272A` | texto 17,72 / 13,55; hora `#71717A` 4,83 / `#A1A1AA` 5,81 |
| `--balao-saida` (da casa) | `#EDE9FE` | `#4C1D95` | texto `#18181B` 14,92 / `#F4F4F5` 9,97; hora `#5B21B6` 7,57 / `#DDD6FE` 7,89 |
| `--nota-interna-fundo` / `-texto` / `-borda` | `#FEF9C3` / `#713F12` / `#FDE047` tracejada | `#312B19` / `#FEF08A` / `#713F12` | 8,07 / 12,11 |
| Bolha que falhou | tom `perigo` (fundo, borda) + texto `foreground` | idem escuro | ver 4.3 |
| Bolha automática (bot/IA) | tom `neutro` + rótulo "Automático" | idem | ver 4.3 |
| `--canal-whatsapp` | `#128C7E`, glifo branco | igual | 4,14 (≥ 3:1 de gráfico). **Proibido** glifo branco sobre `#25D366` (1,98) |
| `--canal-instagram` | `#E1306C`, glifo branco (sem gradiente de `ChannelBadge.tsx:57`) | igual | 4,34; vs `#18181B` 4,08 |
| `--canal-facebook` | `#0866FF`, glifo branco | igual | 4,82 |
| `--canal-tiktok` | `#09090B`, glifo branco | igual + anel `--border` para não sumir no fundo escuro | 19+ |

Balão da casa em tinta clara (e não violeta sólido com texto branco): lido centenas de vezes por dia, tinta
clara cansa menos e mantém a falha de envio visível. Selo de canal sempre com anel de 2 px da cor `--card`.

### 4.5 Mapa estado de negócio → tom

| Domínio | Estado | Tom | Rótulo visível |
|---|---|---|---|
| Conversa | aberta / pendente / resolvida / arquivada | info / aviso / sucesso / neutro | "Aberta", "Aguardando", "Resolvida", "Arquivada" |
| Prioridade | urgente / alta / média / baixa | perigo / aviso / — / — | Só urgente e alta aparecem ("Urgente", "Alta") |
| SLA | dentro / perto do limite / estourado | — / aviso / perigo | "Responder em 12 min" / "Atrasada 8 min" + ícone relógio |
| Pedido x Masc | pendente / lançado / dispensado | aviso / sucesso / neutro | "Falta lançar no Masc", "Lançado (nº 1234)", "Dispensado" |
| Pagamento | pending / approved / rejected / refunded / expired | aviso / sucesso / perigo / neutro / neutro | "Aguardando pagamento", "Pago", "Recusado", "Estornado", "Expirado" |
| Integração | conectado / desconectado / expirado / erro | sucesso / neutro / aviso / perigo | + último erro em texto |
| Envio de campanha | pending, sending / sent, delivered / read, replied / failed | neutro / info / sucesso / perigo | por destinatário |
| Mensagem | enviando / enviada / entregue / lida / falhou | neutro / neutro / neutro / marca / perigo | ícone + texto `sr-only` (seção 12.3) |
| Estoque (Bling) | disponível / baixo / zerado / leitura antiga | sucesso / aviso / perigo / aviso | "12 un · atualizado 14:05" |

Estados vêm de `prisma/schema.prisma:216,221-223,468,480-481,533,761-762` (referência de domínio). Um mapa só,
num módulo só (ex.: `src/lib/ui/tons.ts`), reusado por lista, tabela e detalhe.

### 4.6 Regras de uso

- Violeta ocupa no máximo ~10% da área de uma tela: ação primária, seleção, foco, contador, balão da casa.
  Sidebar e header não são pintados de violeta.
- Cor nunca sozinha: não lida = negrito + contador; selecionada = fundo + barra + `aria-current`; status =
  ícone + texto; erro de campo = ícone + texto; lida x entregue = forma + texto acessível.
- Foto de produto nunca escurecida nem filtrada no tema escuro (a cor da peça é informação de venda) — desvio
  consciente da skill dark-mode-design, que sugere escurecer imagem.
- Loja não ganha cor própria: identificada por texto e ícone (YAGNI até o cliente pedir).
- Gráficos (relatórios): máximo 5 séries categóricas, rótulo direto na série, tabela alternativa no celular,
  validar a paleta com simulador de daltonismo antes de fixar (skill data-visualization).

---

## 5. Tipografia

Família: **Inter** via `next/font/google` (já usada em `src/app/layout.tsx:8`), `display: swap`. Números com
`tabular-nums` em hora, contador, preço e tabela. Monoespaçada = pilha do sistema (`ui-monospace, SFMono-Regular,
Menlo, Consolas, monospace`) só para códigos (nº do pedido, nº Masc, rastreio, SKU), sem baixar fonte extra.

| Token (utilitário) | Tamanho / altura | Pesos | Uso |
|---|---|---|---|
| `text-legenda` | 12 / 16 px | 400, 500 | Hora, helper, badge, chip, contagem |
| `text-denso` | 13 / 18 px | 400, 500 | Linha de lista e tabela, preview, rótulo de campo, cabeçalho de tabela (500) |
| `text-corpo` | 14 / 20 px | 400, 500 | Texto padrão, botão (500), input no desktop, menu |
| `text-mensagem` | 14 / 22 px desktop · 16 / 24 px abaixo de 768 px | 400 | Texto dos balões |
| `text-titulo-secao` | 16 / 24 px | 600 | Título de painel, dialog, card |
| `text-titulo-pagina` | 20 / 28 px, tracking -0.01em | 600 | H1 de página |
| `text-destaque` | 24 / 32 px, tabular | 600 | KPI de relatório |

- Exceção única abaixo do piso: contador de não lidas 11 px/600 dentro do círculo.
- Três pesos no sistema (400/500/600); 700 não entra (skill critique-typography: excesso de negrito dilui).
- Desvio consciente: a skill typography-scale pede corpo de 16 px; ferramenta operacional densa usa 14 px no
  desktop e 16 px no celular (e 16 px em todo input no celular, evita o zoom do iOS).
- Sem caixa alta, exceto siglas (SLA, LGPD, CPF, SKU). Sentence case em rótulo, botão e título.
- Medida: balão `max-width: min(75%, 60ch)`; texto de ajuda e descrição `max-w-prose`.
- Truncamento: nome e preview com `truncate` e texto completo no detalhe/`title`; **nunca** truncar valor,
  status ou número de pedido.
- Formatação centralizada num módulo só (ex.: `src/lib/formatar.ts`): moeda `R$ 1.234,56`
  (`Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`), telefone `(41) 99999-1234`, data
  `12/09/2026`, hora `14:32`.
- Hora na lista: hoje `14:32`, ontem `Ontem`, últimos 6 dias `seg`, antes `12/09`. No balão: sempre `14:32`.
  Tudo em `<time dateTime="ISO" title="12/09/2026 14:32">`.

---

## 6. Espaçamento, densidade e alvos

Base 4 px (`--spacing: 0.25rem`, padrão do Tailwind v4). Passos permitidos: 0.5 (2), 1 (4), 1.5 (6), 2 (8),
3 (12), 4 (16), 6 (24), 8 (32), 12 (48). Fora disso, não.

| Relação (lei da proximidade) | Valor |
|---|---|
| Ícone ↔ texto | 6 px |
| Rótulo ↔ campo | 6 px; helper ↔ campo 4 px |
| Campo ↔ campo | 16 px |
| Grupo de campos ↔ grupo | 24 px |
| Seção ↔ seção | 32 px (espaço acima do título maior que abaixo) |
| Balões do mesmo autor em sequência | 2 px; autores diferentes 12 px |
| Botões relacionados | 8 px; destrutivo separado por 16 px ou empurrado para o lado oposto |

| Medida | Valor |
|---|---|
| Header do app / toolbar | 56 px |
| Linha da lista de conversas | mín. 64 px; padding 12 px × 10 px |
| Linha de tabela | 40 px; célula 12 px × 8 px |
| Padding de painel | 16 px; gutter de página 16 px (celular) / 24 px (desktop) |
| Balão | 12 px × 8 px |
| Controle `sm` / `md` / `lg` | 32 px (toolbar densa) / 36 px (padrão desktop) / 44 px (toque) |
| Botão só-ícone | 32 × 32 no desktop; 44 × 44 em `@media (pointer: coarse)` |

- Alvo mínimo AA: 24 × 24 px (WCAG 2.5.8). Tamanho de toque segue `pointer: coarse`, não o breakpoint (tablet
  com mouse e notebook com toque existem).
- Densidade: **compacta** nas telas de operação (Conversas, tabelas, funil); **confortável** em formulário,
  configurações e login (controle 40 px, gaps um passo acima). Sem seletor de densidade para o usuário (YAGNI).

---

## 7. Layout e grade responsiva

Breakpoints do Tailwind v4: `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536.

**Tela de Conversas (a mais usada):**

| Largura | Navegação | Lista | Chat | Painel do contato |
|---|---|---|---|---|
| ≥ 1536 | sidebar expandida 232 px | 360 px | flex (mín. 480) | 340 px fixo |
| 1280-1535 | trilho 56 px (ícone + tooltip, expande sob demanda) | 340 px | flex | 320 px fixo, recolhível |
| 1024-1279 | trilho 56 px | 320 px | flex | Sheet à direita (sobreposto) |
| 768-1023 | trilho 56 px | 300 px | flex | Sheet à direita |
| < 768 | tab bar inferior (some com o chat aberto) | tela cheia | tela cheia com "Voltar" | Sheet de baixo, altura cheia |

- Altura com `h-dvh`; lista e chat rolam de forma independente; composer fixo embaixo com
  `pb-[env(safe-area-inset-bottom)]`; meta viewport `interactive-widget=resizes-content` para o teclado virtual
  não cobrir o composer.
- Componentes dentro de painel (linha de conversa, card de pedido) usam container queries (`@container`,
  nativo na v4) em vez de breakpoint de tela.
- Painéis com largura fixa; painel redimensionável é YAGNI.

**Demais telas:**
- Tabela: largura total, toolbar (busca à esquerda, filtros, contagem, ação primária à direita).
- Detalhe rápido (pedido, contato): Sheet lateral de 480 px; detalhe completo em página própria com URL.
- Formulário e configurações: coluna única, `max-w-3xl`; configurações com navegação local de 200 px em
  `lg+` e select/abas abaixo disso.
- Abaixo de 768 px, tabela vira lista de cards com 3 campos-chave + status; filtros num Sheet.
- Reflow sem rolagem horizontal a 320 px CSS (WCAG 1.4.10), exceto o funil (rolagem horizontal intencional).

---

## 8. Raio, borda, sombra, camadas

| Token | Valor | Uso |
|---|---|---|
| `--radius` (base) | 8 px | — |
| `rounded-sm` | 4 px | Badge, checkbox, `kbd` |
| `rounded-md` | 6 px | Botão, input, select, chip, miniatura de produto |
| `rounded-lg` | 8 px | Card, popover, menu, toast |
| `rounded-xl` | 12 px | Dialog, Sheet, balão (canto do lado do autor 4 px) |
| `rounded-full` | — | Avatar de pessoa, contador, switch, ponto de status |

Regra de forma: **pessoa é redonda, coisa é quadrada** (avatar redondo; produto e documento com `rounded-md`).
Borda 1 px; anel de foco 2 px com offset 2 px; barra de seleção 3 px.

| Sombra | Claro | Escuro |
|---|---|---|
| `shadow-nenhuma` | card usa borda, não sombra | idem |
| `shadow-1` (popover, menu, toast) | `0 1px 2px rgb(9 9 11 / .06), 0 4px 12px rgb(9 9 11 / .08)` | quase invisível: a elevação vem da superfície `#27272A` + borda `#3F3F46` |
| `shadow-2` (dialog, sheet) | `0 8px 24px rgb(9 9 11 / .12), 0 24px 48px rgb(9 9 11 / .12)` | idem |
| Overlay | `rgb(9 9 11 / .40)` | `rgb(0 0 0 / .60)` |

Camadas (z-index): conteúdo 0 · sticky (cabeçalho de tabela, separador de data) 10 · header do app 20 ·
dropdown/popover/tooltip 40 · overlay + dialog/sheet 50 · toast 60.

---

## 9. Movimento

Princípios: **rápido** (ninguém espera animação para trabalhar), **com propósito** (só comunica mudança de
estado ou de espaço), **respeitoso** (reduced motion tratado no sistema, não componente a componente).

| Token | Valor | Uso |
|---|---|---|
| `--duracao-rapida` | 100 ms | Hover, press, troca de cor, check |
| `--duracao-normal` | 150 ms | Tooltip, dropdown, popover, accordion |
| `--duracao-moderada` | 200 ms | Dialog, Sheet no desktop, entrada de toast |
| `--duracao-lenta` | 300 ms | Sheet de baixo no celular, transição lista → chat no celular |
| `--ease-padrao` | `cubic-bezier(0.2, 0, 0, 1)` | Mudança de estado |
| `--ease-entrada` | `cubic-bezier(0, 0, 0.2, 1)` | Elemento entrando |
| `--ease-saida` | `cubic-bezier(0.3, 0, 1, 0.3)` | Elemento saindo (duração ~75% da entrada) |
| linear | — | Só spinner e barra do modal block |

**Não anima:** troca de rota no desktop; chegada de mensagem (no máximo fade de 100 ms); reordenação da lista
de conversas; contadores (sem "count up"); filtros e tabela; troca de tema. Proibido spring/bounce e hover que
desloca layout.

Reduced motion (global, em `globals.css`):

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .movimento-essencial { animation-duration: 1s !important; animation-iteration-count: infinite !important; }
}
```

Spinner leva `movimento-essencial`; skeleton vira bloco estático `--muted`; "ir para a última mensagem" usa
`behavior: 'auto'`. Dependência: `framer-motion` sai (`package.json:46`); CSS + `tw-animate-css` bastam.

---

## 10. Ícones

- Biblioteca: `lucide-react` (já é a do shadcn, `components.json:13`). Tamanhos: 14 px só dentro de badge e
  legenda; **16 px padrão** (inline com texto e em botão); 20 px na navegação e em botão-ícone de toolbar.
  `strokeWidth` padrão (2) em todo lugar. Conferir nomes na versão instalada (a série 1.x renomeou vários, por
  exemplo `AlertTriangle` → `TriangleAlert`).
- Logos de canal não existem no lucide: um componente local `IconeCanal({ canal })` com os SVGs.
- Decorativo: `aria-hidden="true"`. Informativo sem texto ao lado: `role="img"` + `aria-label`. Botão só-ícone:
  `aria-label` + Tooltip com o mesmo texto no desktop. Ícone informativo ≥ 3:1 contra o fundo.

Um significado por ícone:

| Conceito | Ícone lucide | Conceito | Ícone lucide |
|---|---|---|---|
| Conversas | `MessagesSquare` | Enviando | `Clock` |
| Contatos | `Users` | Enviada | `Check` |
| Funil | `SquareKanban` | Entregue | `CheckCheck` (neutro) |
| Pedidos | `Package` | Lida | `CheckCheck` (marca) + texto "Lida" |
| Produtos | `Shirt` | Falhou | `TriangleAlert` |
| Trocas e devoluções | `ArrowLeftRight` | SLA | `Timer` |
| Campanhas | `Megaphone` | Loja | `Store` |
| Modelos | `FileText` | Número / conta | `Smartphone` |
| Respostas rápidas | `Zap` | Responsável / transferir | `UserRound` / `UserRoundPlus` |
| Galeria | `Images` | Resolver | `CircleCheck` |
| Relatórios | `ChartColumn` | Nota interna | `StickyNote` |
| Alertas | `Bell` | Anexar / produto no chat | `Paperclip` / `ShoppingBag` |
| Base de conhecimento | `BookOpen` | Tentar de novo | `RotateCcw` |
| Configurações | `Settings` | Painel lateral | `PanelRight` |

---

## 11. Esqueleto do `globals.css` (Tailwind v4 + shadcn)

Tema por classe com `next-themes` (`attribute="class"`, já dependência em `package.json:51`).

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.5rem;
  --background: #FAFAFA;  --foreground: #18181B;
  --card: #FFFFFF;        --card-foreground: #18181B;
  --popover: #FFFFFF;     --popover-foreground: #18181B;
  --primary: #7C3AED;     --primary-foreground: #FFFFFF;  --primary-hover: #6D28D9;
  --secondary: #F4F4F5;   --secondary-foreground: #18181B;
  --muted: #F4F4F5;       --muted-foreground: #52525B;    --texto-terciario: #71717A;
  --accent: #F5F3FF;      --accent-foreground: #18181B;   --marca-texto: #5B21B6;
  --destructive: #DC2626;
  --border: #E4E4E7;      --input: #8A8A93;               --ring: #7C3AED;
  --sucesso: #15803D;     --sucesso-fundo: #F0FDF4;       --sucesso-borda: #BBF7D0;
  --aviso: #B45309;       --aviso-fundo: #FFFBEB;         --aviso-borda: #FDE68A;
  --perigo: #B91C1C;      --perigo-fundo: #FEF2F2;        --perigo-borda: #FECACA;
  --info: #1D4ED8;        --info-fundo: #EFF6FF;          --info-borda: #BFDBFE;
  --neutro: #3F3F46;      --neutro-fundo: #F4F4F5;        --neutro-borda: #E4E4E7;
  --chat-fundo: #F4F4F5;  --balao-entrada: #FFFFFF;       --balao-saida: #EDE9FE;  --balao-saida-hora: #5B21B6;
  --nota-interna-fundo: #FEF9C3; --nota-interna-texto: #713F12; --nota-interna-borda: #FDE047;
  --canal-whatsapp: #128C7E; --canal-instagram: #E1306C; --canal-facebook: #0866FF; --canal-tiktok: #09090B;
  --duracao-rapida: 100ms; --duracao-normal: 150ms; --duracao-moderada: 200ms; --duracao-lenta: 300ms;
}

.dark {
  --background: #09090B;  --foreground: #F4F4F5;
  --card: #18181B;        --card-foreground: #F4F4F5;
  --popover: #27272A;     --popover-foreground: #F4F4F5;
  --primary: #A78BFA;     --primary-foreground: #09090B;  --primary-hover: #C4B5FD;
  --secondary: #27272A;   --secondary-foreground: #F4F4F5;
  --muted: #27272A;       --muted-foreground: #A1A1AA;    --texto-terciario: #A1A1AA;
  --accent: #2A233E;      --accent-foreground: #F4F4F5;   --marca-texto: #A78BFA;
  --border: #3F3F46;      --input: #71717A;               --ring: #A78BFA;
  --sucesso: #4ADE80;     --sucesso-fundo: #1A3225;
  --aviso: #FBBF24;       --aviso-fundo: #392C19;
  --perigo: #F87171;      --perigo-fundo: #381F21;
  --info: #60A5FA;        --info-fundo: #1D283C;
  --neutro: #A1A1AA;      --neutro-fundo: #252529;
  --chat-fundo: #09090B;  --balao-entrada: #27272A;       --balao-saida: #4C1D95;  --balao-saida-hora: #DDD6FE;
  --nota-interna-fundo: #312B19; --nota-interna-texto: #FEF08A; --nota-interna-borda: #713F12;
  /* bordas de tom sao decorativas: no escuro todas iguais a --border (sem isso herdam o pastel do claro) */
  --sucesso-borda: #3F3F46; --aviso-borda: #3F3F46; --perigo-borda: #3F3F46;
  --info-borda: #3F3F46;    --neutro-borda: #3F3F46;
  /* --destructive e --canal-* nao mudam: herdam de :root de proposito */
}

@theme inline {
  --color-background: var(--background);  --color-foreground: var(--foreground);
  /* ...um --color-X: var(--X) para CADA variavel de cor acima (card, primary, sucesso-fundo, canal-*...) */
  --radius-sm: calc(var(--radius) - 4px); --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);             --radius-xl: calc(var(--radius) + 4px);
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --text-legenda: 0.75rem;        --text-legenda--line-height: 1rem;
  --text-denso: 0.8125rem;        --text-denso--line-height: 1.125rem;
  --text-corpo: 0.875rem;         --text-corpo--line-height: 1.25rem;
  --text-titulo-secao: 1rem;      --text-titulo-secao--line-height: 1.5rem;
  --text-titulo-pagina: 1.25rem;  --text-titulo-pagina--line-height: 1.75rem;
  --text-destaque: 1.5rem;        --text-destaque--line-height: 2rem;
  --ease-padrao: cubic-bezier(0.2, 0, 0, 1);
  --ease-entrada: cubic-bezier(0, 0, 0.2, 1);
  --ease-saida: cubic-bezier(0.3, 0, 1, 0.3);
  --shadow-1: 0 1px 2px rgb(9 9 11 / .06), 0 4px 12px rgb(9 9 11 / .08);
  --shadow-2: 0 8px 24px rgb(9 9 11 / .12), 0 24px 48px rgb(9 9 11 / .12);
}
```

Uso de duração: `duration-(--duracao-normal)`. Foco: `outline` (não `box-shadow`, que some em
`forced-colors`). Um teste só trava as duas regras (evolução de `tests/tokens-tailwind.test.ts` citado em
`tailwind.config.ts:13-14`): (1) toda variável de cor em `:root` existe em `.dark` e tem `--color-*` no
`@theme`; (2) os pares da tabela 4.2-4.4 continuam ≥ 4,5:1 (texto) e ≥ 3:1 (borda/foco/ícone).

---

## 12. Padrões de tela do domínio

### 12.1 Lista de conversas

**Toolbar (sticky):** título "Conversas" + "12 sem resposta"; busca `type="search"` com placeholder
"Buscar nome, telefone ou mensagem" (hoje é "Buscar...", `ConversationList.tsx:83`); segmentado
"Minhas · Sem responsável · Todas"; chips de filtro Status, Número, Etiqueta, Prioridade; "Limpar filtros"
quando houver filtro; ordenação "Mais recentes / Esperando há mais tempo". Filtros e busca na URL
(`useSearchParams` + `router.replace`), para o voltar do navegador funcionar.

**Linha** (`<li><a href="/conversas/[id]" aria-current="page">`, mín. 64 px):
- Avatar 40 px redondo (foto ou iniciais sobre `--muted`) + selo de canal 16 px no canto inferior direito.
- Linha 1: nome (`text-denso` 500; 600 se não lida) · hora à direita (`text-legenda`, tabular).
- Linha 2: preview (`text-denso`, `muted-foreground`; `foreground` 500 se não lida). Prefixos: "Você: ",
  "Nota: ", ícone `Image` 14 px + "Foto", ícone `Mic` + "Áudio 0:42". Contador de não lidas à direita
  (fundo `--primary`, 11 px/600, mín. 20 px, `aria-label="3 mensagens não lidas"`).
- Linha 3 (só se houver): chips `text-legenda` — número de entrada ("Vendas Centro", obrigatório quando a loja
  tem mais de um número ou a gestão vê "Todas as lojas"), loja (gestão em "Todas as lojas"), SLA, prioridade
  urgente/alta, responsável (avatar 16 + primeiro nome, só na aba "Todas").
- Estados: hover `--muted`; selecionada `--accent` + barra 3 px `--ring`; `focus-visible` com anel; SLA
  estourado com chip `perigo` "Atrasada 12 min"; número fora do ar com chip `aviso` "Número desconectado".

**Tempo real:** conversa com mensagem nova sobe para o topo, **mas** se a vendedora está com o ponteiro ou o
foco na lista, ou rolou, a lista não pula: aparece a pílula "3 conversas atualizadas · Mostrar" no topo
(`aria-live="polite"`). A conversa selecionada nunca perde a seleção por reordenação.

**Volume:** 50 itens + "Carregar mais" (cursor). Virtualização só quando medir lista > 500 itens.

### 12.2 Cabeçalho da conversa (56 px)

- Esquerda: "Voltar" (celular), avatar 32, nome (`text-titulo-secao`), linha `text-legenda`: ícone do canal +
  "WhatsApp · Vendas Centro" (+ "não oficial" quando uazapi, porque muda o composer: sem modelo e sem janela de
  24h, integracoes.md:482-485) + badge de status.
- Direita: "Transferir" (combobox com busca, lista só quem atende a loja, nome + papel traduzido), "Resolver"
  (botão outline com `CircleCheck`), menu "Mais ações" (etiquetas, prioridade, arquivar, abrir no CRM,
  exportar dados LGPD), alternar painel (`PanelRight`, `aria-expanded`).
- Um primário por região: o primário da tela é o "Enviar" do composer; ações do cabeçalho não são sólidas.

### 12.3 Linha do tempo

- Separador de data sticky ("Hoje", "Ontem", "12/09/2026"), pílula `text-legenda` 500 sobre `--chat-fundo`.
- Divisor "Novas mensagens" (linha `--marca-texto`) na primeira não lida ao abrir.
- Entrada à esquerda, saída à direita, `max-width: min(75%, 60ch)`, `text-mensagem`, `rounded-xl` com o canto
  do autor em 4 px. Sequência do mesmo autor em < 5 min: 2 px entre balões, nome do vendedor só no primeiro.
- Todo balão de saída: nome do vendedor (`text-legenda` 500), hora `14:32` e estado de entrega:

  | Estado | Visual | Texto acessível |
  |---|---|---|
  | enviando | `Clock` neutro (sem opacidade no texto) | "Enviando" |
  | enviada | `Check` neutro | "Enviada" |
  | entregue | `CheckCheck` neutro | "Entregue" |
  | lida | `CheckCheck` `--marca-texto` | "Lida" |
  | falhou | tom `perigo` + "Não entregue: <motivo humano>" visível + botão "Tentar de novo" | texto visível |

  Máquina de estados (skill state-machine): `rascunho → enviando → enviada → entregue → lida`;
  `enviando → falhou → (tentar de novo) → enviando`. Impossível: "lida" sem "enviada"; "tentar de novo" em
  mensagem que não falhou.
- Evento de sistema (centralizado, `text-legenda`, `muted-foreground`, sem balão): "Ana transferiu para Bia ·
  14:32", "Resolvida por Ana · 15:10", "Número Vendas Centro reconectado · 16:02". É a trilha de auditoria
  visível para quem atende.
- Nota interna: tokens `--nota-interna-*`, borda tracejada, ícone `StickyNote` + rótulo "Nota interna · só a
  equipe vê".
- Mídia: imagem com `aspect-ratio` reservado (sem salto de layout), máx. 280 px, abre visualizador com zoom e
  "Baixar", `alt` = legenda ou "Foto enviada por Maria em 12/09"; áudio com `<audio controls>` nativo +
  "Ver transcrição"; documento como chip (ícone, nome, tamanho, "Baixar"); produto como card (foto 64 px
  `rounded-md`, nome, tamanho/cor, preço, saldo).
- Botão flutuante "Ir para a última" (`ArrowDown` + nº de novas) quando rolado mais de uma altura de tela.
- Carregar histórico ao rolar para cima preservando a posição (`overflow-anchor`).
- Leitor de tela: região `sr-only` `aria-live="polite"` que anuncia só "Nova mensagem de Maria: <primeiros 80
  caracteres>", em vez de `role="log"` lendo o balão inteiro.

### 12.4 Composer

- Anatomia: segmentado "Responder | Nota interna" · `textarea` com altura automática (1 a 8 linhas) · Anexar
  (`Paperclip`) · Produto (`ShoppingBag`) · Resposta rápida (`Zap`, também `/` no início) · **Enviar** (primário,
  com texto no desktop; ícone 44 px com `aria-label="Enviar"` no celular). Emoji: seletor nativo do sistema (YAGNI).
- Teclas: `Enter` envia, `Shift+Enter` quebra linha; no celular `Enter` quebra linha e só o botão envia; `/`
  abre respostas rápidas (listbox com ↑ ↓ `Enter` `Esc`).
- **Modo nota (anti-erro caro):** o composer inteiro muda para `--nota-interna-fundo`, placeholder "Escreva uma
  nota para a equipe (a cliente não vê)" e o botão vira "Salvar nota" em estilo neutro sólido. Cor, texto e
  botão diferentes: impossível mandar nota para a cliente sem perceber.
- Rascunho por conversa preservado ao trocar de conversa (`sessionStorage` com `try/catch`).
- Anexo: arrastar para o chat ou colar imagem; prévia com legenda antes de enviar; progresso determinado por
  arquivo com "Cancelar"; limite dito antes ("até 16 MB", conferir no provedor).
- Contador de caracteres a partir de 90% do limite do canal (desvio consciente da form-design, que manda
  mostrar sempre: em chat seria ruído permanente).
- **Composer bloqueado sempre explica o motivo e oferece saída** (nunca "Enviar" desabilitado mudo):

  | Situação | Tom | Mensagem e ação |
  |---|---|---|
  | Janela de 24h encerrada (WhatsApp oficial) | aviso | "Passaram 24h desde a última mensagem da cliente. Só dá para enviar um modelo aprovado." [Escolher modelo] |
  | Número desconectado / integração com erro | perigo | "O número Vendas Centro está desconectado desde 10:42. Mensagens não serão enviadas." [Reconectar] (admin) ou "Avise o administrador" |
  | Papel viewer | neutro | "Você tem acesso só de leitura nesta loja." (sem composer) |
  | Sem conexão | perigo | "Sem conexão. Não é possível enviar agora." (rascunho mantido) |

### 12.5 Painel do contato (CRM)

- Topo: nome, telefone formatado com botão "Copiar", e-mail, loja; "Editar" abre formulário (sem edição inline).
- Seções recolhíveis (várias abertas ao mesmo tempo, estado lembrado por usuário): **Pedidos** (status Masc em
  destaque, "Novo pedido") e **Etiquetas** abertas por padrão; Funil (etapa), Notas, Outras conversas (outros
  números da mesma loja), Consentimento e LGPD (exportar; excluir com block).
- Contato é isolado por loja: não existe UI de "mesclar" nem de "mesma pessoa na outra loja"
  (integracoes.md:95-99); a exclusão LGPD avisa que vale só para a loja atual (integracoes.md:350-352).

### 12.6 Tabelas (contatos, pedidos, produtos, trocas, campanhas)

- Toolbar: busca · filtros (chips/popover) · "128 pedidos" · ação primária à direita ("Novo pedido").
- Cabeçalho sticky `text-denso` 500 `muted-foreground`, ordenável com `aria-sort` + ícone.
- Texto à esquerda; número e moeda à direita com `tabular-nums`; data `12/09/2026 14:32`.
- No máximo 7 colunas visíveis (identificação, cliente, status, valor, data, responsável, ações).
- Linha abre pelo link no identificador (nada de `tr onClick`); menu de ações da linha **sempre visível**
  (`aria-label="Ações do pedido 1234"`), nunca só no hover.
- Seleção em massa: checkbox na 1ª coluna + barra contextual "3 selecionados · Etiquetar · Exportar"; ação em
  massa destrutiva passa pelo block.
- Paginação numérica com total e 25/50 por página (tabela); "Carregar mais" só em lista de chat.
- **Fila "Falta lançar no Masc":** vira filtro padrão da tela de Pedidos enquanto houver pendente, com contador
  na navegação. "Marcar como lançado" abre formulário (nº da venda no Masc obrigatório + observação) e confirma
  pelo block com resumo (cliente, valor, loja, nº Masc). "Dispensar" exige motivo.
- **Produtos (Bling, somente leitura):** sem criar/editar/excluir; faixa `info` "Produtos e estoque vêm do
  Bling (somente leitura). Leitura das 14:05."; saldo por loja com horário da leitura, em tom `aviso` quando
  velho (integracoes.md:432-436); grade tamanho × cor em matriz compacta.

### 12.7 Funil (kanban)

- Colunas de 280 px com contagem e soma em R$ no topo; card com nome, valor, próxima ação e dias na etapa
  (`aviso` acima do limite).
- Arrastar tem alternativa sem arrasto: "Mover para…" no menu do card, operável por teclado (WCAG 2.5.7).
- Rolagem horizontal com sombra na borda indicando mais colunas; no celular, uma coluna por vez com abas de etapa.

### 12.8 Configurações → Integrações (só admin)

- Lista, não formulário: uma linha por conta com rótulo, provedor (badge `aviso` "não oficial" no uazapi), loja
  (ou "Rede" no Bling), status, conta (4 últimos dígitos), validade do token, última sincronização e último
  erro **em texto**. Nunca o segredo.
- Ações: "Conectar conta" (primário da página); "Reconectar" (uazapi: dialog com QR, contagem até expirar e
  "Gerar novo QR"); "Desconectar" pelo block (integracoes.md:647-648).
- Aviso permanente do risco de banimento do uazapi (integracoes.md:477-488).

### 12.9 Contexto de loja (header)

- Vendedora e viewer: chip fixo `Store` + "Loja Centro", não interativo.
- Admin e gerente: select "Todas as lojas / Centro / Cerro Azul", persistido e validado no servidor. Trocar de
  loja com formulário alterado pede confirmação simples ("Descartar alterações?").

---

## 13. Formulários

| Tema | Regra |
|---|---|
| Layout | Coluna única; largura do campo proporcional ao conteúdo (CEP estreito, observação larga) |
| Rótulo | Sempre visível acima do campo (`text-denso` 500), sentence case; placeholder nunca substitui rótulo |
| Ajuda | `text-legenda` entre rótulo e campo ("Com DDD, ex.: (41) 99999-1234") |
| Obrigatório | Marcar o **opcional** ("(opcional)"), não asterisco no obrigatório |
| Validação | No `blur` e no envio, nunca a cada tecla; Zod no cliente para UX e **de novo no servidor** (fonte da verdade) |
| Erro de campo | Abaixo do campo, ícone + texto que diz como corrigir; `aria-invalid`, `aria-describedby` |
| Vários erros | Resumo no topo (≥ 2 erros), focável, com link para cada campo; foco vai para o resumo |
| Erro do servidor | Server action devolve `{ ok: false, erros: { campo: [...] }, valores }` (`useActionState`); o formulário **nunca é limpo** |
| Envio | Botão desabilitado + spinner + "Salvando…" enquanto pendente; impede duplo envio; largura do botão não muda |
| CTA | Verbo específico ("Salvar alterações", "Criar pedido", "Marcar como lançado"), nunca "OK"; primário à direita no desktop, largura cheia fixa embaixo no celular |
| Sair com alteração | `beforeunload` + confirmação na navegação interna quando o formulário está alterado |
| Padrão | Pré-preencher o mais comum (loja da sessão, responsável = eu); não pedir de novo o que o sistema já sabe (WCAG 3.3.7) |

Tipos de entrada (subir a escada: nativo antes de biblioteca):

| Dado | Controle | Detalhe |
|---|---|---|
| Telefone | `type="tel"`, `inputMode="tel"`, `autoComplete="tel"`, máscara `(00) 00000-0000` | Guardar canônico E.164; aceitar colado com +55 |
| CPF | texto com máscara + dígito verificador | `inputMode="numeric"` |
| Moeda | texto `inputMode="decimal"`, formata no `blur` | Guardar em centavos (inteiro) |
| Data | `<input type="date">` nativo | Sem datepicker de biblioteca |
| E-mail | `type="email"`, `autoComplete="email"` | — |
| 1 de ≤ 5 opções | radio visível | — |
| 1 de 6+ opções | select/combobox com busca | Transferir, etiqueta, produto |
| Texto longo | `textarea` com redimensionamento visível | Contador se houver limite |
| Código 2FA | `autoComplete="one-time-code"`, `inputMode="numeric"` | Colar habilitado |
| Senha | com "Mostrar/ocultar"; colar e gerenciador de senhas permitidos (WCAG 3.3.8) | Regras de auth na skill `audit-auth-security` |

**Conflito de edição (optimistic locking)** — a mensagem de UX da armadilha conhecida de `updated_at`:
faixa `perigo` no topo do formulário "Este registro foi alterado por Bia às 14:32. Suas alterações não foram
salvas; o que você digitou continua aqui." + [Ver versão atual] (abre a versão do servidor lado a lado ou em
nova aba, sem perder o digitado). Nunca sobrescrever em silêncio.

---

## 14. Ação crítica: `ModalConfirmacaoBlock`

### 14.1 Block ou desfazer?

A skill feedback-patterns prefere "desfazer" a "tem certeza?"; a base exige block em ação crítica. Regra que
concilia as duas:

| Tipo | Padrão | Exemplos neste sistema |
|---|---|---|
| Irreversível, visível para fora ou que mexe em dado de outra área | **Block 3s** | Excluir qualquer registro; exclusão LGPD; disparar campanha para N contatos; desconectar integração; marcar pedido como lançado/dispensado no Masc; trocar papel ou desativar usuário; ação em massa destrutiva |
| Reversível e interno | **Executa já + toast com "Desfazer" (5s)** | Resolver, arquivar, transferir, etiquetar, mudar prioridade, mover no funil |

"Desfazer" chama a ação inversa no servidor (não atrasa a gravação); as duas ficam na trilha de auditoria.

### 14.2 Especificação (skill component-spec)

Base: `espaco-flow\src\components\modal-confirmacao-block.tsx:34-110` (contagem por `Date.now()` em
`:48-62`, rótulo "Aguarde Ns" em `:100-104`). Ajustes para o novo:

| Item | Especificação |
|---|---|
| Anatomia | Título (verbo + objeto: "Excluir contato"), descrição, **resumo obrigatório** com dados concretos (nome, loja, quantidade, valor, nº Masc), aviso de consequência ("fica registrado na auditoria"), Cancelar + Confirmar |
| Props | `aberto`, `titulo`, `resumo` (obrigatório), `descricao?`, `textoConfirmar`, `variante: 'padrao' \| 'destrutiva'`, `carregando`, `erro?`, `onConfirmar`, `onCancelar` (o tempo fixo de 3s não vira prop configurável por tela) |
| Estados | `fechado → bloqueado (3s) → liberado → processando → fechado` (sucesso) ou `→ liberado + erro inline` (falha, não fecha) |
| Durante o bloqueio | Esc, clique fora e botão fechar inertes; botões com `aria-disabled="true"` (focáveis) e guarda no handler — **não** `disabled`, que tira o foco do teclado; rótulo "Aguarde 3s"; barra linear de 3s (`aria-hidden`, some com reduced motion) |
| Foco | Preso no modal; foco inicial em "Cancelar"; ao fechar, volta ao gatilho |
| Leitor de tela | `role="alertdialog"`, `aria-labelledby` (título), `aria-describedby` (resumo); ao liberar, anúncio único "Confirmação liberada" |
| Processando | Tudo travado de novo; "Excluindo…"; sem fechar |
| Erro | Mensagem inline no modal (seção 15.3), botões liberados, dados do resumo preservados |
| Visual | `rounded-xl`, `shadow-2`, largura 440 px (celular: largura cheia, botões empilhados, Confirmar embaixo); destrutiva usa `--destructive` só no botão |
| Teste | Timers falsos: não confirma antes de 3s; Esc/clique fora não fecham; confirma depois; erro mantém aberto |
| Primitivo | A API de bloquear Esc/clique fora muda entre Radix e Base UI (seção 2, item 23): o teste acima é o contrato |

---

## 15. Estados de carregamento, vazio, erro e permissão

Obrigatórios em todo componente que carrega ou envia dado (`docs/components.md:83-92`), mais três que o
domínio pede: sem permissão, dado desatualizado e desconectado.

### 15.1 Carregando

| Duração esperada | Padrão |
|---|---|
| < 100 ms | Nada |
| 100 ms – 1 s | Skeleton (tela/painel) ou estado pendente no botão |
| 1 – 10 s | Spinner + o que está acontecendo ("Carregando histórico…") |
| > 10 s ou fila | Progresso determinado ou etapas; dá para sair da tela; avisa ao terminar (exportação LGPD, upload grande, campanha) |

- `loading.tsx` por rota com skeleton que **espelha o layout real** (8 linhas de conversa, 6 balões alternados,
  cabeçalho de tabela + 10 linhas); sem salto de layout ao trocar.
- `Suspense` por painel: lista, chat e painel do contato carregam independentes; nunca tela em branco.
- Um indicador por região (nunca spinner global + skeleton ao mesmo tempo).
- Otimista: enviar mensagem, marcar como lida, etiqueta, mover no funil — com rollback visível (balão falhou,
  card volta + toast). **Não otimista:** pedido/Masc, LGPD, desconectar, papel (esperam o servidor).

### 15.2 Vazio

| Situação | Mensagem | Ação |
|---|---|---|
| "Minhas" sem conversa | "Nenhuma conversa com você agora." | [Ver sem responsável] |
| Filtro sem resultado | "Nenhuma conversa com esses filtros." | [Limpar filtros] |
| Loja sem número conectado (admin) | "Nenhum número conectado nesta loja." | [Conectar número] |
| Loja sem número conectado (vendedora) | "Esta loja ainda não tem número conectado. Fale com o administrador." | — |
| Fila Masc zerada | "Todos os pedidos foram lançados no Masc." | — |
| Contato sem pedido | "Nenhum pedido deste contato." | [Novo pedido] |
| Busca sem resultado | ver seção 18 | — |

Vazio sempre diz o que aconteceu e qual o próximo passo; nada de ilustração grande em tela de operação.

### 15.3 Erro

Formato (skill error-handling-ux): **o que aconteceu + por quê (se ajudar) + o que fazer**. Nunca culpar a
pessoa, nunca código cru; `digest` do Next só como "Código para o suporte: ab12".

| Contexto | Onde aparece | Exemplo |
|---|---|---|
| Campo | Abaixo do campo | "Informe o telefone com DDD, ex.: (41) 99999-1234." |
| Formulário | Resumo no topo | "Corrija 2 campos para salvar." |
| Ação em segundo plano | Toast persistente com ação | "Não foi possível resolver a conversa. [Tentar de novo]" |
| Rede | Faixa no topo, persistente | "Sem conexão com o servidor. Tentando reconectar…" |
| Tempo real caiu | Faixa discreta | "Atualização automática pausada. [Recarregar]" |
| Página | `error.tsx` com "Tentar de novo" e "Voltar para Conversas" | "Não foi possível abrir esta página." |
| Envio de mensagem | Na própria bolha | "Não entregue: o WhatsApp recusou (número sem WhatsApp). [Tentar de novo]" |
| Upload | No card do anexo | "O arquivo tem 22 MB; o limite do WhatsApp é 16 MB." |
| Conflito de edição | Faixa no formulário | seção 13 |
| Sessão expirada | Tela de login com retorno | "Sua sessão expirou por segurança. Entre de novo; o rascunho foi guardado." |

Recuperação: preservar o que foi digitado, oferecer "Tentar de novo" em falha transitória, retry automático com
backoff só em leitura (nunca em envio de mensagem, que pode duplicar para a cliente).

### 15.4 Sem permissão, não encontrado, desatualizado

- 403: "Você não tem acesso a esta área. Fale com o administrador." — a página nunca renderiza o conteúdo
  por baixo; o item nem aparece na navegação do papel (a checagem de verdade é no servidor).
- Conversa/pedido de outra loja: mesma tela de "não encontrado" (não confirmar que existe).
- Dado lido de fora (Bling): sempre com horário da leitura; acima do limite, tom `aviso` "Leitura antiga".

---

## 16. Feedback e notificações

Hierarquia (skill feedback-patterns): inline no elemento > no componente > toast > faixa/sistema.

| Tipo | Padrão | Duração |
|---|---|---|
| Imediato | Botão muda de estado no clique (< 100 ms); toggle/checkbox reagem na hora | — |
| Sucesso de ação sem efeito visível | Toast `sonner` (`package.json:59`) | 4 s; com "Desfazer" quando couber |
| Sucesso já visível na tela | **Sem toast** (mensagem enviada já mostra o check) | — |
| Erro | Toast persistente até fechar, ou inline | Até resolver |
| Status contínuo | Badge/faixa enquanto durar (número desconectado, campanha enviando 34/120) | Enquanto relevante |
| Não lidas | Contador na navegação (Conversas: não lidas minhas; Pedidos: falta lançar) + título da aba "(3) Conversas · Merlo Store" | — |
| Som | Nova conversa atribuída a mim: ligado por padrão; mensagem na conversa aberta: desligado; configurável em "Meu perfil" | — |
| Notificação do navegador | Só com opt-in explícito em "Meu perfil" | — |
| Digitando | Só se o provedor informar; nunca simulado | — |

- Toasts: no máximo 3 visíveis; canto inferior direito no desktop; topo central no celular (não cobre o
  composer); sucesso com `role="status"`, erro com `role="alert"` (conferir o que o `sonner` já emite).
- Intensidade proporcional: resolver conversa = toast curto; campanha disparada = faixa com progresso.

---

## 17. Navegação

**Arquitetura (rótulos PT-BR, rotas em PT-BR para manter o "tudo em português"):**

| Grupo | Itens (rota sugerida) | Quem vê |
|---|---|---|
| Atendimento | Conversas `/conversas` · Contatos `/contatos` · Funil `/funil` | todos |
| Vendas | Pedidos `/pedidos` · Trocas e devoluções `/trocas` · Produtos `/produtos` | todos |
| Comunicação | Campanhas `/campanhas` · Modelos `/modelos` · Respostas rápidas `/respostas-rapidas` · Galeria `/galeria` | conforme RBAC |
| Gestão | Relatórios `/relatorios` · Alertas `/alertas` · Base de conhecimento `/base-de-conhecimento` | conforme RBAC |
| Rodapé | Configurações `/configuracoes` (só admin) · Meu perfil `/perfil` (inclui `/perfil/seguranca`) | — |

- Desktop: sidebar colapsável (trilho 56 px ↔ 232 px, preferência lembrada); grupos com rótulo `text-legenda`
  500 sentence case; no máximo 7 itens de topo visíveis por papel.
- Item ativo: `--accent` + barra 3 px + peso 500 → 600 + `aria-current="page"` (não só cor). Badge de contagem
  no item (Conversas, Pedidos).
- Celular: tab bar inferior com 4 destinos (Conversas, Contatos, Pedidos, Mais); "Mais" abre Sheet com o resto;
  a tab bar some com o chat aberto e volta com "Voltar".
- Header (56 px): contexto de loja (12.9) · filtro de número (na tela de Conversas) · busca global ·
  Alertas · menu do usuário (tema, preferências, sair). Utilidades à direita, sem competir com a navegação.
- Breadcrumb só em Configurações com profundidade (Lojas › Centro › Integrações).
- Todo objeto tem URL (`/conversas/[id]`, `/pedidos/[id]`) para notificação, auditoria e "abrir em nova aba".
- Atalhos (WCAG 2.1.4: tecla única só age com foco no componente):

  | Atalho | Ação | Escopo |
  |---|---|---|
  | `Ctrl/Cmd + K` | Busca global / comandos | Global |
  | `↑` `↓` | Conversa anterior/próxima | Foco na lista |
  | `Enter` | Abrir conversa | Foco na lista |
  | `Esc` | Fechar painel/menu; do chat volta o foco à lista | Global |
  | `/` | Respostas rápidas | Composer vazio |
  | `?` | Lista de atalhos | Fora de campo de texto |

---

## 18. Busca

**Busca global (`Ctrl/Cmd + K`, `cmdk` já dependência em `package.json:43`):**
- Resultados agrupados, até 5 por grupo + "Ver todos": Contatos (nome, telefone formatado, loja), Conversas
  (trecho com o termo em `<mark>`), Pedidos (nº, nº Masc), Produtos (nome, SKU, saldo), Páginas ("Integrações",
  "Respostas rápidas" — busca como navegação).
- Escopo sempre visível: "Buscando em: Centro". Vendedora nunca vê resultado de outra loja; gestão pode
  "Buscar em todas as lojas".
- A partir de 2 caracteres, debounce de 250 ms, requisição anterior cancelada (`AbortController`), resultado
  fora de ordem descartado; navegação por teclado; `Enter` abre o primeiro.
- Tolerância (no servidor): telefone normalizado ("99999-1234", "+55 41 9…" e só dígitos acham o mesmo contato);
  nome sem acento e sem caixa ("joao" acha "João" — `unaccent` + `ILIKE`/`pg_trgm` no Postgres).

**Busca da lista/tabela:** filtra no lugar, fica na URL, botão limpar, contagem "12 conversas".

**Zero resultado:** "Nenhum resultado para "joao silva" em Centro." + dicas: conferir a grafia, buscar pelo
telefone, [Limpar filtros], e [Buscar em todas as lojas] só para gestão. Nunca página em branco.

**Produto no composer:** foto, nome, tamanho/cor, preço, saldo da loja com horário da leitura; produto sem
saldo continua selecionável com aviso "Sem saldo no Bling às 14:05".

Adiado (YAGNI): buscas recentes, sugestões por popularidade, analytics de busca sem resultado.

---

## 19. Acessibilidade AA (WCAG 2.2)

| Critério | Exigência neste sistema | Como verificar |
|---|---|---|
| 1.1.1 | `alt` em mídia ("Foto enviada por Maria em 12/09"); avatar decorativo `alt=""`; ícone decorativo `aria-hidden` | axe + inspeção |
| 1.3.1 | Landmarks `header/nav/main/aside`; lista de conversas em `ul/li`; tabela com `th scope`; um `h1` por página ("Conversas" pode ser `sr-only`) | Árvore de acessibilidade |
| 1.3.5 | `autoComplete` em nome, telefone, e-mail, CEP, código 2FA | Inspeção dos formulários |
| 1.4.1 | Nenhum estado só por cor (seção 4.6) | Captura em escala de cinza |
| 1.4.3 | Texto ≥ 4,5:1 com os pares da seção 4 | Teste de tokens (seção 11) |
| 1.4.4 / 1.4.10 | Zoom 200% sem perda; reflow a 320 px CSS | Navegador a 200% e 320 px |
| 1.4.11 | Borda de campo, anel de foco, ícone informativo, limite de botão ≥ 3:1 | Teste de tokens |
| 1.4.12 | Aguenta espaçamento de texto aumentado sem cortar | Bookmarklet de text spacing |
| 2.1.1 / 2.1.2 | Todo o fluxo de Conversas por teclado; sem armadilha de foco fora de modal | Passada só de teclado |
| 2.1.4 | Atalho de tecla única só com foco no componente | Seção 17 |
| 2.2.1 | Aviso antes de a sessão expirar com "Continuar conectado" (o block de 3s é atraso, não limite) | Teste manual |
| 2.4.1 | Skip link "Ir para o conteúdo principal" | Tab na carga |
| 2.4.3 | Ordem de foco = ordem visual (lista → chat → composer → painel) | Passada de teclado |
| 2.4.7 / 2.4.11 | Foco visível (`outline` 2 px `--ring`, offset 2 px) e nunca escondido por header, composer ou toast (`scroll-margin`) | Passada de teclado com sticky |
| 2.5.7 | Funil com alternativa sem arrastar | Seção 12.7 |
| 2.5.8 | Alvo ≥ 24 × 24 (44 × 44 no toque) | Medição |
| 3.2.6 | Ajuda sempre no mesmo lugar (menu do usuário) | Revisão |
| 3.3.1 / 3.3.3 | Erro identificado em texto com sugestão de correção | Seção 13 |
| 3.3.7 | Não pedir de novo dado já informado no fluxo | Revisão de fluxo |
| 3.3.8 | Login sem teste cognitivo; colar senha e gerenciador permitidos; passkey | `audit-auth-security` |
| 4.1.2 | Nome, papel e valor em todo controle custom (combobox, segmentado, switch, accordion) | axe + NVDA |
| 4.1.3 | `aria-live` para toast, "3 conversas atualizadas", nova mensagem, liberação do block, "Carregando conversas" | NVDA |
| Extra | `forced-colors: active`: foco e seleção visíveis (outline, não box-shadow); `prefers-reduced-motion` global | Emulação no DevTools |

Ferramentas: axe no teste de componente (ex.: `vitest-axe`, dependência nova a decidir) + passada manual de
teclado + NVDA (a equipe usa Windows) nas telas-alvo da seção 22.

---

## 20. Tema claro e escuro

- `next-themes` com `attribute="class"`, padrão **`system`**, alternância em "Meu perfil → Preferências" e no
  menu do usuário; `suppressHydrationWarning` no `<html>` para não piscar.
- Escuro não é inversão: superfícies sobem de `#09090B` (canvas) → `#18181B` (card) → `#27272A` (popover); texto
  `#F4F4F5` (não branco puro); primário mais claro e menos saturado (`#A78BFA` com texto escuro); bordas
  `#3F3F46`.
- Todo componente e toda tela-alvo verificados nos dois temas (critério de pronto, seção 22).
- Logo: precisa da versão negativa para o escuro (hoje falta, `LEIA-ME.md:10`).
- Troca de tema sem animação.

---

## 21. Voz, mood e glossário

**Mood (referência para `critique-brand-consistency`):** loja de moda — elegante, calma, eficiente. Neutros
limpos, violeta como assinatura pontual, fotos de produto como protagonistas, nenhum enfeite (gradiente,
vidro, sombra "premium") em tela de trabalho.

**Voz:**
- Trata por "você"; frases curtas e diretas; verbo no botão.
- Sem jargão técnico na tela da vendedora: nada de "webhook", "sync", "status 403", "payload", "token"
  (admin vê "credencial" só em Configurações).
- Sem caixa alta, sem exclamação em erro, sem culpar ("Não foi possível…", não "Você errou…").
- Datas e números no padrão brasileiro (seção 5). "Cliente" como termo neutro.
- Todo texto de UI com acento correto.

**Glossário (um termo por conceito, igual em tela, doc e código de domínio):**

| Use | Não use |
|---|---|
| Conversa | ticket, chat, atendimento (como objeto) |
| Contato | lead, cliente (como objeto de cadastro) |
| Loja (Centro, Cerro Azul) | store, unidade |
| Número / conta conectada ("Vendas Centro") | instância, integração (na tela da vendedora) |
| Responsável | agente, atendente atribuído |
| Transferir · Resolver · Arquivar | assign, close |
| Nota interna | comentário privado |
| Resposta rápida | quick reply, atalho |
| Modelo (de mensagem) | template |
| Campanha | broadcast, disparo |
| Funil · Etapa | pipeline, stage |
| Pedido · Lançar no Masc | order, integrar |
| Trocas e devoluções | returns |
| Etiqueta | tag |
| Relatórios | analytics, dashboard |
| Vendedora/vendedor · Gerente · Administrador · Somente leitura | agent, admin, viewer (na tela) |

---

## 22. Checklist de crítica visual (fase de verificação)

### 22.1 Método

**Telas-alvo mínimas:** login (+ 2FA); Conversas com lista + chat + painel; chat com nota interna, falha de
envio, mídia e evento de sistema; composer nos 4 bloqueios (12.4); Contatos (tabela); Pedidos com fila do Masc;
Produtos (Bling); Funil; Configurações → Integrações com número desconectado; modal block (bloqueado e
liberado); e, para cada tela, os estados carregando, vazio, erro e sem permissão.

**Matriz de captura:**

| Viewport | Tema | Extra |
|---|---|---|
| 1440 × 900 | claro e escuro | — |
| 1280 × 800 | claro | zoom 200% |
| 1024 × 768 | claro | painel como Sheet |
| 390 × 844 | claro e escuro | `pointer: coarse` |
| 320 px de largura | claro | reflow |
| 1440 × 900 | claro | `forced-colors`, `prefers-reduced-motion`, rede lenta |

**Formato do relatório (skills critique-*):** por tela, uma tabela com as dimensões (Hierarquia, Marca,
Composição, Tipografia, Cor, Affordance, Densidade + Estados, Movimento, A11y, Domínio), cada uma com
Observação → Problema → Correção e nota `pass` / `minor issue` / `major issue`. Depois, lista única priorizada
(Issue · Dimensão · Correção · `caminho:linha`):
- **P1 crítico:** quebra uso, acessibilidade ou regra da marca/base — bloqueia entrega.
- **P2 importante:** degrada a experiência ou gera inconsistência — corrigir na sprint.
- **P3 polimento:** refinamento visual — quando houver folga.

Fechar com um parágrafo: dimensão mais forte, mais fraca e o maior risco funcional.

### 22.2 Itens (severidade padrão entre colchetes)

**Hierarquia (H)**
- H1 [P1] No "teste do olho semicerrado", o que mais salta depois da seleção são os estados críticos (SLA estourado, falha de envio, número desconectado, falta lançar no Masc).
- H2 [P2] Um único botão sólido por região (Conversas: "Enviar").
- H3 [P2] Ponto de entrada de Conversas é a lista/conversa selecionada, não o header.
- H4 [P3] Diferença entre níveis de título ≥ 1,25× e no máximo 3 pesos na tela.

**Marca e tokens (B)**
- B1 [P1] Nenhum hex/`rgb`/`oklch`, classe de paleta crua ou valor arbitrário `[..]` em TSX (grep).
- B2 [P2] Violeta ≤ ~10% da área e só em ação, seleção, foco, contador e balão da casa.
- B3 [P2] Nome da marca, logos (claro e escuro), favicon e título da aba corretos.
- B4 [P2] Microcopy segue voz e glossário (seção 21): sem inglês, jargão ou caixa alta.
- B5 [P3] Raio conforme a tabela (pessoa redonda, coisa quadrada) e sombras só `shadow-1`/`shadow-2`.

**Composição (C)**
- C1 [P2] Espaçamento só da escala (grep de `p-[`, `gap-[`, `m-[`).
- C2 [P3] Proximidade: rótulo↔campo < campo↔campo < seção; título mais perto do conteúdo que da seção anterior.
- C3 [P3] Colunas de lista e tabela alinhadas; números à direita.
- C4 [P3] Sem divisor redundante (borda + sombra + fundo no mesmo limite) e sem "penhasco" de densidade a 1280 px.

**Tipografia (T)**
- T1 [P1] Nenhum texto < 12 px (exceção: contador 11 px/600).
- T2 [P2] Só os 7 tokens de texto (grep de `text-[`).
- T3 [P2] Mensagem 14/22 no desktop e 16/24 no celular; input 16 px no celular.
- T4 [P2] Truncamento com texto completo acessível; valor, status e nº de pedido nunca truncados.
- T5 [P3] Hora, contador e valores com `tabular-nums`.

**Cor (K)**
- K1 [P1] Todo par texto/fundo presente na tabela da seção 4 (teste de tokens verde); nenhuma cor fora dela.
- K2 [P1] Borda de campo, anel de foco e ícone informativo ≥ 3:1 nos dois temas.
- K3 [P1] Nenhum estado só por cor: não lida, selecionada, status, erro, SLA, lida × entregue.
- K4 [P1] Todas as telas-alvo conferidas em claro e escuro; foto de produto sem filtro.
- K5 [P2] Estado de negócio → tom igual ao mapa 4.5 em lista, tabela e detalhe.
- K6 [P2] Em `forced-colors`, foco e item selecionado continuam visíveis.

**Affordance (A)**
- A1 [P1] Tudo que é clicável é `<a>` ou `<button>` (sem `div`/`tr onClick`).
- A2 [P1] Ações de linha visíveis sem hover (toque).
- A3 [P1] Ação indisponível mostra o motivo; nenhum botão mudo (inclui composer bloqueado).
- A4 [P1] Destrutivo separado visualmente e passando pelo block; reversível com "Desfazer".
- A5 [P1] Alvo ≥ 24 px no desktop e ≥ 44 px com `pointer: coarse`.
- A6 [P2] Hover, `focus-visible`, ativo, desabilitado e selecionado distintos em botão, linha, item de nav e chip.
- A7 [P2] CTA com verbo específico; vazio sempre com próxima ação.

**Densidade (D)**
- D1 [P1] Nada crítico escondido em tooltip (motivo da falha, erro de integração, SLA).
- D2 [P1] Conversas funcional a 390 px: lista → chat → painel sem rolagem horizontal.
- D3 [P2] A 1440 × 900 a lista mostra ≥ 10 conversas legíveis.
- D4 [P2] Tabela com ≤ 7 colunas; celular com 3 campos-chave em card.
- D5 [P3] Painel do contato com seções recolhíveis e só Pedidos e Etiquetas abertas por padrão.

**Estados (E)**
- E1 [P1] Carregando, vazio, erro e sem permissão implementados e capturados em cada tela-alvo.
- E2 [P1] Erro diz o que houve e o que fazer, e preserva o digitado.
- E3 [P1] Conflito de edição (optimistic locking) mostra quem/quando e não perde o digitado.
- E4 [P2] Skeleton espelha o layout real (sem salto ao carregar).
- E5 [P2] Dado do Bling mostra horário da leitura e aviso quando antigo.

**Movimento (M)**
- M1 [P2] `prefers-reduced-motion` zera animações, exceto spinner.
- M2 [P2] Lista de conversas não reordena sob o ponteiro/foco (pílula "N conversas atualizadas").
- M3 [P3] Sem transição de rota, spring ou hover que desloca; durações só dos tokens.

**Acessibilidade (X)**
- X1 [P1] Fluxo completo de Conversas só com teclado: navegar lista, abrir, escrever, enviar, transferir, resolver.
- X2 [P1] Foco nunca escondido por header, composer ou toast.
- X3 [P1] axe sem violação `serious`/`critical`.
- X4 [P1] Modal block: foco preso, Esc/clique fora inertes por 3s, foco inicial em Cancelar, anúncio de liberação.
- X5 [P1] Formulários com rótulo, `aria-invalid`, `aria-describedby` e `autoComplete`.
- X6 [P1] Funil operável sem arrastar.
- X7 [P2] NVDA anuncia nova mensagem, contagem de atualizadas, toasts e carregamento.
- X8 [P2] Zoom 200% e reflow a 320 px sem perda.

**Domínio (N)**
- N1 [P1] Loja ativa sempre visível; gestão vê a loja em cada linha quando em "Todas as lojas".
- N2 [P1] Número de entrada visível no cabeçalho da conversa e na lista quando a loja tem > 1 número.
- N3 [P1] Nota interna impossível de confundir com resposta (cor + rótulo + botão diferente).
- N4 [P1] Composer bloqueado explica o motivo (24h, desconectado, só leitura, sem conexão).
- N5 [P1] Produtos/estoque do Bling sem nenhum controle de escrita.
- N6 [P2] Pedido "falta lançar no Masc" com destaque e contador na navegação.
- N7 [P2] Nome do vendedor em cada sequência de mensagens de saída.
- N8 [P3] Transferência, resolução e reconexão aparecem como evento na linha do tempo.

---

## 23. Decisões em aberto para os arquitetos

| # | Decisão | Opções | Recomendação deste levantamento |
|---|---|---|---|
| 1 | Tema padrão | `dark` (base, `components.md:105`) × `system` | `system` (loja iluminada); registrar o desvio |
| 2 | Primitivo do shadcn | Radix × Base UI (`base-nova` atual) | Decidir em ADR antes do modal block; o teste de 14.2 é o contrato |
| 3 | Nome e ativos da marca | "Merlo Store" (`marca.json`) × "Merlos Store" (código atual) | Confirmar com o cliente; pedir logos negativo, tinta e ícone |
| 4 | Responder conversa resolvida | reabre automático × pergunta | Reabre, com aviso inline "Enviar reabre a conversa" |
| 5 | Responder conversa sem responsável | atribui a quem respondeu × mantém | Atribui, com aviso inline "Ao responder, a conversa fica com você" |
| 6 | Duas vendedoras na mesma conversa | nada × aviso de presença ("Ana está respondendo") | Presença simples se o tempo real já existir; senão, só o nome do responsável |
| 7 | Limiar de "SLA perto do limite" | fixo × configurável por admin | Configurável em Configurações → SLA |
| 8 | Formato do nº da venda no Masc | livre × regex | Regex assim que o cliente mostrar um número real |
| 9 | Som de nova conversa | ligado × desligado por padrão | Ligado só para conversa atribuída a mim |
| 10 | Teste de acessibilidade automatizado | `vitest-axe` (dependência nova) × só manual | Adicionar: um teste por tela-alvo |
| 11 | Onde moram tokens/voz/mood no repo | seção de `docs/front.md` × arquivo novo | Seção de `docs/front.md` (a base proíbe doc novo sem pedido) |
