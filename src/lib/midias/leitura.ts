import "server-only";
import { lerBytes } from "@/lib/armazenamento/midia";
import { ErroDeEscopo } from "@/lib/erros";
import { midiaParaLeitura } from "./_consultas";

/**
 * COSTURA — dono: M3, consumida por M1 (envio de mídia de saída). Assinatura
 * final criada pela integração (D11); o corpo é do M3.
 *
 * Lê o binário de uma mídia VIVA da loja no MinIO para o adaptador de canal
 * subir ao provedor (upload multipart da Graph, base64 do uazapi). Mídia de
 * outra loja, excluída ou sem objeto: `ErroDeEscopo` — nunca o binário.
 * Teto de bytes é o do upload: ninguém lê arquivo maior do que entrou.
 */

export type BinarioDaMidia = {
  midiaId: string;
  bytes: Buffer;
  mime: string;
  nomeOriginal: string | null;
  tamanhoBytes: number;
};

export async function lerBinarioDaMidia(lojaId: string, midiaId: string): Promise<BinarioDaMidia> {
  // Só linha viva: a exceção de RN-M06 é da rota de leitura, não do envio.
  const midia = await midiaParaLeitura(midiaId, { tipo: "uma", lojaId });
  if (!midia) throw new ErroDeEscopo("Mídia não encontrada.");
  const bytes = await lerBytes(midia.chaveObjeto);
  if (!bytes) throw new ErroDeEscopo("Mídia sem arquivo.");
  return {
    midiaId: midia.id,
    bytes,
    mime: midia.mimeType,
    nomeOriginal: midia.nomeOriginal,
    tamanhoBytes: bytes.byteLength,
  };
}
