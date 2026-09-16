# Modelo de relatório — sinaleira, IDs estáveis, evidência, trava

> Entrega padrão: arquivo em **`~/Downloads/auth-audit-<repo>-<AAAA-MM-DD>.md`** **e** o resumo
> executivo no chat (contagem por cor + os 🔴 em uma linha cada). Só grave em `docs/security/` do
> repositório auditado se o usuário pedir. Nunca comite no repo auditado.

## Regras do relatório

- **Uma cor por achado**, do `requirements-catalog.md`. Ajuste da cor da tabela exige uma frase de
  justificativa no próprio achado.
- **Portão final antes do veredicto.** Estas linhas do catálogo formam o portão: A2/A3 · A5 ·
  B1/B9/B10 · C1/C4 · D1/D2/D5/D7/D8/D10 · E1–E4/E8 · F1/F2/F4/F5/F6 · G2/G8 · H1–H3/H5 ·
  I1/I6/I8 · J1/J3/J4 · K1/K3 · L1–L3/L5 · M1/M2. Só há ENTREGÁVEL com **todas** em ✅ com prova.
  A cor do achado não muda (⚪ continua ⚪ — "sem evidência é ⚪, nunca 🔴" vale para a cor); mas no
  **veredicto**, linha do portão em ❌ (qualquer cor) ou ⚪ bloqueia a entrega como um 🔴. Linha
  aceita como "não" de propósito só passa com **exceção registrada**: motivo, quem decidiu, até
  quando — no código (comentário junto da decisão) **e** na seção 5b. Exceção sem dono ou sem
  prazo não é exceção: é 🔴.
- **Evidência obrigatória**: `arquivo:linha` + trecho, ou comando + saída, ou requisição +
  resposta. Sem evidência, é ⚪.
- **Segredo mascarado**: cite a variável, nunca o valor; trechos com segredo hardcoded vão
  ofuscados.
- **O que está certo também entra**, com prova — um relatório só de defeitos não é auditoria.
- **IDs estáveis** (`REQ-<letra><n>`) para comparar com execuções passadas.
- Fato / inferência / risco residual **separados** em cada conclusão.

---

## Estrutura

```markdown
# Auditoria de login e segurança de conta — <sistema>
Data: <AAAA-MM-DD> · Auditor: <IA/pessoa> · Commit: <hash> · Ambiente simulado: <local/homolog/nenhum>
Biblioteca de auth: <nome> <versão do lockfile> · Framework: <nome> <versão> · Hospedagem: <...>
Busca de recência: <data> · fontes: <...> (ou: SEM acesso à web — limitação)

## 1. Resumo executivo
🔴 Críticos: N   🟠 Altos: N   🟡 Médios: N   🟢 Baixos: N   ⚪ N/A ou não verificável: N
Portão final: <todas as linhas com evidência> | <N linhas sem evidência: D8, H2, L2>
Veredicto: <ENTREGÁVEL / NÃO ENTREGÁVEL — N críticos abertos; N linhas do portão sem evidência>

Os 🔴, uma linha cada:
- **REQ-D10** — endpoint `/two-factor/disable` vivo, desliga o 2º fator via sessão+senha.
- **REQ-C4** — login distingue "desativada" (403) de "senha errada" (401): oráculo de enumeração.
- …

## 2. Escopo, premissas e salvaguardas
Superfícies auditadas (pública/privada/máquina); o que ficou de fora e por quê; premissas
declaradas (ex.: "assumi que a hospedagem sobrescreve x-forwarded-for — medido em §X"). Se a
Fase 3 tocou ambiente vivo: host provado (`engagement-safety.md`), contas de teste criadas
(removidas ao final ou motivo de terem ficado) e se algum canal de saída real
(e-mail/SMS/mensageria) disparou para destinatário de verdade.

## 3. Achados (ordenados por cor, depois por domínio)

### 🔴 REQ-<id> — <título curto>
- **Onde**: `caminho/arquivo.ts:linha`
- **Evidência**:
  ```
  <trecho / comando+saída / requisição+resposta>
  ```
- **Impacto** (uma frase): <o que um atacante consegue>.
- **Cenário de falha**: <entradas/estado concretos → resultado>.
- **Correção recomendada**: <o quê, onde>.
- **Trava** (impede a regressão): <teste que lê o fonte / varredura> — ex.: "teste que reprova
  qualquer resposta de login com `code`/`message` em ordem diferente da genérica".
- **Norma**: <NIST/ASVS/A07/CVE>.

(repetir por achado; 🟠, 🟡, 🟢 na sequência)

## 4. O que está correto (com prova)
Lista dos REQ marcados ✅, cada um com a evidência que comprova. Ex.: "REQ-C1 — bloqueio por conta
atômico em `loginLockout.ts:120`, um único UPDATE com CASE; teste de concorrência em
`login-lockout.test.ts`."

## 5. Não verificável / não se aplica (⚪)
Cada REQ ⚪ com o motivo: componente inexistente (qual) **ou** evidência não obtida (o que faltou —
ambiente, acesso, permissão).

## 5b. Exceções aceitas no portão (só existe se alguma linha da regra "Portão final" foi aceita
como ausente)
Uma linha por exceção: **REQ afetado**, **motivo**, **quem decidiu**, **até quando**. Sem as
quatro partes, a linha volta a ser 🔴 no veredicto.

## 6. Cobertura do catálogo
Tabela com todos os IDs do catálogo (domínio por domínio, A a M): para cada um, ✅ / ❌<cor> / ⚪.
Garante que nenhum domínio foi pulado.

## 7. Recência
Versões instaladas × advisories (CVEs de `standards-and-recency.md` + a busca desta execução);
data e fontes da busca.

## 8. Comparação com a execução anterior (se houver)
| REQ | Antes | Agora | Estado |
|-----|-------|-------|--------|
| D10 | 🔴 | ✅ | fechado |
| L1  | —  | 🔴 | novo |
| C4  | ✅ | 🟠 | regrediu |

## 9. Prioridade de correção
Os 🔴 primeiro (bloqueiam entrega), depois 🟠. Para cada, o esforço aproximado e a dependência.
Lembrar: a correção é a PRÓXIMA tarefa; esta auditoria não altera código.
```

---

## Resumo no chat (sempre)

Mesmo com o arquivo gerado, poste no chat, em PT-BR: a **contagem por cor**, os **🔴 em uma linha
cada** e o **veredicto** (entregável ou não). O usuário decide o que fazer com o resto lendo o
arquivo. Não despeje o relatório inteiro no chat.

## Reexecução

Rodar de novo produz o mesmo formato e os mesmos IDs, e preenche a seção 8 comparando com o
arquivo anterior (se o usuário apontar onde está). Fechado / aberto / novo / regrediu — é isso que
mostra se o sistema melhorou ou piorou entre duas medições.
