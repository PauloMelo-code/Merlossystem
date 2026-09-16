# ADR 0008 — Better Auth 1.7.5 endurecido: tabelas em PT-BR, de-para unico e delete fisico de framework

Data: 16/09/2026
Status: Aceito

## Contexto

A biblioteca de autenticacao traz o proprio modelo de dados, em ingles e com
nomes fixos (`user`, `session`, `account`, `verification`). A casa exige tabela
em portugues, hierarquica, com as cinco colunas de auditoria e sem delete
fisico. As duas exigencias colidem em tres pontos, e cada um precisava de
decisao escrita antes do primeiro schema.

## Decisao

1. As tabelas nascem em portugues (`usuarios`, `usuarios_sessoes`,
   `usuarios_contas`, `usuarios_verificacoes`, `usuarios_totp`,
   `usuarios_passkeys`) e o de-para vive em UM lugar so:
   `src/lib/db/schema/_ba-fields.ts` (`CAMPOS_BA`). Um segundo mapa, em
   qualquer arquivo, e a forma garantida de os dois divergirem num minor.
2. As quatro tabelas que a biblioteca administra por dentro (sessoes,
   verificacoes, TOTP e passkeys) levam o marcador `compliance:framework` e
   NAO tem `is_deleted`. A biblioteca apaga a linha; fingir soft delete ali
   seria mentira gravada no marcador. `usuarios` e `usuarios_contas` levam as
   cinco colunas e nunca sao apagados.
3. Nada embrulha o adapter. Envelope em volta do adapter quebra a cada minor e
   a falha aparece so no login de producao.

## Excecao declarada

`usuarios_sessoes.token` e gravado EM CLARO: a 1.7.5 nao oferece hash do token
de cookie. Vai no codigo como `EXCECAO-SEG: REQ-K3` com data de revisao, e com
tres compensacoes obrigatorias: `pg_dump` cifrado com `age` antes de sair do
servidor, leitura do banco nominal pelo papel `merlo_migracao` e alerta quando
a sessao e usada de IP ou agente muito diferente do de criacao.

Delete fisico de linha de auth PELA BIBLIOTECA e excecao nomeada (S-09). Nos
nao escrevemos nenhum `DELETE`: nao existe job `limpeza-auth`.

## Consequencias

- O de-para e conferido contra o banco por `tests/integracao/ba-fields.test.ts`:
  valor de `CAMPOS_BA` que nao e coluna existente reprova.
- A regua e relida a cada minor da biblioteca (REQ-M5), e o item esta no
  template de PR. Caminho novo instalado por um minor reprova em T3.
- O marcador `compliance:framework` precisou entrar no auditor da base
  (`scripts/check-compliance.mjs`) com dois casos novos de teste.
