import "server-only";
import { S3Client } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";

/**
 * Cliente S3 único do processo (03-arquitetura.md §3, §13).
 *
 * `forcePathStyle`: o MinIO responde em `host/bucket/chave`, não no subdomínio.
 * O endpoint é o INTERNO; o bucket é privado e nenhuma URL dele sai para o
 * navegador — quem lê é `GET /api/midias/[id]`.
 */

const global_ = globalThis as unknown as { _s3?: S3Client };

export function clienteS3(): S3Client {
  global_._s3 ??= new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });
  return global_._s3;
}

export const BUCKET = env.S3_BUCKET;
