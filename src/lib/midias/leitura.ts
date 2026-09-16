import "server-only";
import { naoImplementado } from "@/lib/erros";

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
  void lojaId;
  void midiaId;
  throw naoImplementado("leitura do binário de mídia da loja (M3)");
}
