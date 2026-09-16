---
name: how-to-use-guide
description: >-
  Cria um guia "como usar" em PDF de um recurso do MerlostoreChat (atendimento multicanal e CRM multi-loja da Merlo Store), escrito para quem VAI
  USAR — equipe da loja, gestor da Merlo, suporte interno — com prints reais da aplicação rodando e
  os dados pessoais anonimizados. Use quando o usuário pedir "como usar", "guia da loja", "explica as respostas rápidas", "documenta esse recurso para a Merlo",
  "guia do usuário", "manual", "tutorial para o cliente", "passo a passo", "material para mandar no
  WhatsApp", "release notes", ou "das últimas N melhorias faz um como-usar". NÃO use para
  documentação técnica interna (essa é `repo-docs-sync`), para auditoria de dados, nem para
  escrever código.
---

# Guia "Como usar" — MerlostoreChat

Produz um PDF de 6 a 10 páginas ensinando alguém a usar um recurso do sistema. O leitor não vai ler
duas vezes: ele quer saber **onde clicar** e **o que vai acontecer**.

> **Nome em inglês, conteúdo em português.** O identificador é `how-to-use-guide` por convenção
> (skill sempre em kebab-case inglês), mas tudo que ela produz é PT-BR. Quem lê é brasileiro.

## 1. Decida a AUDIÊNCIA antes de escrever

| Variante | Leitor | Vocabulário interno | Prints de onde |
| :--- | :--- | :--- | :--- |
| **Equipe da loja** (padrão) | quem atende no inbox e trabalha o pipeline | ❌ nunca | painel — inbox, pipeline, produtos, pedidos |
| **Gestor da Merlo** | quem olha analytics, metas e configurações | ❌ nunca | analytics e settings |
| **Suporte interno** | nós | ✅ é a linguagem dele | painel + logs |

> [!CAUTION]
> **Variante externa — o que NUNCA entra:** nome de provedor (Anthropic, MinIO, NextAuth), nome de tabela ou coluna (`is_deleted`, `activity_logs`), rota de API, variável de ambiente, nome de arquivo de código, **dado da outra loja** — o sistema é multi-loja (Centro e Cerro Azul). Se qualquer um desses aparecer no
> rascunho, está errado — isso é documentação interna e mora em `docs/`.
>
> **Regra de ouro:** a equipe quer saber **como responder rápido, achar o produto e mover o pedido**. Ela não precisa saber que existem duas ORMs convivendo.

> [!IMPORTANT]
> **Se o recurso mexe em dinheiro ou em dado que não volta**, a pergunta mais importante é
> **"o que NÃO acontece"**. Neste sistema:
>
> - **cada loja vê só os próprios dados** — Centro e Cerro Azul não se misturam;
> - **registro excluído não some de verdade** — é exclusão lógica;
> - **se dois usuários editarem o mesmo registro, a segunda gravação é recusada** e o sistema pede para recarregar;
> - **ação crítica pede confirmação com a tela bloqueada por 3 segundos** — é proposital, não travamento.
>
> Confirme cada uma nos docs do projeto antes de escrever — são invariantes do sistema, não opinião.

## 2. Passo 0 — preparar a marca

A marca é única (Merlo Store) e os ativos vivem em `assets/marca/`:

```bash
node .claude/skills/how-to-use-guide/scripts/preparar-marca.mjs
```

Copia `assets/marca/` para `.tmp_guia/marca/`, que é onde o montador procura. **Leia
`assets/marca/LEIA-ME.md`** — `logo-negativo.svg`, `logo-tinta.svg` e `icone.png` ainda precisam ser
colocados lá na primeira vez. O montador aborta se faltar ativo, de propósito.

> `--marca` é cor de **preenchimento**; para texto, filete e número em papel branco use
> `--marca-texto`. Cor de marca raramente tem contraste suficiente para texto.

## 3. Passo 1 — levantar o que entra no guia

Pergunte ao usuário quais recursos entram. Se ele disser "as últimas N melhorias", leia
`git log --oneline -n 20` + `git status --short` e **proponha a lista antes de escrever**.

Para cada recurso, responda três perguntas na ótica do leitor:
- Que problema isso resolve **para ele**?
- Onde ele clica?
- O que acontece depois — e, se a ação não tem volta, o que **não** acontece?

## 4. Passo 2 — capturar os prints da aplicação REAL

Nunca desenhe mockup nem descreva a tela de memória.

```bash
node .claude/skills/how-to-use-guide/scripts/capturar-prints.mjs \
  .tmp_guia/perfil-chrome .tmp_guia/prints <email> <senha>
```

Sobe o Chrome headless, faz login **de verdade no formulário**, força tema claro e salva PNG em 2x.
Edite o "roteiro dos prints" no fim do arquivo para o fluxo da vez. `.tmp_guia/prints` é o diretório
que `montar-guia.mjs` procura; o nome de cada PNG é o que você cita em `{{PRINT:nome}}`.

**Seletores reais deste projeto** (verificados no código — confira antes de editar o roteiro):

| Tela | Rota | Campos |
| :--- | :--- | :--- |
| Entrar | `/login` | `#email` e `input[type=password]`, botão `type=submit` |

Pré-requisito: `npm run dev` na porta **3005**.

> [!CAUTION]
> **Sistema multi-loja.** Faça a captura logado na loja do guia e confira, tela a tela, que nenhuma
> lista traz registro da outra loja. Se o guia é geral, diga isso no texto e use a loja de exemplo
> consistentemente — não misture as duas nos prints.

> [!IMPORTANT]
> **A porta de dev aqui é 3005**, não 3000 (`.claude/launch.json`). Ajuste `GUIA_BASE_URL` ou o
> `BASE` no `capturar-prints.mjs` antes de rodar a captura.

> [!WARNING]
> **Anonimize sempre — e confira PNG a PNG.** O que cada tela expõe:
>
> | Tela | O que expõe |
> | :--- | :--- |
> | `/inbox` | nome e telefone do cliente, conversa inteira |
> | `/contacts, /pipeline` | carteira de clientes e estágio do negócio |
> | `/orders, /returns` | pedidos, valores e trocas |
> | `/products, /gallery, /gallery/lookbooks` | catálogo e preços |
> | `/broadcasts` | listas de disparo — telefones em massa |
> | `/analytics, /alerts` | números da loja |
> | `/settings/lojas, /settings/integracoes` | **credenciais** — nunca em guia |
> | `/settings/lgpd` | solicitações e consentimentos |
>
> O script carrega `scripts/anonimizar.js`, que troca nome/documento/e-mail/telefone/endereço por
> valores fictícios. **Ajuste os nomes fictícios e o `operador` em `anonimizar.js`** para a realidade
> deste projeto antes do primeiro guia — o modelo veio com nomes de outra empresa.

> [!CAUTION]
> **Nunca escreva o JS de anonimização dentro de um template literal.** O template literal processa
> escapes: `\s` vira `s` e `\/` vira `/`, então a função lança em silêncio e os prints saem **sem
> anonimização nenhuma**, com aparência correta. Mantenha o código em `anonimizar.js` e carregue com
> `readFileSync` — é assim que o script já faz.

> [!CAUTION]
> **O banco de desenvolvimento pode ser cópia de produção.** O `capturar-prints.mjs` é **read-only**
> de propósito: o helper `clicar()` recusa botão de ação destrutiva ou de gravação (Salvar, Receber,
> Estornar, Cancelar, Excluir, Importar). Se o guia precisa mostrar uma dessas ações, use um banco
> **local** — não afrouxe a guarda.

## 5. Passo 3 — escrever as páginas

Copie o esqueleto e troque o texto — **não** escreva `<html>`/`<head>`/`<style>`, quem traz isso é o
montador:

```bash
cp .claude/skills/how-to-use-guide/assets/exemplo-paginas.html .tmp_guia/paginas.html
```

Cada página é uma `<section class="pagina">`. Ativos entram por placeholder: `{{LOGO_NEGATIVO}}` (só
na capa escura), `{{LOGO_TINTA}}`, `{{ICONE}}` e `{{PRINT:01-nome}}`.

## 6. Passo 4 — montar e gerar o PDF

```bash
node .claude/skills/how-to-use-guide/scripts/montar-guia.mjs \
  .tmp_guia/paginas.html .tmp_guia/guia.html --titulo "<título do guia>"
```

Injeta os tokens da marca, embute logo e prints em base64 (o PDF tem que ser **um arquivo único**),
grava o título nas propriedades do PDF e diz quantas páginas você escreveu. Placeholder sem ativo
**aborta** de propósito — print faltando viraria um retângulo escuro que ninguém nota. Depois:

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu \
  --no-pdf-header-footer --print-to-pdf="$HOME/Downloads/MerloStore-<Assunto>.pdf" \
  "file://$PWD/.tmp_guia/guia.html"
```

O montador já imprime o comando com o nome certo.

## 7. Passo 5 — verificação obrigatória

1. **Contagem de páginas** bate com o número de `<section class="pagina">`:
   ```bash
   python -c "import re,sys;d=open(sys.argv[1],'rb').read();print(len(re.findall(rb'/Type\s*/Page[^s]',d)))" <pdf>
   ```
   Veio **menos**? Alguma `section` não fechou. **Nunca vem mais** — `.pagina` tem `height:297mm` +
   `overflow:hidden`, então o que estoura é **recortado em silêncio**.
2. **Olhe o resultado — TODAS as páginas.** Renderize e confira; não confie no HTML. A capa é a única
   página sem print — os defeitos moram nas páginas internas.
3. **Varra vazamento — removendo o base64 antes.** Grep direto dá falso positivo (as imagens
   embutidas são megabytes de base64 e contêm qualquer sequência por acaso):
   ```bash
   python -c "
   import re
   h=open('.tmp_guia/guia.html', encoding='utf-8').read()
   h=re.sub(r'data:[a-z/+]+;base64,[A-Za-z0-9+/=]+','IMG',h)
   v=set(re.findall(r'/api/|Anthropic|MinIO|NextAuth|is_deleted|prisma|process\.env|localhost|src/lib|Cerro Azul',h,re.I))
   print(v or 'nenhum vazamento')"
   ```
4. **Confirme a anonimização print a print.** É o passo que mais falha.
5. **Confirme o título gravado no PDF** — o Chrome grava em duas formas (literal `(...)` quando é
   ASCII puro, hexadecimal UTF-16 quando tem acento), então um `grep` de uma só forma dá falso
   "sem título".

## Referências

### O método — leia antes de escrever o guia

- `references/estrutura-e-tom.md` — estrutura das páginas, tom de voz e frases-modelo
- `references/design-system.md` — tokens, tipografia, geometria da página e por que o papel é branco
- `references/captura-de-prints.md` — captura read-only, login, tema, máscara de valores e anonimização
- `references/marca.md` — as duas armadilhas de branding (logo negativo, contraste)

### Deste projeto

- `CLAUDE.md` — seção "Estado Atual do Projeto" — o que ainda diverge do padrão da base
- `docs/api.md` — as 50 rotas, com efeitos colaterais e desvios conhecidos
- `docs/regras-negocio.md` — regras do produto
- `docs/rbac.md` — quem vê o quê
- `assets/marca/LEIA-ME.md` — ativos da marca e o que ainda falta
- `assets/base.css.html` (CSS do documento) · `assets/exemplo-paginas.html` (esqueleto)
- `scripts/` — `preparar-marca.mjs`, `capturar-prints.mjs` + `anonimizar.js`, `montar-guia.mjs`
