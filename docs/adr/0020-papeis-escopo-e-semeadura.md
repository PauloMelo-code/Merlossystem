# ADR 0020 — Cinco papeis, escopo de loja no banco e semeadura do primeiro dono

Data: 16/09/2026
Status: Aceito

## Contexto

O sistema antigo tinha dois papeis e um cadastro publico que ficava exposto
depois de todo deploy com banco vazio (defeito D-02), com janela de corrida
entre "nao existe admin" e "crie o admin".

## Decisao

1. **Cinco papeis**, em ordem de privilegio: `dono`, `admin`, `gerente`,
   `vendedor`, `viewer`. Os tres primeiros sao de gestao e escolhem a loja;
   `vendedor` e `viewer` tem loja fixa no cadastro.
2. **A coerencia papel x loja e CHECK do banco** (`usuarios_papel_loja`): papel
   de gestao com `loja_id` nulo, papel de operacao com `loja_id` obrigatorio.
   Regra de aplicacao vira defesa em profundidade, nao a unica barreira.
3. **O escopo de loja de quem opera vem do BANCO**; parametro e cookie sao
   ignorados. Sem loja, estado que o CHECK torna impossivel, o escopo e
   `nenhuma`, que FECHA, nunca abre.
4. **Semeadura por convite**, `scripts/primeiro-dono.ts`: emite um convite com
   `bootstrap = true` e papel `admin`, imprime o link uma vez e grava
   `dono_semeado`. Quem consome nasce `dono`, e so se ainda nao houver nenhum
   dono vivo, conferido DENTRO da transacao do consumo. O script nao aceita
   credencial, nao cria usuario e nao roda no entrypoint do container.
5. `dono` NAO esta no CHECK de papel do convite. Um indice unico parcial
   permite no maximo UM convite de semeadura vivo.

## Consequencias

- Admin nao promove admin, e ninguem age sobre alvo de papel igual ou superior
  (S-17). A matriz de permissao e negacao por padrao e e conferida nos dois
  sentidos por T12: chave usada sem entrada E entrada sem tela.
