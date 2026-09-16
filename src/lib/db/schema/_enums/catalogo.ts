/** Listas fechadas de mídia, catálogo, conteúdo e campanhas (01-dados.md §16.3). */

export const TIPOS_GRADE = ["slim", "plussize", "ambos"] as const;
export type TipoGrade = (typeof TIPOS_GRADE)[number];

/** Grade de tamanhos (03/RN-C08): `ambos` = slim seguido de plus, nesta ordem. */
export const TAMANHOS_SLIM = ["PP", "P", "M", "G", "GG"] as const;
export const TAMANHOS_PLUS = ["46", "48", "50", "52", "54", "56", "58"] as const;

export const TIPOS_ARQUIVO_MIDIA = ["imagem", "video", "audio", "documento"] as const;
export type TipoArquivoMidia = (typeof TIPOS_ARQUIVO_MIDIA)[number];

export const ORIGENS_MIDIA = ["upload", "recebida", "gerada"] as const;
export type OrigemMidia = (typeof ORIGENS_MIDIA)[number];

/** Só `origem = 'upload'` tem pasta — é o que mantém a foto da cliente fora da galeria de produtos. */
export const PASTAS_MIDIA = ["produtos", "lookbooks", "stories", "geral"] as const;
export type PastaMidia = (typeof PASTAS_MIDIA)[number];

export const CATEGORIAS_RESPOSTA = [
  "frete",
  "medidas",
  "troca",
  "pagamento",
  "rastreio",
  "geral",
] as const;
export type CategoriaResposta = (typeof CATEGORIAS_RESPOSTA)[number];

export const CATEGORIAS_ARTIGO = [
  "medidas",
  "frete",
  "troca",
  "pagamento",
  "tecidos",
  "combinacoes",
  "procedimentos",
] as const;
export type CategoriaArtigo = (typeof CATEGORIAS_ARTIGO)[number];

export const STATUS_CAMPANHA = [
  "rascunho",
  "agendada",
  "enviando",
  "pausada",
  "concluida",
  "cancelada",
] as const;
export type StatusCampanha = (typeof STATUS_CAMPANHA)[number];

export const STATUS_DESTINATARIO = [
  "pendente",
  "reservado",
  "enviado",
  "entregue",
  "lido",
  "respondido",
  "falhou",
] as const;
export type StatusDestinatario = (typeof STATUS_DESTINATARIO)[number];
