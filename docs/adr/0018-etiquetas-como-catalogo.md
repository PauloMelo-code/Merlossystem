# ADR 0018 — Etiquetas como catalogo por loja; fim dos text[] de ids

Data: 16/09/2026
Status: Aceito

## Contexto

O sistema antigo guardava etiqueta em colunas `text[]` de contatos, midias e
artigos. Sem normalizacao e sem FK: a mesma etiqueta aparecia como "VIP", "vip"
e "Vip", e a audiencia da campanha mudava conforme quem tinha digitado.

## Decisao

`lojas_etiquetas` e o catalogo, POR LOJA, com `slug` unico entre as vivas. As
ligacoes sao tabelas proprias (`contatos_etiquetas`, `lojas_midias_etiquetas`,
`base_conhecimento_artigos_etiquetas`) com FK e escopo de loja.

## Consequencias

- Etiqueta decide audiencia de campanha. Com FK, renomear a etiqueta nao perde
  ninguem, e excluir uma etiqueta em uso e recusado pelo `ON DELETE RESTRICT`.
- A cor e validada por CHECK no formato hexadecimal de seis digitos: cor livre
  vira contraste ilegivel no tema escuro.
