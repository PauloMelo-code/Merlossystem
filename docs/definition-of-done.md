# Definition of Done

Checklist do que precisa estar verde antes de dizer "pronto". Item que nao pode
ser conferido por comando vem com a pergunta que substitui o comando.

Nada aqui e opcional por ser "so um ajuste": o defeito que chega em producao
quase sempre entrou por um caminho que alguem considerou pequeno demais para
conferir.

---

## 1. O comando

```
npm run verificar
```

Ele encadeia, nesta ordem: `lint`, `typecheck`, `compliance`,
`test:compliance`, `test:travas`, `test` (os quatro projetos) e `docs:check`.

Verde aqui e o piso, nao o teto. Os itens abaixo sao o que o comando NAO
consegue conferir.

Antes do commit, tambem: `npm run lixo`.

---

## 2. Banco e dados

- [ ] Toda tabela nova tem as cinco colunas de auditoria (`created_at`,
      `updated_at`, `deleted_at`, `is_deleted`, `modified_by`), espalhadas como
      `...colunasAuditoria`, sem alias.
- [ ] Toda FK tem `ON DELETE RESTRICT` e `ON UPDATE RESTRICT`. Onde pai e filho
      tem `loja_id`, a FK e composta.
- [ ] Nenhum `DELETE` fisico. Exclusao e `excluirLogico()`.
- [ ] Toda consulta de dominio filtra `is_deleted = false` (helper `vivos()`).
- [ ] Toda gravacao passa por `src/lib/db/mutacoes.ts`. Nenhum `.insert(` ou
      `.update(` em outro arquivo.
- [ ] Toda tabela que duas pessoas podem editar ao mesmo tempo usa
      `atualizarComTrava()`. As excecoes sao a lista fechada de `01-dados.md`
      secao 4.7.
- [ ] Coluna de instante e `timestamptz` com `precision: 3`.
- [ ] Lista fechada nova tem constante TypeScript E `CHECK` gerado dela.
- [ ] Migracao lida ANTES de aplicar. O drizzle-kit gera `DROP` quando renomeia.

---

## 3. Seguranca

- [ ] Todo export de arquivo `"use server"` passa por `acao()` ou
      `acaoPublica()`. Nenhum `export const` naquele arquivo.
- [ ] Todo handler de escrita comeca pelo portao.
- [ ] Rota nova aparece em `docs/seguranca/caminhos-de-acesso.md`. Rota publica
      aparece tambem em `src/lib/seguranca/rotas-publicas.ts`, com motivo.
- [ ] Chave de permissao nova existe na matriz de `02-seguranca.md` secao 2.2 e
      e usada por alguma tela ou action (a trava cobra os dois sentidos).
- [ ] Todo id vindo do cliente e conferido contra a loja resolvida. Registro de
      outra loja responde 404, nunca 403.
- [ ] Nenhum `...input` espalhado sobre a linha: campo por campo, sempre.
- [ ] Acao administrativa sobre conta alheia tem sessao fresca, permissao, alvo
      permitido e motivo de 8 a 255 caracteres.
- [ ] Acao destrutiva grava a trilha ANTES do efeito, na mesma transacao.
- [ ] Nenhum segredo em log, trilha, URL, nome de arquivo ou `argv`.
- [ ] `fetch(` com URL nao literal so em `src/lib/rede/buscarExterno.ts`.
- [ ] Variavel de ambiente nova entra em `src/lib/env.ts` E em `.env.example`.
- [ ] Excecao a uma regra da casa esta no codigo como
      `EXCECAO-SEG: REQ-X | motivo | decidido por | ate AAAA-MM-DD` e num ADR.

---

## 4. Interface

- [ ] Os quatro estados existem: carregando (esqueleto com a forma real),
      vazio (com o que fazer agora), erro (com "tentar de novo") e cheio.
- [ ] Cor, espaco e tamanho de texto vem dos tokens. Nenhum valor cru, nenhum
      valor arbitrario entre colchetes.
- [ ] Acao critica usa `ModalConfirmacaoBlock` (3 s), e o identificador da tela
      foi acrescentado a `ACOES_COM_BLOCK` em `tests/componentes/block-3s.test.tsx`,
      com o piso subido. Sem isso a trava vira decoracao.
- [ ] Navegacao por teclado funciona e o foco e visivel.
- [ ] Texto em portugues do Brasil, na voz do sistema, sem jargao tecnico. A
      mensagem de erro diz o que fazer agora.
- [ ] A tela nao promete o que o codigo nao faz. Botao sem acao e defeito, nao
      rascunho.
- [ ] Rota de `(app)` nao usa `generateStaticParams` nem cache estatico: o
      nonce da CSP e por requisicao.

---

## 5. Fila e tempo real

- [ ] Job novo tem nome declarado em `FILAS` (`src/lib/fila/filas.ts`) e
      processador registrado no worker. O boot reprova o que falta.
- [ ] `jobId` deterministico passa por `assertJobIdPart` — sem `:`, sem vazio,
      sem marcador de pendencia.
- [ ] O job e idempotente: reprocessar nao duplica, porque bate num indice
      unico que ja existe.
- [ ] Erro permanente e distinguido do transitorio. Permanente nao retenta.
- [ ] O que publica em tempo real nunca e esperado com `await` dentro de
      transacao, e nunca carrega conteudo: so `{ tipo, lojaId, versao }`.

---

## 6. Codigo

- [ ] Nenhum arquivo passa de 499 linhas. O que estoura por construcao ja nasce
      dividido, por caso de uso e nao por tipo.
- [ ] Arquivo em kebab-case; componente em PascalCase com export nomeado; um
      componente por arquivo.
- [ ] Funcao e variavel em portugues. Contrato de biblioteca fica em ingles.
- [ ] Regra de negocio mora em UM lugar. Se a mesma regra aparece em duas
      telas, ela mora no modulo e as duas a chamam.
- [ ] Nenhum import cruzado entre pacotes fora das costuras de
      `05-plano-construcao.md` secao 5.

---

## 7. Documentacao

- [ ] Decisao de arquitetura virou ADR em `docs/adr/` e entrou no indice.
- [ ] Regra de negocio nova esta em `docs/regras-negocio.md`.
- [ ] `npm run docs:check` sem referencia quebrada nova.
- [ ] `npm run ai-marks` limpo (sem caractere invisivel no texto).

---

## 8. Antes de entregar o sistema com login

- [ ] `node scripts/fumaca-seguranca.mjs --alvo <ambiente>` sem nenhuma falha.
- [ ] SQL "contas ativas sem segundo fator" devolve zero.
- [ ] Backup executado E restaurado em HML com sucesso.
- [ ] A skill `/audit-auth-security` rodada, com o relatorio lido.
- [ ] As quatro pendencias de `docs/seguranca/runbook.md` secao 9 fechadas.
