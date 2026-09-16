# 05 — UI e design do sistema antigo (MerlostoreChat @ 5e902d4)

> Levantamento **read-only** para quem vai redesenhar a interface sem ter lido o código antigo.
> Repo: `C:\Users\Paulo\Documents\MerlostoreChat` (branch `refactor/reconstrucao-estrutura-base`, HEAD `5e902d4`).
> Caminhos relativos à raiz do repo. `arquivo:linha` aponta o trecho exato.
> O código antigo é **referência de domínio e de UX**, não de implementação.

---

## 0. Resumo executivo

1. **23 telas** (2 públicas + 21 logadas), **todas client components com `useEffect + fetch`** exceto `/settings` (server) e `/broadcasts/new` (stub). Não existe `loading.tsx`, `error.tsx` nem `not-found.tsx`.
2. **Três telas são falsas ou quase falsas**: SLA e LGPD guardam estado só em `useState` e o "Salvar" apenas dispara um toast; `/broadcasts/new` é um título sem conteúdo. A busca global do Header, "Meu Perfil" e "Esqueci a senha" não fazem nada.
3. **Bugs visíveis ao usuário**: o filtro "Todos" em Contatos, Produtos e na segmentação de Campanha manda o literal `"all"` para a API, que filtra por ele e **devolve lista vazia**. Editar um produto **zera o estoque**. Nove ações mostram **toast de sucesso sem checar a resposta**, então o viewer recebe 403 e vê "sucesso".
4. **Fluxos que travam**: um template nunca chega a "aprovado" pela UI, e campanha exige template aprovado. Troca/devolução não tem botão para sair de "Enviando". O "Verificar Agora" dos alertas chama uma rota de cron protegida por `CRON_SECRET` e falha em silêncio.
5. **Base visual inconsistente**: shadcn estilo `base-nova` (feito para Tailwind v4, sobre `@base-ui/react`, não Radix) rodando em **Tailwind 3.4**. Utilitários como `focus-visible:ring-3`, `data-open:animate-in` e `rounded-4xl` **não são gerados** (0 ocorrências no CSS compilado em `.next/static/css`), então **não há anel de foco** em Button, Input e Badge.
6. **Dois sistemas de cor convivem**: tokens (`text-muted-foreground`, 156 usos) e cores cravadas (`neutral-*` 275, `bg-white` 54, hex `#141414`/`#fafaf8`). O modo escuro depende de overrides `!important` em `globals.css`.
7. **Identidade visual**: a marca é **monocromática** (logo "merlos | STORE" preto/branco, UI em neutros quentes). Os tokens da skill `how-to-use-guide` (`--marca #7C3AED`, roxo) **não aparecem em lugar nenhum do app** e parecem placeholder de template. O nome oscila entre **"Merlos Store"** (app, logo) e **"Merlo Store"** (skill, docs).
8. **Logo quase ilegível**: os PNGs têm 1080×1350 px com ~75% de área vazia. Na sidebar (`size="sm"`, 90×36) o wordmark ocupa **≈22×9 px**. Não há SVG nem ícone, e o favicon é o padrão do create-next-app.
9. **Acessibilidade**:
   - 10 botões aninhados dentro de Triggers.
   - A lista de conversas (o fluxo principal) é `div onClick`, sem teclado.
   - O pipeline só funciona por drag-and-drop.
   - Labels sem `htmlFor` em todos os formulários de CRUD.
   - Contraste abaixo de AA em timestamps e micro-textos (48 usos de `text-[10px]`/`text-[11px]`).
   - Nenhum respeito a `prefers-reduced-motion`.
10. **Consistência**: 9 exclusões usam `window.confirm` nativo, e só 4 fluxos usam o `ModalConfirmacaoBlock` exigido pela base. Dinheiro é formatado de dois jeitos (`R$ 12.50` e `R$ 12,50`). Datas só aparecem relativas. Termos em inglês (Inbox, Pipeline, Deal, Broadcast, status crus) se misturam ao português.
11. **Vale preservar**: a UX do chat (bolha otimista, texto devolvido em falha, "Tentar de novo", rolagem que respeita a leitura, separador de dia, atalhos "/" por teclado), a venda dentro da conversa com "disponível = saldo Bling − reservado", o `ModalConfirmacaoBlock`, os avisos explicativos em PT-BR (uazapi, depósito do Bling, estoque não ao vivo) e o índice de Configurações filtrado por papel.

---

## 1. Método e limites

- Leitura estática de todos os arquivos de `src/app/(auth)`, `src/app/(dashboard)`, `src/components/**`, `src/app/layout.tsx`, `src/app/globals.css`, `tailwind.config.ts`, `components.json`, `src/middleware.ts`, `src/lib/rbac.ts`, `src/lib/loja.ts`, `docs/front.md`, `docs/components.md`, `docs/rbac.md`, trechos de `docs/integracoes.md` e das rotas de API citadas, e dos ativos da skill `.claude/skills/how-to-use-guide/` (`assets/marca/*`, `references/design-system.md`, `references/marca.md`).
- Os três PNGs de `public/` foram abertos como imagem.
- **Não** rodei a aplicação nem capturei telas. O CSS compilado em `.next/static/css/16479011ca1bcace.css` pode estar desatualizado. Mesmo assim, é evidência forte de que as classes v4 não viram CSS (ver F1).
- Os contrastes foram **calculados** a partir dos hex da paleta padrão do Tailwind v3 (fórmula WCAG), não medidos na tela renderizada. Estão marcados com "≈".
- "Quem pode" nas telas foi **derivado** do RBAC de API (`src/lib/rbac.ts`). As páginas em si **não têm RBAC**: `src/middleware.ts:62-64` só checa papel em `/api/**`.

---

## 2. Stack de UI atual (referência, não alvo)

| Item | Atual | Observação para o alvo |
|---|---|---|
| Framework | Next 14.2.35, React 18 | alvo Next 16.3 / React 19 |
| CSS | Tailwind **3.4.1** + `tw-animate-css` 1.4 (pacote pensado para v4) | alvo Tailwind v4: resolve F1 |
| Componentes | shadcn CLI 4, `style: "base-nova"`, `baseColor: neutral`, `iconLibrary: lucide` (`components.json`) | primitivos de **`@base-ui/react` 1.3**, não Radix |
| Ícones | `lucide-react` ^1.0.1 | `strokeWidth={1.8}` no layout, padrão (2) no resto |
| Animação | `framer-motion` 12 (6 arquivos) | sem reduced-motion |
| Gráficos | `recharts` 3 (só `analytics/page.tsx`) | cores cravadas |
| Toast | `sonner` 2 via `src/components/ui/sonner.tsx` | tema lido de `next-themes` sem provider (F3) |
| Datas | `date-fns` 4 + `ptBR` | quase tudo relativo |
| Formulários | `useState` à mão em todas as telas | `react-hook-form` e `@hookform/resolvers` **instalados e nunca usados** |
| Tema | `ThemeProvider` próprio em `src/components/providers.tsx` | `next-themes` instalado, usado só no Toaster |
| Fonte | Inter via `next/font/google` (`src/app/layout.tsx:8`) | `src/app/fonts/GeistVF.woff` e `GeistMonoVF.woff` sobram sem uso |
| Sessão no cliente | `SessionProvider` do NextAuth v4 | some com Better Auth |

---

## 3. Estrutura de rotas e layouts

### 3.1 Árvore

```
src/app/
  layout.tsx                 RootLayout: <html lang="pt-BR">, Inter (--font-sans), Providers, <Toaster/>
  page.tsx                   redirect("/inbox")  (o middleware já resolve "/" antes)
  (auth)/layout.tsx          split-screen: marca à esquerda (lg+), formulário à direita
  (auth)/login/page.tsx
  (auth)/register/page.tsx
  (dashboard)/layout.tsx     skip-link + Sidebar (lg+) + Header + <main> com transição de página
  (dashboard)/inbox/page.tsx (+ _components/painel-venda.tsx)
  (dashboard)/contacts | pipeline | orders | products | returns
  (dashboard)/gallery (+ gallery/lookbooks)
  (dashboard)/broadcasts (+ broadcasts/new)  | templates | quick-replies
  (dashboard)/knowledge-base | analytics | alerts
  (dashboard)/settings (+ lojas | integracoes (+ _components/conectar-conta.tsx) | team | sla | lgpd)
```

### 3.2 Root layout — `src/app/layout.tsx`

- `metadata.title = "Merlos Store — Atendimento"` e `description = "Plataforma Unificada de Atendimento + CRM com IA"` (`layout.tsx:10-13`). A descrição promete IA, que foi tirada do escopo em 18/08/2026 (`ChatWindow.tsx:389-400`).
- Não declara `icons`, `manifest` nem `themeColor`. `src/app/favicon.ico` tem 25.931 bytes, o tamanho do favicon padrão do create-next-app.

### 3.3 Layout de autenticação — `src/app/(auth)/layout.tsx`

- Coluna esquerda `hidden lg:flex lg:w-1/2 bg-[#141414]` com dois círculos desfocados decorativos, `logo-light.png` 180×72, o título "Plataforma Unificada de Atendimento" (`text-2xl font-light text-white/90`), o subtítulo "Conversas, clientes e pedidos das duas lojas num lugar só." (`text-neutral-500`) e três "dots" decorativos (`:11-49`).
- Coluna direita com `bg-[#fafaf8]` e formulário de `max-w-[400px]`, com entrada animada por framer-motion (`:52-62`).
- É `"use client"` só por causa da animação.

### 3.4 Layout logado — `src/app/(dashboard)/layout.tsx`

- Skip-link "Ir para o conteúdo principal" apontando para `#main-content` (`:15-20`). Boa prática, deve continuar.
- O contêiner usa `flex h-screen overflow-hidden bg-[#fafaf8] dark:bg-[#0a0a0a]` com cores cravadas (`:21`).
- O `<main>` envolve cada página em `AnimatePresence mode="wait"` com `key={pathname}` (`:25-36`). Toda navegação espera 250 ms de saída antes de entrar.
- O padding da página é `p-4 lg:p-6`. A Inbox desfaz isso com margens negativas (E6).

### 3.5 Middleware (fronteira atual)

- `src/middleware.ts` redireciona para `/login?callbackUrl=` quando não há sessão (páginas), responde 401/403 em JSON na API e resolve `/` → `/inbox`.
- **Páginas sem RBAC**: qualquer usuário logado abre qualquer tela, inclusive `/settings/*` (`middleware.ts:62-64`, documentado em `docs/rbac.md` > "Ainda não coberto").

---

## 4. Navegação global

### 4.1 Sidebar — `src/components/layout/Sidebar.tsx`

- Desktop: `aside hidden lg:flex w-[260px]`, fundo `bg-[#141414]` cravado. Os tokens `--sidebar-*` existem em `globals.css`, mas têm **0 usos**.
- Mobile: `Sheet side="left" w-[280px]` aberto por um botão hambúrguer no Header (`:150-168`).
- Logo no topo: `<Logo size="sm" variant="light" />` (`:118`).
- Item ativo: `bg-white/10 text-white` e barra branca de 3 px à esquerda, animada com `layoutId` (`:86-101`). Hover com `whileHover={{ x: 2 }}`.
- Rótulo de seção: `text-[10px] uppercase tracking-[0.15em] text-neutral-500` (`:75`), ≈3,9:1 sobre `#141414`, abaixo de AA para texto pequeno.
- **O menu não é filtrado por papel**: viewer e vendedor veem tudo.

| Seção | Rótulo no menu | Rota | Ícone lucide |
|---|---|---|---|
| (sem título) | Inbox | `/inbox` | Inbox |
| | Contatos | `/contacts` | Users |
| | Pipeline | `/pipeline` | Kanban |
| | Pedidos | `/orders` | Package |
| | Produtos | `/products` | ShoppingBag |
| Comunicação | Broadcast | `/broadcasts` | Megaphone |
| | Templates | `/templates` | FileText |
| | Respostas Rápidas | `/quick-replies` | MessageSquare |
| Ferramentas | Analytics | `/analytics` | BarChart3 |
| | Galeria | `/gallery` | Image |
| | Trocas | `/returns` | ArrowLeftRight |
| | Base de Conhecimento | `/knowledge-base` | BookOpen |
| | Alertas | `/alerts` | Bell |
| (rodapé) | Configurações | `/settings` | Settings |

**Telas órfãs** (sem entrada no menu): `/gallery/lookbooks` (só por URL), `/broadcasts/new` (stub) e as subpáginas de `/settings` (alcançadas pelo índice).

### 4.2 Header — `src/components/layout/Header.tsx`

Barra `h-14`, `bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm`. Da esquerda para a direita:

| Elemento | Comportamento | Problema |
|---|---|---|
| Botão hambúrguer (mobile) | abre a Sidebar em Sheet | `<Button>` dentro de `<SheetTrigger>` gera botão aninhado; sem `aria-label` (`Sidebar.tsx:155-162`) |
| `SeletorLoja` | ver 4.3 | — |
| Busca "Buscar conversas, contatos..." (`sm+`) | **inerte**: `Input` sem `value`/`onChange` (`:74-80`) | promete busca global que não existe |
| Botão lupa (mobile) | **sem ação** (`:85-87`) | idem |
| Alternar tema (lua/sol) | `toggleTheme` do provider próprio (`:90-101`) | sem `aria-label` |
| Sino de notificações | polling de `/api/alerts?acknowledged=false&limit=5` **a cada 15 s** (`:48-52`). Contador vermelho mostra "9+" acima de 9. Dropdown com as 5 últimas, e clicar em qualquer uma leva a `/alerts` | botão aninhado no `DropdownMenuTrigger` (`:105-114`); sem `aria-label`; clicar não leva à conversa ou pedido do alerta |
| Menu do usuário (avatar com iniciais e primeiro nome) | mostra nome e e-mail, "Meu Perfil", "Sair" (`signOut → /login`) | "Meu Perfil" **não faz nada** (`:192-195`); botão aninhado (`:173-184`); fallback de nome "User" em inglês (`:61`) |

### 4.3 SeletorLoja — `src/components/layout/SeletorLoja.tsx`

- Carrega `GET /api/lojas`, que devolve `{ lojas, podeTrocar }`.
- **Gestão** (admin/gerente): dropdown "Todas as lojas" + uma opção por loja. A escolha grava o cookie `loja_ativa` (1 ano, `SameSite=Lax`) e dá `window.location.reload()` (`:63-70`). É o único componente que evita o botão aninhado (comentário em `:92-95`), com `aria-label` descritivo.
- **Vendedor/viewer**: etiqueta estática com o nome da loja, `hidden md:flex` (`:78`). No celular o vendedor **não vê** em que loja está.
- O servidor só honra o cookie para gestão (`src/lib/loja.ts:58-68`).
- Teste existente: `src/components/layout/SeletorLoja.test.tsx`.

---

## 5. Inventário de telas

Legenda de permissão, derivada de `src/lib/rbac.ts:34-89`:

- **L** = leitura: todos os papéis (admin, gerente, vendedor, viewer).
- **E** = criar/editar: admin, gerente, vendedor.
- **X** = excluir: admin, gerente.
- **A** = só admin.

O escopo de loja vale em todas as telas operacionais: vendedor e viewer só enxergam a própria loja, e a gestão enxerga as duas ou filtra pelo seletor.

> Regra transversal: **a página abre para qualquer papel**. Os botões de escrita aparecem para o viewer e a API responde 403. Onde a tela não checa `res.ok`, o viewer vê toast de **sucesso** (A7).

### 5.1 `/login` — `src/app/(auth)/login/page.tsx`

- **Mostra**: logo escuro (só mobile, `:46-48`), "Bem-vindo de volta", "Acesse sua conta para continuar", campos Email e Senha, "Esqueci a senha", botão "Entrar" com seta, e o link "Não tem conta? Criar conta".
- **Ações**: `signIn("credentials", { redirect:false })`, depois `router.push("/inbox")`. Em erro mostra a mensagem única "Email ou senha inválidos" (`:35`), sem enumerar conta (bom).
- **Problemas**:
  - "Esqueci a senha" é `<button type="button">` **sem ação** (`:90-92`).
  - O link "Criar conta" é público (`:121-126`) e leva a `/register`, que só funciona com banco vazio (5.2).
  - O `callbackUrl` que o middleware grava é **ignorado**: sempre vai para `/inbox` (`:39`).
  - Não há mostrar/ocultar senha nem feedback de bloqueio.
  - Os inputs sobrescrevem o estilo do primitivo com `h-11 rounded-xl ...` repetido.
- **Quem**: público.

### 5.2 `/register` — `src/app/(auth)/register/page.tsx`

- **Mostra**: "Criar sua conta", campos Nome, Email e Senha (`minLength 8`), botão "Criar Conta".
- **Ação**: `POST /api/register`, depois `/login`.
- **Regra real**: a rota só cria o **primeiro admin**. Com qualquer usuário no banco responde 403 "O sistema já tem administrador. Novos acessos são criados em Configurações > Equipe." (`src/app/api/register/route.ts`, bloco `ehBootstrap`). Para todo mundo, exceto a primeira pessoa, é beco sem saída exposto no login.
- **Quem**: público (bootstrap).

### 5.3 `/inbox` — atendimento multicanal (tela principal)

Arquivos:

- `src/app/(dashboard)/inbox/page.tsx`
- `src/components/inbox/ConversationList.tsx`, `ChatWindow.tsx`, `CabecalhoConversa.tsx`, `BolhaMensagem.tsx`, `MenuAtalhos.tsx`, `SeletorProduto.tsx`, `ContactPanel.tsx`, `ChannelBadge.tsx`
- `src/components/chat/MediaBar.tsx`, `MediaPreview.tsx`, `AudioPlayer.tsx`, `GalleryModal.tsx`
- `src/app/(dashboard)/inbox/_components/painel-venda.tsx`

**Layout em 3 colunas (desktop `lg+`)**, `h-[calc(100vh-8rem)]` com margens negativas (`page.tsx:62`):

1. **Lista de conversas** (`w-80`):
   - cabeçalho "Conversas" com o badge "N sem resposta" (conta as conversas com `unreadCount > 0`);
   - busca com debounce de 350 ms no servidor (`page.tsx:28-32`);
   - filtros Canal (Todos/WhatsApp/Instagram/Facebook/TikTok) e Status. A opção `all` do Status se chama **"Abertos"** mas significa "todos" (`ConversationList.tsx:107`), e ainda existe a opção "Aberto";
   - cada item tem avatar com selo do canal, nome (negrito se não lida), tempo relativo sem sufixo, badge do canal, URGENTE/ALTA quando a prioridade é urgent/high, prévia da última mensagem e contador de não lidas.
2. **Chat**:
   - **cabeçalho** com o nome da cliente, o badge do canal, um `<select>` nativo "Transferir para..." (lista de `/api/usuarios` filtrada pela loja, com o papel cru entre parênteses, `CabecalhoConversa.tsx:77`) e o botão "Resolver";
   - **histórico** com fundo `#fafaf8`, botão "Mensagens anteriores" (páginas de 40) e separador de dia (Hoje/Ontem/"dd de mês");
   - **barra de mídia** com Foto, Vídeo, Produto, Galeria, Arquivo (.pdf/.doc/.docx) e Resposta Rápida, cada um só ícone com tooltip;
   - **composer**: textarea "Digite sua mensagem... (/ abre as respostas rápidas)", botão Enviar (Enter; Shift+Enter quebra linha), botão Nota interna e o link "Respostas rápidas".
3. **Painel do contato** (`w-72`):
   - botão "Nova venda" no topo;
   - avatar com iniciais, nome e preferência de tamanho (Slim/Plus Size/Ambos);
   - Contato: telefone, e-mail, WA id, IG id;
   - Resumo: nº de pedidos e total gasto (`R$ {toFixed(0)}`);
   - Tags e Notas.
   - É **somente leitura**.

**Mobile (< lg)**: a lista ocupa a tela. Ao abrir uma conversa aparece uma barra com voltar (ícone), nome, botão "Vender" e um ícone que abre o painel do contato em Sheet à direita (`page.tsx:95-122`).

**Estados**: skeletons específicos para lista e chat. Vazio da lista: "Nenhuma conversa encontrada". Sem seleção: "Selecione uma conversa / Escolha uma conversa na lista para iniciar o atendimento".

**Tempo real**: não há. Polling da lista a cada 5 s (`page.tsx:52-55`) e das mensagens a cada 5 s (`ChatWindow.tsx:164-189`). Mensagem nova da cliente toca um bipe (Web Audio, armado no primeiro gesto) e dispara uma `Notification` do sistema se a aba estiver escondida (`src/lib/chat/aviso-sonoro.ts`).

**Fluxos**:

| Fluxo | Passo a passo | Permissão |
|---|---|---|
| Abrir conversa | clica no item → carrega 40 mensagens → rola ao fim → `PUT /api/conversations/:id {markRead:true}` | L (a marcação de lida é PUT, então o **viewer não marca como lida**) |
| Enviar texto | digita → Enter → **bolha otimista** com relógio → `POST /api/messages` → substitui pela salva. Falha HTTP: remove a bolha, **devolve o texto ao campo** e mostra toast. 201 com `externalStatus=failed`: bolha vermelha "Não entregue" + "Tentar de novo" (`POST /api/messages/:id/reenviar`) | E |
| Nota interna | mesmo campo → botão de nota → bolha âmbar "Nota interna" (não vai à cliente) | E |
| Resposta rápida | digita "/" no início da linha → popover com lista filtrada (`GET /api/quick-replies?apenasAtivas=1&search=`) → ↑↓ navega, Enter escolhe (preenche o campo, não envia), Esc limpa | L para listar, E para enviar |
| Enviar mídia | ícone → seletor de arquivo do SO → `subirEEnviar` (`/api/media/upload` + `/api/media/send`) → recarrega | E |
| Enviar da galeria | ícone Galeria → modal "Galeria Merlos Store" com busca, filtros Todos/Produtos/Lookbooks/General, grade 4 colunas de seleção múltipla, legenda → "Enviar N arquivo(s)" | E |
| Enviar produto | ícone Produto → modal "Enviar produto" com busca (debounce 250 ms, `GET /api/products?limit=20`) → clicar **insere texto** no campo (`*Nome*`, preço, tamanhos com estoque ou "No momento sem estoque — posso avisar quando chegar.", URL da 1ª foto) (`SeletorProduto.tsx:49-60`) | L + E |
| Transferir | `<select>` → escolher colega → dispara **na hora** `PUT {assignedTo}` → toast "Conversa transferida para X." | E |
| Resolver | botão → `PUT {status:"resolved"}` → toast. **Sem confirmação e sem desfazer** | E |
| Carregar anteriores | botão → `GET ?before=` → insere no topo **preservando a posição de leitura** | L |
| Nova venda (ponte Masc) | "Nova venda"/"Vender" → Dialog `sm:max-w-3xl` "Nova venda — {cliente}" → ver 6.2 | E |

**Informação que falta na Inbox**, relevante para as regras de negócio:

- A tela não mostra **por qual número/conta** a conversa entrou. A regra é N números por loja com resposta pela conta de entrada.
- Não mostra de **qual loja** é a conversa (gestão em "Todas as lojas").
- Não mostra **a quem está atribuída**: o campo `agent` existe em `ConversationItem` (`ConversationList.tsx:30-33`), mas não é exibido.
- Não há filtro por loja, número, responsável nem "minhas conversas", nem ação de reabrir.

### 5.4 `/contacts` — `src/app/(dashboard)/contacts/page.tsx`

- **Mostra**: título "Contatos" com o subtítulo "Clientes da Merlos Store"; busca "nome, telefone ou email"; filtro Tamanho (Todos/Slim/Plus Size/Ambos); tabela com Nome, Telefone, Email, Tamanho, Tags (3 + "+N"), Total Gasto e Ações (editar/excluir).
- **Ações**:
  - "Novo Contato" e editar: Dialog `max-w-2xl` com Nome, Telefone (placeholder `5511999999999`), Email, Preferência de Tamanho, WhatsApp ID, Instagram ID, Tags (texto separado por vírgula) e Notas.
  - Excluir: `confirm()` nativo e `DELETE`.
- **APIs**: `GET/POST /api/contacts`, `PUT/DELETE /api/contacts/:id`.
- **Quem**: L, E, X.
- **Problemas**:
  - Filtro "Todos" envia `preferredSize=all` e a API aplica `where.preferredSize = "all"`, resultando em **lista vazia** (`page.tsx:175` + `src/app/api/contacts/route.ts:29,44`).
  - Busca sem debounce, um request por tecla com risco de corrida (`:171-185`).
  - `res.json()` sem checar `res.ok` (`:177-179`).
  - Linha com `cursor-pointer` sem ação (`:289`).
  - Dinheiro como `R$ 12.50` (`:315`).
  - Labels sem `htmlFor` (`:100` e seguintes); grades `grid-cols-2` fixas no celular.
  - Sem paginação e sem link para as conversas ou pedidos do contato.
  - Tags por texto livre, embora exista `/api/contacts/:id/tags`, que não é usada.

### 5.5 `/pipeline` — `src/app/(dashboard)/pipeline/page.tsx`

- **Mostra**: "Pipeline de Vendas" com o subtítulo "R$ X em negociação" (soma das etapas abertas).
  - Kanban horizontal com uma coluna por etapa: Lead (neutro), Interessada (azul), Negociando (amarelo), Fechando (laranja), Ganhou (verde), Perdeu (vermelho).
  - A coluna tem cabeçalho com nome, contagem e `R$ total`.
  - O card traz avatar com iniciais, nome, valor `R$` grande, até 2 tags, o canal **cru** (`whatsapp`, `:281-285`) e o tempo desde a última atividade.
  - Entrada com stagger (framer-motion).
- **Ações**:
  - arrastar card entre colunas (`PUT /api/deals/:id {stage}`);
  - soltar em "Perdeu" abre o Dialog "Motivo da Perda" (Preço, Tamanho indisponível, Concorrente, Sem resposta, Mudou de ideia, Outro, e Observações), confirmado por "Confirmar Perda";
  - "Novo Deal": Dialog com **"ID do Contato \*" colado à mão** (`:351-356`), Valor Estimado e Notas.
- **Quem**: L, E.
- **Problemas**:
  - **Só drag-and-drop HTML5**, sem teclado nem toque (`:158-177`, `:246-247`).
  - Mover e confirmar perda **não checam a resposta** e sempre mostram "Deal movido para X" (`:101-109`, `:115-125`).
  - Termos "Deal" e "Lead" em inglês.
  - Criar deal exige saber um UUID.
  - Card não abre detalhe nem conversa.
  - `minHeight: calc(100vh - 16rem)` inline.

### 5.6 `/orders` — `src/app/(dashboard)/orders/page.tsx`

- **Mostra**: "Pedidos" / "Gestão de pedidos e rastreio"; busca "número ou cliente"; filtros Status (Confirmado, Preparando, Enviado, Entregue, Devolvido, Cancelado) e Masc (Falta lançar, Lançado, Não vai).
  - Tabela: Pedido (mono), Cliente, Status (badge colorido), Pagamento (Pendente/Pago/Reembolsado), Masc (badge + nº da venda), Total, Data relativa, Ações.
- **Ações por linha**:
  - Ver (olho) abre o Dialog "Pedido X" com badge de status, botões de avanço linear (Confirmado → "Preparando" → "Enviado" → "Entregue"), itens, subtotal, frete, desconto, total, pagamentos (método e status **crus**, `:428-435`) e timeline de eventos.
  - Gerar Pix (cartão, só com pagamento pendente): `POST /api/payments/pix`, **sem confirmação**, embora gere cobrança real (`:176-189`, `:296-300`).
  - Registrar lançamento no Masc (só com `mascStatus=pendente`): **`ModalConfirmacaoBlock`** "Lançamento no Masc" com resumo (pedido, cliente, total), campo "Número da venda no Masc" e o texto explicando que a reserva é liberada. Grava via `PUT /api/orders/:id/masc {status:"lancado", vendaId}` (`:323-355`).
- **Quem**: L, E. Não há exclusão na UI.
- **Problemas**:
  - `updateStatus` não checa a resposta (`:124-130`).
  - Sem cancelar, devolver ou marcar "Não vai" pela UI.
  - Dinheiro `toFixed(2)`.
  - Filtros com largura fixa sem quebra de linha.

### 5.7 `/products` — `src/app/(dashboard)/products/page.tsx`

- **Mostra**: "Produtos" / "Catálogo de produtos da Merlos Store"; busca "nome ou SKU"; filtros Categoria (Vestidos, Blusas, Calças, Saias, Shorts, Conjuntos, Macacões, Jaquetas, Acessórios) e Tamanho (Slim/Plus Size/Ambos).
  - Tabela: Nome, SKU, Categoria, Tipo, Preço, Status (Ativo/Inativo), Ações.
- **Ações**:
  - Novo e editar: Dialog com Nome\*, SKU, Descrição, Categoria, Tipo de Tamanho, Status, Preço\* e Preço Anterior.
  - Excluir com `confirm()`.
- **Quem**: L, E, X.
- **Problemas graves**:
  - **Editar zera o estoque**: o form sempre envia `stock: {}` e `sizes` padrão do tipo (`:106-109`), e a API grava `stock` quando ele vem definido (`src/app/api/products/[id]/route.ts:71-76`).
  - Filtros "Todas"/"Todos" enviam `category=all` / `sizeType=all`, resultando em **lista vazia** (`:247-248` + `src/app/api/products/route.ts:45-46`).
  - **Contradição de domínio**: produto e preço têm dono no **Bling** (`docs/integracoes.md:154`, ADR 0004), mas a tela é um CRUD local completo.
  - Sem foto e sem estoque na UI.

### 5.8 `/broadcasts` — `src/app/(dashboard)/broadcasts/page.tsx`

- **Mostra**: "Broadcast" / "Campanhas em massa por WhatsApp"; tabela com Nome, Template, Status (**cru em inglês**: `draft`, `sending`..., `:261`), Destinatários, Métricas (enviadas, entregues, lidas, respondidas, só ícones) e Criado.
- **Ações**:
  - "Nova Campanha": Dialog com Nome\*, "Template aprovado \*" (lista de `GET /api/templates?status=approved`, ou o aviso "Nenhum template aprovado. Crie um na página Templates."), Segmentação por tags em texto livre e Tamanho (Todos/Slim/Plus Size).
  - ▶ Iniciar/Retomar: `PUT {status:"sending"}` seguido de um **laço no navegador** chamando `POST /api/broadcasts/:id/disparar` lote a lote, com contador `enviados/total` só nessa aba (`:143-170`).
  - ⏸ Pausar.
  - Excluir com `confirm()` e sem checar a resposta (`:173-177`).
- **Quem**: L, E, X.
- **Problemas**:
  - Tamanho "Todos" grava `preferred_size:"all"` e o disparo filtra `where.preferredSize = "all"`, então a **campanha sai para 0 pessoas** (`:88`, `:217` + `src/lib/broadcasts/disparo.ts:100`).
  - **Iniciar disparo em massa sem modal de bloqueio**, embora seja uma ação crítica (risco de banimento no uazapi).
  - Fechar a aba pausa o envio.
  - Não mostra o tamanho da audiência antes de criar.
  - Botões só-ícone com cores semânticas (verde/laranja/vermelho).

### 5.9 `/broadcasts/new` — `src/app/(dashboard)/broadcasts/new/page.tsx`

- Stub: título "Nova Campanha" e a frase "Criar nova campanha de broadcast." (`:1-8`). Nenhum link aponta para ela.

### 5.10 `/templates` — `src/app/(dashboard)/templates/page.tsx`

- **Mostra**: "Templates WhatsApp" / "Modelos de mensagem para envio proativo"; tabela com Nome (mono), Categoria (Marketing/Utilidade/Autenticação), Status (**cru**: draft/pending/approved/rejected, `:212`), Corpo truncado e Ações.
- **Ações**:
  - Novo e editar: Dialog com Nome\* (placeholder `welcome_message`), Categoria, Corpo\* (com a dica de variáveis `{{1}}`, `{{2}}`), Rodapé e **Preview** verde.
  - "Enviar para aprovação" (só em draft): `PUT {status:"pending"}` e toast "Template enviado para aprovação" (`:153-161`). A API **só grava `submittedAt`** (`src/app/api/templates/[id]/route.ts:63`); não há chamada à Meta.
  - Excluir com `confirm()` e sem checar a resposta.
- **Quem**: L, E, X.
- **Fluxo travado**: nenhuma tela leva um template a `approved`. Portanto a campanha (5.8) nunca tem template para escolher, a menos que o banco seja editado.

### 5.11 `/quick-replies` — `src/app/(dashboard)/quick-replies/page.tsx`

- **Mostra**: "Respostas Rápidas" / "Atalhos para respostas frequentes"; busca; tabela com Título, Atalho (`<code>`), Categoria (Frete, Medidas, Troca, Pagamento, Rastreio, Geral), Conteúdo truncado, Status (Ativo/Inativo) e Ações.
- **Ações**: Novo e editar (Título\*, Atalho com placeholder `/frete`, Categoria, Conteúdo\*); excluir com `confirm()`.
- **Quem**: L, E, X.
- **Problemas**:
  - Status exibido **sem como alternar** (`:243-247`).
  - `res.json()` sem `res.ok` (`:148-150`).
  - Busca sem debounce.

### 5.12 `/analytics` — `src/app/(dashboard)/analytics/page.tsx`

- **Mostra**: "Analytics" / "Métricas e relatórios da Merlos Store"; período (Hoje, 7, 30, 90 dias).
  - 8 KPIs em grade 2/4: Conversas Abertas, Total Mensagens, Taxa Conversão, Receita, Contatos, Pipeline, Vendas Fechadas, Conversas Período.
  - Gráficos Recharts: Volume de Mensagens (área; recebidas `#ec4899`, enviadas `#8b5cf6`), Conversas por Canal (donut com cores das marcas dos canais), Funil de Vendas (barras horizontais `#ec4899`) e Tempo Médio de Resposta (barras `#8b5cf6`, ou "Sem dados suficientes").
- **APIs**: `GET /api/analytics?days=`.
- **Quem**: L.
- **Problemas**:
  - Erro de API deixa o **skeleton para sempre** (`:84-105`).
  - Subtítulo "`${period} dias`" vira "1 dias" em "Hoje" (`:130,132,135,136`).
  - Rosa e violeta não pertencem à marca nem aos tokens `--chart-*`.
  - Não indica qual loja está sendo medida.
  - Gráficos sem tema escuro nem alternativa textual.

### 5.13 `/gallery` — `src/app/(dashboard)/gallery/page.tsx`

- **Mostra**: "Galeria de Mídia" com "N arquivo(s)"; busca "nome ou tag"; filtros Pasta (Todas, Produtos, Lookbooks, Stories, Geral, Recebidas) e Tipo (Imagens, Vídeos, Áudios, Documentos).
  - Área de drop tracejada com grade responsiva de 2 a 6 colunas. O cartão traz miniatura ou ícone, nome, tamanho, 2 tags, o tipo **cru** num badge e um botão excluir **que só aparece no hover** (`:243-249`).
- **Ações**: Upload (múltiplo: `image/*`, `video/*`, `audio/*`, `.pdf`), arrastar e soltar, clicar no cartão para o Dialog de preview (imagem/vídeo/áudio/"Abrir arquivo", mais Tipo, Tamanho, Pasta **crua** e tags), excluir com `confirm()`.
- **Quem**: L, E, X.
- **Problemas**:
  - Toast "`${uploaded} arquivo(s) enviado(s)`" sempre com cara de sucesso, **mesmo 0** (`:105-109`).
  - Cartão é `div onClick` (`:208-212`).
  - Sem skeleton: pisca "Nenhum arquivo encontrado" antes de carregar.
  - Sem paginação.
  - O Dialog de preview tem dois botões de fechar (o X do primitivo e o X do título, `:266-271`).

### 5.14 `/gallery/lookbooks` — `src/app/(dashboard)/gallery/lookbooks/page.tsx`

- **Mostra**: "Lookbooks" / "Coleções de fotos organizadas"; cartões com nome, descrição, Ativo/Inativo, "N mídias" e "N produtos", e botões Editar/Excluir.
- **Ações**: Novo e editar (só Nome\* e Descrição); excluir com `confirm()`.
- **Quem**: L, E, X.
- **Problemas**: não há como **adicionar mídias ou produtos** ao lookbook, embora o cartão mostre as contagens. A tela é órfã (fora do menu) e não tem estado de carregando.

### 5.15 `/returns` — `src/app/(dashboard)/returns/page.tsx`

- **Mostra**: "Trocas e Devoluções" / "Gerenciar solicitações"; filtro Status; tabela com Pedido, Cliente, Tipo (Troca/Devolução/Reembolso), Motivo (Tamanho errado, Defeito, Diferente do esperado, Mudou de ideia, Outro), Status e Data.
- **Transições na UI** (`:132-151`):
  - Solicitado → Aprovar ✓ ou Negar ✗;
  - Aprovado → "Em trânsito" (`shipping_back`);
  - Recebido → "Concluir".
- **Quem**: L, E.
- **Problemas**:
  - **Não existe botão para `shipping_back → received`**, então a solicitação fica presa em "Enviando".
  - Não há criação de troca pela UI.
  - `updateStatus` sem checar a resposta.

### 5.16 `/knowledge-base` — `src/app/(dashboard)/knowledge-base/page.tsx`

- **Mostra**: "Base de Conhecimento" / "Artigos e guias para a equipe"; busca; filtro Categoria (Medidas, Frete, Troca, Pagamento, Tecidos, Combinações, Procedimentos); cartões em 2 colunas com título, categoria, conteúdo em `line-clamp-3` e tags.
- **Ações**: Novo e editar (Título\*, Categoria, Tags, "Conteúdo \* (Markdown)"); excluir com `confirm()` e sem checar a resposta.
- **Quem**: L, E, X.
- **Problemas**:
  - Diz "Markdown", mas **exibe texto cru** e não há tela de leitura do artigo (`:107`, `:203`).
  - Botões editar/excluir só-ícone **sem `aria-label`** (`:192-197`).
  - Sem estado de carregando.
  - A Inbox não se integra à base.

### 5.17 `/alerts` — `src/app/(dashboard)/alerts/page.tsx`

- **Mostra**: "Central de Alertas" / "N alerta(s) pendente(s) de M total"; filtros Tipo, Severidade (Crítico, Alto, Médio, Baixo) e Status (Todos, Pendentes, Reconhecidos).
  - Tipos: SLA Estourado, Risco de Avaliação, Lead Quente, Deal Parado, Estoque Baixo, Primeiro Contato, Cliente Retornando, Pix Pendente, Follow-up Atrasado.
  - Lista de cartões com borda esquerda colorida por severidade (só os pendentes), ícone do tipo, badges (tipo, severidade, canal **cru**), mensagem e tempo.
  - Botão "OK" para reconhecer; reconhecido mostra "Resolvido" em verde (`:210-224`).
- **Ações**:
  - Reconhecer: `PUT /api/alerts/:id`, sem checar a resposta.
  - "Verificar Agora": `POST /api/alerts/check`. É uma **rota de cron com `Authorization: Bearer $CRON_SECRET`** (`src/app/api/alerts/check/route.ts:7`), então do navegador falha e o código não trata o erro (`:102-109`).
- Polling a cada 30 s (`:90-93`).
- **Quem**: L, E.
- **Problemas**:
  - "OK" e "Resolvido" nomeiam a mesma coisa de dois jeitos.
  - O alerta não abre a conversa ou o pedido relacionado.
  - Sem estado de carregando.

### 5.18 `/settings` — índice (server component) — `src/app/(dashboard)/settings/page.tsx`

- **Mostra**: "Configurações" / "Ajustes da rede e das integrações."; cartões-link (`AREAS`, `:18-55`):

| Cartão | Descrição exibida | Visível para |
|---|---|---|
| Lojas (borda escura de destaque) | "As unidades da rede e o de-para com o depósito do Bling. Comece por aqui…" | só admin |
| Integrações | "Bling, TikTok Shop, Instagram e WhatsApp. As credenciais ficam cifradas." | só admin |
| Equipe | "Quem acessa o sistema, o papel de cada um e a loja a que pertence." | só admin |
| SLA | "Prazos de resposta que disparam alerta. **Somente leitura.**" | todos |
| LGPD | "Exportar e apagar dados de um cliente. O apagamento é definitivo e não tem volta." | todos |

- Cartões de admin trazem a etiqueta "ADMIN". O filtro usa `usuarioDaSessao()` no servidor (`:57-60`). É o único ponto da UI que respeita papel.
- **Contradições**: o SLA é descrito como somente leitura, mas a tela tem campos editáveis e "Salvar". A LGPD promete exportar e apagar, e a tela não faz nenhum dos dois (5.22, 5.23).

### 5.19 `/settings/lojas` — `src/app/(dashboard)/settings/lojas/page.tsx`

- **Mostra**: "Lojas" / "As unidades da rede. Cada vendedor pertence a uma; admin e gerente veem todas."
  - Aviso âmbar quando há loja sem depósito do Bling, explicando que "a tela de venda não mostra estoque ao vivo" (`:147-161`).
  - Lista com nome, slug (mono), badge "depósito X" (verde) ou "sem depósito" (âmbar), a nota "O identificador entra na URL de webhook — mudá-lo exige reconfigurar os canais." e o botão Editar.
  - Vazio: "Nenhuma loja cadastrada" com "Cadastrar a primeira".
- **Ações**:
  - "Nova loja" e Editar: Dialog com "Nome da loja" e "Depósito no Bling". Com Bling conectado é um Select dos depósitos (`GET /api/integracoes/bling/depositos`); sem Bling vira texto livre com a dica de conectar.
  - A gravação passa por **`ModalConfirmacaoBlock`**, que mostra o resumo e, na edição, o **diff do depósito** "de X para Y" (`:281-314`).
- **APIs**: `GET/POST /api/lojas`, `PUT /api/lojas/:id`.
- **Quem**: L para listar; A para criar/editar.
- **Problema**: a tela só esconde a UI de admin quando a API responde **403** (`:52-55`). Para o vendedor, `GET /api/lojas` é permitido, então ele vê "Nova loja"/"Editar" e só descobre a falta de permissão ao gravar. O `GET` de depósitos é admin-only e falha em silêncio.

### 5.20 `/settings/integracoes` — `src/app/(dashboard)/settings/integracoes/page.tsx` + `_components/conectar-conta.tsx`

- **Mostra**: "Integrações" / "Contas conectadas por loja. As credenciais ficam cifradas e nunca são exibidas."
  - Três botões: "Conectar Instagram, Facebook ou WhatsApp", "Conectar Bling"/"Reconectar Bling" e "Conectar TikTok Shop"/"Conectar outra loja TikTok" (`:155-165`).
  - Lista: rótulo, provedor (Bling, TikTok Shop, Instagram, Facebook, WhatsApp oficial, WhatsApp uazapi), selo de status (Conectado verde, Desconectado neutro, Token expirado âmbar, Com erro vermelho), "Toda a rede" ou nome da loja, referência externa (mono), credenciais **mascaradas** e último erro em vermelho.
  - Notas de rodapé: Bling e TikTok são somente leitura; TikTok nasce sem loja; **aviso âmbar do uazapi** sobre banimento, sessão que cai e ausência de template (`:267-288`).
- **Ações**:
  - OAuth: `GET /api/integracoes/{bling|tiktok}/autorizar` e depois `window.location.href`.
  - Conectar por token: Dialog "Conectar conta de canal" com `<select>` **nativo** Canal, aviso âmbar quando uazapi, "Apelido da conta", identificador (rótulo e ajuda vêm de `REFERENCIA_DO_PROVEDOR`) e **um campo `type="password"` por chave**, gerados de `CHAVES_ESPERADAS` (a mesma constante que o servidor usa). Grava via `POST /api/integracoes`.
  - Sessão (uazapi): painel inline com status, número, instruções "Aparelhos conectados → Conectar aparelho", QR code 176 px e "Gerar QR code"/"Gerar outro QR" (`:224-261`).
  - Desconectar: `window.confirm` nativo, embora **apague a credencial** (`:114-118`).
- **Quem**: A. Não-admin recebe 403 e vê o texto "Conectar e desconectar integração é função do administrador…".
- **Problemas**:
  - **A loja da conta nova é implícita**: vem do cookie do SeletorLoja (`src/app/api/integracoes/route.ts:44-47`). O Dialog diz "Cada conta pertence a uma loja", mas não mostra nem pergunta qual. Com o seletor em "Todas as lojas" a API responde 400 "Informe a loja (?loja=\<id\>)…", mensagem técnica.
  - Não há UI para **atribuir loja** à conta TikTok, embora a nota mande "escolha a loja depois de conectar".
  - Não há UI para trocar o rótulo nem reautenticar um token expirado.

### 5.21 `/settings/team` — `src/app/(dashboard)/settings/team/page.tsx`

- **Mostra**: breadcrumb "Configurações > Equipe"; "Equipe" / "Quem acessa o sistema, com qual papel e em qual loja."
  - Tabela em Card: Nome (+ "desativado"), E-mail, Papel (badge: Administrador preto, Gerente azul, Vendedor esmeralda, Somente leitura neutro, com descrição no `title`), Loja (nome ou "as duas"), Último acesso ("nunca entrou" ou data) e Ações.
  - Linha desativada com `opacity-50`.
- **Ações**:
  - "Novo acesso" e editar: Dialog com Nome, E-mail (desabilitado na edição, com "O e-mail é o login e não muda por aqui."), **Senha inicial / Nova senha em `type="text"` visível** (`:350-360`), Papel (`<select>` nativo com descrição do papel) e Loja (`<select>` nativo, desabilitado para gestão: "Alcança as duas lojas").
  - Texto do Dialog: "Não há convite por e-mail: defina a senha e entregue à pessoa."
  - Desativar: **`ModalConfirmacaoBlock`** "Desativar acesso" com "X perde o login imediatamente. O histórico… continua" (`:414-425`).
  - Reativar: sem confirmação.
- **APIs**: `GET /api/usuarios?detalhe=1`, `GET /api/lojas`, `POST /api/usuarios`, `PUT/DELETE /api/usuarios/:id`.
- **Quem**: A para escrever. Não-admin vê o Card "Apenas administradores gerenciam os acessos ao sistema." **se** a API responder 403.
- **Problemas**:
  - Estado de carregando é só o texto "Carregando...".
  - O admin define a senha definitiva de outra pessoa, e ela aparece em claro. Isso contraria a régua da base (CLAUDE.md > Segurança de Login).
  - Selects nativos destoam do resto.

### 5.22 `/settings/sla` — `src/app/(dashboard)/settings/sla/page.tsx` — **tela falsa**

- **Mostra**: breadcrumb; "SLA — Acordo de Nível de Serviço".
  - Card "Tempos de Primeira Resposta" em minutos: WhatsApp 5, Instagram 15, Facebook 30, TikTok 60.
  - Card "Tempos por Prioridade": Urgente 2, Alta 5, Média 15, Baixa 60.
  - Card "Notificações de SLA": switches "Notificar agente quando SLA estiver próximo de estourar" e "Notificar admin quando SLA estourar", e o campo "Notificar X minutos antes".
- **Ação**: "Salvar alterações" dispara `toast.success("SLA atualizado")` e **nada é gravado** (`:37-39`). Os valores voltam ao padrão no reload.
- **Quem**: qualquer um. O índice diz que é somente leitura, e pela regra de negócio SLA é **configuração, só admin** (`docs/integracoes.md`, decisão 7).

### 5.23 `/settings/lgpd` — `src/app/(dashboard)/settings/lgpd/page.tsx` — **tela falsa**

- **Mostra**: breadcrumb; "LGPD — Privacidade e Dados"; quatro Cards:
  - Consentimento: switch e mensagem.
  - Retenção de Dados: período 6 meses/1 ano/2 anos/Indefinido e switch "Excluir dados automaticamente".
  - Direitos do Titular: switches de exclusão e exportação via chat, com os comandos `/meus-dados` e `/excluir-dados`.
  - Opt-Out: switch e mensagem.
- **Ação**: "Salvar alterações" dispara `toast.success(...)` e **nada é gravado** (`:41-43`).
- **Lacuna**: `/api/lgpd` (exportar/apagar dossiê) existe e **nenhuma tela usa**. O índice promete essa função. Falsa conformidade é risco jurídico.

### 5.24 APIs sem nenhuma tela

Levantado com grep dos `fetch` da UI:

| Rota | O que é | Implicação para o redesenho |
|---|---|---|
| `/api/activity-logs` | trilha de auditoria | **não há tela de auditoria** (regra da base exige painel owner/admin) |
| `/api/lgpd` | exportar/apagar dados do titular | tela LGPD real a construir |
| `/api/scheduled`, `/api/scheduled/:id` | mensagens agendadas | recurso sem UI |
| `/api/surveys` | pesquisas | sem UI |
| `/api/payments/link` | link de pagamento | sem UI (só Pix) |
| `/api/contacts/:id/tags` | editar tags | sem UI (tags por texto livre) |
| `/api/integracoes/bling/catalogo` | catálogo do Bling | a tela de Produtos é CRUD local em vez disso |
| `/api/ai/*`, `/api/transcription` | IA e transcrição | IA fora de escopo; a transcrição aparece só no AudioPlayer |
| `/api/media/:id/raw` | download bruto | sem uso direto |

---

## 6. Fluxos de ponta a ponta (como o usuário percorre hoje)

### 6.1 Atendimento

Login → `/inbox` → (gestão: escolher loja no Header, com reload) → filtrar ou buscar → abrir conversa → ler (bipe e notificação em mensagem nova) → responder (texto, "/" atalho, produto como texto, mídia, galeria) ou nota interna → transferir (select) ou resolver (botão).

### 6.2 Venda dentro da conversa (ponte manual com o Masc)

1. "Nova venda" (desktop, no painel do contato) ou "Vender" (mobile).
2. Dialog "Nova venda — {cliente}" (`painel-venda.tsx:174-327`):
   - aviso âmbar quando `estoqueAoVivo=false`: "**Estoque não está ao vivo.** O Bling não respondeu, ou a loja ainda não tem depósito configurado…";
   - busca "Buscar produto por nome ou SKU..." (debounce 300 ms, `GET /api/products/disponibilidade`);
   - **coluna esquerda**: produtos com nome, SKU, preço (`Intl` BRL) e selo de disponibilidade. O selo é verde "N disp.", vermelho "esgotado" ou "estoque ?", com `title` "Bling: X · prometido e ainda não lançado no Masc: Y". Cada tamanho tem um botão "+ tamanho" (ou "único");
   - **coluna direita**: carrinho com −/+/lixeira, aviso "Só há N disponível" e total. Botão "Fechar venda".
3. **`ModalConfirmacaoBlock`** "Fechar venda" → resumo dos itens e total, aviso âmbar se algo passa do disponível, e o texto "O pedido entra na fila **falta lançar no Masc**. O estoque só baixa quando alguém lançar a venda lá…". Após 3 s libera "Gravar pedido".
4. `POST /api/orders` → toast "Pedido X criado — falta lançar no Masc".
5. Em `/orders`, alguém filtra "Masc: Falta lançar", clica no ícone de prancheta e informa o número da venda no Masc no modal com bloqueio. O pedido fica "Lançado" e a reserva é liberada.

### 6.3 Campanha (hoje inviável sem mexer no banco)

Templates: criar → "Enviar para aprovação" (fica `pending`) → **sem caminho para `approved`** → Broadcast: "Nova Campanha" exige template aprovado → ▶ → envio em lotes pela aba aberta → ⏸/▶.

### 6.4 Onboarding da rede (admin)

`/register` (só o 1º usuário) → `/settings` → Lojas (cadastrar Centro e Cerro Azul com depósito do Bling, via modal block) → Integrações (conectar Bling por OAuth; conectar números de WhatsApp oficial/uazapi e Instagram/Facebook por token, **com a loja definida implicitamente pelo seletor do Header**; parear o uazapi por QR) → Equipe (criar acessos com papel e loja, senha entregue em mãos).

### 6.5 Pós-venda

Pedidos: Confirmado → Preparando → Enviado → Entregue (botões no detalhe) → Gerar Pix (sem confirmação). Trocas: Solicitado → Aprovado/Negado → Em trânsito → **(trava)**.

---

## 7. Inventário de componentes

### 7.1 Layout (`src/components/layout/`)

| Componente | Arquivo | Responsabilidade | Notas |
|---|---|---|---|
| `SidebarProvider` / `useSidebar` | `Sidebar.tsx:19-36` | contexto open/close do menu mobile | — |
| `Sidebar` | `Sidebar.tsx:141-147` | menu desktop | fundo cravado `#141414` |
| `MobileSidebarTrigger` | `Sidebar.tsx:150-168` | hambúrguer e Sheet | botão aninhado, sem `aria-label` |
| `NavSection` / `SidebarContent` (internos) | `Sidebar.tsx:64-138` | seções, item ativo animado | não filtra por papel |
| `Header` | `Header.tsx` | loja, busca (inerte), tema, notificações, usuário | polling 15 s |
| `SeletorLoja` | `SeletorLoja.tsx` | loja ativa via cookie | com teste |

### 7.2 Inbox (`src/components/inbox/` e `inbox/_components/`)

| Componente | Props principais | Faz | Observações |
|---|---|---|---|
| `ConversationList` | `conversations, selectedId, onSelect, search, channelFilter, statusFilter` (+ setters) | lista, busca, filtros | item em `div onClick` (sem teclado); exporta o tipo `ConversationItem` |
| `ChatWindow` | `conversationId, contactName, channel, onConversaAtualizada` | orquestra carregar, paginar, poll, marcar lida, enviar (otimista), reenviar, transferir, resolver, mídia, atalhos | 494 linhas, perto do teto de 500 |
| `CabecalhoConversa` | `contactName, channel, onTransferir, onResolver` | cabeçalho e ações | `<select>` nativo como disparador de ação |
| `BolhaMensagem` | `msg, onReenviar, reenviando` | bolha: cliente (branca, esquerda), agente/bot (preta, direita), nota (âmbar), falha (borda vermelha), nome do vendedor, status de entrega | exporta os tipos `Mensagem`, `MensagemMidia` |
| `ChannelBadge` / `ChannelAvatar` | `channel`, `contactName`, `avatarUrl`, `size` | badge e avatar com selo, SVGs inline de WhatsApp/Instagram/Facebook/TikTok | canal desconhecido cai em **WhatsApp** (`:79`, `:103`) |
| `MenuAtalhos` | `termo, aberto, onEscolher, onFechar` | popover de respostas rápidas (debounce 150 ms, teclado em captura) | `role="listbox"` sem `aria-activedescendant` ligado ao textarea |
| `SeletorProduto` (+ `textoDoProduto`) | `aberto, onFechar, onEscolher` | busca produto e gera texto | `Intl` BRL |
| `ContactPanel` | `contactId` | ficha do contato, só leitura | `R$ toFixed(0)` |
| `PainelVenda` (+ `SeloDisponivel`) | `aberto, onFechar, contactId, contactNome, conversationId, onVendaCriada?` | venda na conversa | com teste `painel-venda.test.tsx` |

### 7.3 Chat e mídia (`src/components/chat/`)

| Componente | Faz | Situação |
|---|---|---|
| `MediaBar` | 6 botões-ícone (Foto, Vídeo, Produto, Galeria, Arquivo, Resposta Rápida) + inputs file ocultos | `<Button>` dentro de `TooltipTrigger` (6 botões aninhados); nome acessível só por tooltip |
| `MediaPreview` | renderiza áudio, imagem (clique amplia em Dialog), vídeo `controls` ou documento com link de download | imagem em `div onClick`; ícone de download sem nome |
| `AudioPlayer` | play/pause, barra de progresso clicável, tempo, expandir transcrição (pendente/processando/falha/texto) | barra em `div onClick`, sem teclado; botões sem `aria-label` |
| `GalleryModal` | seleção múltipla da galeria + legenda | filtros "General" em inglês; grade de 4 colunas fixa |
| `AiSuggestion` | sugestão de resposta por IA (roxo) | **morto**: só referenciado em comentário (`ChatWindow.tsx:389-400`) |
| `OrderCard` | cartão de pedido no chat | **morto**: nenhum import |
| `PaymentCard` | cartão Pix/link no chat (QR, copia-e-cola) | **morto**: nenhum import |

### 7.4 Compartilhados

| Componente | Arquivo | Contrato | Usos |
|---|---|---|---|
| `ModalConfirmacaoBlock` | `src/components/modal-confirmacao-block.tsx` | `aberto, titulo, mensagem?, children?, rotuloConfirmar="Confirmar", onConfirmar, onCancelar, carregando?, segundos=3`. Reinicia a contagem a cada abertura (`:47-56`); ignora ESC e clique fora enquanto bloqueado ou carregando (`:68-70`); sem X de fechar; ícone âmbar no título; "Confirme o resumo — libera em Ns" em `aria-live="polite"` (`:83-91`); botão mostra "Gravando..." | PainelVenda, Pedidos/Masc, Lojas, Equipe/desativar. Com teste |
| `Providers` / `useTheme` | `src/components/providers.tsx` | `SessionProvider` + `ThemeProvider` próprio (`localStorage "merlos-theme"`, classe `.dark`) | root |
| `Logo` | `src/components/ui/logo.tsx` | `size: sm 90×36, md 120×48, lg 160×64, xl 200×80`; `variant: dark→/logo-dark.png, light→/logo-light.png` | só Sidebar (login e layout de auth usam `<Image>` direto) |

### 7.5 Primitivos `src/components/ui/` (shadcn base-nova sobre `@base-ui/react`)

| Primitivo | Base | Arquivos que importam | Observação |
|---|---|---|---|
| `button` | base-ui Button + cva (variants default/outline/secondary/ghost/destructive/link; sizes xs/sm/default/lg/icon/icon-xs/icon-sm/icon-lg) | 34 | usa `ring-3`, `in-data-*`, `has-data-*` (v4, inertes). **Não é forwardRef**, então não serve como filho de Trigger |
| `badge` | base-ui useRender + cva | 22 | `rounded-4xl` (v4, inerte). Status colorido é feito por `className` em cada tela |
| `input` | base-ui Input | 21 | foco `ring-3` inerte |
| `dialog` | base-ui Dialog | 18 | `data-open:animate-in` inerte; `sr-only "Close"` em inglês (`:80`); `text-foreground` explícito no popup (conserto de texto invisível em portal) |
| `select` | base-ui Select | 15 | coexiste com `<select>` nativo em 3 lugares |
| `label` | nativo | 15 | usado quase sempre sem `htmlFor` |
| `skeleton` | próprio | 14 | inclui variantes de domínio: `SkeletonConversationList`, `SkeletonChat`, `SkeletonTable`, `SkeletonKpiGrid`, `SkeletonKanban`, `SkeletonContactPanel`, `SkeletonCard`, `SkeletonText`, `SkeletonCircle`. Cores cravadas `bg-neutral-200/60`, `bg-white` |
| `textarea` | nativo | 11 | — |
| `table` | nativo com `overflow-x-auto` | 8 | — |
| `scroll-area` | base-ui ScrollArea | 7 | extensão local `viewportRef` (aponta o elemento que rola) |
| `card` | nativo | 4 | `ring-1 ring-foreground/10` |
| `avatar` | base-ui | 3 | — |
| `breadcrumb` | **próprio** (`items[]`), não é o do shadcn | 3 | cores `neutral` cravadas; `aria-label="Navegação"` |
| `dropdown-menu` | base-ui Menu | 2 | Trigger já é `<button>` |
| `sheet` | base-ui Dialog | 2 | `sr-only "Close"` (`:75`) |
| `separator`, `switch` | base-ui | 2 cada | — |
| `tooltip` | base-ui | 1 (MediaBar) | não há `TooltipProvider` no layout |
| `sonner` | sonner | 1 (root) | `useTheme` de `next-themes` sem provider |
| `command`, `input-group`, `popover`, `tabs` | — | **0** | instalados e sem uso |

### 7.6 Componentes locais repetidos (candidatos a padrão único)

Cada tela de CRUD reimplementa a mesma estrutura: `XForm` (formulário com `useState`), um `Dialog` de criar/editar, tabela, `confirm()` e mapas de cor e rótulo.

- `ContactForm` (`contacts:43-161`), `ProductForm` (`products:75-232`), `TemplateForm` (`templates:46-129`), `QuickReplyForm` (`quick-replies:40-135`), `ArticleForm` (`knowledge-base:39-116`), `LookbookForm` (`lookbooks:25-79`), `KpiCard` (`analytics:47-66`), `Selo` (`integracoes:49-58`).
- Mapas de status e cor duplicados: `statusColors` em `orders:75-82`, `broadcasts:47-54`, `templates:39-44`, `returns:38-45`; `severityColors` em `alerts:50-55`; `STATUS` em `integracoes:42-47`; `mascColors` em `orders:69-73`; `stageConfig` em `pipeline:51-58`; `CORES_DO_PAPEL` em `team:65-70`; `priorityBadge` em `ConversationList:36-41`.
- A mesma cor significa coisas diferentes: roxo é "Enviado" num pedido e "Enviando" (cliente devolvendo) numa troca; amarelo é "Preparando", "Pendente", "Enviando campanha" e "Solicitado".

### 7.7 Outros

- Diretórios **vazios**: `src/components/crm/`, `src/components/gallery/`, `src/components/orders/`.
- Utilitários de UI do chat em `src/lib/chat/`: `aviso-sonoro.ts` (bipe e `Notification`), `mesclar.ts` (mescla idempotente de páginas), `midia.ts` (upload e envio), `enviar.ts`.
- Testes de UI existentes: `modal-confirmacao-block.test.tsx`, `layout/SeletorLoja.test.tsx`, `inbox/_components/painel-venda.test.tsx`, `tests/tokens-tailwind.test.ts` (paridade entre as variáveis CSS e o `tailwind.config`), `tests/estrutura.test.tsx` (smoke do Button).

---

## 8. Identidade visual

### 8.1 Nome da marca (inconsistente, precisa de decisão)

| Onde | Grafia |
|---|---|
| Logotipo (PNG) | **"merlos"** em caixa baixa + barra vertical + **"STORE"** |
| App (`metadata.title`, alt do logo, subtítulos, título da galeria, placeholder de template) | **"Merlos Store"** (16 ocorrências em `src`) |
| `package.json` `name` | `merlos-store` |
| Skill `how-to-use-guide` (`marca.json` label, LEIA-ME) e `docs/` | **"Merlo Store"** / "na Merlo" |
| Repositório | `MerlostoreChat` |
| Chave de localStorage / tag de notificação | `merlos-theme` / `merlos:` |

**Pergunta ao cliente**: a marca é "Merlos Store" (como no logo) ou "Merlo Store"?

### 8.2 Logotipo — `public/`

| Arquivo | Pixels | Conteúdo | Uso atual |
|---|---|---|---|
| `logo-dark.png` | 1080×1350 (retrato) | wordmark **preto** sobre fundo branco/transparente, ocupando ≈75% da largura e ≈24% da altura, centralizado | mobile de login/register (140×56) |
| `logo-light.png` | 1080×1350 | wordmark **branco** sobre transparente (negativo) | Sidebar (`Logo sm` 90×36), layout de auth (180×72) |
| `logo-dark-bg.png` | 2300×2300 (quadrado) | wordmark branco sobre **fundo preto** chapado | sem uso |

- **Desenho**: geométrico, traço fino e uniforme. O "e" é cortado por uma diagonal, "merl" e "os" são separados por uma **barra vertical** que desce além da linha de base, e "STORE" vem em caixa alta fina, alinhado à direita sob "os". Monocromático.
- **Problema de uso**: com `next/image` + `object-contain` numa caixa 90×36, a imagem inteira (retrato) é escalada a ≈28,8×36 px, e o wordmark visível fica **≈22×9 px** na sidebar, ≈43×17 px no login desktop e ≈34×13 px no login mobile. O logo é praticamente ilegível.
- **Faltam** (confirmado em `.claude/skills/how-to-use-guide/assets/marca/LEIA-ME.md`): `logo-negativo.svg`, `logo-tinta.svg`, `icone.png`. Não existe versão vetorial, recortada, nem símbolo/ícone para favicon e PWA.
- **Favicon**: padrão do create-next-app (25.931 bytes).

### 8.3 Paleta implementada no app (`src/app/globals.css`)

**Conceito declarado nos comentários**: "Premium warm neutral palette" e "Sidebar — dark elegant". Tudo em neutros com matiz quente (hue 60–80 no OKLCH), **sem cor de marca cromática**. O único acento real é o preto (`--primary`).

Tokens `:root` (claro):

| Token | Valor OKLCH | Aproximação | Uso |
|---|---|---|---|
| `--background` | `0.985 0.002 80` | ≈ `#FAF9F7` (off-white quente) | fundo |
| `--foreground` | `0.15 0.01 60` | ≈ `#1C1A18` | texto |
| `--card` / `--popover` | `1 0 0` | `#FFFFFF` | superfícies |
| `--primary` | `0.2 0.01 60` | ≈ `#262320` (quase preto) | botão primário |
| `--primary-foreground` | `0.98 0 0` | ≈ `#F9F9F9` | texto no primário |
| `--secondary` | `0.96 0.005 80` | ≈ `#F2F1EE` | — |
| `--muted` | `0.955 0.005 80` | ≈ `#F0EFEC` | — |
| `--muted-foreground` | `0.5 0.01 60` | ≈ `#6E6A66` | texto secundário (≈5:1 sobre branco, passa AA) |
| `--accent` | `0.95 0.008 80` | ≈ `#EFEDE9` | hover/seleção |
| `--destructive` | `0.577 0.245 27.325` | ≈ `#E7000B` (vermelho shadcn) | erro |
| `--border` / `--input` | `0.92` / `0.93 0.005 80` | ≈ `#E7E5E2` | bordas |
| `--ring` | `0.4 0.01 60` | ≈ `#57534F` | foco (mas o anel não é gerado, F1) |
| `--chart-1..5` | `0.35` → `0.92`, escala de cinza quente | — | **não usados** (analytics usa hex) |
| `--radius` | `0.75rem` | — | `lg`; `md` = −2 px; `sm` = −4 px |
| `--sidebar*` | fundo `0.12` (≈ `#141210`), texto `0.88`, accent `0.18`, borda `0.22` | — | **0 usos** (a Sidebar usa `#141414` cravado) |

- Tokens `.dark` (escuro): fundo `0.1` (≈ `#0F0E0D`), card `0.14`, primário **invertido** para claro `0.92`, borda `oklch(1 0 0 / 8%)`, `--destructive 0.704 0.191 22.216`, charts invertidos, sidebar `0.08`.
- **Cores cravadas fora dos tokens**:
  - `#141414`: Sidebar e painel de marca do login.
  - `#fafaf8`: fundo do dashboard, fundo da coluna de formulário do login, fundo do histórico e do textarea do chat.
  - `#0a0a0a`: fundo escuro do dashboard.
  - Utilitários próprios: `.gradient-brand` (`#1a1a1a → #2d2d2d → #1a1a1a`), `.gradient-accent` (`#f8f4f0 → #faf8f6 → #f5f0eb`, bege), `.glass` / `.glass-dark`, `.shadow-premium` / `-hover`, `.border-subtle`.
- **Cores de marca dos canais** (`ChannelBadge.tsx:40-75`, `analytics:33-38`):

| Canal | Cor |
|---|---|
| WhatsApp | `#25D366` |
| Instagram | gradiente `#F58529 → #DD2A7B → #8134AF`; ícone `#E4405F` |
| Facebook | `#1877F2` |
| TikTok | preto (`neutral-900` / `#000000`) |

- **Cores semânticas de status**: paleta padrão do Tailwind em pares `bg-*-100 text-*-700`, sem tokens. Verde = ok/pago/lançado/conectado/ativo; âmbar = pendente/aviso/nota interna/sem depósito; vermelho = erro/cancelado/negado/excluir; azul = confirmado/gerente/lida; roxo = enviado; amarelo e laranja = estados intermediários.
- **Bolhas do chat**: cliente em branco com borda `neutral-200/60`; atendente em **`neutral-900` com texto branco**; nota interna em `amber-50/80` com borda `amber-200/60`; falha com borda `destructive/40` sobre `destructive/5`.
- **Gráficos**: rosa `#ec4899` e violeta `#8b5cf6`, cores sem relação com a marca.

### 8.4 Tokens da skill `how-to-use-guide` (material impresso) — divergentes do app

Arquivos: `.claude/skills/how-to-use-guide/assets/marca/tokens.css`, `marca.json`, `LEIA-ME.md`, `references/design-system.md`, `references/marca.md`. A pasta está **untracked** no git.

- `marca.json`: `{ key:"merlo-store", label:"Merlo Store", tokens:{ marca:"#7C3AED", "marca-texto":"#5B21B6" }, logo:{tipo:"svg"} }`.
- `tokens.css`: `--marca: #7C3AED; --marca-texto: #5B21B6;`.
- **`#7C3AED` (violeta Tailwind 600) e `#5B21B6` aparecem 0 vezes no app.** O LEIA-ME marca os logos como "falta". Tudo indica **placeholder herdado do template** (a skill foi copiada do ERP Auto Peças: `design-system.md` fala em "O ERP tem tema claro e escuro" e cita `references/prints-do-erp.md` e `references/branding-e-marca.md`, que não existem nesta pasta; o LEIA-ME cita `preparar-marca.mjs` e o design-system cita `preparar-marca.ts`).
- Contraste calculado: `#7C3AED` sobre branco ≈5,4:1 (passaria AA), `#5B21B6` ≈9:1. O texto do `design-system.md` diz que a cor de marca fica "entre 1,07 e 2,14" contra branco, número de outras marcas.
- Tokens fixos do guia impresso (valem para PDF, não para o app):

| Token | Valor | Uso |
|---|---|---|
| `--tinta` | `#111827` | capa, títulos |
| `--papel` | `#FFFFFF` | fundo |
| `--papel-alt` | `#F9FAFB` | linha alternada, cartões |
| `--linha` | `#E5E7EB` | bordas |
| `--texto` | `#262626` | corpo (o arquivo afirma ser o `--foreground` do app, o que **não confere**: o app usa ≈ `#1C1A18`) |
| `--texto-suave` | `#6B7280` | legendas |
| `--aviso` | `#B45309` | irreversível ou dinheiro |

- Tipografia do guia: Inter; capa 34 pt, seção 19 pt, passo 13,5 pt, corpo 10,5 pt, legenda 8,5 pt. Rótulos pequenos em CAIXA ALTA com tracking; valores monetários à direita com `tabular-nums`.
- Conceitos úteis para o app novo: separar **cor de preenchimento** (`--marca`) de **cor de texto** (`--marca-texto`, ≥4,5:1), e usar a versão negativa do logo só sobre fundo escuro.

### 8.5 Tipografia do app

- **Família**: Inter (`next/font/google`, `subsets:["latin"]`, `variable:"--font-sans"`), aplicada em `<html className="font-sans">`. `tailwind.config.ts` define `sans: [var(--font-sans), ui-sans-serif, system-ui]` e `heading: [var(--font-heading), …]`.
- `--font-heading` só é definido dentro da classe `.theme`, que ninguém usa, e de forma **circular** (`.theme { --font-sans: var(--font-sans) }`, `globals.css:38-41`). As 4 ocorrências de `font-heading` (primitivos) caem na fonte herdada, que é Inter mesmo assim.
- Geist (`src/app/fonts/*.woff`) está sem uso.
- **Escala em uso** (sem tokens, por classe):

| Nível | Classe |
|---|---|
| Título de página | `text-2xl font-bold` (auth usa `font-semibold tracking-tight`) |
| Subtítulo de página | `text-muted-foreground` (tamanho base) |
| Título de card/dialog | `font-semibold` / `CardTitle` |
| Corpo | `text-sm`; itens de menu `text-[13px] font-medium` |
| Rótulo de seção | `text-[10px] font-semibold uppercase tracking-wider` / `tracking-[0.15em]` |
| Micro-texto | `text-[10px]` (39 usos) e `text-[11px]` (9 usos): badges, timestamps, contadores |
| Números | mono para nº de pedido, SKU, atalho, IDs; `tabular-nums` só em `painel-venda` e no progresso da campanha |

- `antialiased` e font-smoothing forçados no `html`.

### 8.6 Forma, profundidade, iconografia, movimento

- **Raio**: `rounded-lg` (12 px) padrão; `rounded-xl` em inputs do login, bolhas (`rounded-2xl`), cards de KPI e skeletons; `rounded-md` nas tabelas; `rounded-4xl` nos badges (inerte no v3).
- **Sombra**: mínima (`shadow-sm`, `.shadow-premium` com opacidade 0.03–0.06). Profundidade dada por borda fina (`border-neutral-200/60`, `ring-foreground/10`).
- **Scrollbar** customizada de 6 px, polegar `rgba(0,0,0,.12)` (`globals.css`).
- **Ícones**: lucide com traço fino (`strokeWidth 1.8`) no layout, de 18 px (`h-[18px]`) a 16 px; SVGs próprios para as marcas dos canais.
- **Movimento** (framer-motion):
  - transição de página (fade + 8 px, 250 ms, `ease [0.22,1,0.36,1]`);
  - deslize de 2 px no hover da sidebar;
  - indicador ativo com `layoutId`;
  - entrada do login;
  - stagger das colunas e cards do pipeline, com `whileHover y:-2`;
  - `active:scale-[0.98]` nos botões;
  - `animate-pulse` nos skeletons;
  - **Nenhum `prefers-reduced-motion`.**
- **Tom da interface**: "premium", minimalista, preto e off-white, próximo de moda. A microcopy em PT-BR é explicativa e franca (ex.: "Id errado mostra o estoque da loja errada, sem dar erro.").

### 8.7 Tema escuro

- Alternado manualmente no Header e salvo em `localStorage "merlos-theme"`. **Ignora a preferência do sistema**.
- Aplicado **depois** da hidratação (`providers.tsx:22-30`), o que causa **flash do tema claro** a cada carga.
- Quando `mounted` vira `true`, o provider troca `<>{children}</>` por `<ThemeContext.Provider>{children}</…>` (`providers.tsx:37-43`): um tipo de elemento diferente no mesmo lugar **remonta a árvore inteira** uma vez, repetindo todos os `useEffect`/`fetch` da primeira tela.
- As telas usam `bg-white`, `text-neutral-*` e hex. O escuro funciona por **overrides globais com `!important`** para uma lista fechada de classes (`globals.css`, bloco "Dark mode overrides for hardcoded colors"). O que não está na lista (`bg-neutral-50/80`, `amber-50`, `green-50`, `border-neutral-100`, gráficos, badges de status) fica claro sobre fundo escuro.
- O Toaster lê o tema de `next-themes` (`sonner.tsx:3,8`), que não tem provider no app. Os toasts seguem `"system"`, não o botão do Header.

---

## 9. Problemas encontrados (catálogo para o redesenho)

Severidade: **S1** impede tarefa ou engana o usuário / risco jurídico ou de dados; **S2** atrito sério ou barreira de acessibilidade; **S3** inconsistência ou polimento.

### A. Funcionalidade falsa, enganosa ou quebrada

| ID | Sev | Problema | Evidência |
|---|---|---|---|
| A1 | S1 | Tela SLA falsa: "Salvar" só mostra toast; o índice diz "somente leitura" | `settings/sla/page.tsx:37-39`; `settings/page.tsx:46` |
| A2 | S1 | Tela LGPD falsa enquanto `/api/lgpd` não tem UI; o índice promete exportar/apagar | `settings/lgpd/page.tsx:41-43`; `settings/page.tsx:52-53` |
| A3 | S1 | Toast de **sucesso sem checar a resposta** (viewer com 403 vê "sucesso") | `pipeline:101-109,115-125`; `orders:124-130`; `returns:70-77`; `templates:147-150,154-160`; `broadcasts:173-176`; `knowledge-base:136-139`; `alerts:97-99` |
| A4 | S1 | Filtro "Todos/Todas" envia `"all"` e a lista vem vazia | `contacts:175` + `api/contacts/route.ts:44`; `products:247-248` + `api/products/route.ts:45-46` |
| A5 | S1 | Campanha com Tamanho "Todos" sai para 0 destinatários | `broadcasts:88,217` + `lib/broadcasts/disparo.ts:100` |
| A6 | S1 | Editar produto zera o estoque e redefine os tamanhos | `products:106-109` + `api/products/[id]/route.ts:71-76` |
| A7 | S1 | Template nunca chega a "aprovado" pela UI, e campanha exige aprovado | `templates:153-161`; `api/templates/[id]/route.ts:63`; `broadcasts:74` |
| A8 | S2 | Troca presa em "Enviando" (sem transição para "Recebido") | `returns:142-151` |
| A9 | S2 | "Verificar Agora" chama rota de cron (`CRON_SECRET`) e falha em silêncio | `alerts:102-109`; `api/alerts/check/route.ts:7` |
| A10 | S2 | Busca global do Header inerte; lupa mobile sem ação | `Header.tsx:74-80,85-87` |
| A11 | S2 | "Meu Perfil" sem ação; não existe tela de perfil/segurança (exigida pela base) | `Header.tsx:192-195` |
| A12 | S2 | "Esqueci a senha" sem ação; login ignora `callbackUrl` | `login:90-92,39` |
| A13 | S2 | "Criar conta" público leva a `/register`, que dá 403 depois do 1º usuário | `login:121-126`; `api/register/route.ts` |
| A14 | S2 | Upload da galeria mostra "0 arquivo(s) enviado(s)" como sucesso | `gallery:105-109` |
| A15 | S2 | Lookbook não permite associar mídias/produtos; tela órfã | `gallery/lookbooks/page.tsx` |
| A16 | S3 | `/broadcasts/new` é stub órfão | `broadcasts/new/page.tsx:1-8` |
| A17 | S3 | Resposta rápida mostra status Ativo/Inativo sem como alternar | `quick-replies:243-247` |
| A18 | S3 | Base de conhecimento diz "Markdown" e mostra texto cru; sem tela de leitura | `knowledge-base:107,203` |
| A19 | S3 | Analytics: erro deixa skeleton infinito; "1 dias" | `analytics:84-105,130` |
| A20 | S3 | Componentes mortos (`AiSuggestion`, `OrderCard`, `PaymentCard`); primitivos sem uso (`command`, `input-group`, `popover`, `tabs`); diretórios vazios | 7.3, 7.5, 7.7 |

### B. Consistência

| ID | Sev | Problema | Evidência |
|---|---|---|---|
| B1 | S2 | Exclusão com `window.confirm` nativo em 9 telas; `ModalConfirmacaoBlock` só em 4 fluxos. "Desconectar integração" (apaga credencial), "Gerar Pix" (cobrança) e "Iniciar campanha" (disparo em massa) sem bloqueio | `contacts:188`, `products:261`, `broadcasts:173`, `templates:147`, `quick-replies:159`, `knowledge-base:136`, `gallery:114`, `lookbooks:95`, `integracoes:114`; `orders:176-189`; `broadcasts:281-285` |
| B2 | S2 | Dois sistemas de cor: tokens (156 `text-muted-foreground`) e cravado (275 `neutral-*`, 54 `bg-white`, hex); tokens de sidebar e chart sem uso | greps; `Sidebar.tsx:115`; `dashboard/layout.tsx:21` |
| B3 | S2 | Dinheiro em dois formatos: `R$ ${n.toFixed(2)}` (ponto, sem milhar) e `Intl pt-BR` | `contacts:315`, `orders:286`, `products:390`, `pipeline:189,228,268`, `analytics:132,134`, `ContactPanel:125` vs `painel-venda:58`, `SeletorProduto:39-40` |
| B4 | S2 | Termos e valores em inglês na UI: Inbox, Pipeline, Deal, Lead, Broadcast, Templates, Analytics, Upload, Preview, OK, "General", "User", sr-only "Close"; **status crus** (`draft`, `sending`, `approved`, `pix`, canal `whatsapp`, papel `vendedor`, `fileType`, pasta) | `Sidebar.tsx:38-62`; `broadcasts:261`; `templates:212`; `orders:430-433`; `pipeline:284`; `alerts:200`; `CabecalhoConversa:77`; `gallery:253,303`; `GalleryModal:93-100`; `Header:61`; `dialog.tsx:80`; `sheet.tsx:75` |
| B5 | S3 | Datas só relativas ("há 3 dias") em tabelas, bolhas e alertas, sem data/hora absoluta nem tooltip | `formatDistanceToNow` em 7 arquivos |
| B6 | S3 | Selects de três tipos: base-ui `Select`, `<select>` nativo (Transferir, Canal, Papel, Loja) e botões-filtro (GalleryModal) | `CabecalhoConversa:52-80`; `conectar-conta:125-136`; `team:364-396` |
| B7 | S3 | Estados de carregando inconsistentes: skeleton na maioria; nada em knowledge-base, lookbooks, gallery e alerts (pisca o "vazio"); texto em team | — |
| B8 | S3 | `res.json()` sem `res.ok` (quebra em 401/500) | `contacts:177-179`, `products:250-252`, `gallery:80-83`, `lookbooks:87-89`, `quick-replies:148-150`, `GalleryModal:49-51` |
| B9 | S3 | Busca com debounce na Inbox, SeletorProduto, MenuAtalhos e PainelVenda; sem debounce em Contatos, Produtos, Pedidos, Respostas, Conhecimento, Galeria | — |
| B10 | S3 | Breadcrumb só em SLA, LGPD e Equipe (não em Lojas e Integrações); cabeçalho de página copiado em cada tela | — |
| B11 | S3 | Mapas de cor e status duplicados por tela; mesma cor com significados diferentes | 7.6 |
| B12 | S3 | Nomes de arquivo misturados: PascalCase em inglês (`ChatWindow.tsx`), PascalCase em português (`BolhaMensagem.tsx`), kebab-case (`painel-venda.tsx`); a base pede kebab-case | — |
| B13 | S3 | Nome da marca: "Merlos Store" × "Merlo Store" | 8.1 |
| B14 | S3 | `docs/front.md` desatualizado (lista `settings/{general,channels,automations}` e diz que o modal não existe) | `docs/front.md` |

### C. Acessibilidade

| ID | Sev | Problema | Evidência |
|---|---|---|---|
| C1 | S1 | **Sem anel de foco**: `focus-visible:ring-3` e afins são sintaxe v4 num projeto v3 e não aparecem no CSS compilado. Button tem `outline-none`, então o foco por teclado vira só troca da cor da borda | `button.tsx:9`, `input.tsx:12`, `badge.tsx:8`; `.next/static/css/*.css` com 0 ocorrências de `ring-3` e `data-open` |
| C2 | S1 | Lista de conversas (fluxo principal) em `div onClick`: sem foco nem Enter | `ConversationList.tsx:125-131` |
| C3 | S1 | Pipeline só por drag-and-drop HTML5 (sem teclado nem toque) | `pipeline:158-177,246-247` |
| C4 | S2 | `<Button>` aninhado em Trigger que já é `<button>`: DOM inválido e leitor de tela anuncia dois controles | `Header.tsx:105-106,173-174`; `Sidebar.tsx:155-156`; `inbox/page.tsx:113-114`; `MediaBar.tsx:54-100` (6) |
| C5 | S2 | Botões só-ícone sem nome acessível: hambúrguer, tema, sino, voltar e contato (mobile inbox), play/pause e transcrição do áudio, editar/excluir artigo, link de download, lupa mobile. MediaBar depende de tooltip | `Sidebar.tsx:156-162`; `Header.tsx:85-114`; `inbox/page.tsx:96-98,114-116`; `AudioPlayer.tsx:81-92,111-122`; `knowledge-base:192-197`; `MediaPreview.tsx:106-108` |
| C6 | S2 | `<Label>` sem `htmlFor` em todos os formulários de CRUD e diálogos do pipeline e da campanha; buscas só com placeholder | `contacts:100-149`, `products:136-219`, `templates:94-116`, `quick-replies:89-118`, `knowledge-base:86-108`, `lookbooks:64-69`, `pipeline:314-373`, `broadcasts:194-221` |
| C7 | S2 | Contraste abaixo de AA (≈, calculado): `text-neutral-400` sobre branco ≈2,5:1 (timestamp da cliente, "Respostas rápidas", "Sem tags", ícones com texto, horário no dropdown); rótulo de seção da sidebar `neutral-500` sobre `#141414` ≈3,9:1 a 10 px; hora na bolha do agente `white/40` sobre `neutral-900` ≈3,8:1 a 11 px; hora da nota `amber-500` sobre `amber-50` ≈2,1:1 | `BolhaMensagem.tsx:169,173,174`; `ChatWindow.tsx:465`; `ContactPanel.tsx:148`; `Sidebar.tsx:75`; `Header.tsx:143` |
| C8 | S2 | Elementos interativos só por mouse: miniatura da galeria, tile do GalleryModal, imagem da bolha, barra de progresso do áudio; excluir da galeria só aparece no hover | `gallery:208-212,243-249`; `GalleryModal:117-125`; `MediaPreview:51-54`; `AudioPlayer:95-98` |
| C9 | S2 | Affordance falsa: linhas de tabela com `cursor-pointer` e hover sem ação | `contacts:289`, `orders:260`, `products:376`, `templates:208`, `broadcasts:257`, `returns:121`, `quick-replies:228` |
| C10 | S2 | Sem `prefers-reduced-motion` (0 ocorrências) em transições de página, springs e stagger | `dashboard/layout.tsx:25-35`; `Sidebar.tsx:83-101`; `pipeline:207-252` |
| C11 | S3 | Status só por cor: "entregue" e "lida" diferem só na cor do duplo check, sem rótulo | `BolhaMensagem.tsx:76-78` |
| C12 | S3 | Conteúdo que muda por polling (nova mensagem, contador) sem `aria-live` | `ChatWindow.tsx:164-189` |
| C13 | S3 | Menu "/" com `role="listbox"`, mas o textarea não tem `aria-expanded`/`aria-controls`/`aria-activedescendant` | `MenuAtalhos.tsx:110-127` |
| C14 | S3 | Gráficos sem alternativa textual ou tabela | `analytics` |
| C15 | S3 | Micro-texto de 10–11 px em 48 lugares | greps |

Pontos positivos a manter: skip-link; `aria-label` descritivo no SeletorLoja; `aria-live` no modal com bloqueio; `aria-label` por item no PainelVenda; `sr-only` nas ações da Equipe; `lang="pt-BR"`.

### D. UX e fluxo

| ID | Sev | Problema | Evidência |
|---|---|---|---|
| D1 | S1 | A Inbox não mostra **número/conta de entrada**, **loja** nem **responsável** da conversa; sem filtro por loja, número ou responsável nem "minhas" (as regras de negócio dependem disso) | `ConversationList.tsx:30-33` (campo `agent` não exibido) |
| D2 | S1 | Integração por token nasce na loja do **cookie do seletor**, invisível no Dialog; em "Todas" o erro é técnico | `conectar-conta.tsx`; `api/integracoes/route.ts:44-47`; `lib/loja.ts:112-117` |
| D3 | S1 | Senha inicial ou nova de outra pessoa definida pelo admin e **exibida em claro** (`type="text"`) | `team:350-360` |
| D4 | S2 | Páginas sem RBAC: vendedor vê Configurações e, em Lojas, vê "Nova loja"/"Editar" (a API de listagem não dá 403) | `middleware.ts:62-64`; `lojas:52-58,141-144` |
| D5 | S2 | Polling concorrente (lista 5 s + chat 5 s + sino 15 s + alertas 30 s) sem tempo real | `inbox/page.tsx:52-55`; `ChatWindow:164-189`; `Header:48-52`; `alerts:90-93` |
| D6 | S2 | Transferir dispara no `onChange` do `<select>` (seta do teclado pode transferir sem querer); sem mostrar o responsável atual | `CabecalhoConversa.tsx:59-69` |
| D7 | S2 | "Resolver" sem confirmação nem desfazer; não há "reabrir" | `CabecalhoConversa.tsx:82-98` |
| D8 | S2 | Campanha dirigida pela aba do navegador: fechar pausa; progresso só na aba de origem; sem prévia da audiência | `broadcasts:143-170` |
| D9 | S2 | Novo deal pede UUID do contato | `pipeline:351-356` |
| D10 | S2 | Produto e preço editáveis localmente, contra ADR 0004 (Bling é o dono) | `products/page.tsx`; `docs/integracoes.md:154` |
| D11 | S2 | Trocar loja recarrega a página inteira; vendedor no mobile não vê a loja | `SeletorLoja.tsx:63-70,78` |
| D12 | S2 | Alerta e notificação não levam ao objeto (conversa/pedido) | `Header.tsx:138`; `alerts` |
| D13 | S3 | Painel do contato só leitura dentro da Inbox; editar exige ir a `/contacts` e perder o contexto | `ContactPanel.tsx` |
| D14 | S3 | Pedido: só avanço linear; sem cancelar, devolver ou "não vai" | `orders:371-386` |
| D15 | S3 | Sem paginação em nenhuma listagem de CRUD | — |
| D16 | S3 | `AnimatePresence mode="wait"` atrasa toda navegação em ≈250 ms | `dashboard/layout.tsx:25-35` |
| D17 | S3 | Filtro de status da Inbox: opção "Abertos" significa "todos" | `ConversationList.tsx:107` |
| D18 | S3 | `ChannelBadge` de canal desconhecido aparece como WhatsApp | `ChannelBadge.tsx:79,103` |

### E. Responsividade

| ID | Sev | Problema | Evidência |
|---|---|---|---|
| E1 | S2 | Barras de filtro `flex gap-3` com larguras fixas (`w-36`–`w-44`) e sem `flex-wrap` estouram em 375 px | `contacts:239`, `orders:200`, `products:313`, `gallery:151`, `alerts:127`, `knowledge-base:164` |
| E2 | S2 | Formulários `grid-cols-2`/`grid-cols-3` sem breakpoint | `contacts:98,108,129`, `products:134,152,199`, `templates:92`, `quick-replies:87`, `knowledge-base:89` |
| E3 | S2 | Inbox com `h-[calc(100vh-8rem)]` e margens negativas: `100vh` sofre com a barra do navegador mobile e 8rem não corresponde ao Header (3,5rem) + padding, então sobra ou corta espaço | `inbox/page.tsx:62` |
| E4 | S3 | Cabeçalhos de página `flex justify-between` sem quebra (título espremido pelo botão) | maioria das páginas |
| E5 | S3 | Tabelas de 6 a 8 colunas só com rolagem horizontal, sem layout em cartões | `table.tsx` |
| E6 | S3 | GalleryModal com `grid-cols-4` fixo e linha de filtros sem quebra | `GalleryModal.tsx:92-113` |
| E7 | S3 | Sidebar mobile, Sheet do contato e "Vender" funcionam (manter) | `inbox/page.tsx:95-122` |

### F. Base técnica do design system

| ID | Sev | Problema | Evidência |
|---|---|---|---|
| F1 | S1 | shadcn `base-nova` e `tw-animate-css` (v4) sobre Tailwind 3.4: classes `ring-3`, `data-open:*`, `rounded-4xl`, `has-data-*`, `in-data-*`, `supports-backdrop-filter:*` não geram CSS (foco, animação, raio, variantes). Os tokens precisaram de espelho manual e de teste para existir | `components.json`; `package.json`; `tailwind.config.ts:4-15`; `tests/tokens-tailwind.test.ts` |
| F2 | S2 | Modo escuro por overrides `!important` de classes cravadas | `globals.css` (bloco final) |
| F3 | S2 | ThemeProvider próprio: FOUC, remontagem da árvore ao montar, Toaster fora de sincronia (`next-themes` sem provider) | `providers.tsx:22-43`; `sonner.tsx:3,8` |
| F4 | S3 | Token `--font-heading` circular/indefinido; fontes Geist órfãs; `--chart-*` e `--sidebar-*` sem uso | `globals.css:38-41`; `src/app/fonts/` |
| F5 | S2 | 21 de 23 páginas são client com `useEffect + fetch`; sem `loading.tsx`, `error.tsx`, `not-found.tsx` | find: 0 arquivos |
| F6 | S2 | Logo em PNG retrato com margem enorme: ilegível em tamanho de UI; sem SVG, ícone ou favicon próprio | 8.2 |
| F7 | S3 | `Button` não é forwardRef: não serve de `render` para Trigger, o que provocou os botões aninhados | comentário `SeletorLoja.tsx:92-95` |
| F8 | S3 | `ChatWindow` com 494 linhas (teto da base: 500) | `wc -l` |

---

## 10. O que vale preservar (decisões de UX já validadas no código antigo)

1. **Chat**:
   - bolha otimista com relógio;
   - em falha, remove a bolha e **devolve o texto ao campo** (`ChatWindow.tsx:230-237`);
   - 201 com `failed` vira bolha vermelha "Não entregue" com motivo no `title` e "Tentar de novo";
   - separador de dia;
   - "Mensagens anteriores" preservando a posição de leitura;
   - rolagem automática **só** se a atendente já estava no fim (`FOLGA_DO_FIM = 120` px);
   - limpar o histórico ao trocar de conversa (nunca mostrar mensagens de outra cliente sob o nome errado);
   - marcar lida de novo quando chega mensagem com a conversa aberta.
2. **Nome do vendedor na bolha** (duas lojas, vários vendedores no mesmo número).
3. **Nota interna** no mesmo composer, visualmente distinta.
4. **Atalhos "/"**: abre só quando a linha inteira é um atalho (não em "10/12"), navegação por teclado, Enter escolhe sem enviar, mostra o conteúdo antes.
5. **Produto como texto editável** antes de enviar (a vendedora complementa), com tamanhos **só com estoque**.
6. **Venda na conversa**: "disponível = saldo Bling − reservado (não lançado no Masc)", selo com o detalhe no `title`, aviso de estoque não ao vivo, aviso de venda acima do disponível sem bloquear, modal com bloqueio e resumo, pedido nascendo "falta lançar no Masc".
7. **`ModalConfirmacaoBlock`**: contagem reiniciada a cada abertura, bloqueia ESC e clique fora, contador com `aria-live`, estado "Gravando...", conteúdo rico (resumo, diff).
8. **Lançamento no Masc** como ação explícita que registra o nº da venda.
9. **Lojas**: aviso de loja sem depósito com consequência explicada; diff do depósito no modal; nota de que o slug entra na URL do webhook.
10. **Integrações**: formulário gerado da mesma constante de chaves que o servidor valida; credenciais mascaradas; aviso honesto sobre o uazapi; pareamento por QR com instruções.
11. **Configurações**: índice server-side que não oferece caminho sem saída ao não-admin.
12. **Bipe armado no primeiro gesto + `Notification` com a aba escondida.**
13. **Debounce + descarte de resposta atrasada** (flag `vivo`) nas buscas.
14. **Skeletons com a forma do conteúdo** (lista, chat, kanban, KPI, painel).
15. **Tom da microcopy**: PT-BR direto, explica a consequência ("perde o login imediatamente", "Id errado mostra o estoque da loja errada, sem dar erro").
16. **Estética**: monocromática, neutros quentes, off-white `#FAFAF8`, preto `#141414`, bordas finas, traço de ícone fino. É coerente com o logo e com uma loja de moda.

---

## 11. Insumos para os arquitetos (perguntas e direções, não decisões)

- **Marca**: confirmar a grafia ("Merlos Store" × "Merlo Store") e se existe cor de marca cromática. Hoje o app é monocromático e o `#7C3AED` da skill é placeholder. Pedir ao cliente o logo em **SVG** (positivo, negativo e símbolo) para favicon e sidebar.
- **Tokens**: com Tailwind v4, definir tokens semânticos em `@theme` (superfícies, texto, borda, foco, estados `sucesso/aviso/perigo/info`, cores de canal, cores de status de domínio) e proibir cor cravada. Isso elimina F1, F2, B2 e B11.
- **Componentes de padrão único** (derivados das duplicações): `CabecalhoPagina` (título, descrição, breadcrumb, ações), `TabelaDados` (busca com debounce, filtros que quebram linha, paginação, vazio/carregando/erro, versão cartão no mobile), `SeloStatus` (mapa central domínio → rótulo PT-BR → tom), `ConfirmarExclusao` sobre o modal com bloqueio, `CampoFormulario` (label associado, ajuda, erro), formatadores centrais `moeda()` / `dataHora()` / `relativo()` com tooltip absoluto.
- **Glossário PT-BR** para Inbox/Atendimento, Pipeline/Funil, Deal/Negociação, Lead, Broadcast/Campanha, Template/Modelo, Analytics/Relatórios e para todos os enums exibidos.
- **Navegação guiada por papel**, com checagem também no servidor da página. Não mostrar item nem botão que o papel não pode usar.
- **Inbox**: incluir conta de entrada, loja e responsável; filtros "minhas / não atribuídas / por número"; transferir e resolver com confirmação leve e desfazer; tempo real no lugar de polling triplo.
- **Telas a construir de verdade** (hoje falsas ou ausentes): SLA (config, admin), LGPD (exportar/apagar com modal com bloqueio), Trilha de auditoria e painel owner/admin (regra da base), Meu perfil > Segurança (régua de auth), aprovação de template ou sincronização com a Meta, transições completas de troca, ciclo completo do lookbook.
- **Onde a UI precisa refletir as fontes da verdade**: Produto e preço vêm do Bling (somente leitura na UI, sem CRUD de preço); estoque é sempre "disponível" com origem visível; venda é do Masc ("falta lançar").
- **Ações críticas com bloqueio de 3 s** (hoje sem): excluir qualquer registro, desconectar integração, gerar Pix, iniciar/retomar campanha, apagar dados LGPD, resolver em lote, trocar papel de usuário.
- **Acessibilidade mínima de aceite**: anel de foco visível, tudo operável por teclado (lista de conversas, kanban com alternativa "mover para…"), `aria-label` em todo botão-ícone, label associado, contraste AA (texto de apoio ≥ `neutral-500`), `prefers-reduced-motion`, textos de sistema em PT-BR ("Fechar").
- **Tema**: seguir o sistema por padrão, aplicar a classe antes da hidratação (script inline ou cookie) e ter um único provider de tema compartilhado com o Toaster.

---

## Apêndice A — Matriz tela × papel (estado atual, derivado do RBAC de API)

| Tela | admin | gerente | vendedor | viewer | Observação |
|---|---|---|---|---|---|
| Inbox (ler) | ✓ | ✓ | ✓ (sua loja) | ✓ (sua loja) | viewer não marca como lida (PUT) |
| Inbox (responder, transferir, resolver, vender) | ✓ | ✓ | ✓ | ✗ (403; botões visíveis) | — |
| Contatos, Produtos, Templates, Respostas, Conhecimento, Galeria, Lookbooks, Campanhas: criar/editar | ✓ | ✓ | ✓ | ✗ | botões visíveis ao viewer |
| Mesmas: excluir | ✓ | ✓ | ✗ | ✗ | botões visíveis a vendedor e viewer |
| Pipeline, Pedidos, Trocas, Alertas: operar | ✓ | ✓ | ✓ | ✗ | — |
| Analytics | ✓ | ✓ | ✓ | ✓ | — |
| Configurações (índice) | 5 cartões | SLA, LGPD | SLA, LGPD | SLA, LGPD | único filtro por papel na UI |
| Lojas: listar / gravar | ✓ / ✓ | ✓ / ✗ | ✓ / ✗ | ✓ / ✗ | UI de gravação aparece para não-admin |
| Integrações | ✓ | ✗ (mensagem) | ✗ (mensagem) | ✗ (mensagem) | — |
| Equipe: gravar | ✓ | ✗ | ✗ | ✗ | mensagem só se a API der 403 |
| SLA, LGPD | tela falsa | tela falsa | tela falsa | tela falsa | nada grava |

## Apêndice B — Chamadas de API por tela

| Tela | Endpoints |
|---|---|
| Header | `GET /api/alerts?acknowledged=false&limit=5` (15 s), `GET /api/lojas` |
| Inbox | `GET /api/conversations` (5 s), `PUT /api/conversations/:id`, `GET/POST /api/messages`, `POST /api/messages/:id/reenviar`, `GET /api/usuarios`, `GET /api/contacts/:id`, `GET /api/quick-replies`, `GET /api/products`, `GET /api/products/disponibilidade`, `POST /api/orders`, `GET /api/media/gallery`, `POST /api/media/upload`, `POST /api/media/send` |
| Contatos | `GET/POST /api/contacts`, `PUT/DELETE /api/contacts/:id` |
| Pipeline | `GET/POST /api/deals`, `PUT /api/deals/:id` |
| Pedidos | `GET /api/orders`, `GET/PUT /api/orders/:id`, `PUT /api/orders/:id/masc`, `POST /api/payments/pix` |
| Produtos | `GET/POST /api/products`, `PUT/DELETE /api/products/:id` |
| Campanhas | `GET/POST /api/broadcasts`, `PUT/DELETE /api/broadcasts/:id`, `POST /api/broadcasts/:id/disparar`, `GET /api/templates?status=approved` |
| Templates | `GET/POST /api/templates`, `PUT/DELETE /api/templates/:id` |
| Respostas rápidas | `GET/POST /api/quick-replies`, `PUT/DELETE /api/quick-replies/:id` |
| Analytics | `GET /api/analytics?days=` |
| Galeria | `GET /api/media/gallery`, `POST /api/media/upload`, `DELETE /api/media/:id` |
| Lookbooks | `GET/POST /api/lookbooks`, `PUT/DELETE /api/lookbooks/:id` |
| Trocas | `GET /api/returns`, `PUT /api/returns/:id` |
| Conhecimento | `GET/POST /api/knowledge`, `PUT/DELETE /api/knowledge/:id` |
| Alertas | `GET /api/alerts` (30 s), `PUT /api/alerts/:id`, `POST /api/alerts/check` (cron) |
| Lojas | `GET/POST /api/lojas`, `PUT /api/lojas/:id`, `GET /api/integracoes/bling/depositos` |
| Integrações | `GET/POST /api/integracoes`, `DELETE /api/integracoes/:id`, `GET /api/integracoes/{bling,tiktok}/autorizar`, `GET/POST /api/integracoes/uazapi/:id/sessao` |
| Equipe | `GET /api/usuarios?detalhe=1`, `GET /api/lojas`, `POST /api/usuarios`, `PUT/DELETE /api/usuarios/:id` |
| Login / Register | NextAuth `signIn("credentials")`, `POST /api/register` |

## Apêndice C — Rótulos de enum exibidos hoje (base para o glossário)

- **Canal**: whatsapp → WhatsApp; instagram → Instagram; facebook → Facebook; tiktok → TikTok.
- **Status de conversa** (filtro): all → "Abertos" (ambíguo); open → Aberto; pending → Pendente; resolved → Resolvido.
- **Prioridade**: urgent → URGENTE; high → ALTA (medium e low não aparecem na lista); no SLA: Urgente/Alta/Média/Baixa.
- **Pedido**: confirmed → Confirmado; preparing → Preparando; shipped → Enviado; delivered → Entregue; returned → Devolvido; cancelled → Cancelado.
- **Pagamento**: pending → Pendente; paid → Pago; refunded → Reembolsado. Método e status de `payments` aparecem crus.
- **Masc**: pendente → Falta lançar; lancado → Lançado; dispensado → Não vai.
- **Etapa do funil**: lead → Lead; interested → Interessada; negotiating → Negociando; closing → Fechando; won → Ganhou; lost → Perdeu.
- **Motivo de perda**: price → Preço; size_unavailable → Tamanho indisponível; competitor → Concorrente; no_response → Sem resposta; changed_mind → Mudou de ideia; other → Outro.
- **Troca, tipo**: exchange → Troca; return → Devolução; refund → Reembolso.
- **Troca, status**: requested → Solicitado; approved → Aprovado; shipping_back → Enviando; received → Recebido; completed → Concluído; denied → Negado.
- **Troca, motivo**: wrong_size → Tamanho errado; defect → Defeito; not_as_expected → Diferente do esperado; changed_mind → Mudou de ideia; other → Outro.
- **Campanha, status** (cru): draft, scheduled, sending, paused, completed, cancelled.
- **Template, status** (cru): draft, pending, approved, rejected. Categoria: marketing → Marketing; utility → Utilidade; authentication → Autenticação.
- **Alerta, tipo**: sla_breach → SLA Estourado; review_risk → Risco de Avaliação; hot_lead → Lead Quente; deal_stale → Deal Parado; low_stock → Estoque Baixo; first_contact → Primeiro Contato; returning_customer → Cliente Retornando; payment_pending → Pix Pendente; follow_up_due → Follow-up Atrasado.
- **Alerta, severidade**: critical → Crítico; high → Alto; medium → Médio; low → Baixo.
- **Integração, status**: conectado → Conectado; desconectado → Desconectado; (expirada) → Token expirado; erro → Com erro.
- **Integração, provedor**: bling → Bling; tiktok_shop → TikTok Shop; instagram; facebook; whatsapp_oficial → WhatsApp (oficial); uazapi → WhatsApp (uazapi).
- **Papel**: admin → Administrador; gerente → Gerente; vendedor → Vendedor; viewer → Somente leitura (descrições em `src/lib/usuarios.ts:31-36`).
- **Tamanho (cliente/produto)**: slim → Slim; plussize → Plus Size; both → Ambos. Grades padrão: slim PP–GG; plussize 46–58.
- **Categoria de produto**: vestidos, blusas, calcas, saias, shorts, conjuntos, macacoes, jaquetas, acessorios.
- **Pasta da galeria**: produtos, lookbooks, stories, general → Geral, incoming → Recebidas.
- **Categoria de resposta rápida**: frete, medidas, troca, pagamento, rastreio, geral.
- **Categoria de artigo**: medidas, frete, troca, pagamento, tecidos, combinacoes, procedimentos.
