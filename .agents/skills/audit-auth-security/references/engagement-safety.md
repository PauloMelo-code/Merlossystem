# Segurança do engajamento — prova de ambiente antes da sonda mutante

> As regras de engajamento (`SKILL.md`) dizem "só ambiente autorizado" e "local/homologação".
> Isto aqui é a **prova** de que é isso mesmo — sem ela, "parece que é local" é a mesma aposta
> que já girou um `.env` para o Postgres de produção com o container local rodando ao lado, sem
> ninguém notar.

## Prova de ambiente (uma vez, antes da 1ª sonda que escreve ou consome estado)

Nenhum `POST` mutante, nenhum `INSERT`/`UPDATE`/`DELETE`, nenhum login de teste antes de rodar e
registrar no relatório (seção 2 — Escopo, premissas e salvaguardas):

```bash
# host do alvo HTTP ($BASE) — nunca a URL inteira no relatório
python3 -c "import sys; from urllib.parse import urlparse; print(urlparse(sys.argv[1]).hostname)" "$BASE"

# host de cada URL de conexão no .env carregado — credenciais mascaradas, nunca em claro
grep -hoE '(DATABASE|MONGO|REDIS)_?URL=.*' .env* 2>/dev/null | sed -E 's#://[^@]*@#://***@#'
```

`localhost` / `127.0.0.1` / `::1` / nome de container / `*.local` → sonda ativa e escrita liberadas,
contanto que o **nome do banco** contenha `test`/`dev`/`local`. Qualquer outro host — domínio
próprio, ou de provedor gerenciado (`*.aivencloud.com`, `*.rds.amazonaws.com`, `*.supabase.co`,
`*.mongodb.net`…) — **para e pergunta**: trate como produção até prova em contrário. O `.env`
carregado pode apontar para produção mesmo com um container local de pé; o host medido é a prova,
nunca o nome do arquivo nem a suposição de quem pediu a auditoria.

`INSERT`/`UPDATE` direto no banco (prova de `CHECK`, ataque "chave de API com privilégio máximo" em
`threat-catalog.md`) só roda com o host acima aprovado — nunca por escrita direta em homologação;
ali o mesmo efeito se prova pela própria aplicação, com conta de teste, marcando ⚪ se não for
possível.

## O que NÃO está aqui

Conta de teste, canal de saída (e-mail/WhatsApp/SMS) e o que fazer ao achar segredo real no
histórico do git são regras de conduta próprias, vivendo em `SKILL.md` › "Regras de engajamento"
(itens 7 e 8) — não duplicadas aqui. Este arquivo cobre só a prova de **ambiente**, que é a única
peça extensa o bastante (comandos + árvore de decisão) para justificar um arquivo próprio.
