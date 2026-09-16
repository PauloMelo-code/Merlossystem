# ADR 0030 — Familia `conta:*` na matriz de permissao

Data: 16/09/2026
Status: Aceito

## Contexto

`02-seguranca.md §2.2` diz que "Meu perfil > Seguranca" nao tem chave na
matriz: qualquer sessao plena alcanca a propria conta (REQ-G1). Mas
`executarAcao` exige uma chave em toda action (trava T1). Na fundacao, as
actions de `/perfil`, `/perfil/seguranca`, sair, troca de loja ativa e
primeiro acesso usaram `lojas:ler` como remendo, por ser a unica chave
concedida a todos os papeis.

O remendo acopla coisas sem relacao: se um papel perdesse a leitura de lojas,
perderia tambem o proprio "sair".

## Decisao

Nasce `src/lib/auth/permissoes/conta.ts` com UMA chave:

| Chave | Papeis | O que cobre |
|---|---|---|
| `conta:gerir` | todos | nome, senha, fatores, sessoes, sair e loja ativa do seletor — sempre da sessao corrente |

Nao ha `conta:ler`: as paginas da conta usam `exigirSessao()` sem chave, e uma
entrada sem uso fere INV-27.

## Consequencias

- O alvo das actions da conta nunca vem do pedido (T11); por isso uma chave
  concedida ao `viewer` nao vira escrita em dado alheio.
- A trava de rbac (`tests/seguranca/rbac.test.ts`) isenta `conta:*` do INV-19
  (que e sobre dado de negocio), prova a concessao aos cinco papeis, reprova
  chave nova na familia sem passar por ela e reprova o `lojas:ler` de volta nas
  actions da conta.
