# Ativos da marca — Merlo Store

O montador (`scripts/montar-guia.mjs`) procura estes arquivos em `.tmp_guia/marca/`;
`scripts/preparar-marca.mjs` copia esta pasta para lá.

| Arquivo | Para que | Estado |
| :--- | :--- | :--- |
| `marca.json` | label e tokens da marca | ✅ preenchido |
| `tokens.css` | `--marca` e `--marca-texto` injetados no CSS | ✅ preenchido |
| `logo-negativo.svg` | logotipo BRANCO — só sobre a faixa escura da capa | ⚠️ **falta** |
| `logo-tinta.svg` | logotipo escuro — cabeçalho de página branca | ⚠️ **falta** |
| `icone.png` | ícone colorido, funciona em qualquer fundo | ⚠️ **falta** |

Coloque os três arquivos que faltam aqui antes de gerar o primeiro guia — o montador
**aborta** de propósito se um placeholder não tem ativo (print faltando viraria um
retângulo escuro que ninguém nota).

> `--marca` (#7C3AED) é cor de **preenchimento**. Para texto, filete e número em papel
> branco use `--marca-texto` (#5B21B6). Confira o contraste antes de confiar:
> abaixo de 4,5:1 contra branco, não serve como texto.
