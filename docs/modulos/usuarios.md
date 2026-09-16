# Módulo de equipe e acesso (pacote M7)

Convites, papéis, loja, ativação e as cerimônias de acesso sobre a conta de
outra pessoa. Fontes: `02-seguranca.md §2.3, §9.2, §9.3, §11.2`,
`04-ui.md §5.6 e §9.1`, `01-dados.md §5.7 e §5.9`. O que é da própria conta
(senha, fatores, sessões) mora em "Meu perfil" (`src/lib/actions/seguranca.ts`,
fundação).

## Onde mora

| Caminho | Papel |
|---|---|
| `src/lib/validadores/usuarios.ts` | Zod puro: convite, troca de papel, cerimônia de admin (frase de ciência), troca de e-mail. Todos `strictObject`, nenhum com senha |
| `src/lib/usuarios/regras.ts` | regras puras: quadro de donos/admins (INV-31), destino de papel, papéis convidáveis, reativação, `acoesDisponiveis` (o que a linha oferece) |
| `src/lib/usuarios/_alvo.ts` | `travarAlvo`: `SELECT ... FOR UPDATE` do quadro + alvo + ator (sem o `ATOR_SISTEMA`), relê o papel do ator, aplica `exigirAlvoPermitido` e grava `recusa_403` |
| `src/lib/usuarios/administracao.ts` | `trocarPapel`, `promoverAAdmin`, `transferirPosse`, `desativarUsuario`, `reativarUsuario`, `encerrarConvitesAbertos` |
| `src/lib/usuarios/acesso.ts` | `destravarConta`, `iniciarResetDeSenha`, `recuperarAcessoAssistido`, `encerrarSessoesDe` |
| `src/lib/usuarios/convites.ts` | `convidarUsuario`, `reenviarConvite`: conferem escada e loja e chamam `emitirConviteEm` da fundação na MESMA transação; não enviam e-mail |
| `src/lib/usuarios/trocas-email.ts` | `iniciarTrocaDeEmail` (admin), `confirmarTrocaDeEmail` (a própria pessoa) |
| `src/lib/usuarios/_consultas.ts` | listas da tela: usuários (com e-mail, sem o `ATOR_SISTEMA`), convites abertos, lojas vivas |
| `src/lib/actions/usuarios.ts` | `trocarPapel`, `promoverAAdmin`, `transferirPosse`, `desativarUsuario`, `reativarUsuario`, `destravarUsuario`, `iniciarResetDeAcesso`, `recuperarAcesso`, `encerrarSessoesDoUsuario`, `trocarEmail`, `confirmarMeuNovoEmail` |
| `src/lib/actions/convites.ts` | `convidarUsuario`, `reenviarConvite`; enfileiram o e-mail (`enviarConvite`) só depois do commit |
| `src/app/(app)/configuracoes/usuarios/` | a tela: `page.tsx` e `_components/` (`formulario-convite.tsx`, `lista-convites.tsx`, `lista-usuarios.tsx`, `acoes-usuario.tsx`, `dialogo-ciencia-admin.tsx`, `campos-comuns.tsx`, `usar-cerimonia.ts`) |

## Tabelas

Só lê e grava tabelas da fundação, sem coluna nova: `usuarios` (papel, loja,
`ativo`, gates, bloqueio), `usuarios_convites`, `usuarios_trocas_email`,
`usuarios_sessoes` (contagem; a revogação é da biblioteca),
`usuarios_totp` e `usuarios_passkeys` (removidos só na recuperação assistida, por
`removerTodosOsFatores` da fundação),
`auth_eventos` e `auditoria_eventos` (trilhas).

## Permissões

| Action | Chave | Quem |
|---|---|---|
| tela `/configuracoes/usuarios` | `usuarios:ler_detalhe` | dono, admin |
| `convidarUsuario`, `reenviarConvite` | `usuarios:convidar` | dono, admin (convite de `admin` só pelo dono) |
| `trocarPapel` | `usuarios:editar` (+ `usuarios:rebaixar_admin` quando o alvo é admin ou dono) | dono, admin |
| `promoverAAdmin` | `usuarios:promover_admin` | só dono |
| `transferirPosse` | `usuarios:transferir_posse` | só dono |
| `desativarUsuario`, `reativarUsuario` | `usuarios:desativar` | dono, admin |
| `destravarUsuario` | `usuarios:destravar` | dono, admin |
| `iniciarResetDeAcesso` | `usuarios:iniciar_reset` | dono, admin |
| `recuperarAcesso` | `usuarios:recuperar_fator` | dono, admin |
| `encerrarSessoesDoUsuario` | `usuarios:encerrar_sessoes` | dono, admin |
| `trocarEmail` | `usuarios:trocar_email` | dono, admin |
| `confirmarMeuNovoEmail` | `conta:gerir` | a própria pessoa (alvo = sessão) |

## Regras

- **Cerimônia de toda ação sobre conta alheia**: `exigirSessaoFresca()` (15 min)
  → `exigirPermissao` → Zod com **motivo de 8 a 255** → `travarAlvo`
  (`exigirAlvoPermitido` com o papel do ator RELIDO sob trava) → regra pura →
  **trilha de `auth_eventos` gravada ANTES do efeito, na mesma transação,
  fail-closed** → efeito por `atualizarComTrava` (trava de colisão +
  `auditoria_eventos`), campo a campo → revogação das sessões do alvo.
- **Escada** (`02 §2.3`): auto-alvo recusado; alvo estritamente inferior; só
  `dono` age sobre `dono`. Recusa = `403 SEM_PERMISSAO` + `recusa_403` com
  `detalhes.motivo = "alvo"`, e nenhuma coluna muda. Não existe código
  `ALVO_NAO_PERMITIDO` na resposta: diria a quem sonda que a pessoa existe
  (ADR 0032).
- **Quadro (INV-31)**: nunca zero dono, nunca mais de 2 donos ativos, nunca
  zero admin ativo. Só recusa o que a operação PIORA — o sistema recém-semeado
  (1 dono, 0 admin) não trava a primeira promoção. O `FOR UPDATE` em ordem de
  `id` serializa duas ações concorrentes; a segunda relê o quadro e o papel do
  ator já com o efeito da primeira (rebaixamento cruzado de dois donos: um
  passa, o outro recebe 403).
- **Transferir posse**: o alvo precisa ser `admin` ativo; ele vira `dono` e quem
  transfere vira `admin`. As sessões dos dois caem.
- **Dono e admin precisam de passkey E aplicativo** (H7, ADR 0029): promover,
  transferir e reativar conta de administração são recusados enquanto o alvo não
  tiver os dois fatores.
- **Trocar papel** nunca leva a `dono`; leva a `admin` só no rebaixamento de um
  dono. Conceder `admin` é `promoverAAdmin`, com a frase de ciência
  (`CIENCIA_ADMIN_V1`, "CONCEDO ACESSO DE ADMINISTRADOR") digitada. A versão
  vai para `auth_eventos.detalhes.ciencia_versao` (promoção, transferência e
  convite de admin) e, no convite, também para `usuarios_convites.ciencia_versao`.
- **Desativar** conta em provisionamento também zera `precisa_configurar_fator`
  e aposenta os convites abertos do e-mail: ela passa a cair no item 2 de
  `podeCriarSessao` (desativada). **Reativar** exige conta que já concluiu o 2º
  fator; quem nunca concluiu volta por convite novo ou recuperação assistida.
- **Destravar** conta que não está bloqueada responde `409 CONTA_LIVRE`.
- **Reset por admin** nunca define senha (E8): dispara o mesmo
  `requestPasswordReset` do "esqueci a senha", derruba as sessões e grava
  `reset_solicitado` antes. Cooldown de 60 s por conta (`reset:<id>`,
  `SET NX EX 60`) com resposta idêntica; Redis fora do ar deixa passar.
- **Recuperação assistida** (§9.3): o motivo registra COMO a identidade foi
  confirmada. Efeito: `precisa_configurar_fator = true`,
  `two_factor_enabled = false`, TODAS as passkeys e o TOTP removidos por
  `removerTodosOsFatores` (`src/lib/auth/fatores.ts`: adaptador do Better Auth,
  tabelas `compliance:framework`, ADR 0029), sessões revogadas,
  link de redefinição enviado e aviso `recuperacao-assistida`.
- **Convite**: `dono` não é convidável (Zod + CHECK). E-mail com conta ou com
  convite válido é recusado; convite vencido e não usado é fechado por
  `fecharConviteVencido` (trilha `convite_expirado`) antes de emitir outro.
  **Reenviar** aposenta o convite aberto e emite outro na mesma transação. A
  emissão é `emitirConviteEm` (fundação), que grava `convite_emitido` e NÃO
  envia: a action chama `enviarConvite` depois do commit, para um rollback não
  deixar link morto na caixa da pessoa. O link volta **uma vez** para quem
  emitiu (enquanto não há provedor de e-mail) e nunca vai para o log.
- **ATOR_SISTEMA** (ADR 0031): a linha semeada que assina worker e webhook não
  aparece na lista e não é alvo de ação nenhuma (responde 404).
- **Troca de e-mail** (E12): o admin inicia; um código de 6 dígitos, válido por
  10 min, vai ao endereço NOVO (assunto `email-troca-codigo`, código no
  fragmento `/perfil#codigo=`); o endereço atual recebe `email-troca-solicitada`;
  só a própria pessoa confirma, no campo de "Meu perfil"
  (`confirmarMeuNovoEmail`, sessão fresca). Confirmada, o endereço antigo
  recebe `email-trocado`. O código é comparado por `compararEmTempoConstante`
  (porta única da T17). Até lá o e-mail não
  muda. São no máximo 5 tentativas, contadas FORA da transação e antes de
  travar a linha. Nova solicitação cancela a aberta (`cancelado_motivo`).

## Tela

- O formulário de convite oferece só os papéis abaixo de quem convida
  (`papeisConvidaveisPor`); `admin` só aparece para o dono e pede a ciência.
  Vendedora e somente leitura pedem loja. Ninguém escolhe senha.
- Cada linha oferece só o que o servidor aceitaria (`acoesDisponiveis`, com
  `pode()` puro — sem trilha). A própria linha diz "use Meu perfil".
- **Bloqueio de 3 s** (`04 §9.1`, itens 10 a 17): convidar e reenviar, trocar
  papel, promover, transferir posse, desativar/reativar, iniciar redefinição,
  recuperação assistida, encerrar todas as sessões. **Sem bloqueio**: destravar
  e trocar e-mail (pedem motivo, mas não estão na lista fechada).
- `SESSAO_NAO_FRESCA` abre o `ModalReautenticacao` e a MESMA chamada é refeita
  (`usar-cerimonia.ts`). Erro do servidor mantém o modal e o formulário.

## Testes

| Arquivo | Prova |
|---|---|
| `tests/unidade/usuarios-regras.test.ts` | quadro, destino de papel, esquemas (sem campo a mais, sem senha), `acoesDisponiveis` |
| `tests/integracao/usuarios-administracao.test.ts` | convite sem e-mail antes do commit, ciência em `detalhes.ciencia_versao`, convite vencido fechado com `convite_expirado`, reenvio, troca de papel com colisão, desativar em provisionamento, promoção exigindo fatores, destravar 409, reset com cooldown sem tocar na senha, recuperação removendo todos os fatores, troca de e-mail em duas mãos com os assuntos próprios, `ATOR_SISTEMA` fora da lista e fora do alcance |
| `tests/seguranca/admin-actions.test.ts` | T14: admin sobre admin e sobre dono → 403 com trilha (`detalhes.motivo = "alvo"`) e sem efeito; dono sobre admin → passa e revoga sessões; corridas de rebaixamento e de transferência; terceiro dono; trilha fora do ar = efeito nenhum; CHECK de convite de dono; ordem trilha → efeito na fonte; e-mail do convite só na action e nenhum delete de fator fora da fundação |
| `tests/componentes/usuarios-tela.test.tsx` | convite (papéis, ciência, bloqueio, erro), ações da linha (bloqueio, sem bloqueio, reautenticação refazendo a chamada), lista (vazio, própria linha, situação em texto) |

Rodar no banco do pacote:

```
node scripts/db-teste.mjs --sufixo m7
DATABASE_URL=postgres://dev:dev@localhost:5437/merlostore_test_m7 DATABASE_URL_TESTE=postgres://dev:dev@localhost:5437/merlostore_test_m7 REDIS_URL=redis://localhost:6382/7 npm run test:integracao -- tests/integracao/usuarios-administracao.test.ts tests/seguranca/admin-actions.test.ts
```

Os testes aposentam as contas do arquivo anterior (`limparAuth`) e reaproveitam
a loja `centro-m7`: rodar duas vezes no mesmo banco não colide.

## Pendências

- O e-mail da troca de e-mail e o da recuperação assistida ainda são
  enfileirados dentro da transação. Um rollback raro deixa um código sem linha
  (a confirmação recusa e a pessoa pede outra troca) — nada de acesso indevido.
- O formulário de convite não pede nome: `usuarios_convites` não tem a coluna,
  e o nome é digitado no primeiro acesso (divergência com `04-ui.md §5.6`).
