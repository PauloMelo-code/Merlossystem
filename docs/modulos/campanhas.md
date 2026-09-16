# Módulo de campanhas, conteúdo e mensagens agendadas (pacote M6)

Disparo em lote pelo número certo, respostas rápidas, modelos do WhatsApp
oficial e mensagens programadas. Fontes: `01-dados-dominio.md §2.5, §5, §7.2`,
`03-arquitetura.md §8.4`, `04-ui.md §5.4`.

## Tabelas

| Tabela | Uso |
|---|---|
| `campanhas` | a campanha, com conta de saída, modelo ou texto, `variaveis` e `segmento`; trava de colisão |
| `campanhas_destinatarios` | um por contato; máquina de estado de sistema (`atualizarEstado`), `mensagem_id` liga à conversa |
| `conversas_agendamentos` | mensagem programada; trava de colisão; cancelamento lógico |
| `respostas_rapidas` | atalhos do chat; trava de colisão |
| `lojas_integracoes_templates` | modelos do WhatsApp oficial (o schema é da fundação; a tela e a gravação, daqui) |
| `consentimentos` | só leitura: a verdade do opt-out |

`lookbooks`, `lookbooks_midias`, `lookbooks_produtos` e a base de conhecimento
estão fora do R1: tabelas criadas, sem tela.

## Onde mora

| Caminho | Papel |
|---|---|
| `src/lib/conteudo/variaveis.ts` | `contarVariaveis`, `conferirVariaveis`, `resolverVariaveis`, `renderizarCorpo`. Puro: a tela e o servidor usam a mesma regra |
| `src/lib/conteudo/gravacao.ts` | respostas rápidas e modelos: criar, editar, alternar, excluir (lógico) |
| `src/lib/conteudo/_consultas.ts` | listas de respostas e modelos, números oficiais da loja |
| `src/lib/conteudo/trilha.ts` | ação da trilha para o que não é campanha (provisório, ver Bloqueios) |
| `src/lib/campanhas/regras.ts` | ritmo por conta, lease, transições permitidas, chave de idempotência. Puro |
| `src/lib/campanhas/segmento.ts` | o filtro de audiência, único para prévia e materialização; opt-out lido de `consentimentos` |
| `src/lib/campanhas/conta.ts` | conta de saída e modelo conferidos no servidor |
| `src/lib/campanhas/disparo.ts` | criar, iniciar (materializa), retomar, pausar, reenviar falhas, excluir; `agendarLote` |
| `src/lib/campanhas/lote.ts` | `processarLoteDeCampanha`: lease, reserva, envio, encadeamento, conclusão |
| `src/lib/campanhas/_consultas.ts` | lista, detalhe e destinatários com métricas por `count(*)` |
| `src/lib/campanhas/cursor.ts` | cursor `(created_at, id)` das listas do módulo. Puro |
| `src/lib/campanhas/pagina.ts` | abertura das páginas: portão, permissão e escopo de loja |
| `src/lib/campanhas/sistema.ts` | contexto do worker e classificação de erro permanente |
| `src/lib/agendamentos/gravacao.ts` | criar, reagendar, cancelar; `agendarEnvio` (fila com `delay`) |
| `src/lib/agendamentos/envio.ts` | `enviarAgendamento`: envio de uma linha, com opt-out para gatilho promocional |
| `src/lib/agendamentos/_consultas.ts` | lista por cursor e contatos para o formulário |
| `src/lib/agendamentos/rotulos.ts` | rótulos dos gatilhos e conversão de `datetime-local`. Puro |
| `src/lib/actions/conteudo.ts` | `criarRespostaRapida`, `editarRespostaRapida`, `alternarRespostaRapida`, `excluirRespostaRapida`, `criarModeloWhatsapp`, `editarModeloWhatsapp`, `excluirModeloWhatsapp` |
| `src/lib/actions/campanhas.ts` | `previaDeSegmento`, `criarNovaCampanha`, `iniciarDisparo`, `retomarDisparo`, `pausarDisparo`, `reenviarFalhasDaCampanha`, `excluirCampanhaRegistro` |
| `src/app/(app)/agendadas/_acoes.ts` | `agendarMensagem`, `reagendarMensagem`, `cancelarMensagem` |
| `src/lib/validadores/{campanhas,conteudo}.ts` | forma das entradas (Zod) |
| `src/server/processadores/{campanhas,agendamentos}.ts` | jobs `campanhas/processar-lote` e `agendamentos/enviar-agendada` |
| `src/app/(app)/respostas-rapidas/` | `/respostas-rapidas` — `lista-respostas` |
| `src/app/(app)/modelos/` | `/modelos` — `lista-modelos` (com o contador de `{{n}}`) |
| `src/app/(app)/campanhas/` | `/campanhas`, `/campanhas/nova`, `/campanhas/[id]` — `tabela-campanhas`, `assistente-campanha`, `previa-segmento`, `progresso-disparo`, `lista-destinatarios` |
| `src/app/(app)/agendadas/` | `/agendadas` — `formulario-agendamento`, `lista-agendadas` |

## Permissões

| Ação | Chave | Papéis (matriz atual) |
|---|---|---|
| ver campanhas, modelos, respostas, agendadas | `campanhas:ler`, `modelos:ler`, `respostas:ler`, `agendamentos:ler` | todos |
| criar campanha e prévia do segmento | `campanhas:criar` | dono, admin, gerente, vendedor (*) |
| pausar | `campanhas:editar` | dono, admin, gerente, vendedor |
| iniciar, retomar, reenviar falhas (block 3 s no iniciar/retomar) | `campanhas:disparar` | dono, admin, gerente |
| excluir campanha (block 3 s) | `campanhas:excluir` | dono, admin, gerente |
| respostas: criar / editar / excluir | `respostas:criar` / `respostas:editar` / `respostas:excluir` | operação / operação / gestão |
| modelos: criar / editar / excluir | `modelos:criar` / `modelos:editar` / `modelos:excluir` | operação / operação / gestão |
| agendar / reagendar / cancelar | `agendamentos:criar` / `agendamentos:editar` / `agendamentos:cancelar` | dono, admin, gerente, vendedor |

(*) O plano pede `campanhas:criar` de gerente para cima; a matriz da fundação dá
a vendedor. Ver Bloqueios. Toda escrita é `loja: "grava"`; em "Todas as lojas"
as telas escondem o que grava e pedem a escolha da loja.

## Regras

- **Conta de saída obrigatória** (`campanhas.integracao_id`). O número oficial
  dispara por **modelo aprovado daquela conta**; o uazapi, por texto. Conferido
  ao criar e de novo ao iniciar (a conta precisa estar `conectado`).
- **Variáveis**: a campanha não é criada nem sai de `rascunho` se
  `variaveis.length ≠ template.variaveis_contagem`, com índices 1..n sem
  repetir. `{nome_contato}` vira o primeiro nome da cliente (ou "cliente").
- **Materialização** no clique de iniciar, na mesma transação da troca
  `rascunho → enviando`, com trava de colisão: duas abas com o mesmo
  `updated_at` → a segunda recebe `COLISAO`. Único `(campanha_id, contato_id)`
  segura o resto. `total_destinatarios` é o retrato desse momento.
- **Audiência** (`segmento.ts`): contato vivo, não anonimizado, com WhatsApp ou
  telefone, e fora do marketing pela **última linha** de `consentimentos`
  (`opt_out`/`opt_in`/`marketing`, mesma tabela-verdade de `optOutDe()` do M2).
  O espelho `contatos.opt_out` não é lido. Filtros: etiquetas (qualquer uma,
  conferidas contra a loja), grade (`tamanho_preferido` igual), gasto mínimo
  (`pedidos_valor_total`), dias sem comprar (`ultima_compra_em`).
- **Lote** (`lote.ts`): lease vencido (5 min) volta a `pendente`; reserva com
  `reservarDestinatarios` (`FOR UPDATE SKIP LOCKED`); cada destinatário numa
  transação que trava a linha e confere que a reserva ainda é a mesma
  (`reservado_em`); `registrarEnvio` (costura do M1) em SAVEPOINT; sucesso =
  `enviado` + `mensagem_id`; erro permanente = `falhou` + motivo; erro
  transitório sobe e a fila retenta.
- **Ritmo por conta**: o lote reserva o ritmo da conta (1 no uazapi, 10 no
  oficial) e o próximo sai 1 s depois. Só reserva em voo → o próximo espera o
  lease. Sem pendente e sem reserva → `concluida`.
- **Pausar** muda só o status; o lote seguinte lê e para. Retomar abre outra
  rodada (`jobId` = `lote-<campanha>-<rodada>-<sequência>`).
- **Métricas** são `count(*)` por status; enviadas ⊇ entregues ⊇ lidas ⊇
  responderam. A tela relê o servidor a cada 15 s enquanto envia.
- **Reenviar falhas**: `falhou → pendente` com a linha travada; a chave de
  idempotência leva o número da tentativa, então o reenvio gera mensagem nova.
- **Agendada**: o job leva o id e o horário; reagendar gera outro job e o
  antigo se descarta. Gatilhos `promocao`, `reativacao`, `abandono` respeitam
  opt-out (a linha vira `cancelada` com o motivo); os demais saem. Cancelar é
  lógico (`cancelada_por`). Agendamento de mídia não é aceito (ver Bloqueios).
- **Respostas rápidas**: atalho `^/[a-z0-9-]{1,30}$`, único por loja entre as
  vivas — excluir `/frete` e recriar funciona. Atalho repetido volta como erro
  do campo.
- **Modelos**: só em número oficial; `variaveis_contagem` calculado no servidor
  a partir do corpo; editável só em `rascunho`/`rejeitado`; o status vem da
  Meta e a tela não aprova. Modelo em uso por campanha viva ou agendamento
  pendente não é excluído.

## Bloqueios abertos (dependem da fundação ou de outro pacote)

1. `lojas_integracoes_templates_nome` (migração 0011) usa `{1,512}` e o
   Postgres recusa repetição acima de 255: **nenhum modelo é gravável**. Os
   testes de modelo ficam pulados até a correção do CHECK.
2. `ACOES_AUDITADAS` não tem ações para resposta rápida, agendamento, criação
   de modelo nem edição de campanha: `src/lib/conteudo/trilha.ts` usa a ação
   mais próxima e a coluna `entidade` diz a tabela.
3. Inserção em lote de destinatários: hoje é `inserirAuditado` por linha (uma
   trilha por destinatário). Precisa de helper em `mutacoes.ts`.
4. `campanhas:criar` está em OPERACAO na matriz; o plano pede gerente para cima.
5. "Enviar para aprovação" depende do cliente da Meta (pacote M5) e não tem
   costura: o botão não existe.
6. Ritmo "configurável por integração" pede coluna nova; hoje é constante.
7. Agendamento de mídia: a costura de saída só leva texto/modelo.

## Testes

- `tests/unidade/campanhas-regras.test.ts` — variáveis, cursor, ritmo, forma.
- `tests/componentes/campanhas-telas.test.tsx` — assistente, block de disparo,
  respostas, modelos, agendamento.
- `tests/integracao/campanhas-disparo.test.ts` — 500 destinatários com 2
  workers sem duplicar, materialização única, pausa/retomada, lease, opt-out
  pela verdade, ritmo por conta, agendada promocional × manual, reagendamento.

```
node scripts/db-teste.mjs --sufixo m6
DATABASE_URL_TESTE=postgres://dev:dev@localhost:5437/merlostore_test_m6 REDIS_URL=redis://localhost:6382/6 npm run test:integracao -- campanhas
```
