---
name: remove-ai-marks
description: Remove marcas invisíveis que modelos de IA deixam no texto (zero-width, tag characters de marca d'água, bidi, espaços exóticos). Use quando o usuário pedir para limpar texto gerado por IA, tirar caracteres invisíveis/ocultos, remover marca d'água de texto, ou antes de publicar conteúdo. Gatilhos: "tira as marcas invisíveis", "limpa esse texto", "remove marca d'água", "caracteres ocultos", "texto de IA", "remove-ai-marks", "clean ai text", "zero width".
---

# Remove AI Marks

Texto gerado por IA costuma vir com caracteres que não aparecem na tela mas existem no
arquivo. Uns entram por acidente (BOM, espaço fora do padrão); outros são marca d'água
deliberada — sequências do bloco Tags do Unicode que codificam ASCII invisível dentro do
texto. Colar esse texto em contrato, post, PR ou commit leva a marca junto.

Esta skill roda `scripts/remove-ai-marks.mjs`. No CI ela é o passo 10, por
`npm run ai-marks` (`--check --dir docs`).

## Passos

1. **Descubra o alvo.** Se o usuário não disser quais arquivos, pergunte ou varra o
   óbvio: `docs/`, `README.md`, o arquivo que ele acabou de citar.

2. **Reporte antes de corrigir.** Rode sem `--write` e mostre o que apareceu:

   ```bash
   node scripts/remove-ai-marks.mjs docs/modulos/conversas.md
   ```

   A saída diz arquivo, linha:coluna da primeira marca e a contagem por tipo.

3. **Corrija.** Só depois de mostrar o relatório:

   ```bash
   node scripts/remove-ai-marks.mjs --write docs/modulos/conversas.md
   ```

4. **Confirme** que o texto visível não mudou. Acentos, cedilha e emoji continuam
   iguais — se algo visível mudou, é bug, não limpeza.

## Comandos

| Situação | Comando |
|----------|---------|
| Um arquivo | `node scripts/remove-ai-marks.mjs arquivo.md` |
| Corrigir no lugar | `node scripts/remove-ai-marks.mjs --write arquivo.md` |
| Pasta inteira | `node scripts/remove-ai-marks.mjs --dir docs` |
| No CI (falha se achar) | `npm run ai-marks` |
| Texto colado / pipe | `cat texto.md \| node scripts/remove-ai-marks.mjs -` |
| Validar o próprio script | `node scripts/remove-ai-marks.mjs --selftest` |

## O que sai

| Marca | Por quê |
|-------|---------|
| Zero-width space, word joiner, BOM, soft hyphen | invisível, entra sozinho |
| **Tag characters** (`U+E0000`–`U+E007F`) | marca d'água: ASCII escondido dentro do texto |
| Variation selectors soltos | mesmo uso, escondem dados |
| Controles bidi (LRM/RLM, override, isolate) | invertem a ordem visual do texto |
| Espaços exóticos (NBSP, thin, narrow) | viram espaço comum |

## O que NÃO sai

- **Emoji com ZWJ** — o script só tira ZWJ/ZWNJ quando os vizinhos não são emoji.
- **Variation selector logo após emoji** — é o que faz o emoji renderizar colorido.
- **Acento, til, cedilha** — o PT-BR sai intacto. Este repositório é PT-BR inteiro.
- **Aspas curvas, travessão, reticências** — são visíveis e podem ser escolha do autor.
  Só mudam com `--tipografia`, e avise o usuário antes.

## Cuidados neste repositório

- **Nunca rode `--write` em pasta inteira sem mostrar o relatório antes.**
- **Rode em `src/` quando o código veio colado de fora**: zero-width dentro de string
  quebra comparação e passa despercebido em code review. É primo do defeito que o hook
  `texto-cru` bloqueia (escape unicode literal e mojibake).
- **Não rode em `node_modules`, `.git`, `.next`, `src/components/ui/`** — o script já
  ignora os três primeiros; o quarto é código vendorizado do shadcn e não se edita.
- **Antes de mandar material para o cliente** (proposta, guia, release notes): rode.
- Arquivo binário não entra (o script só olha extensão de texto).

## Quando NÃO usar

- Texto que o usuário quer preservar byte a byte (evidência, amostra forense).
- Arquivo com ZWJ/ZWNJ semântico de escrita índica ou árabe — nesses sistemas de escrita
  o juntor tem valor linguístico e o script vai removê-lo. Confirme antes.
