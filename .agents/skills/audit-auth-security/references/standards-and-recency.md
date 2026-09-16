# Normas e recência — a régua pública e o que muda com o tempo

> **Esta referência envelhece.** Data de corte: **02/09/2026**. Toda execução da skill **repete a
> busca na web** por advisories novos da biblioteca e do framework em uso, e registra no relatório
> a data da busca e as fontes. Sem acesso à web, isso é uma **limitação** declarada, não um "está
> tudo certo".

## 1. As três normas que governam o catálogo

### NIST SP 800-63B-4 (final, julho de 2025)

| Tema | Regra | ID no catálogo |
| :--- | :--- | :--- |
| Comprimento | **SHALL** ≥ 15 (fator único); ≥ 8 em MFA; **SHOULD** ≥ 64 máx. | B2 |
| Blocklist | **SHALL** comparar contra comuns/comprometidas — senha **inteira**, não substring | B3 |
| Composição | **SHALL NOT** exigir mistura de classes | B4 |
| Expiração | **SHALL NOT** periódica; **SHALL** forçar troca com evidência de comprometimento | B4, E8 |
| Paste / mostrar | **SHOULD** permitir | B5 |
| Dica / KBA | **SHALL NOT** | E6 |
| Falhas | **SHALL** limitar por autenticador a ≤ 100 e desabilitar; espera crescente/anti-bot/risco **MAY** | C1 |
| **E-mail OOB** | **SHALL NOT** ser fator (3.1.3.1) — exceto código de **recuperação** | D3 |
| SMS/PSTN | **restrito** (3.1.3.3); exigir alternativa | D4 |
| Phishing-resistant | AAL2 **SHALL** oferecer ≥ 1 opção; AAL3 exige | D2 |
| Sincronizáveis (passkeys) | AAL1/AAL2 OK; **SHALL NOT** AAL3 (nota: não conta para D2 em AAL3) | D2 |
| Sessão | AAL2: total ≤ 24 h SHOULD, inatividade ≤ 1 h SHOULD; AAL3: total ≤ 12 h SHALL, inatividade ≤ 15 min SHOULD | F2, F3 |
| Lookup secrets | ≥ 6 dígitos, CSPRNG, **hasheados**, uso único, com limite | D7 |
| Invalidação | **SHALL** invalidar autenticador imediatamente após aviso de perda | D10, F6 |

Fontes: `https://pages.nist.gov/800-63-4/sp800-63b.html` · `https://csrc.nist.gov/pubs/sp/800/63/b/4/final`

### OWASP ASVS 5.0.0 (30 de maio de 2025)

Capítulos que governam a skill: **V6 Autenticação**, **V7 Sessão**, **V8 Autorização**. Os que
mais reprovam sistemas reais (com o ID do catálogo):

- 6.3.4 (caminhos todos documentados, força consistente → A1, A3, A4) · 6.3.6 e-mail não é fator
  (D3) · 6.3.8 sem oráculo por mensagem/status/**tempo** (C4, E1).
- 6.4.3 reset não contorna MFA (E4) · 6.4.6 admin não escolhe a senha (E8) · 6.5.1 OTP/TOTP/lookup
  uma vez (D5, D7) · 6.5.6 fator revogável (D10).
- 7.2.4 sessão nova a cada auth (F4) · 7.3.1/7.3.2 inatividade e teto (F3, F2) · 7.4.2 desativar
  encerra sessões (F5) · 7.5.1 reauth p/ mudar e-mail (F9) · 7.5.2 ver/encerrar sessões (F6) ·
  7.4.5 admin encerra sessões (F7).
- 8.2.1/8.2.2 função e objeto com permissão explícita (H5) · 8.3.2 permissão vale imediatamente
  (H6) · 8.4.1 cross-tenant (H10) · 8.4.2 admin com camadas extras (H7).

Fontes (markdown cru): `https://github.com/OWASP/ASVS/blob/master/5.0/en/0x15-V6-Authentication.md`
· `0x16-V7-Session-Management.md` · `0x17-V8-Authorization.md`

### OWASP Top 10:2025 — A07 *Authentication Failures*

Vulnerável se: stuffing/spray; força bruta não barrada; senha fraca/padrão; aceita credencial já
vazada; recuperação fraca (KBA); senha em claro/fraca; **MFA ausente ou ineficaz**; **fallback
fraco de MFA**; id de sessão na URL; **reusa** id após login; não invalida no logout/inatividade;
não confere escopo/audiência (JWT `aud`/`iss`). Cada um tem ID no catálogo.
Fonte: `https://owasp.org/Top10/2025/A07_2025-Authentication_Failures/`

### Cheat Sheets de apoio

*Authentication*, *Multifactor Authentication*, *Forgot Password*, *Password Storage* (Argon2id
19 MiB/t2/p1 mínimo; scrypt N=2¹⁷/r8/p1; bcrypt legado ≥ 10, ≤ 72 bytes; PBKDF2 ≥ 600k SHA-256 só
FIPS), *Session Management*, *Credential Stuffing Prevention*, *HTTP Headers*. Duas frases-régua:
"o contador de falhas é da **conta**, não do IP" e "conta **não** deve ser bloqueada em resposta a
ataque de esqueci-minha-senha".

## 2. Advisories a conferir contra a versão instalada (M2)

### Better Auth

| CVE / item | O que era | Corrigido em |
| :--- | :--- | :--- |
| **CVE-2025-61928** | `createApiKey`/`updateApiKey`: criar chave **para outro usuário sem autenticação** → ATO pulando MFA | 1.3.26 (out/2025) |
| **CVE-2025-53535** | open redirect no `originCheck` (`/verify-email`, `/reset-password/:token`, `/delete-user/callback`, `/magic-link/verify`, `/oauth-proxy-callback`) | 1.3.x |
| **CVE-2026-53513** | SSRF no `@better-auth/sso` — usuário logado alcança serviços internos (CVSS 9.6) | ver advisory |
| **CVE-2026-67336** | defaults cripto inseguros em `oidcProvider`/`mcp` (aceitava `alg: none`, não exigia PKCE S256; CVSS 8.7) | 1.6.11 |
| "Security update: June 2026" | série de correções 1.6.x com advisory por item | 1.6.14+ |

Linha observada em 28/08/2026: 1.7.0/1.7.1 (referência do doc: 1.7.2). Assine
`https://github.com/better-auth/better-auth/security/advisories`.

### Next.js

| Quando | O quê | Corrigido em |
| :--- | :--- | :--- |
| mar/2025 | **CVE-2025-29927** (CVSS 9.1): `x-middleware-subrequest` forjado pula o middleware inteiro | ≥ 12.3.5 / 13.5.9 / 14.2.25 / 15.2.3 |
| mai/2026 | **13 CVEs**, 3 de **bypass de auth** sem credencial (segment-prefetch do App Router; `[locale]` padrão do Pages Router) + SSRF, cache poisoning, XSS, DoS em RSC | **15.5.18 / 16.2.6** |

Fonte: `https://vercel.com/changelog/next-js-may-2026-security-release`

## 3. Panorama de ameaças 2025–2026 (por que o fator fraco importa)

- **AiTM**: Tycoon 2FA respondeu por ~62 % do phishing bloqueado pela Microsoft em meados de 2025 e
  **detecta o pedido de passkey e força o fluxo fraco**; Evilginx/Modlishka fazem relé e capturam o
  cookie **pós-MFA**.
- **Cross-device (QR/híbrido)**: PoisonSeed (Expel, jul/2025) abusou do fluxo FIDO2 cross-device →
  `authenticatorAttachment: "platform"` em times homogêneos.
- **Device code phishing**: +37,5× até abr/2026 (Push Security, PhaaS EvilTokens); 340+ orgs M365
  (CSA); campanha assistida por IA (Microsoft, 06/04/2026). **Passkey não protege** — desligar o
  fluxo no IdP se não for usado.
- **Roubo de sessão**: SpyCloud recapturou **8,6 bi** de cookies/artefatos em 2025 e vê mais
  artefatos de sessão que senhas; Constella contou 51,7 mi de pacotes de infostealer (+72 %).
  **DBSC** GA no Chrome 146/Windows (10/04/2026) — defesa em profundidade (F11), não substitui
  teto (F2) e revogação (F6).
- **Passkeys sincronizadas**: pesquisa de ago/2026 sobre recuperação de chave privada e bypass de
  MFA em cenários específicos — ler antes de decidir passkey sincronizada × ligada ao dispositivo
  para administradores.
- **Agentes de IA**: injeção indireta **em campo** (+32 % nov/2025–fev/2026); um agente com acesso
  à caixa **lê o OTP por e-mail** de instruções escondidas numa página (Brave/Comet, ago/2025) —
  reforça "e-mail é piso de transição, não destino" (D3).

Fontes: Microsoft Security Blog (06/04/2026) · Push Security (abr/2026) · CSA Lab Space (mar–abr/2026)
· Proofpoint · WorkOS ("Passkeys stop phishing. Your MFA fallbacks undo it.") · SpyCloud Annual
Identity Exposure Report 2026 · Constella 2026 Identity Breach Report · The Hacker News (ago/2026,
passkeys) · Chrome DBSC (`https://developer.chrome.com/docs/web-platform/device-bound-session-credentials`;
W3C `dbsc-1`) · Help Net Security (24/04/2026) · Brave (Comet, ago/2025).

## 4. Como manter esta referência

A cada execução: rode a busca por "<biblioteca> security advisory <ano>" e "<framework> CVE auth
<ano>"; compare a versão instalada; some ao relatório o que for novo. Se aparecer um advisory ou
técnica recorrente, registre aqui (data + fonte), **sem apagar** o histórico — item superado é
marcado, não removido.
