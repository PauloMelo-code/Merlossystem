import type { OrigemMidia, PastaMidia, TipoArquivoMidia } from "@/lib/db/schema/_enums/catalogo";

/** Rótulos PT-BR dos enums de mídia usados só na galeria. */

export const ROTULO_PASTA: Readonly<Record<PastaMidia, string>> = {
  produtos: "Produtos",
  lookbooks: "Lookbooks",
  stories: "Stories",
  geral: "Geral",
};

export const ROTULO_TIPO: Readonly<Record<TipoArquivoMidia, string>> = {
  imagem: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  documento: "Documento",
};

/** `gerada` não tem produtor no R1: a aba não existe (U8). */
export const ABAS_DE_ORIGEM: readonly { valor: OrigemMidia; rotulo: string }[] = [
  { valor: "upload", rotulo: "Enviadas pela equipe" },
  { valor: "recebida", rotulo: "Recebidas de clientes" },
];
