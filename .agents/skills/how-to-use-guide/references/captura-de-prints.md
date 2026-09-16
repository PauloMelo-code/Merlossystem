# Captura de prints e anonimização

## 0. ANTES DE TUDO: a captura é READ-ONLY

> [!CAUTION]
> **O `.env` local desta máquina aponta para o banco de PRODUÇÃO** (`DATABASE_URL` ativo é o host
> Aiven; a linha do `localhost` está comentada). Ou seja: o `npm run dev` que você usa para tirar
> print está lendo **dados reais de clientes reais**.
>
> Portanto o roteiro de captura só pode **navegar, abrir painel e preencher campo**. É PROIBIDO:
> - enviar o formulário do checkout (criaria cliente, assinatura e **cobrança de verdade no gateway**);
> - clicar em Salvar de qualquer modal, em "Receber", "Cancelar", "Estornar" ou em ação em massa;
> - rodar importação/sincronização "para a tela ficar bonita".
>
> Preencher input é seguro (é só estado do React). **Clicar em submit não é.** Se o guia precisa
> mostrar a tela de sucesso, use um plano de teste em ambiente com banco local — nunca o de produção.

## 1. Pré-requisitos

| Item | Valor |
| :--- | :--- |
| Servidor | `npm run dev` (Next + Turbopack) na porta **3000** — está em `.claude/launch.json` |
| Usuário | um login ERP válido (e-mail + senha), com permissão nas telas do guia |
| Viewport | 1440 × 900, `deviceScaleFactor: 2` (o print entra em 150 mm; 2x mantém o texto nítido) |
| Tema | **claro**, sempre |

## 2. Login: formulário, não cookie

> [!IMPORTANT]
> O Better Auth grava a sessão em `better-auth.session_token` com **`httpOnly: true`** (verificado no
> pacote). Logo o cookie **não aparece** em `document.cookie` e não há valor para copiar do DevTools
> e injetar. Qualquer tentativa de `Network.setCookie` com valor inventado só produz redirect para
> `/login`.

O caminho que funciona é fazer login de verdade. A tela `/login` tem `#email`, `#password` e o botão
**Entrar** (`SignInForm.tsx`), e é o que `scripts/capturar-prints.mjs` dirige:

```js
await preencher('#email', EMAIL)
await preencher('#password', SENHA)
await clicar('Entrar')          // aguarda o redirect para /dashboard
```

Falha de login **aborta a captura** de propósito: sem isso o script sai tirando 10 prints da tela de
login e o erro só aparece no PDF.

## 2.1 Reaproveitar sessão sem digitar senha

No Windows não existe o problema de Keychain do macOS: perfil com sessão + `--headless` funciona.
Ainda assim, reaproveitar a sessão é o caminho quando **o login não é formulário nosso** — Clerk,
Better Auth com antibot, SSO — porque aí não há campo para preencher.

```bash
# Sobe o Chrome VISIVEL a partir do perfil; faca o login a mao na primeira vez.
# O perfil em .tmp_guia/perfil-chrome guarda a sessao para as proximas execucoes.
GUIA_HEADED=1 node .claude/skills/how-to-use-guide/scripts/capturar-prints.mjs \
  .tmp_guia/perfil-chrome .tmp_guia/prints

# Ou anexa a um Chrome JA ABERTO onde alguem logou:
GUIA_CDP_PORT=9500 node .claude/skills/how-to-use-guide/scripts/capturar-prints.mjs \
  .tmp_guia/perfil-chrome .tmp_guia/prints
```

No modo attach o script **não mata** o Chrome do usuário ao terminar. O roteiro detecta sessão viva
sozinho e só exige e-mail/senha quando não há nenhuma.

## 3. Tema claro — force, não confie no default

O provider é `next-themes` com `attribute="class"`, `defaultTheme="system"`, `enableSystem`
(`src/app/(erp)/providers.tsx`). "System" no Chrome headless normalmente cai em claro, mas não é
garantido — e o tema fica gravado em `localStorage` da máquina. Force os dois lados:

```js
await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
await avaliar(`localStorage.setItem('theme','light')`)   // antes de navegar para a área logada
```

Confira no print: `document.documentElement.className` **não** pode conter `dark`.

## 4. Valores em dinheiro: use a máscara NATIVA da aplicação

O ERP já tem privacidade de valores embutida (o olho 👁 no cabeçalho, `ValuePrivacyContext`). Ela
funciona por atributo no `<html>`:

```js
await avaliar(`document.documentElement.dataset.valuePrivacy = 'masked'`)
```

O CSS do próprio app troca todo `.bt-sensitive-value` por `••••` (`VALUE_PRIVACY_MASK`). Vantagem
sobre borrão: sai **limpo**, o leitor entende que é ocultação intencional e a diagramação não muda.

> [!WARNING]
> A máscara cobre só o que passa por `SensitiveValue` / `SensitiveCurrency`. **Valor escrito solto,
> rótulo de gráfico, total dentro de modal e texto de toast podem escapar.** Depois de mascarar,
> olhe o PNG e confirme. O que escapar entra na anonimização do passo 5.

Quando o guia é do **cliente final** sobre a cobrança dele, o valor às vezes PRECISA aparecer — nesse
caso não mascare: use um valor de exemplo redondo (R$ 199,00) e um nome fictício.

## 5. Anonimização — o que cada tela expõe

`scripts/anonimizar.js` detecta a coluna pelo **texto do cabeçalho** (`<th>`), não por posição fixa.
É o que faz o mesmo script servir em várias telas: os cabeçalhos reais são "Nome", "Documento",
"Email", "Telefone", "Cliente", "Descrição". Coluna casada vira nome fictício (`ÓTICAS EXEMPLO LTDA`)
ou máscara de documento; o resto da tela fica intacto.

Além da tabela, sempre trate:

| Elemento | O que aparece | Ação |
| :--- | :--- | :--- |
| Rodapé da sidebar | **iniciais, nome e cargo** do operador logado (o e-mail e a lista de cargos só aparecem no dropdown, que nasce fechado) | a camada 5 do `anonimizar.js` troca por usuário fictício — alvo estrutural (`footer button[aria-label*="menu do usu"]`), não por padrão de e-mail |
| Modal / painel lateral | nome e documento do cliente, endereço, telefone | substituir por fictício (borrão no meio da explicação atrapalha) |
| Campo de e-mail | e-mail real | usar `financeiro@suaempresa.com.br` |
| Linha digitável / QR / copia-e-cola | dado de cobrança real | truncar; nunca sair completo |
| Tabela grande | muitas linhas, conteúdo irrelevante ao passo | pode ir de borrão |

Critério: **borrão** quando o conteúdo não importa para o passo; **substituição** quando o leitor
precisa entender o bloco.

## 6. Mapa das telas deste projeto

O mapa de rota → dado sensível **deste** projeto está na seção "Anonimize sempre" do
[`../SKILL.md`](../SKILL.md). É a fonte única: mantenha lá, não duplique aqui.

Antes da primeira captura, confira se a tabela ainda bate com a aplicação — tela nova que exponha
dado pessoal precisa entrar nela **antes** de alguém gerar um guia.

> [!TIP]
> O cabeçalho global costuma trazer o nome da tela por rota. Se o seu projeto faz isso, o print já
> vem com o nome — **use esse nome no texto do passo**, não um sinônimo. E fique atento a
> divergência entre o rótulo do menu e o título do cabeçalho: se existir, o guia deve usar o que o
> usuário vê primeiro.
