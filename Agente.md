# Agente.md — como o agente trabalha neste repositório

`AGENTS.md` diz **o que construir**. Este arquivo diz **como se comportar** construindo.
As duas coisas são cobradas; a segunda é a que costuma faltar.

## 1. Ler antes de escrever

1. Nunca documente, corrija ou "melhore" de memória. Abra o arquivo real.
2. Antes de criar qualquer coisa, procure em `docs/PROJECT_MAP.md` e no código se ela já
   existe. Metade do trabalho ruim é reimplementar o que estava dois arquivos ao lado.
3. O commit `5e902d4` é o sistema antigo: leia-o para entender **o domínio** (como a loja
   trabalha, o que o Masc é, o que a vendedora precisa) e nunca para copiar
   implementação.
4. Decisão fechada mora em `docs/adr/`. Se você discorda de uma, escreva um ADR novo —
   não mude o código por conta própria.

## 2. Parar e reportar, em vez de decidir sozinho

Pare e avise quem coordena quando:

- falta coluna, tabela, permissão, rota ou enum que o modelo fechado não tem;
- um arquivo compartilhado (schema, `mutacoes.ts`, `permissoes/`, `navegacao.ts`,
  `tons.ts`, `filas.ts`) precisa de mais uma linha;
- o documento que você está seguindo contradiz outro documento;
- a implementação correta exigiria quebrar uma regra absoluta.

Nesses casos o custo de decidir sozinho é alto e escondido: vira duas verdades no
repositório. Reportar custa cinco minutos.

## 3. Escopo: só o que foi pedido

- Faça o que foi pedido, nada além. Funcionalidade "que vai ser útil depois" é dívida
  hoje e ninguém pediu.
- **Nunca crie arquivo** se der para editar um existente. **Nunca crie documentação** sem
  pedido explícito.
- Nunca commite arquivo que não é do seu pacote. Se o `git status` mostrar arquivo
  alheio, não commite: avise.
- Nada de pasta "para depois": item fora do R1 não tem arquivo.

## 4. Corrigir a causa, não o sintoma

Antes de editar, procure **todos** os chamadores da função que você vai tocar. A guarda
certa fica na função compartilhada, não em cada chamador — senão o defeito continua vivo
nos irmãos. Patch só no caminho que o relato cita é um segundo bug esperando.

## 5. Provar, com a saída real

- Rode os comandos de aceite e **cole a saída** no relatório. "Deve passar" não é prova.
- Nunca declare verde o que está vermelho. Comando falhou e você não conseguiu corrigir?
  Registre a falha com a saída literal do comando.
- Script de diagnóstico tem de percorrer **o mesmo caminho do código de produção**.
  Script que testa por fora mente.
- Teste nasce junto com o código, não "na próxima etapa". Trava que passa vazia (porque
  não encontrou nada para varrer) é pior que trava nenhuma: por isso toda varredura tem
  piso mínimo de itens.

## 6. Segurança e dado de gente de verdade

- Nunca leia, crie ou edite `.env`, `.env.local`, `.env.production`. O único arquivo de
  ambiente que se escreve é `.env.example`. Precisa de variável para rodar um comando?
  Passe **inline** no comando.
- Nunca escreva senha literal em seed, README, doc, comentário ou mensagem de commit.
- Nunca copie dado real de cliente (nome, telefone, endereço, valor de venda) para
  documento, teste, issue ou log.
- Dump de banco não vira artifact de CI e não sai do perímetro.
- Mexeu em autenticação, borda, webhook ou papel? Rode `/audit-auth-security` e versione
  o relatório em `docs/seguranca/` — sem dado sensível.

## 7. Destrutivo: a régua

- **NUNCA dropar banco de dados.** `scripts/db-teste.mjs` recria o **schema** do banco de
  teste, com três guardas (host local, nome contendo `test`, `NODE_ENV ≠ production`).
- Backup antes de qualquer operação destrutiva, e backup só vale se o restore já foi
  testado em HML.
- Antes de `rm`, `git reset --hard` ou `--force`: confira duas vezes e explique o porquê.
  Existe caminho reversível? Use ele.

## 8. Higiene do ambiente (Windows)

- Nada de `node -e "..."` ou `psql -c "..."` inline: o shell cria arquivo-lixo na raiz com
  o nome do fragmento. Escreva um `.mjs` e rode com `node`.
- `npm run lixo` antes de cada commit de etapa; a raiz fica limpa.
- Arquivo em UTF-8, acento escrito direto. Escape unicode literal (`ç`) e mojibake
  são bloqueados pelo hook `texto-cru` — eles chegaram a aparecer na tela do cliente.

## 9. Como reportar

Todo fechamento de tarefa traz, nesta ordem:

1. **O que foi construído** e as decisões de implementação que não eram óbvias.
2. **Arquivos criados e alterados**, com caminho.
3. **Comandos de aceite rodados e a saída real** de cada um.
4. **O que ficou vermelho ou incompleto** — nomeado, não escondido.
5. **O que falta decidir** (e quem decide).
6. **O que a próxima etapa precisa saber** do que você fez.

## 10. Commits

Conventional Commits em PT-BR: `tipo(escopo): assunto no imperativo`, minúsculo, sem
ponto final, ≤ 72 caracteres. Corpo explicando **por quê** quando a decisão não é óbvia.
**Sem rodapé de coautoria e sem assinatura de IA.** Nunca commitar na `master`.
