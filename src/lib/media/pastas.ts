/**
 * As pastas da Galeria — fonte unica do nome e do rotulo.
 *
 * A pasta era uma string solta em cada lugar que sobe arquivo: `"incoming"` no
 * gateway de mensagem, `"avatars"` no webhook do uazapi, `"produtos"` na
 * segunda passada do Bling, `"general"` no upload manual. A tela tinha a
 * propria lista fixa, que ja nao batia com a realidade — mostrava "Lookbooks" e
 * "Stories", que nunca receberam arquivo, e nao tinha nome para o que chegava.
 */

/**
 * Foto de perfil de contato.
 *
 * NAO aparece na Galeria, e isso nao e organizacao: a foto existe para a ficha
 * do contato, `contacts.avatar_url` aponta para ela, e excluir da Galeria
 * apagaria o objeto do bucket — a ficha ficaria com a imagem quebrada e
 * ninguem ligaria uma coisa na outra.
 */
export const PASTA_DE_AVATAR = "avatars"

export const ROTULO_DA_PASTA: Record<string, string> = {
  produtos: "Fotos de produto",
  incoming: "Recebidas na conversa",
  general: "Enviadas pela equipe",
  lookbooks: "Lookbooks",
  stories: "Stories",
}

export function rotuloDaPasta(pasta: string | null | undefined): string {
  if (!pasta) return "Sem pasta"
  return ROTULO_DA_PASTA[pasta] ?? pasta
}

/** Rotulo do tipo de arquivo. O banco guarda em ingles; a tela e em PT-BR. */
export const ROTULO_DO_TIPO: Record<string, string> = {
  image: "Imagem",
  sticker: "Figurinha",
  video: "Vídeo",
  audio: "Áudio",
  document: "Documento",
}

export function rotuloDoTipo(tipo: string | null | undefined): string {
  if (!tipo) return "Arquivo"
  return ROTULO_DO_TIPO[tipo] ?? tipo
}
