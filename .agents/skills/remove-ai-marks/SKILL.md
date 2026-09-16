---
name: remove-ai-marks
description: Remove marcas invisiveis que modelos de IA deixam no texto (zero-width, tag characters de marca d'agua, bidi, espacos exoticos). Use quando o usuario pedir para limpar texto gerado por IA, tirar caracteres invisiveis/ocultos, remover marca d'agua de texto, ou antes de publicar conteudo. Gatilhos: "tira as marcas invisiveis", "limpa esse texto", "remove marca d'agua", "caracteres ocultos", "texto de IA", "remove-ai-marks", "clean ai text", "zero width".
---

# Remove AI Marks

Texto gerado por IA costuma vir com caracteres que nao aparecem na tela mas
existem no arquivo. Uns entram por acidente (BOM, espaco fora do padrao); outros
sao marca d'agua deliberada — sequencias do bloco Tags do Unicode que codificam
ASCII invisivel dentro do texto. Colar esse texto em contrato, post, PR ou
commit leva a marca junto.

Esta skill roda `scripts/remove-ai-marks.mjs`.

## Passos

1. **Descubra o alvo.** Se o usuario nao disser quais arquivos, pergunte ou
   varra o obvio: `docs/`, `README.md`, o arquivo que ele acabou de citar.

2. **Reporte antes de corrigir.** Rode sem `--write` e mostre o que apareceu:

   ```bash
   node scripts/remove-ai-marks.mjs docs/relatorio.md
   ```

   A saida diz arquivo, linha:coluna da primeira marca e a contagem por tipo.

3. **Corrija.** So depois de mostrar o relatorio:

   ```bash
   node scripts/remove-ai-marks.mjs --write docs/relatorio.md
   ```

4. **Confirme** que o texto visivel nao mudou. Acentos, cedilha e emoji
   continuam iguais — se algo visivel mudou, e bug, nao limpeza.

## Comandos

| Situacao | Comando |
|----------|---------|
| Um arquivo | `node scripts/remove-ai-marks.mjs arquivo.md` |
| Corrigir no lugar | `node scripts/remove-ai-marks.mjs --write arquivo.md` |
| Pasta inteira | `node scripts/remove-ai-marks.mjs --dir docs` |
| No CI (falha se achar) | `node scripts/remove-ai-marks.mjs --check --dir docs` |
| Texto colado / pipe | `cat texto.md \| node scripts/remove-ai-marks.mjs -` |
| Validar o proprio script | `node scripts/remove-ai-marks.mjs --selftest` |

## O que sai

| Marca | Por que |
|-------|---------|
| Zero-width space, word joiner, BOM, soft hyphen | invisivel, entra sozinho |
| **Tag characters** (`U+E0000`–`U+E007F`) | marca d'agua: ASCII escondido dentro do texto |
| Variation selectors soltos | mesmo uso, escondem dados |
| Controles bidi (LRM/RLM, override, isolate) | invertem a ordem visual do texto |
| Espacos exoticos (NBSP, thin, narrow) | viram espaco comum |

## O que NAO sai

- **Emoji com ZWJ** — `👨‍👩‍👧` quebra em tres bonecos sem o juntor. O script
  so tira ZWJ/ZWNJ quando os vizinhos nao sao emoji.
- **Variation selector logo apos emoji** — e o que faz `☺️` renderizar colorido.
- **Acento, til, cedilha** — PT-BR sai intacto.
- **Aspas curvas, travessao, reticencias** — sao visiveis e podem ser escolha
  do autor. So mudam com `--tipografia`, e avise o usuario antes.

## Cuidados

- **Nunca rode `--write` em pasta inteira sem mostrar o relatorio antes.** O
  usuario precisa ver o que vai mudar.
- **Nao rode em `node_modules`, `.git`, build** — o script ja ignora.
- **Codigo tambem conta**: zero-width dentro de string quebra comparacao e
  passa despercebido em code review. Vale rodar em `src/` quando o codigo veio
  colado de fora.
- Arquivo binario nao entra (o script so olha extensao de texto).

## Quando NAO usar

- Texto que o usuario quer preservar byte a byte (evidencia, amostra forense).
- Arquivo com ZWJ/ZWNJ semantico de escrita indiana ou arabe — nesses scripts o
  juntor tem valor linguistico e o script vai remove-lo. Confirme antes.
