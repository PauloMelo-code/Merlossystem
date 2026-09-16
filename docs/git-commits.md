# Commits e branches

## Conventional Commits, em portugues

```
<tipo>(<escopo>): <assunto no imperativo, minusculo, sem ponto final>

<corpo: POR QUE, quando a decisao nao e obvia>
```

**Tipos**: `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`.

**Escopo** e o nome do modulo, em portugues e igual ao do plano: `nucleo`,
`schema`, `auth`, `seguranca`, `ui`, `acesso`, `fila`, `conversas`, `contatos`,
`midias`, `catalogo`, `pedidos`, `integracoes`, `campanhas`, `usuarios`,
`alertas`, `auditoria`, `relatorios`, `lgpd`, `adr`, `travas`, `repo`, `base`.

**Assunto** com no maximo 72 caracteres.

**Corpo** so quando o "por que" nao esta no assunto. Um commit que troca o
default de um limitador precisa dizer por que; um que corrige um erro de
digitacao nao precisa.

**SEM RODAPE DE COAUTORIA.** Nada de `Co-Authored-By`, nada de assinatura de
ferramenta. Vale para commit e para descricao de PR.

### Exemplos bons

```
feat(fila): filas BullMQ, agendador e worker em processo separado
fix(conversas): manter o status de entrega monotonico no recibo atrasado
refactor(auditoria): mover o gravador da trilha para src/lib/auditoria
test(travas): instalar as travas de fonte e a matriz REQ x teste
docs(adr): registrar as decisoes 0008 a 0024 da reconstrucao
```

### Exemplos ruins, e o motivo

```
fix: bug            -> qual bug, onde, em que caminho
feat(Conversas): Adiciona envio de mensagem.   -> escopo maiusculo, assunto na
                                                  terceira pessoa, ponto final
chore: varios ajustes                          -> commit que ninguem consegue
                                                  reverter sozinho
```

---

## Um commit, uma coisa

O commit precisa ser revertivel sozinho. Se o `git revert` de um commit deixa o
sistema num estado que nao compila, ele misturou coisas demais.

Na pratica: a mudanca de schema vai num commit, o codigo que a usa vai em
outro. Renomear arquivo vai sozinho — misturado com mudanca de conteudo, o diff
some e ninguem revisa.

---

## Branches

| Branch | Proposito | Deploy |
|---|---|---|
| `develop` | desenvolvimento ativo | HML, pelo CI |
| `master` | codigo estavel, validado em HML | PRD, pelo CI |
| `refactor/reconstrucao-estrutura-base` | a reconstrucao do R1 | nenhum, ate virar `develop` |

Regras:

1. **NUNCA commitar direto na `master`.**
2. Todo codigo entra pela `develop`.
3. Merge para `master` so depois de validado em HML.
4. Hotfix: branch a partir de `master`, merge de volta em `master` E `develop`.

---

## Um pacote nunca commita arquivo de outro

Na onda 2 os pacotes correm em paralelo e o mapa de dono esta em
`05-plano-construcao.md` secao 8. Se o `git status` mostrar arquivo de outro
pacote, **nao commite** — avise o orquestrador.

As costuras de `05-plano-construcao.md` secao 5 existem exatamente para isso: o
arquivo nasce na fundacao com a assinatura final e corpo
`throw naoImplementado(...)`, e o pacote dono troca so o corpo.

---

## Antes de commitar

```
npm run lixo        # move para quarentena o lixo de shell mal escapado na raiz
npm run verificar   # lint, tipos, compliance, travas, testes e drift de docs
```

`npm run lixo` existe porque `node -e "..."` e `psql -c "..."` no PowerShell
criam arquivos de zero byte com nomes estranhos na raiz. A regra e nao usar
comando inline: escreva um `.mjs` e rode com `node <arquivo>`.
