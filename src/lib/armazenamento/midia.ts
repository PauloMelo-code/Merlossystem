import "server-only";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { BUCKET, clienteS3 } from "./s3";
import { BYTES_DE_ASSINATURA, ErroDeArquivo } from "./limites";

/**
 * Operações de binário no bucket privado (03-arquitetura.md §13): subir, ler,
 * remover e miniatura. Nada aqui conhece linha de banco nem sessão.
 */

/**
 * Abre o corpo em streaming: lê só o começo (para a assinatura) e devolve o
 * resto como `Readable` que conta, calcula o SHA-256 e ABORTA ao passar do teto
 * — um `content-length` mentiroso é gratuito.
 */
export async function abrirCorpo(fonte: ReadableStream<Uint8Array>, teto: number) {
  const leitor = fonte.getReader();
  const pedacos: Uint8Array[] = [];
  let lidos = 0;
  while (lidos < BYTES_DE_ASSINATURA) {
    const { done, value } = await leitor.read();
    if (done) break;
    pedacos.push(value);
    lidos += value.byteLength;
  }
  const inicio = Buffer.concat(pedacos);
  const hash = createHash("sha256");
  let total = 0;
  let digerido: string | null = null;

  const contar = (pedaco: Uint8Array) => {
    total += pedaco.byteLength;
    if (total > teto) throw new ErroDeArquivo({ status: 413, motivo: "Arquivo acima do limite." });
    hash.update(pedaco);
    return pedaco;
  };

  async function* corpo() {
    if (inicio.byteLength > 0) yield contar(inicio);
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) return;
      yield contar(value);
    }
  }

  return {
    inicio,
    corpo: Readable.from(corpo()),
    /** Chame só depois de consumir `corpo` inteiro. */
    fim: () => ({ hash: (digerido ??= hash.digest("hex")), total }),
    cancelar: () => leitor.cancel().catch(() => undefined),
  };
}

/** Junta um `Readable` em memória. Só para imagem (≤ 5 MB), que o sharp precisa inteira. */
export async function juntar(corpo: Readable): Promise<Buffer> {
  const pedacos: Buffer[] = [];
  for await (const pedaco of corpo) pedacos.push(Buffer.from(pedaco as Uint8Array));
  return Buffer.concat(pedacos);
}

export function hashDe(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function subirObjeto(
  chave: string,
  corpo: Buffer | Readable,
  tipo: string,
  tamanho: number,
): Promise<void> {
  await clienteS3().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: chave,
      Body: corpo,
      ContentType: tipo,
      ContentLength: tamanho,
    }),
  );
}

function ausente(erro: unknown): boolean {
  const e = erro as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}

export type ObjetoLido = {
  corpo: ReadableStream<Uint8Array> | null;
  tamanho: number | undefined;
  faixa: string | undefined;
  parcial: boolean;
};

/** `null` = objeto ausente (anonimizado, limpo ou nunca subiu). */
export async function lerObjeto(
  chave: string,
  opcoes: { faixa?: string | null; soCabecalho?: boolean } = {},
): Promise<ObjetoLido | null> {
  try {
    if (opcoes.soCabecalho) {
      const r = await clienteS3().send(new HeadObjectCommand({ Bucket: BUCKET, Key: chave }));
      return { corpo: null, tamanho: r.ContentLength, faixa: undefined, parcial: false };
    }
    const r = await clienteS3().send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: chave,
        ...(opcoes.faixa ? { Range: opcoes.faixa } : {}),
      }),
    );
    return {
      corpo: r.Body ? (r.Body.transformToWebStream() as ReadableStream<Uint8Array>) : null,
      tamanho: r.ContentLength,
      faixa: r.ContentRange,
      parcial: Boolean(r.ContentRange),
    };
  } catch (erro) {
    if (ausente(erro)) return null;
    throw erro;
  }
}

export async function lerBytes(chave: string): Promise<Buffer | null> {
  const lido = await lerObjeto(chave);
  if (!lido?.corpo) return null;
  return Buffer.from(await new Response(lido.corpo).arrayBuffer());
}

/**
 * A ÚNICA exclusão física do sistema, e ela é de ARQUIVO (ADR 0013).
 * Idempotente: objeto ausente é sucesso.
 */
export async function removerObjeto(chave: string): Promise<void> {
  try {
    await clienteS3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: chave }));
  } catch (erro) {
    if (!ausente(erro)) throw erro;
  }
}

export const LADO_MINIATURA = 320;

/**
 * Miniatura WebP de até 320 px e as dimensões do original. `rotate()` aplica a
 * orientação EXIF antes de medir, e o WebP de saída não carrega o EXIF
 * (localização do aparelho fica de fora).
 */
export async function gerarMiniatura(
  bytes: Buffer,
): Promise<{ miniatura: Buffer; largura: number | null; altura: number | null }> {
  const base = sharp(bytes, { limitInputPixels: 40_000_000 }).rotate();
  const meta = await base.metadata();
  const miniatura = await base
    .clone()
    .resize(LADO_MINIATURA, LADO_MINIATURA, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();
  const girada = (meta.orientation ?? 1) >= 5;
  const largura = (girada ? meta.height : meta.width) ?? null;
  const altura = (girada ? meta.width : meta.height) ?? null;
  return { miniatura, largura, altura };
}
