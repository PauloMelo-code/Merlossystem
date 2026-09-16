import type { TipoArquivoMidia } from "@/lib/db/schema/_enums/catalogo";
import { ErroDoAplicativo } from "@/lib/erros";

/**
 * Allowlist de MIME, magic bytes e tetos de mídia (02-seguranca.md §15,
 * 03-arquitetura.md §13.1).
 *
 * Módulo PURO, sem `server-only`, de propósito: a tela de upload lê os mesmos
 * tetos para avisar ANTES do envio (04-ui.md §13). A decisão, porém, é sempre
 * do servidor — o cliente só economiza a viagem.
 *
 * Fechada: sem SVG, sem HTML, sem executável, sem texto puro (texto não tem
 * assinatura, e um `.txt` com `<script>` é HTML para quem abrir errado).
 */

const MB = 1024 * 1024;

export const TETOS: Readonly<Record<TipoArquivoMidia, number>> = {
  imagem: 5 * MB,
  video: 16 * MB,
  audio: 16 * MB,
  documento: 100 * MB,
};

/** Conferência de assinatura: `bytes` precisa começar como o formato diz. */
type Assinatura = (b: Uint8Array) => boolean;

const comeca =
  (...valores: number[]): Assinatura =>
  (b) =>
    valores.every((v, i) => b[i] === v);

const texto = (b: Uint8Array, inicio: number, s: string) =>
  [...s].every((c, i) => b[inicio + i] === c.charCodeAt(0));

/** Família ISO-BMFF (mp4, m4a, 3gp, mov): `....ftyp` a partir do byte 4. */
const ftyp: Assinatura = (b) => texto(b, 4, "ftyp");

const ZIP = comeca(0x50, 0x4b, 0x03, 0x04);

type Formato = { tipo: TipoArquivoMidia; extensao: string; assinatura: Assinatura };

export const FORMATOS: Readonly<Record<string, Formato>> = {
  "image/jpeg": { tipo: "imagem", extensao: "jpg", assinatura: comeca(0xff, 0xd8, 0xff) },
  "image/png": {
    tipo: "imagem",
    extensao: "png",
    assinatura: comeca(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  },
  "image/webp": {
    tipo: "imagem",
    extensao: "webp",
    assinatura: (b) => texto(b, 0, "RIFF") && texto(b, 8, "WEBP"),
  },
  "image/gif": {
    tipo: "imagem",
    extensao: "gif",
    assinatura: (b) => texto(b, 0, "GIF87a") || texto(b, 0, "GIF89a"),
  },
  "video/mp4": { tipo: "video", extensao: "mp4", assinatura: ftyp },
  "video/3gpp": { tipo: "video", extensao: "3gp", assinatura: ftyp },
  "video/quicktime": { tipo: "video", extensao: "mov", assinatura: ftyp },
  "audio/ogg": { tipo: "audio", extensao: "ogg", assinatura: (b) => texto(b, 0, "OggS") },
  "audio/mpeg": {
    tipo: "audio",
    extensao: "mp3",
    // ID3 no começo, ou direto o sincronismo do quadro MPEG (11 bits ligados).
    assinatura: (b) => texto(b, 0, "ID3") || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0),
  },
  "audio/mp4": { tipo: "audio", extensao: "m4a", assinatura: ftyp },
  "audio/aac": {
    tipo: "audio",
    extensao: "aac",
    assinatura: (b) => b[0] === 0xff && ((b[1] ?? 0) & 0xf6) === 0xf0,
  },
  "audio/amr": { tipo: "audio", extensao: "amr", assinatura: (b) => texto(b, 0, "#!AMR") },
  "application/pdf": { tipo: "documento", extensao: "pdf", assinatura: (b) => texto(b, 0, "%PDF-") },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    tipo: "documento",
    extensao: "docx",
    assinatura: ZIP,
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    tipo: "documento",
    extensao: "xlsx",
    assinatura: ZIP,
  },
};

/** Quantos bytes do começo bastam para qualquer assinatura acima. */
export const BYTES_DE_ASSINATURA = 16;

/** Motivo da recusa, já com o status HTTP que a rota responde. */
export type Recusa = { status: 400 | 411 | 413 | 415; motivo: string };

/** Recusa de arquivo. Código `VALIDACAO` (contrato de 04-ui.md §7.2), status próprio. */
export class ErroDeArquivo extends ErroDoAplicativo {
  constructor(recusa: Recusa) {
    super("VALIDACAO", recusa.motivo, recusa.status);
  }
}

/** `Image/PNG; charset=x` → `image/png`: parâmetro e caixa não decidem nada. */
export function normalizarMime(bruto: string | null | undefined): string {
  return (bruto ?? "").split(";")[0]!.trim().toLowerCase();
}

export function formatoDe(mimeBruto: string | null | undefined): Formato | null {
  return FORMATOS[normalizarMime(mimeBruto)] ?? null;
}

/**
 * Primeira barreira, ANTES de ler o corpo: tipo declarado na allowlist e
 * `content-length` presente e dentro do teto daquele tipo.
 */
export function conferirDeclarado(
  mimeBruto: string | null | undefined,
  tamanhoBruto: string | number | null | undefined,
): Recusa | { formato: Formato; tamanho: number; mime: string } {
  const formato = formatoDe(mimeBruto);
  if (!formato) return { status: 415, motivo: "Tipo de arquivo não aceito." };
  const tamanho = Number(tamanhoBruto ?? Number.NaN);
  if (tamanhoBruto === null || tamanhoBruto === undefined || !Number.isInteger(tamanho)) {
    return { status: 411, motivo: "Tamanho do arquivo não informado." };
  }
  if (tamanho <= 0) return { status: 400, motivo: "O arquivo está vazio." };
  if (tamanho > TETOS[formato.tipo]) {
    return { status: 413, motivo: `Arquivo acima do limite de ${rotuloDeTamanho(TETOS[formato.tipo])}.` };
  }
  return { formato, tamanho, mime: normalizarMime(mimeBruto) };
}

/** Segunda barreira: os primeiros bytes são mesmo do formato declarado. */
export function conferirAssinatura(formato: Formato, inicio: Uint8Array): Recusa | null {
  return formato.assinatura(inicio)
    ? null
    : { status: 415, motivo: "O conteúdo do arquivo não corresponde ao tipo informado." };
}

/**
 * Para a mídia que chega do provedor: o tipo real é descoberto pelos bytes,
 * dentro do tipo declarado quando ele existe.
 */
export function detectarMime(bytes: Uint8Array, declarado?: string | null): string | null {
  const pedido = normalizarMime(declarado);
  if (pedido && FORMATOS[pedido]?.assinatura(bytes)) return pedido;
  // `ftyp` e ZIP são ambíguos: sem declaração, não se adivinha.
  for (const [mime, f] of Object.entries(FORMATOS)) {
    if (f.assinatura === ftyp || f.assinatura === ZIP) continue;
    if (f.assinatura(bytes)) return mime;
  }
  if (!pedido && ftyp(bytes)) return "video/mp4";
  return null;
}

/**
 * Chave do objeto: `{loja}/{origem}/{uuid}.{ext}`. O nome original NUNCA vira
 * chave, a extensão vem do formato (minúscula) e, sem formato, `.bin`.
 */
export function chaveDoObjeto(lojaId: string, origem: string, id: string, extensao?: string): string {
  const seguro = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const ext = extensao ? seguro(extensao) : "";
  return `${seguro(lojaId)}/${seguro(origem)}/${seguro(id)}.${ext || "bin"}`;
}

/** A miniatura mora ao lado do original, sempre em WebP. */
export function chaveDaMiniatura(chaveObjeto: string): string {
  return chaveObjeto.replace(/\.[a-z0-9]+$/, "") + ".min.webp";
}

export function rotuloDeTamanho(bytes: number): string {
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** `accept` do `<input type="file">`, montado da mesma lista. */
export const ACEITOS = Object.keys(FORMATOS).join(",");
