# Padrao de componentes

Como uma tela nasce aqui. O inventario completo esta em `04-ui.md` secao 6;
este documento e a regra de convivencia entre as tres pastas.

---

## 1. Tres pastas, tres regras

| Pasta | O que e | Pode editar? |
|---|---|---|
| `src/components/ui/` | primitivos do shadcn, vendorizados pelo CLI | **nao.** Atualizar o primitivo sobrescreveria a edicao, e a diferenca so apareceria num comportamento sutil de teclado meses depois (ADR 0024) |
| `src/components/layout/` | a casca: navegacao lateral, cabecalho, seletor de loja, busca global, sino, menu do usuario, tab bar, provedor de tema | sim |
| `src/components/comum/` | **tudo o mais que duas ou mais telas reusam** | sim |

Colocado (`app/<rota>/_components/`) e o padrao de partida. **Um componente so
sobe para `comum/` quando a SEGUNDA tela precisa dele.** Subir na primeira e
inventar uma abstracao para um caso — e a assinatura fica errada, porque foi
desenhada olhando so metade do problema.

---

## 2. Servidor por padrao

O componente nasce **server**. Vira `"use client"` so quando precisa de uma
destas quatro coisas: estado, efeito, ouvinte de evento do navegador ou API do
navegador.

Quando precisar, empurre o `"use client"` para a folha. Um formulario inteiro
marcado como cliente arrasta a arvore toda para o pacote do navegador; o que
precisa ser cliente e o campo que controla, nao a pagina.

**Dado vem por prop, de cima.** A casca de `(app)` resolve sessao, escopo de
loja, lojas, contadores e alertas UMA vez, no layout, e passa tudo por prop.
Componente que busca o proprio dado gera N consultas por tela e faz o portao
ser reaplicado em lugares que ninguem consegue listar.

---

## 3. Convencoes de arquivo

- Arquivo em **kebab-case**: `selo-status.tsx`.
- Componente em **PascalCase**, com **export nomeado**: `export function SeloStatus`.
  Nada de `export default`.
- **Um componente por arquivo.**
- Props com tipo explicito, declarado no proprio arquivo e exportado quando
  outro arquivo precisa dele.
- Tipo do Drizzle (`$inferSelect`) so **como tipo**. O que chega na tela e
  projecao, nunca a linha crua: `preco_custo` e `url_externa` nao saem do
  servidor.
- Maximo de 499 linhas. Pagina com mais de ~150 linhas de JSX vira `page.tsx`
  mais `_components/`.

---

## 4. Tokens: o que a trava reprova

`tests/componentes/tokens.test.ts` varre todo `src/**/*.tsx` fora de
`src/components/ui/` e reprova:

- cor em hexadecimal, `rgb()`, `hsl()`, `oklch()` ou `color-mix()`;
- classe de paleta crua (`bg-zinc-100`, `text-white`);
- **tamanho de texto cru** (`text-sm`, `text-lg`): so os sete tokens de
  `04-ui.md` secao 2.5 passam — `text-legenda`, `text-denso`, `text-corpo`,
  `text-mensagem`, `text-titulo-secao`, `text-titulo-pagina`, `text-destaque`;
- valor arbitrario entre colchetes.

Variante com seletor (`data-[state=open]:`, `aria-[...]`, `supports-[...]`) nao
conta como valor, e `env(safe-area-inset-*)` e excecao nomeada. A trava ignora
comentario, entao da para explicar o padrao proibido no proprio arquivo.

Espaco: base 4 px, passos 2/4/6/8/12/16/24/32/48. **Nao ha trava para a escala
de espacamento** — o proprio codigo da casca usa passos fora da lista
(`px-2.5`, `gap-1.5`). Liga-la exige revisar tudo primeiro.

Peso de fonte: 400, 500 e 600. **700 nao existe.**

---

## 5. Os quatro estados

Toda tela com dado entrega os quatro. Faltou um, nao esta pronta.

| Estado | O que mostrar |
|---|---|
| carregando | esqueleto com a FORMA real do conteudo (`comum/esqueletos/`), nunca um spinner centralizado |
| vazio | o que aconteceu e **qual e o proximo passo** (`comum/estado-vazio.tsx`) |
| erro | o que houve, "tentar de novo", e o codigo para o suporte (`comum/estado-erro.tsx`) |
| cheio | o conteudo |

Esqueleto que nao tem a forma do conteudo real faz a tela saltar quando o dado
chega, e o salto e pior que a espera.

---

## 6. Formulario

Padrao unico, em `04-ui.md` secao 7:

1. `comum/campo.tsx` envolve todo campo. Ele associa `label`/`htmlFor`,
   `aria-describedby` e `aria-invalid` — o defeito mais repetido do sistema
   antigo era rotulo solto, que nenhum leitor de tela ligava ao campo.
2. `comum/botao-enviar.tsx` usa `useFormStatus`: largura fixa, texto
   "Salvando...", e impede o duplo envio.
3. Erro de campo vem do `Resultado` da action (`erros`), e o formulario **nunca
   e limpo** — os valores digitados voltam em `valores`.
4. Dois ou mais erros: `comum/resumo-de-erros.tsx` no topo, focavel.
5. A mensagem de politica de senha vem do MESMO modulo do servidor. Duas
   copias divergem, e a pessoa le uma regra e leva outra.

---

## 7. Acao critica: modal com bloqueio de 3 s

`comum/modal-confirmacao-block.tsx`. A lista fechada das acoes que o exigem
esta em `04-ui.md` secao 9.1 e, executavel, em `ACOES_COM_BLOCK`
(`tests/componentes/block-3s.test.tsx`).

- Os **3 s sao fixos** e nao viram prop.
- `role="alertdialog"`, foco inicial em Cancelar.
- Esc e clique fora sao inertes enquanto bloqueado, com `aria-disabled` e nao
  `disabled` (elemento `disabled` some do leitor de tela).
- Resumo do que vai acontecer e **obrigatorio**: bloquear 3 s sem dizer o que
  esta prestes a acontecer so atrasa o mesmo clique.
- Erro aparece inline, sem fechar o modal.

**Ao ligar uma dessas acoes numa tela, acrescente o identificador a
`telasLigadas` e suba o `PISO_DE_TELAS_LIGADAS`.** Sem isso a trava vira
decoracao: ela continua verde com zero telas ligadas.

O casco fino mais `CorpoDoBlock` e obrigatorio, nao estetica: o Radix desmonta
o conteudo ao fechar, e e isso que reinicia os 3 s sem `setState` sincrono
dentro de efeito — que o lint do React Compiler reprova.

---

## 8. Enum na tela

`src/lib/ui/tons.ts` e o **unico** lugar que traduz valor de enum em rotulo
portugues e tom. `comum/selo-status.tsx` le de la.

Um segundo mapa de status em qualquer componente e a forma garantida de a
mesma etapa aparecer com dois nomes em duas telas. Papel tambem sai daqui:
`rotuloDePapel()`, com o glossario de `04-ui.md` secao 2.9 (Dono,
Administrador, Gerente, Vendedora, Somente leitura).

---

## 9. Acessibilidade

- Contraste AA. O contraste dos tokens e provado por CALCULO em
  `tests/componentes/tokens.test.ts`; a regra `color-contrast` do axe fica
  incompleta no jsdom (falta `canvas`).
- `vitest-axe` filtrado por `serious` e `critical`, com
  `expect.extend(matchers)` de `vitest-axe/matchers`.
- Alvo de toque: 24 px no desktop, 44 px em `@media (pointer: coarse)` — por
  ponteiro, nao por largura de tela.
- Foco visivel com `outline` de 2 px e offset 2 px. Nunca `box-shadow`, que
  desaparece em `forced-colors`.
- Movimento reduzido e global no CSS; o spinner leva `.movimento-essencial` e o
  esqueleto vira bloco estatico.

---

## 10. O que a tela nao pode fazer

- Prometer o que o codigo nao faz. Botao sem acao e defeito (U8).
- Formatar dinheiro, data ou telefone a mao. Tudo vem de `src/lib/formato.ts`;
  nenhum `toFixed(2)` em TSX.
- Confiar no `pode()` como controle de acesso. Ele decide o que **renderizar**;
  quem decide o que **acontece** e o portao da action.
- Chamar `exigirPermissao()` para montar menu: isso grava `recusa_403` na
  trilha e inundaria `auth_eventos` a cada carregamento de pagina.
