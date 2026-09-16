import type { OrigemMidia, PastaMidia, TipoArquivoMidia } from "@/lib/db/schema/_enums/catalogo";

/**
 * O que a tela recebe de uma mídia. NENHUM endereço: a rota de leitura é
 * derivada do `id` (`/api/midias/{id}`), e `url_externa` nunca entra em DTO
 * (01-dados-dominio.md §2.4, trava `dto-midia`).
 */
export type MidiaDto = {
  id: string;
  lojaId: string;
  nomeOriginal: string | null;
  tipoArquivo: TipoArquivoMidia;
  mimeType: string;
  tamanhoBytes: number;
  largura: number | null;
  altura: number | null;
  origem: OrigemMidia;
  pasta: PastaMidia | null;
  temMiniatura: boolean;
  criadaEm: string;
  /** Vai no campo oculto da exclusão: é o que a trava de colisão compara. */
  updatedAt: string;
};

export type PaginaDeMidias = {
  itens: MidiaDto[];
  cursorAnterior: string | null;
  cursorProximo: string | null;
};

/** O único endereço de mídia do sistema. */
export function rotaDaMidia(id: string, miniatura = false): string {
  return `/api/midias/${id}${miniatura ? "?miniatura=1" : ""}`;
}
