# ADR 0012 — Trilha unica append-only, papeis de banco e trilhas sem FK

Data: 16/09/2026
Status: Aceito

## Contexto

No sistema antigo a auditoria era best-effort ate para troca de papel (defeito
D-13): se a gravacao do log falhava, a promocao acontecia assim mesmo e ninguem
sabia quem promoveu. E a aplicacao, dona das tabelas, podia apagar o proprio
log. Uma trilha que o suspeito pode editar nao e trilha.

## Decisao

1. **Duas trilhas append-only**: `auth_eventos` (funil de sessao e seguranca) e
   `auditoria_eventos` (acoes de negocio, com antes e depois). So `criado_em`;
   nenhuma coluna de atualizacao, nenhum soft delete.
2. **Append-only no BANCO, nao so no ORM**: `REVOKE UPDATE, DELETE, TRUNCATE`
   do papel da aplicacao MAIS gatilho `trilha_imutavel()`, que levanta `P0001`
   em qualquer `UPDATE` ou `DELETE`, inclusive de superusuario. O REVOKE
   sozinho nao alcanca quem se conecta como dono; o gatilho sozinho pode ser
   desabilitado por quem tem o privilegio. Os dois juntos fecham.
3. **Dois papeis de banco**: `merlo_app` (a aplicacao, NUNCA dona das tabelas) e
   `merlo_migracao` (dono, usado por `db:migrate` e `db:backup`). Os dois nascem
   SEM SENHA na migracao, porque segredo em migracao e segredo versionado. Quem
   provisiona HML e PRD define a credencial fora dela; e linha do runbook.
4. **As trilhas NAO tem Foreign Key**, desvio nomeado da regra da casa. O
   evento tem de poder registrar ator que nao existe mais, alvo de outra loja e
   webhook que chegou no endereco errado. FK ali transformaria "gravar a prova"
   em "falhar porque a prova aponta para algo estranho", que e exatamente o
   caso em que a prova importa. A integridade e conferida por teste
   (`tests/integracao/integridade-trilha.test.ts`), nao por constraint.

## Consequencias

- A politica de gravacao e POR TIPO DE EVENTO, nao por tabela: entrada e saida
  de sessao sao best-effort (trilha nao pode impedir alguem de entrar, REQ-L3);
  promocao, rebaixamento, transferencia de posse, desativacao e anonimizacao
  sao fail-closed e gravadas ANTES do efeito, na mesma transacao.
- O gravador e `src/lib/auditoria/gravador.ts` e `src/lib/auth/trilha.ts`, os
  dois por `execute(sql...)`: as trilhas nao passam por `mutacoes.ts`, que
  existe para tabela de dominio com trava de colisao e soft delete.
