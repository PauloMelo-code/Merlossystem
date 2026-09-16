# Modelo de ameaças — ataque → controle → procedimento de prova

Uso: para cada ataque **aplicável** ao sistema, execute o procedimento em ambiente autorizado
(local/homologação), registre requisição e resposta, e aponte os IDs de `requirements-catalog.md`
que respondem. Onde não for seguro, marque ⚪ com o motivo.

## Regras da simulação

- **Nunca** contra produção sem autorização escrita. Nunca com contas ou dados reais de terceiros.
- **Sem carga.** Prova de bloqueio usa 7–10 requisições, não milhares. Prova de limitador usa o
  mínimo que dispara o teto declarado.
- **Compare bytes, não impressões.** Salve corpos com `curl -s -o a.json` e use `diff`/`cmp`.
  Ordem de chaves JSON conta.
- **Compare tempo com amostra.** 10 repetições de cada caso, mediana; diferença consistente
  > ~50 ms entre "existe" e "não existe" é oráculo.
- **Anote a versão** do que está sendo testado (lockfile) — o achado é da versão.

## Ferramental mínimo

```bash
# corpo + status + tempo, sem seguir redirect
req() { curl -s -o "$1" -w '%{http_code} %{time_total}\n' "${@:2}"; }

# exemplo: login com e-mail inexistente vs senha errada
req a.json -X POST "$BASE/api/auth/sign-in/email" -H 'content-type: application/json' \
  -d '{"email":"naoexiste@x.test","password":"Senha-Errada-1234567"}'
req b.json -X POST "$BASE/api/auth/sign-in/email" -H 'content-type: application/json' \
  -d '{"email":"existe@x.test","password":"Senha-Errada-1234567"}'
cmp a.json b.json && echo "corpos idênticos"
```

---

## 1. Contra a credencial

| Ataque | O que viabiliza | Controles | Procedimento de prova |
| :--- | :--- | :--- | :--- |
| **Credential stuffing / password spray** | sem bloqueio por conta; sem checagem de vazamento; senha único fator | C1, C2, B3, D1 | 7 senhas erradas na mesma conta de teste → a 7ª deve responder **igual** às anteriores e em **ms** (sem KDF). Repetir de 2 IPs (ou `X-Forwarded-For` variado se a plataforma **não** sobrescrever) → deve acumular na conta. Cadastrar `Password123456!`→ recusada por vazamento |
| **Força bruta de OTP/TOTP/resgate** | tentativas ilimitadas; validade estendida; código reutilizável | D5, D6, D7 | pedir código; errar N vezes → bloqueio do 2º fator; acertar → 2ª tentativa com o mesmo código falha; conferir no banco que erro não mudou `expires_at` |
| **Enumeração de contas** | recusa distinta por motivo; SMTP no caminho | C4, E1 | matriz: inexistente / senha errada / desativada / bloqueada / senha vencida → `cmp` dos corpos + `time_total` mediano; reset de inexistente × existente idem; cadastro com e-mail existente (deve ser genérico ou exigir convite) |
| **DoS por KDF** | KDF antes de teto/bloqueio | B8, C3 | POST com senha de 1–4 MB → recusa em µs (medir); login em conta bloqueada → tempo ≈ consulta, não ≈ KDF |
| **Bloqueio como arma** | contador por conta sem saída para a vítima | C7, C9, E3 | bloquear conta de teste; verificar: e-mail de aviso chegou (uma vez em 24 h); login por passkey entra e zera contador; reset destrava; martelar conta bloqueada **não** estende `locked_until` |
| **Reuso de senha** | sem histórico; histórico fail-open | B7 | trocar para uma das 5 anteriores → recusada; simular falha de leitura do histórico (se possível) → troca recusada |
| **Unicode / normalização** | `.length` em vez de regex; NFKC ausente na blocklist | B5, B6 | campos curtos que viram `UPPER`: enviar `ßß`; blocklist com `ｐａｓｓｗｏｒｄ` (largura total) |
| **Pré-sequestro de conta (Microsoft 2022)** | cadastro cria sessão/vínculo social antes do e-mail verificado; convite avulso sobrescreve identidade existente | C10, C11 | criar conta com e-mail X sem verificar, guardar o cookie; verificar X de outro cliente → cookie antigo deve virar 401; conta com convite avulso e documento/e-mail já cadastrados → nome/documento/endereço não mudam, resposta é idêntica casada/não-casada |

## 2. Contra a sessão

| Ataque | O que viabiliza | Controles | Procedimento de prova |
| :--- | :--- | :--- | :--- |
| **Cookie roubado (infostealer)** | renovação infinita; sem tela de sessões; sem revogação | F2, F6, F5 | copiar cookie para outro cliente; usar; conferir que aparece na tela de sessões; "encerrar" → próxima requisição do clone é 401; sem uso, morre no teto absoluto (ler `expires_at`) |
| **Fixação** | mesmo token antes/depois do login | F4 | capturar `Set-Cookie` antes do login (se houver) e depois; devem diferir; após 2FA, a sessão pré-desafio não existe mais no banco |
| **Sessão sobrevive à desativação / troca de papel** | cache de permissões; desativação sem apagar sessões | F5, H6 | desativar conta de teste com sessão aberta → próxima requisição 401/redirect; remover papel → tela protegida some na próxima requisição |
| **Computador compartilhado** | sem inatividade; sem "sair" | F3, F8 | leitura de config + tela |
| **Passo sensível com cookie velho** | sem frescor | F9, D8 | 16+ min após login (ou ajustar relógio de teste): cadastrar passkey → deve pedir reautenticação |
| **Token de sessão no payload** | listagem devolve `token` | F6 | abrir a tela de sessões com DevTools → procurar o valor do cookie no payload RSC/JSON |
| **Token em `localStorage`/URL, cache do navegador** | sem `HttpOnly`; sem `Cache-Control: no-store`; sem `Clear-Site-Data` no logout | F13 | DevTools › Application: token em Web Storage? `curl -I` de página autenticada: `Cache-Control`? resposta do logout: `Clear-Site-Data`? |
| **Scanner de e-mail corporativo consome o link** | verificação/convite/magic link vira sessão ou consome token só com `GET` | F12 | `curl -sD- -o /dev/null "$LINK"` (GET, sem clicar) → não pode haver `Set-Cookie` nem consumo do token; a confirmação exige `POST` |
| **Sessões simultâneas sem teto** | nenhuma decisão sobre quantas sessões por conta | F14 | login repetido em 20 dispositivos de teste → alguma política dispara (derruba a mais antiga / recusa / avisa), ou está documentado que é livre |

## 3. Contra o segundo fator e a recuperação

| Ataque | O que viabiliza | Controles | Procedimento de prova |
| :--- | :--- | :--- | :--- |
| **AiTM (Evilginx, Tycoon 2FA)** | fatores fraseáveis; sem opção resistente | D2 | passkey cadastrada em `app.example` **não** autentica em `app-example.evil` (WebAuthn amarra origem). Se só há senha+TOTP/e-mail: achado 🟠 "sem opção resistente a phishing" |
| **Rebaixamento (downgrade)** | fallback do mesmo peso na tela; recovery fraco | D14, E7, D4 | tela de login: com passkey cadastrada, o caminho fraco está em pé de igualdade? reset cria sessão? |
| **Dispositivo "lembrado" indevido** | cookie de confiança pula o 2º fator sem prazo/revogação | D15 | copiar o cookie de "lembrar dispositivo" para outro cliente/conta → deve exigir 2º fator ou morrer no teto; troca de senha/fator derruba a confiança? a tela lista e revoga? |
| **Spoofing do remetente de e-mail de segurança** | domínio sem SPF/DKIM/DMARC alinhados | D16 | `dig +short TXT _dmarc.<domínio>`; enviar um e-mail forjado com o `From` do domínio de auth para uma caixa própria — o SPF/DKIM falha e o provedor rejeita/marca? |
| **Push bombing / replay de OOB entre sessões** | sem limite de pedidos; código aceito fora da requisição que o gerou | D17 | disparar 10 pushes seguidos → limite/number matching age; usar o código emitido no login A no desafio da sessão B → recusado |
| **Bombing de OTP/reset** | sem cooldown por conta-alvo; reenvio não invalida o anterior | D18 | 5 pedidos seguidos de código/reset para a mesma conta em 10 s → resposta idêntica mas o envio real cessa; login da vítima com a senha certa continua funcionando |
| **E-mail comprometido** | código **e** reset na mesma caixa | D3, D12, L7 | ler config; existe alerta "senha aceita sem sessão iniciada"? |
| **Substituir o autenticador da vítima** | `enable` regrava semente preservando `verified` | D10, D11, D12 | com sessão+senha de teste: `POST /two-factor/enable` → regrava? avisa o dono? exige sessão fresca? |
| **Ler semente / regenerar códigos / desligar 2FA** | endpoints do plugin vivos | D10, A2 | `curl -i -X POST $BASE/api/auth/two-factor/get-totp-uri` (e `/disable`, `/generate-backup-codes`) com sessão válida → esperado **404 sem corpo**, idêntico a `/api/auth/nao-existe` |
| **Cross-device (QR) phishing** | menu de QR no login | — | inspecionar `authenticatorAttachment`; time homogêneo → `platform` |
| **Device code phishing** | fluxo *device authorization* habilitado no IdP | — | se há IdP externo (Entra, Okta…), conferir se o fluxo está desligado |
| **SIM swap** | SMS como fator/recuperação | D4 | `grep` |
| **Push bombing** | push sem limite/number matching | ASVS 6.6.4 | config do provedor |
| **Token de reset em dump/log/Referer** | token em claro; `?token=` | E2, K3 | pedir reset; `SELECT identifier, value FROM verification` → deve ser hash; link do e-mail usa `#`? logs do servidor contêm o token? |
| **Reset pula o 2º fator** | `autoSignIn` no reset | E3, E4 | resposta do `POST /reset-password` **sem** `Set-Cookie` |
| **Duplo envio / corrida** | consumo não atômico | D5, E2 | dois `POST /reset-password` **simultâneos** com o mesmo token (`&` no shell) → exatamente um 200 |
| **Troca de senha obrigatória contornada** | `must_change_password` só na tela, não na action | E11 | com o flag ligado na conta de teste: chamar a Server Action/endpoint de outra tela diretamente → deve ser recusada, não só a navegação |
| **Sequestro por troca de e-mail** | e-mail novo passa a valer sem confirmar; antigo não é avisado | E12 | pedir troca de e-mail sem confirmar, depois pedir reset → o link cai no e-mail **antigo** ou no **novo** não confirmado? o antigo recebeu aviso com instrução de contestação? |
| **Senha temporária previsível ou eterna** | geração fraca; sem expiração própria | E13 | senha temporária de convite/reset administrativo é sequencial/curta? conta nunca logada meses depois: a temporária original ainda funciona? |
| **Reset como arma de negação de serviço** | pedido/tentativa de reset alimenta o bloqueio de login (C1) | E14 | 10 pedidos de reset seguidos para a conta de teste → login com a senha certa continua entrando (não deve bloquear) |

## 4. Contra o privilégio

| Ataque | O que viabiliza | Controles | Procedimento de prova |
| :--- | :--- | :--- | :--- |
| **Convite com papel de dono** | convite carrega qualquer papel; resgate não revalida | H1, H2 | com usuário `create:users` (não dono): criar convite com papel que contém o privilégio máximo → recusado; se houver convite antigo com esse papel, resgatar → conta nasce **sem** ele e há trilha |
| **Auto-promoção** | sem guarda de auto-alvo | H2, H3 | ator == alvo → recusado (promover, revogar, desativar) |
| **Chave de API com privilégio máximo** | sem regra/`CHECK` | H1, I1 | `INSERT`/`UPDATE` direto no banco de teste com o privilégio → violação de `CHECK` |
| **Sistema sem dono** | sem `ultimo_dono` | H3 | tentar desativar/revogar o último dono → recusado |
| **Abuso interno** | admin escolhe senha; sessões do alvo sobrevivem | E8, H4 | fluxo administrativo de reset: senha temporária? `must_change`? sessões do alvo caem? motivo exigido? trilha antes? |
| **Permissão que "cola"** | cache/JWT com roles | H6 | tirar papel → efeito na próxima requisição |
| **Bypass de middleware** (Next) | auth só no middleware/proxy | A5, H5 | `x-middleware-subrequest` forjado (CVE-2025-29927) e prefetch de segmento (`Next-Router-Prefetch`, `?_rsc`) contra rota protegida → deve continuar barrando; a página confere sessão por conta própria? |
| **Server Action sem guarda** | `'use server'` em módulo utilitário; `if (access && !has)` que só barra logado | A3, H5 | todo export de módulo `'use server'` começa por `require*`? identificadores de action legíveis no bundle são endpoints; chamar um sem sessão |
| **Cross-tenant** | escopo vindo do corpo | H10 | `company_id`/`tenant` no corpo é ignorado/422? forjar o de outro tenant |
| **Account linking por e-mail não verificado (login social)** | IdP social aceito sem `email_verified`; casamento de conta por e-mail, não por (`iss`,`sub`) | A7 | cadastrar no IdP social um e-mail igual ao de uma conta local já existente, sem verificá-lo lá → não pode vincular/entrar como a conta local |
| **Abuso de impersonação ("entrar como")** | sem trilha, sem exclusão do próprio privilégio máximo, sobrevive a troca de credencial | H11 | impersonar o portador do privilégio máximo → recusado; trocar a própria senha/e-mail durante a impersonação → recusado; a trilha grava ator ≠ alvo? |
| **IDOR / mass-assignment (BOLA/BOPLA)** | id de outra conta aceito sem checar escopo; campo de privilégio aceito por update genérico | H12 | repetir uma action trocando o id para o de outra conta de teste → 403/404; enviar `role`/`is_active` no corpo de um update comum → ignorado ou 422 |

## 5. Contra a borda e a integração

| Ataque | O que viabiliza | Controles | Procedimento de prova |
| :--- | :--- | :--- | :--- |
| **CSRF em ação mutante / login CSRF** | sem checagem de `Origin`/`Sec-Fetch-Site`; `SameSite=None` | J1, J7 | POST mutante com `Origin: https://evil.example` → **403**; sem `Origin` → recusado; ler `SameSite` do cookie |
| **Open redirect no callback de auth** | `callbackURL`/`next` não validado | J3 | `?next=https://evil.example` / `//evil.example` / `/\evil` → deve cair no caminho padrão (CVE-2025-53535) |
| **Origem derivada de `request.url` atrás de proxy** | comparação com o host interno | J1 | em produção/homologação atrás de proxy: origem **correta** sem cookie → **401**, não 403 (403 aqui = toda escrita quebrada) |
| **XFF forjado** | primeiro salto do `x-forwarded-for` confiado fora de plataforma que sobrescreve | C6 | duas requisições com `X-Forwarded-For` diferentes → gravam o **mesmo** IP real? (se a plataforma sobrescreve). **Medir**, não supor |
| **Limitador em memória por instância** | `Map`/memória em serverless | C2 | ler `storage`/`store`; em serverless, memória = `max × instâncias` |
| **Webhook sem assinatura** | capability URL nua | I8 | POST forjado no webhook → recusado **antes** de escrever; conferir verificação de assinatura no controller, não só no middleware |
| **Promessa falsa de segurança** | rótulo sem implementação | I6 | `grep -ri "hmac\|anti-replay\|assinatura\|signed"` em telas/docs/Swagger × existe cálculo real? (só o hash do segredo guardado ⇒ não há como recalcular assinatura) |
| **Segredo M2M estático em CI** | variável fixa nos workflows | I7 | `grep` de segredo nos workflows; há OIDC com `repository` por igualdade exata? |
| **Clickjacking / XSS / cookie sem HttpOnly** | sem `frame-ancestors`; sem CSP; cookie legível por JS | J4, J5, F1 | `curl -I` os cabeçalhos; `Set-Cookie` tem `HttpOnly`? |
| **Dependência vulnerável** | versão atrás dos advisories | M2 | lockfile × `standards-and-recency.md` + `npm/pip/bundle audit` |
| **Erro do driver no log** | log cru do banco | K4 | provocar violação de UNIQUE em teste; o log traz `Key (col)=(valor)`? |
| **Agente de IA / injeção indireta lendo OTP** | e-mail/magic link como fator; agente com acesso à caixa | D3 | não simular; registrar como risco se o piso é e-mail e o público usa navegador com agente |
| **Guarda por resolver ausente (GraphQL/gRPC/tRPC)** | um único endpoint expõe N operações; alias/lote burlam o limitador por requisição | A8 | mutação de login repetida 20× por alias na MESMA requisição GraphQL → deve bloquear na N-ésima operação; introspecção expõe mutações sensíveis em produção? |
| **Rota interna sem defesa real** | só obscuridade ou segredo estático comparado com `===` | I12 | `curl` direto na rota de cron/health/admin sem segredo → 401/404; com segredo, comparação em tempo constante? |
| **Confused deputy entre serviços** | gateway valida, serviço confia em cabeçalho nu | I13 | chamar o serviço **por dentro** da rede com `X-User-Id` de outra conta, sem passar pelo gateway → deve ser ignorado/401 |
| **Servidor OAuth/OIDC próprio mal configurado** | `redirect_uri` frouxo; PKCE `plain`/ausente; código reutilizável; refresh sem rotação | I14 | testar `code_challenge_method=plain`, reuso do `code`, `redirect_uri` com sufixo, `response_type=token` → todos recusados |
| **Credencial de API na URL** | chave em query string fica em log de proxy/CDN/histórico | I15 | `curl "$BASE/api/x?api_key=$KEY"` sem cabeçalho → deve ser 401; log do proxy retém a URL completa? |

---

## O que fazer com um achado

1. **Confirme o impacto**, não só a condição. "Sem bloqueio por conta" só é 🔴 se, provado, N
   senhas erradas não são barradas. Anexe a prova.
2. **Registre a versão** (lockfile) — o achado é da versão instalada, e some numa atualização.
3. **Aponte a correção e a trava** (o teste que lê o fonte e impede a regressão) — o relatório
   fecha o ciclo, não só o abre. Ver `report-template.md`.
4. **Nunca corrija durante a auditoria.** A correção é a próxima tarefa, com o relatório na mão.
