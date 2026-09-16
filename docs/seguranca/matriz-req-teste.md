# Matriz REQ x teste

Cada requisito do portao de seguranca (`02-seguranca.md` secao 19, catalogo
`REQ-A1` a `REQ-M6`) aponta para o arquivo de teste que o prova. A trava T24
(`tests/seguranca/matriz-req-teste.test.ts`) le esta tabela e reprova quando:

- um grupo de REQ nao tem nenhuma prova listada;
- a prova listada aponta para um arquivo que nao existe em `tests/`;
- o catalogo de REQ do documento de seguranca ganha um grupo que nao aparece
  aqui.

O agrupamento e o MESMO de `02-seguranca.md` secao 19. Onde o catalogo trata
dez requisitos como um bloco (`B1-B10`), a matriz trata igual: quebrar em dez
linhas identicas daria a aparencia de cobertura, nao cobertura.

**Estado**

- `entregue` — o teste existe e roda no CI hoje.
- `onda 2` — o esqueleto existe e o pacote da onda 2 o preenche; o arquivo ja
  esta listado no plano daquele pacote.

---

## 1. Superficie e portao

| REQ | O que exige | Prova | Estado |
|---|---|---|---|
| A1 | toda rota inventariada, com portao, limitador e trilha | `tests/seguranca/inventario.test.ts` | entregue |
| A2 | caminho sem chamador desligado, 404 sem corpo | `tests/seguranca/caminhos-ba.test.ts`, `tests/seguranca/caminhos-desligados.test.ts` | entregue |
| A3 | todo export `use server` passa por `acao()` ou `acaoPublica()` | `tests/seguranca/guarda.test.ts` | entregue |
| A4 | rota de maquina e rota de sessao isoladas, codigos distintos | `tests/seguranca/webhooks.test.ts` | onda 2 |
| A5 | portao em page, layout, handler e action; proxy so UX | `tests/seguranca/guarda.test.ts` | entregue |
| A6 | area publica enumerada, com origem e teto por IP | `tests/travas/rotas-publicas.test.ts` | entregue |
| A7 | sem login social, OIDC ou SAML | `tests/seguranca/auth-config.test.ts` | entregue |
| A8 | sem GraphQL, tRPC ou gRPC (coberto por A3) | `tests/seguranca/guarda.test.ts` | entregue |

## 2. Senha

| REQ | O que exige | Prova | Estado |
|---|---|---|---|
| B1-B10 | KDF, 15 a 128, HIBP fail-open, sem composicao nem expiracao, historico fail-closed, politica so onde grava | `tests/unidade/politica-senha.test.ts`, `tests/seguranca/reset.test.ts` | entregue |

## 3. Forca bruta, enumeracao e IP

| REQ | O que exige | Prova | Estado |
|---|---|---|---|
| C1 | bloqueio por CONTA, atomico e persistido | `tests/seguranca/bloqueio-conta.test.ts` | entregue |
| C2 | limitador por IP, compartilhado, fail-open com alerta | `tests/seguranca/limitador.test.ts` | entregue |
| C3 | conta bloqueada ou desativada recusada antes do KDF | `tests/seguranca/bloqueio-conta.test.ts` | entregue |
| C4 | recusa unica byte a byte, com piso de tempo | `tests/seguranca/recusa-unica.test.ts` | entregue |
| C5 | nenhuma escrita por requisicao anonima antes do limitador | `tests/seguranca/limitador.test.ts` | entregue |
| C6 | uma implementacao de IP canonico, um salto confiavel | `tests/seguranca/origem.test.ts` | entregue |
| C7 | aviso a vitima com dedupe no banco | `tests/seguranca/bloqueio-conta.test.ts` | entregue |
| C8 | sem auto-cadastro, sem conta padrao, seed fora do entrypoint | `tests/seguranca/caminhos-desligados.test.ts`, `tests/seguranca/segredos.test.ts` | entregue |
| C9 | passkey entra com conta bloqueada e zera o contador | `tests/seguranca/bloqueio-conta.test.ts` | entregue |
| C10 | sem magic link e sem OTP por e-mail | `tests/seguranca/caminhos-ba.test.ts` | entregue |
| C11 | convite nunca sobrescreve identidade existente | `tests/seguranca/convite.test.ts` | entregue |

## 4. Segundo fator

| REQ | O que exige | Prova | Estado |
|---|---|---|---|
| D1-D9 | 2o fator no provisionamento, passkey com `userVerified`, TOTP com anti-replay no banco, sem SMS, sem codigo de resgate | `tests/seguranca/auth-efeito.test.ts`, `tests/seguranca/passkey-uv.test.ts`, `tests/seguranca/totp-replay.test.ts` | entregue |
| D10-D11 | trocar de fator com reautenticacao e piso de um fator | `tests/seguranca/perfil-proibidos.test.ts`, `tests/componentes/perfil.test.tsx` | entregue |
| D12-D13 | aviso ao dono da conta, com conferencia do retorno do provedor | `tests/seguranca/trilha.test.ts` | onda 2 |
| D14-D18 | passkey como acao primaria, sem dispositivo confiavel, desafio amarrado ao login, cooldown de reset | `tests/seguranca/auth-config.test.ts`, `tests/seguranca/reset.test.ts` | entregue |

## 5. Reset, recuperacao e gates

| REQ | O que exige | Prova | Estado |
|---|---|---|---|
| E1-E6 | resposta e tempo identicos, token hasheado e consumo atomico, sessoes revogadas, sem auto-login | `tests/seguranca/reset.test.ts`, `tests/seguranca/sem-segredo-em-claro.test.ts` | entregue |
| E7-E8 | recuperacao assistida com motivo e trilha antes; admin nunca define senha | `tests/seguranca/admin-actions.test.ts` | onda 2 |
| E9-E10 | politica antes do consumo do token; vocabulario sem jargao | `tests/seguranca/reset.test.ts`, `tests/componentes/acesso.test.tsx` | entregue |
| E11 | gates de sessao reduzida em pagina E action | `tests/seguranca/sessoes.test.ts` | entregue |
| E12-E14 | troca de e-mail confirmada pelo dono da conta; sem senha temporaria | `tests/seguranca/sem-segredo-em-claro.test.ts` | entregue |

## 6. Sessao

| REQ | O que exige | Prova | Estado |
|---|---|---|---|
| F1-F14 | token fora de toda projecao, teto absoluto, revogacao por mudanca de papel, limite de sessoes simultaneas | `tests/seguranca/sessoes.test.ts` | entregue |

## 7. Meu perfil

| REQ | O que exige | Prova | Estado |
|---|---|---|---|
| G1-G8 | acoes miram a sessao corrente, nunca um `userId` do corpo | `tests/seguranca/perfil-sem-userid.test.ts`, `tests/componentes/perfil.test.tsx` | entregue |

## 8. Administracao e papeis

| REQ | O que exige | Prova | Estado |
|---|---|---|---|
| H1-H4 | escada de papeis, ciencia versionada, trilha antes do efeito, motivo obrigatorio | `tests/seguranca/admin-actions.test.ts` | onda 2 |
| H5 | matriz fail-closed, conferida nos dois sentidos | `tests/seguranca/rbac.test.ts` | entregue |
| H6-H9 | papel, loja e `ativo` lidos do banco a cada requisicao; destravar com motivo | `tests/seguranca/sessoes.test.ts`, `tests/seguranca/bloqueio-conta.test.ts` | entregue |
| H10-H12 | escopo de loja com FK composta; sem impersonacao; nenhum update espalha o corpo | `tests/seguranca/escopo-loja.test.ts` | entregue |

## 9. Superficie de maquina

| REQ | O que exige | Prova | Estado |
|---|---|---|---|
| I1-I15 | ordem fixa da rota de maquina, 401 com corpo nulo, idempotencia, segredo so em cabecalho, `state` de uso unico | `tests/seguranca/webhooks.test.ts`, `tests/seguranca/oauth-integracoes.test.ts` | onda 2 |

## 10. Borda

| REQ | O que exige | Prova | Estado |
|---|---|---|---|
| J1-J7 | cabecalhos fixos, CSP em enforce, origem conferida em toda action | `tests/seguranca/cabecalhos.test.ts`, `tests/seguranca/origem.test.ts` | entregue |

## 11. Dados e segredos

| REQ | O que exige | Prova | Estado |
|---|---|---|---|
| K1 | `process.env` so em `env.ts`, `.env.example` completo | `tests/seguranca/segredos.test.ts` | entregue |
| K2-K3 | cofre AES-256-GCM; nada em claro, salvo a excecao nomeada do token de sessao | `tests/seguranca/sem-segredo-em-claro.test.ts`, `tests/seguranca/excecoes.test.ts` | entregue |
| K4 | erro do driver nunca vai cru ao log | `tests/seguranca/segredos.test.ts` | entregue |
| K5-K6 | `timestamptz(3)` em toda coluna de instante; indices nas migracoes | `tests/travas/timestamps.test.ts`, `tests/travas/migracoes.test.ts` | entregue |
| K7-K8 | sem MongoDB; backup cifrado com o bucket junto, restaurado em HML | `docs/seguranca/runbook.md` (procedimento executado, com data) | entregue |

## 12. Trilha

| REQ | O que exige | Prova | Estado |
|---|---|---|---|
| L4 | append-only no BANCO: `REVOKE` mais gatilho `trilha_imutavel()`, provado pelo papel `merlo_app` | `tests/integracao/integridade-trilha.test.ts` | entregue |
| L1-L3, L5-L9 | funil unico de sessao, politica por tipo de evento (best-effort x fail-closed), nenhum campo proibido gravado | `tests/seguranca/trilha.test.ts` | onda 2 |

## 13. Processo

| REQ | O que exige | Prova | Estado |
|---|---|---|---|
| M1 | toda trava no CI, com esta matriz | `tests/seguranca/matriz-req-teste.test.ts` | entregue |
| M2 | versoes minimas conferidas no lockfile | `tests/seguranca/versoes.test.ts` | entregue |
| M3 | interruptor com default seguro e piso validado | `tests/seguranca/segredos.test.ts` | entregue |
| M4 | fumaca pos-deploy | `scripts/fumaca-seguranca.mjs` | entregue |
| M5 | releitura da regua a cada minor, item no PR template | `.github/pull_request_template.md` | entregue |
| M6 | `EXCECAO-SEG` com as 4 partes e sem data vencida | `tests/seguranca/excecoes.test.ts` | entregue |

---

## Excecoes abertas

Toda excecao vive no codigo como
`EXCECAO-SEG: REQ-X | motivo | decidido por | ate AAAA-MM-DD` e num ADR. A
trava T24 reprova excecao sem as quatro partes ou com data vencida.

| REQ | Excecao | Ate | ADR |
|---|---|---|---|
| K3 | token de sessao gravado em claro (a 1.7.5 nao hasheia o token de cookie) | 2026-12-15 | 0008 |
| J5 | `style-src 'unsafe-inline'` enquanto o Tailwind v4 injeta estilo | 2026-12-15 | 0023 |
| S-09 | delete fisico de linha de auth, PELA BIBLIOTECA | revisao a cada minor | 0008 |
| D7 | sem codigos de resgate; mitigado pela recuperacao assistida (E7) | permanente, com decisao escrita | 0008 |
| RN-M06 | midia soft-deletada continua sendo servida quando referenciada por mensagem | permanente, com decisao escrita | 0013 |

---

## Travas fora do catalogo REQ

Vem do modelo de dados e dos ADRs, nao do portao de seguranca. A trava T24 so
confere que o arquivo existe.

| Trava | Reprova quando | Arquivo | Estado |
|---|---|---|---|
| T25 | `db.delete`, `deleteMany`, `DELETE FROM` em qualquer lugar; consulta de dominio sem filtro de soft delete | `tests/travas/soft-delete.test.ts` | entregue |
| T26 | cliente Bling com `PUT`, `PATCH`, `DELETE` ou mais de dois `POST` (ADR 0015) | `tests/travas/bling-somente-leitura.test.ts` | entregue |
| mutacoes | `.insert(` ou `.update(` fora de `src/lib/db/mutacoes.ts` | `tests/travas/mutacoes.test.ts` | entregue |
| migracoes | parametro posicional em indice parcial; `DROP` nao revisado | `tests/travas/migracoes.test.ts` | entregue |
| enums | `CHECK` do banco divergindo da constante TypeScript | `tests/integracao/enums-check.test.ts` | entregue |
| de-para BA | valor de `CAMPOS_BA` que nao e coluna existente | `tests/integracao/ba-fields.test.ts` | entregue |
| tokens de UI | cor crua, tamanho de texto cru ou valor arbitrario fora de `src/components/ui/` | `tests/componentes/tokens.test.ts` | entregue |
| block de 3 s | acao critica sem o modal de confirmacao com bloqueio | `tests/componentes/block-3s.test.tsx` | entregue |
