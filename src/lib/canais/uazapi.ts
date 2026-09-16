import {
  chamar,
  comoLista,
  comoObjeto,
  ehPermanente,
  lerJson,
  paraData,
  primeiro,
  texto,
  vazio,
  type Bruto,
} from "./normalizacao";
import type {
  AdaptadorDeCanal,
  ClienteHttp,
  EstadoDaSessao,
  InterpretacaoDeWebhook,
  MensagemNormalizada,
  MidiaParaEnvio,
  ResultadoEnvio,
  StatusRecebido,
  TipoNormalizado,
} from "./tipos";

/**
 * WhatsApp NÃO OFICIAL via uazapi (03-arquitetura.md §10, §11).
 *
 * Diferenças que o contrato expõe sem `if (provedor)`:
 *   - `enviarModelo` NÃO existe: não há modelo aprovado; mandar o nome do
 *     template como texto chegaria à cliente como "boas_vindas";
 *   - `exigeJanela24h = false`;
 *   - `estadoDaSessao` existe (o número cai quando o aparelho desconecta);
 *   - `deMim` acontece: o que a vendedora manda pelo próprio celular volta pelo
 *     webhook e é GRAVADO como saída (01/D-08). O eco do que o PRÓPRIO sistema
 *     enviou pela API (`wasSentByApi`) é descarte registrado — ele já está na
 *     conversa.
 *
 * O parser é tolerante de propósito: o payload muda entre versões da
 * instalação. Campo desconhecido é ignorado; nada lança.
 */

const TIPOS: Record<string, TipoNormalizado> = {
  conversation: "texto",
  extendedtextmessage: "texto",
  text: "texto",
  imagemessage: "imagem",
  image: "imagem",
  videomessage: "video",
  video: "video",
  audiomessage: "audio",
  audio: "audio",
  ptt: "audio",
  documentmessage: "documento",
  document: "documento",
  stickermessage: "sticker",
  sticker: "sticker",
  locationmessage: "localizacao",
  location: "localizacao",
};

const STATUS: Record<string, StatusRecebido> = {
  sent: "enviada",
  serverack: "enviada",
  delivered: "entregue",
  deliveryack: "entregue",
  read: "lida",
  readself: "lida",
  played: "lida",
  failed: "falhou",
  error: "falhou",
};

const SESSOES: Record<string, EstadoDaSessao> = {
  connected: "conectada",
  open: "conectada",
  connecting: "conectando",
  qrcode: "conectando",
  disconnected: "desconectada",
  close: "desconectada",
};

/** O uazapi devolve o id em três formatos; o curto é o que o recibo cita. */
export function idCurto(valor: unknown): string | undefined {
  const t = texto(valor);
  return t?.includes(":") ? t.slice(t.lastIndexOf(":") + 1) : t;
}

function ehGrupo(m: Bruto, chat: string | undefined): boolean {
  return m.isGroup === true || Boolean(chat?.endsWith("@g.us"));
}

function mensagemDe(m: Bruto, contaExterna: string, saida: InterpretacaoDeWebhook): void {
  const chave = comoObjeto(m.key);
  const chat = primeiro(m.chatid, chave?.remoteJid, m.sender);
  if (ehGrupo(m, chat)) {
    saida.descartados.push({ motivo: "grupo" });
    return;
  }
  const deMim = m.fromMe === true || chave?.fromMe === true;
  if (deMim && m.wasSentByApi === true) {
    saida.descartados.push({ motivo: "eco_de_pagina", tipoOriginal: "eco_da_api" });
    return;
  }

  const externoId = idCurto(primeiro(m.messageid, chave?.id, m.id));
  const remetenteBruto = deMim ? chat : primeiro(m.sender, chat);
  const remetenteId = remetenteBruto?.replace(/@.*$/, "");
  if (!externoId || !remetenteId) {
    saida.descartados.push({ motivo: "sem_remetente" });
    return;
  }

  const tipoOriginal = primeiro(m.messageType, m.mediaType, m.type) ?? "text";
  const tipo = TIPOS[tipoOriginal.toLowerCase()];
  if (!tipo) {
    saida.descartados.push({ motivo: "tipo_nao_suportado", tipoOriginal });
    return;
  }

  const conteudo = primeiro(m.text, m.caption, typeof m.content === "string" ? m.content : undefined, m.body);
  const url = primeiro(m.fileURL, m.fileUrl, m.mediaUrl, m.file, m.url);
  const normalizada: MensagemNormalizada = {
    contaExterna,
    externoId,
    remetenteId,
    tipo,
    deMim,
    ocorridoEm: paraData(primeiro(m.messageTimestamp, m.timestamp)),
    bruto: m,
  };
  const nome = deMim ? undefined : primeiro(m.senderName, m.pushName);
  if (nome) normalizada.remetenteNome = nome;
  if (conteudo) normalizada.texto = conteudo;
  const citada = idCurto(primeiro(m.quoted, comoObjeto(m.contextInfo)?.stanzaId));
  if (citada) normalizada.respondendoA = citada;
  if (tipo !== "texto" && tipo !== "localizacao") {
    if (url && /^https?:\/\//.test(url)) {
      const mime = primeiro(m.mimetype, m.mimeType);
      const nomeArquivo = primeiro(m.fileName, m.docName);
      normalizada.midias = [
        {
          url,
          ...(mime ? { mime } : {}),
          ...(nomeArquivo ? { nome: nomeArquivo } : {}),
          ...(texto(m.caption) ? { legenda: texto(m.caption)! } : {}),
        },
      ];
    }
  }
  if (tipo === "texto" && !conteudo) {
    saida.descartados.push({ motivo: "tipo_nao_suportado", tipoOriginal });
    return;
  }
  saida.mensagens.push(normalizada);
}

/** Parser do webhook. Puro, nunca lança. */
export function interpretarUazapi(corpoCru: string): InterpretacaoDeWebhook {
  const saida = vazio();
  const corpo = lerJson(corpoCru);
  if (!corpo) return saida;

  const contaExterna = primeiro(corpo.instanceName, corpo.instance, corpo.owner) ?? "";
  const evento = (primeiro(corpo.EventType, corpo.event, corpo.type) ?? "").toLowerCase();

  // Sessão do aparelho.
  const instancia = comoObjeto(corpo.instance) ?? comoObjeto(corpo.data);
  const estadoBruto = primeiro(instancia?.status, corpo.status, corpo.state);
  if (evento.startsWith("connection") && estadoBruto) {
    const estado = SESSOES[estadoBruto.toLowerCase()];
    if (estado) {
      const qr = primeiro(instancia?.qrcode, corpo.qrcode);
      saida.sessao = { estado, ...(qr ? { qr } : {}) };
    }
    return saida;
  }

  // Recibos de entrega.
  const atualizacao = comoObjeto(corpo.event) ?? (evento.includes("update") ? corpo : null);
  if (atualizacao && evento.includes("update")) {
    const status = STATUS[(primeiro(atualizacao.Type, atualizacao.type, atualizacao.status) ?? "").toLowerCase()];
    const ids = comoLista(atualizacao.MessageIDs ?? atualizacao.messageIds ?? atualizacao.ids);
    if (status) {
      for (const id of ids) {
        const externoId = idCurto(id);
        if (externoId) {
          saida.status.push({
            externoId,
            status,
            ocorridoEm: paraData(primeiro(atualizacao.Timestamp, atualizacao.timestamp)),
          });
        }
      }
    }
    return saida;
  }

  // Mensagens: `messages[]`, `message` ou `data`.
  const lista = Array.isArray(corpo.messages)
    ? corpo.messages
    : [corpo.message ?? corpo.data].filter((x) => x !== undefined);
  for (const bruto of lista) {
    const m = comoObjeto(bruto);
    if (m) mensagemDe(m, contaExterna, saida);
  }
  return saida;
}

export type DepsUazapi = {
  token: string;
  /** `UAZAPI_BASE_URL`, sem barra final. */
  base: string;
  http: ClienteHttp;
  conferirAssinatura: (corpoCru: string, cabecalhos: Headers) => boolean;
};

const TIPO_DE_MIDIA: Record<MidiaParaEnvio["tipo"], string> = {
  imagem: "image",
  video: "video",
  audio: "ptt",
  documento: "document",
  sticker: "sticker",
};

function resultado(r: { status: number; corpo: Bruto }): ResultadoEnvio {
  if (r.status >= 200 && r.status < 300) {
    const id = idCurto(primeiro(r.corpo.messageid, comoObjeto(r.corpo.key)?.id, r.corpo.id));
    return id
      ? { ok: true, externoId: id }
      : { ok: false, motivo: "O provedor não devolveu o id da mensagem.", permanente: false };
  }
  return {
    ok: false,
    motivo: primeiro(r.corpo.error, r.corpo.message) ?? `HTTP ${r.status}`,
    permanente: ehPermanente(r.status),
  };
}

export function criarUazapi(deps: DepsUazapi): AdaptadorDeCanal {
  const base = deps.base.replace(/\/+$/, "");
  const cabecalhos = { token: deps.token, "content-type": "application/json" };

  async function postar(caminho: string, corpo: Bruto): Promise<ResultadoEnvio> {
    const r = await chamar(deps.http, `${base}${caminho}`, {
      provedor: "uazapi",
      metodo: "POST",
      corpo: JSON.stringify(corpo),
      cabecalhos,
    });
    return r.ok ? resultado(r) : r.resultado;
  }

  return {
    provedor: "uazapi",
    limites: { imagemMb: 5, videoMb: 16, audioMb: 16, documentoMb: 100, textoMax: 4096 },
    exigeJanela24h: false,

    enviarTexto: (destino, conteudo) => postar("/send/text", { number: destino, text: conteudo }),

    enviarMidia: (destino, m) =>
      postar("/send/media", {
        number: destino,
        type: TIPO_DE_MIDIA[m.tipo],
        file: `data:${m.mime};base64,${m.bytes.toString("base64")}`,
        ...(m.legenda ? { text: m.legenda } : {}),
        ...(m.nome ? { docName: m.nome } : {}),
      }),

    async baixarMidia(ref) {
      const arquivo = await deps.http(ref, { provedor: "uazapi", cabecalhos: { token: deps.token } });
      if (arquivo.status !== 200) throw new Error(`download da mídia falhou: HTTP ${arquivo.status}`);
      return { bytes: arquivo.bytes, mime: arquivo.tipo ?? "application/octet-stream" };
    },

    async marcarComoLida(externoId) {
      await postar("/message/markread", { id: [externoId] });
    },

    async estadoDaSessao() {
      const r = await chamar(deps.http, `${base}/instance/status`, { provedor: "uazapi", cabecalhos });
      if (!r.ok) return { estado: "desconectada" };
      const instancia = comoObjeto(r.corpo.instance) ?? r.corpo;
      const estado = SESSOES[(texto(instancia.status) ?? "").toLowerCase()] ?? "desconectada";
      const qr = texto(instancia.qrcode);
      return { estado, ...(qr ? { qr } : {}) };
    },

    verificarAssinatura: deps.conferirAssinatura,
    interpretarWebhook: interpretarUazapi,
  };
}
