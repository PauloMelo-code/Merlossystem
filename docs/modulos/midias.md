# Módulo de mídia e galeria (pacote M3)

Upload autenticado, leitura por rota interna, miniatura, galeria da loja e
limpeza de binário. Fontes: `01-dados-dominio.md §3`, `03-arquitetura.md §13`,
`02-seguranca.md §15`, `04-ui.md §5.4`.

## Onde mora

| Caminho | Papel |
|---|---|
| `src/lib/armazenamento/limites.ts` | allowlist de MIME, magic bytes, tetos, chave de objeto. Puro (a tela usa para avisar antes do envio) |
| `src/lib/armazenamento/s3.ts` | cliente S3 único (`forcePathStyle`, endpoint interno) |
| `src/lib/armazenamento/midia.ts` | subir, ler (com `Range`), remover (idempotente), corpo em streaming com teto e SHA-256, miniatura WebP 320 px (`sharp`) |
| `src/lib/midias/` | domínio: `upload.ts`, `ingestao.ts` (costura de M1), `limpeza.ts` (chamada por M8), `_consultas.ts`, `dto.ts`, `index.ts` |
| `src/lib/actions/midias.ts` | `listarGaleria` (`midia:ler`), `excluirMidia` (`midia:excluir`, exclusão lógica) |
| `src/lib/validadores/midias.ts` | filtros da grade, parâmetros do upload, exclusão |
| `src/app/api/midias/route.ts` | `POST` upload |
| `src/app/api/midias/[id]/route.ts` | `GET`/`HEAD` binário (`?miniatura=1`) |
| `src/app/(app)/galeria/` | tela: `area-upload.tsx`, `grade-midias.tsx`, `visualizador.tsx` |
| `src/server/processadores/midia.ts` | jobs `baixar-de-url` e `gerar-miniatura` |

## Regras

- **Bucket privado. A rota interna é o único endereço.** O banco guarda
  `chave_objeto` e `chave_miniatura`; a tela deriva `/api/midias/{id}` do `id`
  (`rotaDaMidia`). Não há presigned PUT nem URL do bucket no navegador. Mídia
  privada não passa por `next/image`.
- **Upload** (`POST /api/midias`): corpo = o próprio arquivo (`Content-Type` e
  `Content-Length` obrigatórios), `?pasta=&loja=&nome=` na URL. Ordem: origem →
  sessão → `midia:enviar` → parâmetros → loja (`lojaParaGravar`; o `loja` da URL
  só vale para gestão) → tipo e tamanho declarados (antes de ler) → assinatura
  dos primeiros bytes → streaming ao MinIO com teto no tamanho declarado →
  reconferência → miniatura (imagem) → linha com trilha `midia_enviada`.
- **Tetos**: imagem 5 MB, vídeo/áudio 16 MB, documento 100 MB. Respostas: vazio
  400, sem tamanho 411, acima 413, tipo recusado ou bytes divergentes 415.
  Todas com `codigo: "VALIDACAO"`.
- **Allowlist**: JPEG, PNG, WebP, GIF, MP4, 3GP, MOV, OGG, MP3, M4A, AAC, AMR,
  PDF, DOCX, XLSX. Sem SVG, HTML, texto puro ou executável.
- **Mesmo arquivo, mesma loja**: o único parcial `(loja_id, hash_sha256)`
  devolve a mídia existente (`200 { duplicada: true }`) e o objeto novo é
  removido.
- **Leitura** (`GET /api/midias/[id]`): sessão + `midia:ler` + escopo; outra
  loja, inexistente ou excluída = 404. `Cache-Control: private, no-store`,
  `nosniff`, `Content-Disposition: attachment` para não-imagem, `Range` → 206.
  `?miniatura=1` só para imagem; sem a miniatura ainda, serve o original.
- **RN-M06** (única entrada da lista branca de T25, com `EXCECAO-SEG` na rota):
  mídia excluída **referenciada por anexo vivo** continua sendo servida.
- **Exclusão** é lógica (block de 3 s, item 5 de `04-ui.md §9.1`), só para
  gestão. O binário fica.
- **Galeria**: abas "Enviadas pela equipe" (`origem = 'upload'`) e "Recebidas
  de clientes" (`origem = 'recebida'`, com aviso de dado pessoal). Filtros de
  pasta e tipo na URL; cursor `(created_at, id)` nos dois sentidos. Gestão sem
  loja escolhida vê a rede e não envia até escolher a loja.

## Costura com M1 (`src/lib/midias/ingestao.ts`)

- `guardarMidiaRecebida(tx, { lojaId, origem, bytes, tipoMime? }, ctx)` —
  descobre o tipo pelos bytes, sobe o objeto, grava `lojas_midias`
  (`origem = 'recebida'`, sem pasta) na transação de quem chama e devolve
  `{ midiaId }`. Imagem ganha `chave_miniatura` determinística e o job
  `gerar-miniatura`. Mesmo conteúdo na loja devolve a mídia existente.
  **Só URL é recusado** (`ErroDeIntegracao` permanente).
- **Mídia por URL**: M1 grava o anexo (`conversas_mensagens_midias`) com
  `url_externa` e `midia_id` nulo e chama
  `agendarDownload({ lojaId, anexoId, provedor })` (`jobId = download-<anexoId>`).
  O job busca **só** por `rede/buscarExterno.ts`, grava a mídia e, no mesmo
  `UPDATE` do anexo, preenche `midia_id`, marca `baixada` e limpa
  `url_externa`. A URL nunca vai para o Redis nem para DTO.
- O download **não manda credencial**: serve para URL que o provedor entrega
  pronta. Mídia da Graph API que exige token deve ser baixada pelo adaptador
  de M1 e entrar por `bytes`.
- Recusa de SSRF, tipo não aceito e 4xx do provedor são **permanentes** (o job
  registra e termina, a tela mostra "mídia indisponível"); anexo ainda
  invisível (commit pendente) e 5xx são transitórios (retenta).

## Costura com M8 (`src/lib/midias/limpeza.ts`)

- `limparMidiasExpiradas(lojaId?)` — remove o objeto (e a miniatura) de linha
  excluída há mais de 90 dias e **não referenciada** por anexo vivo (RN-M06).
  A linha fica.
- `removerBinarios(midiaIds)` — para a anonimização LGPD, depois do commit.
- Ambas idempotentes: objeto ausente é sucesso. Nada marca "binário já
  removido"; a varredura repete as mesmas linhas (limite conhecido).

## Testes

| Arquivo | Prova |
|---|---|
| `tests/unidade/midias-limites.test.ts` | tetos, allowlist, magic bytes, `detectarMime`, chave sem `..` |
| `tests/integracao/midias-rotas.test.ts` | 201/200 duplicada, 6 MB → 413, `.svg` → 415, extensão trocada → 415, escopo (outra loja 404, gestão lê a rede), `FALTA_LOJA`, viewer 403, `Range`, `HEAD`, `attachment`, exclusão lógica, RN-M06 (referenciada 200, não referenciada 404), colisão |
| `tests/integracao/midias-ingestao.test.ts` | ingestão por bytes, job de miniatura, dedupe, recusa de `http://127.0.0.1:9002`, `169.254.169.254` e host fora da allowlist, limpeza de 90 dias, remoção LGPD, cursor nos dois sentidos |
| `tests/componentes/midias-galeria.test.tsx` | grade só com `/api/midias/…`, block de 3 s na exclusão, erro mantém o modal, envio por XHR |

Rodar (banco e Redis do pacote):

```
node scripts/db-teste.mjs --sufixo m3
DATABASE_URL_TESTE=postgres://…:5437/merlostore_test_m3 REDIS_URL=redis://localhost:6382/3 npm run test:integracao -- midias
```

## Pendências registradas

- `ESTADOS_DE_SISTEMA` (`src/lib/db/listas-fechadas.ts`) não lista
  `conversas_mensagens_midias` (`midia_id`, `baixada`, `url_externa`), e
  `01-dados.md §4.7` classifica a tabela como "ligação pura", em conflito com
  `01-dados-dominio.md §2.4`. Até a fundação decidir, o job `baixar-de-url`
  falha no `UPDATE` final e o teste de sucesso fica pulado (`it.skipIf`); ele
  liga sozinho quando a entrada existir.
- `ACOES_AUDITADAS` não tem ação para mídia recebida nem para editar
  pasta/etiquetas, e a matriz não tem `midia:editar`. A ingestão grava
  `midia_enviada` com `ator_tipo = 'sistema'`. **Editar pasta e etiquetas não
  existe na tela** (U8) até a ação e a permissão existirem.
