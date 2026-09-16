# Regras de negocio

O que o sistema faz e por que. Regra que nao esta aqui nao e regra: e habito de
alguem. Quando a regra muda, muda AQUI e no unico lugar do codigo que a
implementa — nunca em cinco telas.

O modelo de dados que sustenta cada regra esta em `01-dados-dominio.md`.

---

## 1. Loja e escopo

1. Tudo pertence a uma loja. A rede tem duas, e uma cliente pode comprar nas
   duas: o **mesmo telefone existe em lojas diferentes**, como contatos
   diferentes, de propósito. Unicidade de telefone e POR LOJA.
2. `dono`, `admin` e `gerente` escolhem a loja no topo da tela. `vendedor` e
   `viewer` tem loja fixa no cadastro, e o seletor vira etiqueta.
3. Registro de outra loja responde **404**, nunca 403: confirmar que existe ja
   entrega o que o escopo esconde.
4. A sigla da loja e **cadastrada** (tres letras, unica), nunca derivada do
   nome. Dois nomes parecidos derivariam a mesma sigla, e a numeracao de pedido
   depende dela.

---

## 2. Atendimento

1. **Toda conversa sabe por qual numero entrou** (`integracao_id` obrigatoria).
   Nao existe numero padrao. A resposta sai pelo mesmo numero que recebeu.
2. Mensagem que chega e persistida ANTES de qualquer processamento, e o webhook
   devolve 200 na hora. Processar depois, na fila, e o que impede a mensagem de
   se perder quando o processamento falha.
3. O casamento do contato tem tres passos, numa transacao: pelo identificador
   do canal; pelo telefone, quando o contato veio do cadastro e ainda nao tem
   identificador; e uma segunda tentativa, para a corrida. Sem o segundo passo,
   toda mensagem de quem foi cadastrado a mao se perde.
4. **Status de entrega e MONOTONICO**: `entregue` atrasado nao rebaixa `lida`.
   O recibo do provedor nunca sai de `falhou` — essa transicao e exclusiva do
   reenvio, que a reivindica atomicamente.
5. Reenviar e claim atomico: duas pessoas clicando ao mesmo tempo resultam em
   UM reenvio. A segunda recebe "alguem ja reenviou".
6. Nota interna nunca sai para a cliente. E mensagem com autor interno, na
   mesma linha do tempo, com aparencia distinta.
7. **Prazos de resposta por canal sao constantes no codigo**: 5, 15, 30 e 60
   minutos. Nao existe tela de configuracao de SLA no R1, e a tela de auditoria
   mostra o prazo como texto somente leitura.

---

## 3. Contato, consentimento e LGPD

1. Telefone canonico e **E.164 so digitos** (`5551999990001`). Uma unica
   funcao normaliza a entrada: `normalizarTelefone()`, em
   `src/lib/contatos/telefone.ts` (exportada por `@/lib/contatos`, modulo puro
   que tambem roda no navegador). `src/lib/formato.ts` so formata para
   exibicao (`telefone()`); ele nao normaliza.
2. **`registrarConsentimento()` e a unica funcao que grava `consentimentos`** e
   o espelho `contatos.opt_out`, sempre na mesma transacao. A trilha de
   consentimento e append-only; o espelho existe so para a consulta ser rapida.
3. **Opt-out e de MARKETING.** Ele nao bloqueia resposta um a um: a cliente que
   pediu para nao receber campanha continua sendo atendida quando ela mesma
   escreve.
4. Quem decide a audiencia da campanha e a **verdade** (`consentimentos`), nao
   o espelho. O espelho pode estar velho; a trilha nao.
5. O IP do consentimento vem de `ipDoCliente()`, nunca do corpo da requisicao.
   IP vindo do corpo e prova forjada.
6. **Anonimizacao, nunca exclusao** (ADR 0013): trilha antes do efeito, depois
   os `UPDATE`s, e o binario sai fora da transacao pelo job idempotente. O
   conteudo da mensagem vira o marcador "[removido a pedido do titular]", nunca
   `NULL` — `NULL` viola o CHECK e aborta a transacao inteira.
7. O pedido, o valor e a data PERMANECEM: sao obrigacao fiscal. O vinculo passa
   a apontar para um contato sem identidade.
8. **Nao existe exclusao em massa de contatos.**

---

## 4. Catalogo

1. **Nao existe cadastro manual de produto.** O catalogo e espelho do Bling, e
   a matriz de permissao nao tem `produtos:criar`, `produtos:editar` nem
   `produtos:excluir`.
2. **Disponibilidade e CALCULADA, nunca persistida**: saldo do deposito menos o
   reservado em pedido aberto, casando por SKU. Nunca negativa. Pedido
   cancelado ou devolvido nao reserva; SKU ausente nao desconta.
3. Uma implementacao so (`calcularDisponivel`). Duas contas fariam a tela de
   venda prometer o que a tela de produto nega.
4. A tela mostra a **idade do dado**. Espelho sem idade visivel e espelho em
   que ninguem confia na segunda vez que erra.
5. Grade de tamanhos: `slim` (PP a GG), `plussize` (46 a 58) ou `ambos` — e
   `ambos` lista slim antes de plus, nesta ordem.
6. **`preco_custo` so sai do servidor para `dono`, `admin` e `gerente`.** Nao e
   filtro de tela: o campo nao entra na projecao.

---

## 5. Pedido

1. O numero e um **contador atomico por loja e mes** (`SIG-AAAAMM-0001`), nunca
   o maior numero mais um. Cem pedidos simultaneos geram cem numeros distintos,
   sem buraco.
2. `ano_mes` e calculado em **America/Sao_Paulo**. Com o fuso do container, a
   venda das 21h cai no mes seguinte.
3. **Preco e nome vem do servidor**, sempre. O que o navegador manda e o SKU e
   a quantidade.
4. O pedido nasce com a ponte do Masc em `pendente`. Voltar para `pendente`
   **preserva** o identificador da venda ja lancada — apagar faria a mesma venda
   ser lancada duas vezes.
5. Dispensar o lancamento no Masc exige **motivo**, e a trilha e gravada antes
   do efeito.
6. Pedido ligado a um negocio move o negocio para `ganho` na MESMA transacao.
7. Cancelar pedido e `gerente` para cima; criar e editar sao de `vendedor` para
   cima.

---

## 6. Campanha e mensagem agendada

1. A conta de saida (`integracao_id`) e **obrigatoria**. Campanha sem conta nao
   sai do rascunho.
2. A campanha nao sai de `rascunho` se a quantidade de variaveis preenchidas
   nao bater exatamente com a do modelo aprovado. Modelo com duas variaveis e
   campanha com uma e recusada na validacao, nao no disparo.
3. A reserva de destinatarios usa `FOR UPDATE SKIP LOCKED` mais um **lease**:
   linha reservada ha muito tempo volta para `pendente` sozinha. E o que faz o
   worker morto no meio do lote nao congelar a campanha.
4. Unico `(campanha_id, contato_id)`: a mesma cliente nunca recebe a mesma
   campanha duas vezes, mesmo com o lote reprocessado.
5. Pausar no meio e retomar **nao reenvia** para quem ja recebeu.
6. Os contadores da campanha sao `count(*)` na hora de ler, **nunca colunas**.
   Coluna de contador diverge, e o numero errado na tela de campanha e o tipo
   de erro que ninguem percebe.
7. A mensagem da campanha **entra na conversa da cliente**. Ela responde e a
   atendente ve o contexto.
8. Ritmo por conta: 1 mensagem por segundo na conta nao oficial, 10 por segundo
   na oficial. Uma campanha nao pode furar a fila de quem esta conversando.
9. **Agendamento promocional respeita opt-out; os demais nao.** Lembrete de
   entrega e resposta a uma compra, nao marketing.
10. Disparar campanha e `gerente` para cima. Criar e editar sao de `vendedor`
    para cima.

---

## 7. Midia

1. O bucket e **privado**, e a rota interna `/api/midias/[id]` e o **unico**
   endereco de midia do sistema. URL do provedor na tela contornaria o portao.
2. O corte por tamanho acontece pelo `content-length`, **antes** de ler o corpo.
3. O tipo e conferido contra os **magic bytes**, nao contra a extensao. Nada de
   SVG, HTML ou executavel.
4. Midia de outra loja responde 404.
5. **Midia excluida que ainda e referenciada por uma mensagem continua sendo
   servida.** E a unica entrada da lista branca do soft delete, com excecao
   escrita: apagar da galeria nao pode furar o historico da conversa.
6. `url_externa` e coluna de trabalho do job de download: some quando o binario
   chega e **nunca** entra em projecao para a tela.

---

## 8. Equipe e acesso

1. Cinco papeis, em ordem: `dono`, `admin`, `gerente`, `vendedor`, `viewer`.
2. **Ninguem age sobre alvo de papel igual ou superior.** Admin nao mexe em
   admin; so `dono` mexe em `dono`. Auto-alvo e recusado.
3. Toda acao sobre conta alheia exige sessao fresca, permissao, alvo permitido
   e **motivo de 8 a 255 caracteres**. A trilha e gravada ANTES do efeito, na
   mesma transacao, e fail-closed: falhou a trilha, nao aconteceu o efeito.
4. **O admin nunca define a senha de outra pessoa.** Ele inicia o reset e
   revoga as sessoes; quem escolhe a senha e a dona da conta.
5. Sempre ao menos um `dono` e um `admin` ativos; no maximo dois `dono`. A
   garantia e `FOR UPDATE`, nao validacao de tela.
6. `dono` nao e convidavel. Convite de `admin` so pelo `dono`, com ciencia
   versionada digitada.
7. O segundo fator e **obrigatorio** e e ligado no provisionamento. Conta ativa
   sem segundo fator e defeito, e a fumaca pos-deploy reprova.

---

## 9. Alertas e auditoria

1. **Quem resolve um alerta e o gerador dele**, nao a pessoa. A pessoa
   reconhece ("ja vi"); o alerta some quando a condicao que o criou deixa de
   valer. Alerta que a pessoa fecha a mao volta a aparecer na proxima varredura,
   e ninguem confia mais no sino.
2. Dedupe por `(loja_id, chave_deduplicacao)` entre os nao resolvidos.
3. A **reconciliacao noturna gera alerta, nao corrige em silencio**: divergencia
   entre o espelho de opt-out e a trilha, ou entre contadores, denuncia um
   defeito. Corrigir sozinho apaga a prova.
4. `/auditoria/excluidos` e **somente leitura** no R1: nao existe restaurar.
5. Campo de dado pessoal aparece na trilha como `"(alterado)"`, nunca com o
   valor. A trilha prova QUE o telefone mudou sem virar um segundo cadastro de
   telefones.
6. `/auditoria/seguranca` mostra `email_hash`, nunca e-mail em claro, e e so
   para `dono` e `admin`.
7. **Retencao nunca apaga linha.** O diario de ingestao e anonimizado por
   `UPDATE` depois de 30 dias.

---

## 10. Fora do R1

Tabela criada, sem tela, sem rota e sem item de menu: trocas e devolucoes,
funil de negocios, lookbooks, base de conhecimento, pesquisa de satisfacao,
pagamentos, IA, transcricao, TikTok, Facebook e SLA configuravel.

As chaves de permissao dessas funcionalidades ja estao decididas e escritas
(`02-seguranca.md` secao 2.2), para que o estorno nao nasca sem dono no dia em
que a tela ligar. Mudar o corte e editar `fase` numa linha de
`src/lib/navegacao.ts` e criar a rota.
