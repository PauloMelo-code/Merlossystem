# Estrutura e tom do guia

## Quem lê

Depende da variante escolhida no SKILL.md, e isso muda a linguagem inteira:

| Variante | Quem é | O que ele já sabe | O que trava ele |
| :--- | :--- | :--- | :--- |
| **Cliente final** | Dono de empresa, financeiro, contador do cliente | usar WhatsApp e banco pelo celular | não saber se o pagamento entrou |
| **Operador do ERP** | Equipe interna | o negócio (cobrança, nota, assinatura) | não saber a consequência do clique |
| **Dev do parceiro** | Programador integrando na API M2M | HTTP, JSON | autenticação e por que a resposta veio vazia |

Escreva como quem explica ao lado da pessoa: "clique aqui", "vai abrir isso", "pronto".

## Tom — regras duras

| ✅ Escreva assim | ❌ Nunca assim |
| :--- | :--- |
| "Clique no botão de filtro, no canto superior direito." | "Acione o componente de filtragem." |
| "O QR Code vale até o vencimento, e ainda funciona alguns dias depois." | "A expiração do EMV respeita `cancelAfterDueDays`." |
| "A tela já abre com o mês atual." | "O estado inicial aplica um recorte por competência." |
| "Pode marcar mais de um." | "A seleção é multivalorada." |
| "Se o PIX não aparecer, tente o boleto." | "Em caso de falha do gateway primário, há fallback." |
| "Cancelar a nota não devolve o dinheiro." | "O cancelamento fiscal é independente do estorno." |

- Frases curtas. Uma ideia por frase.
- **Negrito** só no que a pessoa clica ou digita.
- Nada de "simplesmente", "basta", "é só" — quando não funciona, soa como deboche.
- Números por extenso quando forem instrução ("marque os três formatos").
- Sem emoji no corpo. O design carrega a personalidade.
- **Nomeie os elementos exatamente como a tela os nomeia.** Aqui isso exige cuidado: o menu lateral
  diz "Origens API" e o cabeçalho da mesma tela diz "Integrações M2M"; o menu diz "Contas a Receber"
  e a coluna diz "Valor Bruto". Copie o rótulo do print, não da memória.

## Estrutura padrão

| Página | Conteúdo |
| :--- | :--- |
| 1 | **Capa** — faixa escura, logo da marca (negativo), título com uma palavra na cor da marca, subtítulo de duas linhas, selo com mês/ano |
| 2 | **O que você vai conseguir fazer** — promessa em 2 frases + cartões das opções + passo 1 |
| 3–6 | **Passo a passo** — número na cor da marca, título curto, 1–2 frases, print |
| 7 | **Antes de terminar** — o que NÃO acontece, prazos e o detalhe que gera dúvida no suporte |
| 8 | **Perguntas rápidas** — as que o suporte já recebeu |

Máximo **dois blocos com print por página**. O print ocupa 150 mm de largura; três estouram a página
e o Chrome quebra em duas.

## Passo bem escrito

```
[3]  Escolha o período
     Clique no botão de filtro, no canto superior direito. Vai abrir um painel.
     [print]
```

Título = verbo no imperativo. Corpo = onde clicar + o que acontece. Nada além disso.

## A página "Antes de terminar" — específica desta plataforma

Aqui mora dinheiro e nota fiscal, então a omissão custa caro. Escolha os itens que se aplicam ao
recurso do guia e escreva o que **não** acontece:

- Cancelar a nota fiscal **não** devolve valor nenhum ao cliente.
- Estorno de **boleto pago não existe** por decisão de produto: a devolução é feita manualmente pelo
  banco da empresa. PIX e cartão têm estorno.
- Estorno cai na conta do cliente em **dias**, não na hora (cartão pode entrar na fatura seguinte).
- PIX e boleto continuam **pagáveis depois do vencimento** (a carência padrão é de 40 dias) — pagar
  atrasado não exige cobrança nova.
- Marcar uma cobrança como "Estornado" na tela **registra** o estorno; não movimenta dinheiro.
- Cobrança **paga** não volta atrás: "Estornado" e "Cancelado" são estados finais.

Escreva em PT-BR simples, sem citar arquivo, tabela, cron ou gateway.

## Blocos de apoio

- **Nota** (`.nota`) — a dúvida que a pessoa teria logo depois do passo. Ex.: "Como sei que o filtro
  está ligado?"
- **Tabela** — comparar opções (PIX × boleto × cartão; baixar × enviar por e-mail).
- **Cartões** (`.cartoes`) — 2 a 4 alternativas equivalentes.
- **Aviso** (`.aviso`) — quando o passo é irreversível ou mexe em dinheiro. Um por página, no máximo:
  se tudo é aviso, nada é aviso.

## Legenda dos prints

Quando o print tiver dado ocultado, explique — senão parece defeito:

> *Os nomes e valores aparecem ocultados neste guia apenas para proteger os dados dos clientes.*
