# Caminhos de acesso — tabela unica de rotas

Fonte unica de "o que existe e quem alcanca". Sai da arvore canonica de
`01-dados.md` secao 13.2 e de `04-ui.md` secao 4.1, e e a fonte da trava T2
(`tests/seguranca/inventario.test.ts`).

**Como ler a coluna `estado`**

- `entregue` — o arquivo existe em `src/app` e o portao esta ligado.
- `pacote Mx` — a rota e da onda 2. Ainda nao existe no disco, e por isso um
  link para ela hoje e 404.

**O que a trava cobra hoje**: a direcao "rota existe em `src/app` implica linha
nesta tabela". A direcao estrita — "linha nesta tabela implica rota em
`src/app`" — entra no pacote de INTEGRACAO (onda 3), quando a ultima rota da
onda 2 nascer. Ligar a direcao estrita agora reprovaria o repositorio inteiro
por 40 rotas que ainda nao e hora de existirem.

**Regras que valem para a tabela toda**

- Negacao por padrao: rota privada sem chave na matriz de `02-seguranca.md`
  secao 2.2 nao existe. A coluna `permissao` com `sessao ativa` significa
  alcancavel por qualquer sessao plena, sem chave — e o caso de `/perfil`
  (REQ-G1).
- **Token nunca em segmento de rota.** `/primeiro-acesso` e
  `/redefinir-senha` nao tem `[token]`: o componente cliente le de
  `location.hash`, limpa com `history.replaceState` e envia o token no CORPO do
  POST. Token em path vai para log de proxy, cabecalho `Referer` e historico do
  navegador.
- Toda rota privada tambem passa pelo escopo de loja. Registro de outra loja
  responde **404**, nunca 403: confirmar que existe ja entrega o que o escopo
  esconde.

---

## 1. Publicas (sem sessao)

O manifesto executavel destas linhas e `src/lib/seguranca/rotas-publicas.ts`.
Item la sem linha aqui reprova em T2.

| Caminho | Metodos | Portao | Por que pode existir sem sessao | Estado |
|---|---|---|---|---|
| `/entrar` | GET | publica | e a porta: quem chega ainda nao tem sessao | entregue |
| `/entrar/verificar` | GET | publica | segundo fator por TOTP; passkey resolve em `/entrar` | entregue |
| `/primeiro-acesso` | GET | publica | consumo de convite; o token vem do fragmento | entregue |
| `/esqueci-a-senha` | GET | publica | pedido de redefinicao; resposta sempre igual | entregue |
| `/redefinir-senha` | GET | publica | consumo do token de reset, vindo do fragmento | entregue |
| `/api/auth/[...all]` | GET, POST | proprio (Better Auth) | protocolo da biblioteca | entregue |
| `/api/saude` | GET | publica | liveness do orquestrador; nao toca dependencia | entregue |
| `/api/pronto` | GET | maquina | readiness; segredo em cabecalho, comparado em tempo constante | entregue |
| `/api/csp` | POST | publica | coletor de violacao da CSP em Report-Only | entregue |
| `/api/webhooks/whatsapp` | GET, POST | maquina | Meta entrega evento; HMAC-SHA256 do corpo cru | pacote M5 |
| `/api/webhooks/instagram` | GET, POST | maquina | mesmo HMAC, token de challenge proprio do canal | pacote M5 |
| `/api/webhooks/uazapi/[integracaoId]` | POST | maquina | segredo POR INTEGRACAO, so em cabecalho | pacote M5 |
| `/api/integracoes/bling/callback` | GET | proprio (OAuth) | redirect do provedor; `state` assinado, uso unico, 5 min | pacote M5 |

**Nao existem, e nunca existiram**: `/login`, `/registrar`, `/api/register`,
`/primeiro-acesso/[token]`, `/redefinir-senha/[token]`, `/api/media/*`. Rota
publica com segmento `[token]` reprova em T27.

---

## 2. Privadas — atendimento

| Caminho | Permissao | Estado |
|---|---|---|
| `/` (redireciona para `/conversas`) | sessao ativa | pacote M1 |
| `/conversas` | `conversas:ler` | pacote M1 |
| `/conversas/[id]` | `conversas:ler` | pacote M1 |
| `/contatos` | `contatos:ler` | pacote M2 |
| `/contatos/[id]` | `contatos:ler` | pacote M2 |
| `/api/eventos` (SSE) | sessao ativa, reavaliada a cada 25 s | pacote M1 |

---

## 3. Privadas — vendas

| Caminho | Permissao | Estado |
|---|---|---|
| `/pedidos` | `pedidos:ler` | pacote M4 |
| `/pedidos/[id]` | `pedidos:ler` | pacote M4 |
| `/produtos` | `produtos:ler` | pacote M4 |
| `/produtos/[id]` | `produtos:ler` | pacote M4 |

Nao existe cadastro manual de produto: o catalogo e espelho do Bling (ADR
0015), e a matriz nao tem `produtos:criar`, `produtos:editar` nem
`produtos:excluir`.

---

## 4. Privadas — comunicacao

| Caminho | Permissao | Estado |
|---|---|---|
| `/campanhas` | `campanhas:ler` | pacote M6 |
| `/campanhas/nova` | `campanhas:criar` | pacote M6 |
| `/campanhas/[id]` | `campanhas:ler` | pacote M6 |
| `/modelos` | `modelos:ler` | pacote M6 |
| `/respostas-rapidas` | `respostas:ler` | pacote M6 |
| `/agendadas` | `agendamentos:ler` | pacote M6 |
| `/galeria` | `midia:ler` | pacote M3 |
| `/api/midias` | `midia:enviar` | pacote M3 |
| `/api/midias/[id]` | `midia:ler` mais escopo de loja | pacote M3 |

`/api/midias/[id]` aceita `?miniatura=1`. O bucket e privado e esta rota e o
UNICO endereco de midia do sistema.

---

## 5. Privadas — gestao

| Caminho | Permissao | Estado |
|---|---|---|
| `/alertas` | `alertas:ler` | pacote M8 |
| `/relatorios` | `relatorios:ler` | pacote M8 |
| `/auditoria` | `trilha:ler` | pacote M8 |
| `/auditoria/qualidade` | `trilha:ler` | pacote M8 |
| `/auditoria/excluidos` | `trilha:ler` | pacote M8 |
| `/auditoria/seguranca` | `seguranca:ler_eventos` | pacote M8 |

`gerente` alcanca `trilha:ler` e **nao** alcanca `seguranca:ler_eventos`:
`auth_eventos` carrega IP, agente, meio e alvo de dono e admin. A aba mostra
`email_hash`, nunca o e-mail em claro.

`/configuracoes/seguranca` **nao existe**. As tres abas de `/auditoria` sao o
lugar onde a pessoa procura.

---

## 6. Privadas — conta e configuracoes

| Caminho | Permissao | Estado |
|---|---|---|
| `/perfil` | sessao ativa (sem chave, REQ-G1) | entregue |
| `/perfil/seguranca` | sessao ativa (sem chave, REQ-G1) | entregue |
| `/configuracoes` | `configuracao:ler` | pacote M5 |
| `/configuracoes/lojas` | `lojas:criar` para gravar, `lojas:ler` para ver | pacote M5 |
| `/configuracoes/integracoes` | `integracoes:ler` | pacote M5 |
| `/configuracoes/integracoes/[id]` | `integracoes:ler` | pacote M5 |
| `/configuracoes/usuarios` | `usuarios:ler_detalhe` | pacote M7 |

**Nao existem**: `/configuracoes/equipe`, `/configuracoes/auditoria`,
`/configuracoes/lgpd`, `/configuracoes/sla`, `/configuracoes/seguranca`,
`/meu-perfil/*`.

As actions de `/perfil/seguranca` miram SEMPRE a sessao corrente. Nenhuma delas
aceita `userId` no corpo — a trava T11 reprova o identificador de usuario em
action daquela pasta.

---

## 7. Fora do R1 (tabela existe, rota nao)

Nenhum arquivo, nenhum link, nenhum item de menu. O catalogo de navegacao
(`src/lib/navegacao.ts`) marca o item como `fase: "R2"` e ele nao renderiza.

`/trocas`, `/funil`, `/lookbooks`, `/base-de-conhecimento`, `/csat`,
`/pagamentos`, e qualquer rota de TikTok ou Facebook.

Mudar o corte do R1 e editar uma linha de `src/lib/navegacao.ts` e criar a
rota. Enquanto a rota nao existe, o item nao aparece: tela que promete o que o
codigo nao faz e o defeito U8.

---

## 8. Caminhos do proxy

`src/proxy.ts` NAO decide acesso — ele so redireciona quem nao tem cookie e
injeta o nonce da CSP. O portao e da action e do Route Handler.

O matcher deixa passar intactos, sem excecao (`PREFIXOS_SEM_PROXY` em
`src/lib/seguranca/rotas-publicas.ts`): `/api/auth`, `/api/webhooks`,
`/api/eventos`, `/api/midias`, `/api/saude`, `/api/pronto`, mais
`_next/static` e `_next/image`.

Rota de maquina coberta pelo matcher reprova em T22: o proxy escreveria
cabecalho de pagina numa resposta que o provedor le como maquina.
