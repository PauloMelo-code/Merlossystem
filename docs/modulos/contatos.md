# Módulo de contatos, consentimento e LGPD (pacote M2)

Carteira por loja, etiquetas, ficha do contato, opt-out com prova, dossiê do
titular e anonimização. Fontes: `01-dados-dominio.md §2.1, §2.6, §7, §8`,
`04-ui.md §5.3`, `02-seguranca.md §16`.

## Onde mora

| Caminho | Papel |
|---|---|
| `src/lib/contatos/telefone.ts` | `normalizarTelefone()`: entrada livre → E.164 só dígitos. Puro |
| `src/lib/contatos/_regras.ts` | cursor `(ultimo_contato_em, id)`, escape de `LIKE`, CSV com fórmula neutralizada. Puro |
| `src/lib/contatos/_consultas.ts` | leituras da carteira e da ficha, sempre com `condicaoDeLoja` e `vivos` |
| `src/lib/contatos/index.ts` | API pública: `buscarCarteira`, `exportarCsv`, `lerFicha`, `criarContato`, `editarContato`, `excluirContato`, `definirEtiquetas`, `etiquetarEmMassa` |
| `src/lib/lgpd/regras.ts` | `optOutDe()` e `TERMO_VIGENTE`. Puro |
| `src/lib/lgpd/consentimento.ts` | `registrarConsentimento()` — a ÚNICA porta de negócio que grava `consentimentos` e o espelho `contatos.opt_out` (sobre `registrarConsentimentoBase` da fundação) |
| `src/lib/lgpd/_anonimizacao.ts` | `anonimizarContato()` em transação única (sobre `anonimizarTitular` da fundação) |
| `src/lib/lgpd/objetos-removidos.ts` | costura do M8: `registrarObjetosRemovidos(solicitacaoId, n)` |
| `src/lib/lgpd/_dossie.ts` | seções do dossiê, paginadas por `(tempo, id)` |
| `src/lib/lgpd/_consultas.ts` | protocolo, solicitação, histórico, eliminação travada para o job |
| `src/lib/lgpd/index.ts` | API pública: as acima + `iniciarExportacao`, `lerDossie`, `registrarSolicitacao`, `lerHistoricoLgpd`, `agendarLimpezaDeMidia` |
| `src/lib/actions/contatos.ts` | `listarContatos`, `exportarContatosCsv`, `abrirFicha`, `criarContato`, `salvarContato`, `excluirContato`, `definirEtiquetasDoContato`, `etiquetarContatos` |
| `src/lib/actions/lgpd.ts` | `historicoDoTitular`, `registrarConsentimentoDoContato`, `eliminarDadosDoTitular`, `iniciarExportacaoDoDossie`, `lerPaginaDoDossie`, `registrarPedidoDeCorrecao` |
| `src/lib/validadores/contatos.ts` | formulário, filtros da URL (`aplicarFiltro`), etiquetas |
| `src/lib/validadores/lgpd.ts` | protocolo, motivo, consentimento, dossiê |
| `src/app/(app)/contatos/page.tsx` | `/contatos` — carteira |
| `src/app/(app)/contatos/[id]/page.tsx` | `/contatos/[id]` — ficha |
| `src/app/(app)/contatos/_components/` | `filtros-contatos`, `lista-contatos`, `formulario-contato`, `painel-contato`, `editor-etiquetas`, `excluir-contato`, `consentimento-contato`, `acoes-lgpd`, `montar-dossie`, `baixar` |

## Permissões

| Ação | Chave | Papéis |
|---|---|---|
| ver carteira, ficha, histórico de consentimento, exportar CSV | `contatos:ler` | todos |
| criar / editar / etiquetar | `contatos:criar` / `contatos:editar` | dono, admin, gerente, vendedor |
| registrar opt-out / opt-in | `contatos:optout` | dono, admin, gerente, vendedor |
| excluir (block 3 s) | `contatos:excluir` | dono, admin, gerente |
| exportar dossiê (block 3 s) | `lgpd:exportar` | dono, admin, gerente |
| eliminar dados (block 3 s) | `lgpd:anonimizar` | dono, admin, gerente |
| registrar pedido de correção | `lgpd:registrar_solicitacao` | dono, admin, gerente |

Toda escrita é `loja: "grava"`: o formulário manda a loja DO contato no campo
`loja` (vale para gestão; vendedora e viewer usam a loja do cadastro). Em
"Todas as lojas" a tela esconde "Novo contato" e a seleção em massa.

## Regras

- **Telefone canônico E.164 só dígitos** (`5551999990000`). Sem `+`, 10 ou 11
  dígitos ganham o `55`; zeros à esquerda saem. Número estrangeiro é digitado
  com `+`. Telefone repetido na MESMA loja volta como erro de campo; na outra
  loja é outro contato, de propósito (DN-05).
- **Contato excluído com o mesmo número**: o novo é criado e a tela avisa. Reativar
  o antigo é decisão de produto, não deste módulo.
- **Edição com trava de colisão** (`updatedAt` oculto → `COLISAO`). Contato
  anonimizado não é editável. A trilha grava `"(alterado)"` nos campos PII.
- **Carteira**: ordem `ultimo_contato_em DESC NULLS LAST, id DESC`, cursor com
  `null` no par; busca por prefixo do nome (`ILIKE 'termo%'`, curinga escapado)
  ou por 4+ dígitos do telefone; filtros de etiqueta e de promoções. Valor
  desconhecido na URL é IGNORADO: "Todos" é a ausência do parâmetro, e `all`
  nunca é enviado nem interpretado (bug `02/C-12`).
- **CSV da lista filtrada**: mesmo filtro da tela, até 5000 linhas, `;`, BOM,
  célula iniciada por `= + - @` ganha apóstrofo. Sai no corpo da action (POST),
  sem rota nova e sem link.
- **Sem exclusão em massa.** A seleção em massa só acrescenta UMA etiqueta; a
  etiqueta e os contatos têm de ser da loja resolvida.
- **Etiquetas**: ligação pura. Trocar o conjunto exclui logicamente o que saiu
  e cria o que entrou; as duas pontas vão para `contato_etiqueta_alterada`.
  Etiqueta nova é da configuração da loja, não daqui.

### Consentimento e opt-out

- `registrarConsentimento(tx, ctx, novo)` decide o espelho com `optOutDe()` e
  grava por `registrarConsentimentoBase()` (`@/lib/db/mutacoes`): trava a linha
  do contato, grava a prova em `consentimentos` (append-only) e, se o espelho
  mudar, atualiza `opt_out`/`opt_out_em` pela `atualizarComTrava` com o
  `updated_at` relido na transação. Sempre registra `consentimento_registrado`.
  Aceita `ContextoDeGravacao`: o contexto da tela ou `contextoDeSistema()`.
  `termoVersao` ausente vira `TERMO_VIGENTE`.
- O IP é o de `ipDoCliente()` na action. O validador não tem campo `ip`; se o
  cliente mandar, o Zod descarta.
- `optOutDe(tipo, concedido)`: `marketing`/`opt_in` → `!concedido`;
  `opt_out` → `concedido`; `tratamento_dados` não mexe no espelho. A tela usa
  só `marketing`. `TERMO_VIGENTE = "marketing-v1"`.
- **Opt-out é de marketing**: a ficha diz que a equipe continua respondendo
  quando a pessoa escreve. Quem filtra campanha lê `consentimentos`, não o
  espelho (pacote M6).
- O M1 (palavra-chave de saída na conversa) chama a MESMA função, com
  `origem: "mensagem"` e `ip: null`.

### Anonimização (eliminação, art. 18, VI)

`anonimizarContato(tx, ctx, { contatoId, updatedAt, protocolo, motivo })`, na
ordem de `01-dados-dominio.md §8` e com o alcance da ADR 0033:

1. `lgpd_anonimizado` em `auditoria_eventos` ANTES do efeito, só com o
   protocolo (sem motivo: texto livre pode ter o nome);
2. `contatos` → `Titular anonimizado`, identificadores e campos livres `NULL`,
   `anonimizado_em`, com trava de colisão da versão que a tela mostrou;
3. os depósitos em lote, por `anonimizarTitular()` (`@/lib/db/mutacoes`):
   - `conversas_mensagens.conteudo` → `[removido a pedido do titular]` (nunca
     `NULL`), `metadados = {}`; `conversas.ultima_mensagem_previa` → marcador;
   - `conversas_mensagens_midias.legenda/transcricao` e
     `pesquisas_satisfacao.comentario` → `NULL`;
   - `conversas_agendamentos`: `conteudo` → marcador, `variaveis = []`; o que
     estava `agendada` vira `cancelada`, com `cancelada_por` = autor;
   - `pedidos.observacoes` e `pedidos.endereco_entrega` → `NULL`;
   - mídias RECEBIDAS do titular: `nome_original = NULL`, `is_deleted`;
4. `lgpd_solicitacoes` (`eliminacao`) com a contagem por tabela (`contatos`,
   `conversas_mensagens`, `conversas`, `conversas_mensagens_midias`,
   `pesquisas_satisfacao`, `conversas_agendamentos`, `pedidos`,
   `lojas_midias`) e `objetos_removidos = 0`;
5. o pedido (número, valores, itens) e os pagamentos ficam: a venda de verdade
   mora no Masc.

O passo 3 alcança também linhas já excluídas. Depois do commit,
`eliminarDadosDoTitular` chama `agendarLimpezaDeMidia`, que enfileira
`manutencao/limpar-midia` com `jobId = lgpd-<solicitacao>` e a carga
`{ lojaId, solicitacaoId, midiaIds }` (`DadosManutencao` do M8). Redis fora: a
anonimização vale e fica log de erro.

O job remove os binários e chama `registrarObjetosRemovidos(solicitacaoId, n)`
(`@/lib/lgpd/objetos-removidos`), que grava `resultado.objetos_removidos = n`
pelo ATOR_SISTEMA, com trava de colisão relida em `FOR UPDATE` e a trilha
`lgpd_anonimizado` na entidade `lgpd_solicitacoes`. Idempotente: o mesmo
número não regrava nem repete a trilha. Solicitação inexistente, excluída ou
que não é `eliminacao` → `ErroDeEscopo`; carga inválida → erro do Zod (o job
falha e vai para a DLQ).

Recusas: contato de outra loja → `NAO_ENCONTRADO`; versão velha → `COLISAO`
(nada muda, nem a trilha); já anonimizado ou protocolo repetido na loja →
`VALIDACAO`.

### Dossiê (acesso, art. 18, II)

- `iniciarExportacao` registra a solicitação `acesso` e grava `lgpd_exportado`
  antes da primeira página.
- `lerDossie` devolve UMA página (200 linhas) de UMA seção, só para solicitação
  de acesso da loja, aberta há menos de 1 hora. Seções: `contato` (com
  etiquetas), `conversas`, `mensagens` (com legendas e transcrições),
  `pedidos`, `pedidos_itens`, `pagamentos`, `devolucoes`, `devolucoes_itens`,
  `negocios`, `consentimentos` (completo, com IP), `pesquisas`, `agendamentos`.
  Inclui linhas excluídas. Nunca sai `url_externa` nem chave de objeto.
- O navegador monta o JSON seção a seção; qualquer página recusada interrompe
  e nada é baixado.

### Correção (art. 18, III)

`registrarSolicitacao` registra só o protocolo (`correcao`, sem
`executado_em`). A correção sai pela edição normal, com `contato_alterado`.

## Telas

- `/contatos`: título, "Novo contato" (sheet), busca com debounce, filtros de
  etiqueta e promoções com chips e "Limpar filtros", contagem, "Exportar CSV da
  lista filtrada", tabela que vira cartão abaixo de 768 px, seleção em massa só
  para etiquetar, paginação por cursor. Vazio diferencia "sem contatos" de "sem
  resultado para os filtros".
- `/contatos/[id]`: dados, etiquetas (`command`), conversas e pedidos
  (links para `/conversas/[id]` e `/pedidos/[id]`), promoções e consentimento,
  direitos do titular e solicitações registradas. Contato anonimizado mostra
  faixa `info` e esconde edição, etiquetas, opt-out e eliminar.
- Block de 3 s (`04-ui.md §9.1`): excluir contato (item 5), exportar dossiê
  (19), eliminar dados (20). Protocolo e motivo são pedidos antes do modal;
  erro do servidor aparece dentro do modal, que continua aberto.

## Testes

| Arquivo | Prova |
|---|---|
| `tests/integracao/lgpd-anonimizacao.test.ts` | aceite: anonimizar contato com texto, mídia com transcrição, pesquisa, pedido lançado (com observação e endereço) e agendamento pendente fecha a transação e o telefone some de TODA coluna de texto/json; agendamento cancelado; escopo, colisão, repetição; `objetos_removidos` gravado uma vez pelo sistema. O telefone é único por execução: a varredura é global |
| `tests/integracao/contatos-carteira.test.ts` | E.164, telefone repetido por loja, aviso de excluído, colisão, escopo, cursor com `null` e volta, busca, filtros, `all` ignorado, CSV, etiquetas. A visão "todas" busca por um prefixo único, porque outras suítes gravam contatos no mesmo banco |
| `tests/integracao/contatos-lgpd.test.ts` | consentimento + espelho + IP + trilha, `merlo_app` não reescreve a prova, dossiê paginado (205 mensagens), expiração, escopo, correção |
| `tests/unidade/contatos-regras.test.ts` | telefone, cursor adulterado, CSV, filtros, formulário, `optOutDe`, `ip` descartado |
| `tests/componentes/contatos-telas.test.tsx` | block dos itens 5, 19 e 20, dossiê pela metade não baixa, "Todos" sem `all`, sem exclusão em massa, estados |

Integração no banco do pacote:

```
node scripts/db-teste.mjs --sufixo m2
DATABASE_URL=postgres://dev:dev@localhost:5437/merlostore_test_m2 DATABASE_URL_TESTE=postgres://dev:dev@localhost:5437/merlostore_test_m2 REDIS_URL=redis://localhost:6382/2 npm run test:integracao
```

`tests/integracao/contatos-apoio.ts` abre cada teste numa transação com
`set local role merlo_app` e rollback no fim.
