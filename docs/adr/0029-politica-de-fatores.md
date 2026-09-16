# ADR 0029 — Dono e admin cadastram passkey E aplicativo; conta so-passkey entra pela passkey

Data: 16/09/2026
Status: Aceito
Decisores: Paulo (decisao repassada pelo orquestrador da reconstrucao)

## Contexto

`02-seguranca.md §9.1` torna a passkey obrigatoria para `dono` e `admin` (H7) e
proibe codigo de resgate (G4). Com um fator so, perder o aparelho de quem
administra tudo vira recuperacao assistida por outra pessoa — e, sobre o
`dono`, so outro `dono` age (S-17).

Antes desta decisao, o provisionamento concluia com QUALQUER fator, inclusive
para `dono` e `admin`: nem H7 era cobrado.

Havia tambem microcopia errada: conta sem senha gravada recebia
"Senha incorreta." ao reautenticar, o que manda a pessoa tentar de novo algo
que nao existe.

## Decisao

1. **Politica por papel**, numa funcao so — `fatorQueFalta(papel, estado)` em
   `src/lib/auth/fatores.ts`:
   - `dono` e `admin`: passkey (H7) **e** aplicativo autenticador (TOTP). O TOTP
     e a porta de recuperacao, num aparelho diferente;
   - `gerente`, `vendedor`, `viewer`: um fator, qualquer dos dois.
2. **Provisionamento**: `concluirProvisionamento` so ativa a conta com a
   politica cumprida e devolve o que falta. A tela de primeiro acesso pede o
   proximo fator e diz por que.
3. **Remocao**: a ultima passkey de `dono`/`admin` nao sai (o servidor recusa e
   a tela esconde o botao). O piso de um fator continua valendo para todos.
4. **Conta so-passkey**: reautenticar e cadastrar aplicativo sem senha gravada
   respondem que o caminho de entrada da conta e a passkey. `/entrar` traz o
   mesmo aviso, FIXO para todos — a recusa unica de login (§8) continua sem
   dizer nada conta a conta.

## Alternativas consideradas

- **Duas passkeys obrigatorias**: passkeys sincronizadas moram no mesmo cofre;
  perder a conta do cofre leva as duas. Rejeitada.
- **Codigo de resgate so para dono**: reabre G4. Rejeitada.
- **`allowPasswordless` no plugin**, para conta so-passkey cadastrar TOTP:
  nenhuma conta nasce sem senha no R1 (o convite sempre grava uma), e opcao de
  seguranca do BA so entra com prova de efeito (S-18). Fica para quando existir
  caminho que crie conta sem senha.

## Consequencias

- Contas `dono`/`admin` ja ativas com um fator so NAO sao barradas
  retroativamente pelo gate de sessao; a politica vale no provisionamento e na
  remocao. Conferir as contas existentes e item do portao de entrega.
- Enquanto `allowPasswordless` estiver desligado, conta `dono`/`admin` sem senha
  nao consegue cumprir a politica sozinha. Hoje nenhum fluxo cria essa conta.
- Prova: `tests/seguranca/politica-fatores.test.ts`.
