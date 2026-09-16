---
name: audit-auth-security
description: >-
  Auditoria AGNÓSTICA DE STACK da segurança de AUTENTICAÇÃO e CONTA: login, senha, MFA/2FA
  (e-mail, TOTP, passkey/WebAuthn), reset e recuperação, sessão, tela "meu perfil",
  super-admin/dono, RBAC, público × privado, API/M2M/webhooks, borda, auditoria. Descobre a stack
  e a biblioteca de auth (Better Auth, Auth.js, Clerk, Supabase, Auth0, Django, Laravel, Spring,
  JWT caseiro…), inventaria TODOS os caminhos que criam sessão, percorre um catálogo de requisitos
  com IDs estáveis (NIST SP 800-63B-4, OWASP ASVS 5.0, Top 10:2025), simula ataques sem dano e
  entrega relatório em sinaleira com evidência. READ-ONLY, reexecutável. Dispara em: "auditoria de login",
  "auditar autenticação", "segurança de conta", "o login está seguro?", "pentest de auth",
  "revisar MFA/2FA/passkey/sessão", "account takeover", "auth security audit", "review
  authentication", "session security review". NÃO usar para escrever código de feature, nem
  auditoria fiscal, de cobrança ou de schema.
---

# audit-auth-security — auditoria de login e segurança de conta

Responda ao usuário em **PT-BR**, objetivo. Esta skill é **READ-ONLY sobre o código**: ela lê,
mede, simula sem dano e **relata**. Ela não corrige nada durante a auditoria — a correção é outra
tarefa, com o relatório na mão.

> [!CAUTION]
> **Evidência antes de veredicto.** Nenhuma linha do relatório sem `arquivo:linha` + trecho, ou
> comando + saída, ou requisição + resposta. "Parece que não tem" é ⚪ (não verificável), nunca
> 🔴. E o que **funciona** também precisa de prova — um relatório só de defeitos não é auditoria.

> [!IMPORTANT]
> **A tela nunca é o controle.** Botão escondido, `disabled`, "rota que ninguém chama", "endpoint
> que a tela não usa" — nada disso é defesa contra `curl`. Audite o que o **servidor** aceita,
> não o que a interface mostra. Isso inclui os endpoints que a **biblioteca** instala e ninguém
> pediu.

## Regras de engajamento (não negociáveis)

1. **Só ambiente autorizado.** Simulações de ataque (respostas cruas, tempo, `Origin` forjado,
   sonda **ativa** em endpoints — `POST`, credencial, cookie, tentativa de login/reset) rodam em
   **local/homologação**. Contra produção **só** com autorização escrita do dono, e nunca com
   credenciais ou dados reais de terceiros. Sonda **passiva** (`GET`/`HEAD` anônimo, ≤ 5
   requisições) pode ir direto à produção — definição em `references/threat-catalog.md`, Regras
   da simulação.
2. **Nada de mutação no repositório auditado.** Sem `Edit`/`Write` em `src/`, sem commit. O único
   arquivo criado é o relatório (fora do repo, por padrão).
3. **Não vaze segredo no relatório.** Cite a variável, nunca o valor. Trechos de código com
   segredo hardcoded entram **mascarados**. O mesmo vale para o que o PRÓPRIO ataque simulado
   capturar — cookie, token, OTP, semente TOTP: redigido no relatório, nunca cru, mesmo de conta
   de teste.
4. **Separe fato, inferência e risco residual** em toda conclusão. Cor sem evidência é palpite.
5. **Reexecução idempotente.** Mesma régua, mesmos IDs (`REQ-<letra><n>`, do primeiro ao último de
   cada domínio A–M do catálogo). Se houver relatório anterior, compare: fechado / aberto / novo /
   regrediu.
6. **Prove o ambiente antes da 1ª sonda mutante.** Rode a prova de
   `references/engagement-safety.md` e registre o host do alvo e do banco no relatório; qualquer
   host que não seja claramente local é parar e perguntar.
7. **Conta de teste é sua, canal de saída é conferido antes de martelar.** Crie a própria conta
   de teste (e-mail em domínio reservado — `.test`/`.example`/`.invalid`); nunca reaproveite conta
   de funcionário, cliente ou do dono. Antes de qualquer prova que dispara bloqueio, reset ou
   alerta real (e-mail, WhatsApp, SMS, webhook), confirme que o canal cai num sorvedouro
   controlado ou que o dono aceitou por escrito o disparo real — sem isso, ⚪. Ao terminar,
   desfaça o que a auditoria criou (conta, sessão, contador de bloqueio/limitador) e registre no
   relatório (seção "Escopo e premissas") o que foi limpo e o que ficou.
8. **Segredo real encontrado (inclusive só no histórico do git) é tratado como comprometido na
   hora.** Localize sem despejar o patch cru (`git log --all --oneline -S "<nome>"` para achar o
   commit; nunca `-p` sem máscara — o patch completo já vaza o valor no transcript antes de
   qualquer mascaramento). Nunca copie o valor para relatório, chat ou rascunho: registre
   variável, `arquivo:linha` (ou commit) e só os 4 primeiros caracteres + tamanho. Avise o usuário
   **antes de continuar a auditoria**, não no relatório final — histórico sobrevive em clones,
   forks, CI e backup mesmo removido do HEAD. Correção é sempre **rotação**; nunca teste a
   credencial contra o serviço real.

## Fluxo

### Fase 0 — Escopo (2 minutos, uma vez)

Descubra ou pergunte **uma** vez: qual sistema/repo; que superfícies existem (pública, privada,
máquina); há ambiente local/homologação para simular; há relatório anterior desta skill. Se o
usuário não souber, infira do repo e **declare** as premissas no relatório. Não bloqueie a
auditoria esperando resposta — comece pelo reconhecimento, que independe.

### Fase 1 — Reconhecimento (`references/stack-recon.md`)

Nunca escreva um achado antes de fechar esta fase. Produza, com evidência:

1. **Stack**: runtime, framework, banco, camada de acesso, hospedagem/proxy (Vercel, ALB, Nginx…).
2. **Biblioteca de auth e VERSÃO INSTALADA** (lockfile / `node_modules`, não `package.json`).
   Pacote + variável de ambiente **afirmam**; cookie e nome de tabela só **confirmam**.
3. **Todos os caminhos que criam sessão ou concedem acesso**: senha, OTP, TOTP, código de
   resgate, passkey, social, magic link, convite, callback, impersonação, API key, OIDC de CI,
   webhook, Server Action, cron. Método de **duas passadas** (descobrir o vocabulário de guardas do
   projeto → inverter e listar quem não o cita), comparando **identidade de função**, não nome.
4. **Inventário dos endpoints que a biblioteca instala** (leia o pacote instalado) × quem os chama
   no projeto. Endpoint instalado sem chamador e sem desligamento no servidor é achado.
5. **As três superfícies** e o portão de entrada de cada uma.

### Fase 2 — Catálogo de requisitos (`references/requirements-catalog.md`)

Percorra **todos** os IDs do catálogo, domínio por domínio (A a M), do primeiro ao último de cada
um. Para cada: ✅ existe (evidência) · ❌ falta (cor da
tabela; ajuste só com justificativa escrita) · ⚪ não se aplica / não verificável (qual dos dois
e por quê). Não pule domínio "porque o projeto não parece ter isso" — verifique e marque ⚪.

### Fase 3 — Modelo de ameaças e simulação (`references/threat-catalog.md`)

Para cada ataque aplicável, execute o **procedimento de prova** quando for seguro (respostas
byte-a-byte, piso de tempo, `Origin` forjado, requisição sem cookie, sonda em endpoint desligado,
bypass de middleware, requisição M2M sem credencial). Registre requisição e resposta. Onde não
for seguro ou possível, marque ⚪ e diga o que faltou.

### Fase 4 — Armadilhas da biblioteca e recência

- `references/library-gotchas.md`: confira as armadilhas conhecidas **da biblioteca e do
  framework em uso**, na versão instalada. Muitas não estão na documentação oficial.
- `references/standards-and-recency.md`: compare versões instaladas com a tabela de advisories
  **e repita a busca na web** (a tabela tem data). Registre no relatório a data da busca e as
  fontes. Se não houver acesso à web, diga isso como limitação.

### Fase 5 — Relatório (`references/report-template.md`)

Sinaleira, IDs estáveis, evidência por achado, impacto em uma frase, correção recomendada e **a
trava** (teste que lê o fonte) que impede a regressão. Depois: o que está certo, com evidência.
Por fim: ⚪, limitações, premissas e comparação com o relatório anterior.

Entrega padrão: `~/Downloads/auth-audit-<repo>-<AAAA-MM-DD>.md` **e** o resumo executivo no chat
(contagem por cor + os 🔴 em uma linha cada). Só grave dentro do repositório (`docs/security/`)
se o usuário pedir.

## O que esta skill NÃO faz

- Não corrige código, não abre PR, não muda configuração (é auditoria; a correção é a próxima
  tarefa, guiada pelo relatório).
- Não audita cobrança, fiscal, schema de banco ou lógica de negócio — só o que toca identidade,
  autenticação, sessão, autorização e as superfícies que os cercam.
- Não roda ataque contra produção sem autorização escrita, nem carga/força bruta real.

## Documento-fonte

Se existir nesta máquina, **`~/Documents/tools/login-e-seguranca-de-conta.md`** é a fonte extensa
desta skill: Parte 0 (o Norte, N0–N12) e o roteiro Better Auth (§1–§32). As `references/` desta
skill são autossuficientes; o documento acrescenta o raciocínio por trás de cada regra e as lições
de campo com o que foi medido. Leia-o quando precisar do **porquê**.
