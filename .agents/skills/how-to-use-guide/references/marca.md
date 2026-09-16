# Marca no material

Destilado das armadilhas de branding do modelo. O registro das seis marcas da BahTech ficou de fora
de propósito — este projeto tem a sua. Os ativos e os tokens vivem em
[`../assets/marca/`](../assets/marca/); o que ainda falta lá está no `LEIA-ME.md`.

## As duas armadilhas que arruínam o PDF

Ambas já aconteceram com ativos reais.

### 1. Logotipo oficial costuma ser NEGATIVO

Muita marca distribui o logotipo em versão branca (`fill="white"`). Sobre papel branco ele fica
**invisível** — e o PDF sai com um buraco onde deveria estar a marca.

- Use o negativo **só** na faixa escura da capa (`{{LOGO_NEGATIVO}}`).
- Em página branca use o logotipo em tinta (`{{LOGO_TINTA}}`) ou o ícone colorido (`{{ICONE}}`).
- Marca sem versão em tinta: use `<img src="{{ICONE}}" alt="">NOME DA MARCA` na linha do cabeçalho.

### 2. Cor de marca não é cor de texto

Contraste é o que decide, não o gosto. Abaixo de **4,5:1** contra branco, a cor não serve para
texto, filete ou número — por mais que seja "a cor da marca".

- `--marca` é cor de **preenchimento** (faixa, badge, barra de gráfico).
- `--marca-texto` é a variante escurecida, para texto e filete em papel branco.

Os dois tokens vêm de `assets/marca/tokens.css`. Se a cor da marca já passa de 4,5:1, os dois podem
ser iguais — mas **meça antes** de assumir.

## Antes de gerar o primeiro guia

1. Coloque `logo-negativo.svg`, `logo-tinta.svg` e `icone.png` em `assets/marca/`.
2. Confira `marca.json` e `tokens.css` — label e as duas cores.
3. Rode `node .claude/skills/how-to-use-guide/scripts/preparar-marca.mjs`.

O montador **aborta** se um placeholder não tiver ativo. Isso é proposital: print ou logo faltando
viraria um retângulo escuro que ninguém nota até o cliente abrir o PDF.

## Na verificação final

- Nenhum texto, filete ou borda em `--marca` puro numa página branca.
- O `<em>` do título na capa escura **pode** usar `--marca` — ali o fundo é escuro e é proposital.
- O nome do arquivo do PDF traz a marca certa.
- O título gravado nas propriedades do PDF não diz outra marca.
