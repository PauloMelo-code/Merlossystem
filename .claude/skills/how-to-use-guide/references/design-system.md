# Design system do guia

O material impresso da plataforma tem que ser reconhecível como **um só** em qualquer marca. Por isso
o layout é sempre o mesmo e só os **tokens de marca** trocam — exatamente como o favicon, que é o
mesmo glifo com outra cor.

## Por que papel branco e não fundo escuro

O ERP tem tema claro e escuro; o **documento não**. Um PDF é lido na tela e impresso — fundo escuro
gasta tinta, fica cinza no papel comum e deixa o texto ilegível. A cor da marca entra em detalhes:
faixa de capa, número dos passos, filetes e blocos de destaque.

Consequência prática: **capture os prints no tema CLARO**. Print escuro sobre página branca vira um
retângulo preto no meio do guia. (Como forçar: `references/prints-do-erp.md`.)

## Tokens

Os quatro primeiros vêm de `marca.json` (gerado por `scripts/preparar-marca.ts`) e são os ÚNICOS que
mudam entre marcas:

| Token | Origem | Onde usar |
| :--- | :--- | :--- |
| `--marca` | `background` do registro | Preenchimento: faixa da capa, círculo do número, tag, cabeçalho de tabela |
| `--marca-texto` | derivado (WCAG ≥ 4,5 vs branco) | Texto colorido, filete, borda de nota, ícone |
| `--marca-fundo` | 8% da marca sobre branco | Fundo do bloco de nota |
| `--marca-glifo` | `glyph` do registro | Texto **sobre** `--marca` — branco na maioria; preto quando `--marca` for clara |

Fixos, iguais em todas as marcas:

| Token | Valor | Onde usar |
| :--- | :--- | :--- |
| `--tinta` | `#111827` | Capa, títulos, cabeçalho de tabela |
| `--papel` | `#FFFFFF` | Fundo |
| `--papel-alt` | `#F9FAFB` | Linha alternada de tabela, cartões |
| `--linha` | `#E5E7EB` | Bordas e divisórias |
| `--texto` | `#262626` | Corpo (é o `--foreground` do app) |
| `--texto-suave` | `#6B7280` | Legenda, rodapé, subtítulo |
| `--aviso` | `#B45309` | Bloco de aviso (irreversível / mexe em dinheiro) |

> [!CAUTION]
> `--marca` **pode não servir** como cor de texto: a maioria das cores de marca não alcança 4,5:1
> contra papel branco. Confira a sua antes de confiar —
> contraste contra branco fica entre 1,07 e 2,14. Texto colorido usa SEMPRE `--marca-texto`. Números
> e evidências: `references/branding-e-marca.md` §4.

## Tipografia

**Inter** (a fonte da plataforma), com fallback `-apple-system` / Helvetica. Saltos perceptíveis
entre níveis — se dois níveis diferem por 1 pt, o olho não hierarquiza:

| Nível | Tamanho |
| :--- | :--- |
| Título de capa | 34 pt |
| Título de seção | 19 pt |
| Título de passo | 13,5 pt |
| Corpo | 10,5 pt |
| Legenda / rodapé | 8,5 pt |

Rótulos pequenos (cabeçalho, rodapé, tag de cartão) vão em CAIXA ALTA com tracking positivo: abaixo
de 9 pt a caixa alta espaçada lê melhor e cria textura de "rótulo", nunca confundida com dado.

Dinheiro em tabela: alinhado à **direita**, com `font-variant-numeric: tabular-nums` — é o que
alinha as vírgulas de uma coluna de valores.

## Página

A4 (210 × 297 mm), margem de 15/16/12 mm. `.pagina` tem `height: 297mm` e `overflow: hidden`, com
`page-break-after: always` — assim uma página nunca vaza para a seguinte sem você perceber.

**Sempre confira a contagem de páginas do PDF final.** Se vier mais páginas do que `<section>`, há
transbordo: reduza a largura do print ou tire um bloco da página.

## Prints

`.print` tem 150 mm de largura, borda `--linha` e fundo `--tinta`. O fundo escuro existe para o
print claro "assentar" na página com uma moldura fina — e para um print faltando aparecer como
retângulo escuro óbvio, em vez de sumir no branco.
