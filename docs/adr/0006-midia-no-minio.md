# ADR 0006 — Midia no MinIO, com bucket privado

- **Status**: Substituído por ADR-0008..0024 (reconstrução na branch `refactor/reconstrucao-estrutura-base`)
- **Data**: 17/08/2026
- **Substitui**: Cloudinary como armazenamento de midia

## Contexto

A midia (foto de produto, imagem que a cliente manda no WhatsApp, audio,
documento) ficava no Cloudinary. Duas coisas motivaram a troca: tirar a
dependencia de servico externo pago, e manter o dado do cliente dentro do
perimetro da operacao.

Na hora de trocar, apareceu o que o Cloudinary fazia alem de guardar bytes.

## Decisao

### 1. MinIO, falado pelo SDK da S3

`@aws-sdk/client-s3`, nao o SDK do MinIO. O mesmo codigo fala com o MinIO de
dev, com o MinIO da VPS de producao, e com S3/R2/Backblaze se um dia mudar —
trocar de provedor vira variavel de ambiente, nao reescrita.

`forcePathStyle: true` e obrigatorio: o MinIO nao serve bucket como subdominio,
e sem isso a URL vira `bucket.localhost` e nao resolve.

### 2. O bucket e PRIVADO, e essa e a decisao central

O que esta guardado ali e foto de cliente, conversa e documento. Bucket publico
significa que **qualquer pessoa com o link ve o arquivo**, sem passar por
sessao, sem passar por escopo de loja — anulando o isolamento entre Centro e
Cerro Azul justamente no dado mais sensivel.

Dai saem dois caminhos de leitura, e a diferenca entre eles importa:

| Quem le | Como | Por que |
|---------|------|---------|
| O time, pelo sistema | `GET /api/media/[id]/raw` | exige sessao **e** escopo de loja; o arquivo herda a mesma protecao da API |
| A Meta / uazapi, ao enviar | URL assinada, TTL de 10 min | eles baixam de fora e nao tem sessao nossa; `fileUrl` daria 401 e a cliente receberia mensagem sem imagem |

Por isso `media_files.file_url` guarda a **rota interna**, nao a URL do bucket.
A URL assinada e gerada no momento do envio e nao e persistida — ela e um
segredo enquanto vale, e viaja para fora.

### 3. O thumbnail virou arquivo

No Cloudinary o thumb nao existia: era gerado por parametro de URL
(`width=200&format=webp`) e nao ocupava espaco. MinIO guarda bytes e devolve
bytes.

Entao o thumb passa a ser gerado **no upload**, com `sharp`, e salvo como um
segundo objeto (`<chave>.thumb.webp`, 200x200, qualidade 80). `media_files`
ganhou `thumbnail_key` para apontar para ele.

Falhar ao gerar miniatura **nao derruba o upload**: thumb e conveniencia, e um
arquivo exotico nao pode impedir de guardar o original. Nesse caso
`?thumb=1` cai no original.

### 4. Regressao aceita: video perdeu miniatura

O Cloudinary extraia um quadro do video. Fazer isso aqui exigiria ffmpeg no
servidor. Preferi a regressao visivel — a tela ja trata `thumbnailUrl` nulo — a
carregar uma dependencia pesada por um detalhe visual.

### 5. A chave comeca pela loja

`{storeId}/{pasta}/{uuid}.{ext}`. A loja no caminho permite auditoria, cota por
loja e limpeza sem consultar o banco. O nome original **nao** vira chave: dois
uploads do mesmo arquivo nao podem se sobrescrever, e nome vindo do cliente e
entrada hostil (`../` escaparia do prefixo).

## Consequencias

- **O disco e de voces agora.** O volume entra no dimensionamento da VPS de
  backend (240 GB, segundo o CLAUDE.md), e o backup do MinIO passa a ser
  responsabilidade da operacao — hoje a politica de backup so cobre o Postgres.
- Combinado com o [ADR 0005](0005-soft-delete.md): midia excluida marca
  `is_deleted` e **o objeto fica**. Apagar o binario faria o soft delete mentir
  (restaurar daria link morto, e mensagem ja enviada ficaria com imagem
  quebrada no historico). A limpeza definitiva e rotina separada.
- `Cache-Control: private` na rota: o arquivo passou por checagem de sessao e
  loja, entao proxy compartilhado nao pode guardar.

## O que ainda nao foi verificado

**O ciclo completo contra um MinIO de verdade nao rodou** — o Docker Desktop
estava fora na maquina de desenvolvimento. O que foi verificado de fato:

- `sharp` funciona nesta plataforma: 400x300 PNG vira webp 200x200, 93% menor;
- `fetch` aceita `data:` URL preservando o content-type — e o caminho pelo qual
  a midia do webhook do WhatsApp chega;
- os invariantes de seguranca (URL nao publica, assinatura so no envio, escopo
  na rota) estao travados em `tests/midia-minio.test.ts`.

Antes de HML, subir `docker compose up -d` e fazer um upload real pela tela de
galeria: e o unico jeito de confirmar credencial, criacao do bucket e o
round-trip de bytes.
