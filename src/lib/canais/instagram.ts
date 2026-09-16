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
  InterpretacaoDeWebhook,
  MensagemNormalizada,
  MidiaRecebida,
  ResultadoEnvio,
  TipoNormalizado,
} from "./tipos";

/**
 * Instagram Direct — plataforma de mensagens da Meta (03-arquitetura.md §10).
 *
 * `entry[].id` é o perfil que RECEBEU: é a chave de roteamento. `is_echo` é a
 * própria página ecoando o que mandou e vira DESCARTE registrado (nunca
 * contato). Vários anexos no mesmo `mid` são UMA mensagem com N mídias.
 *
 * Sem `enviarModelo` (modelo aprovado é do WhatsApp) e sem `enviarMidia` no R1:
 * o Direct pede o anexo por URL pública, e a mídia da loja é privada
 * (03-arquitetura.md §13.3). A tela não oferece anexo nesta conta.
 */

const ANEXOS: Record<string, TipoNormalizado> = {
  image: "imagem",
  video: "video",
  audio: "audio",
  file: "documento",
  sticker: "sticker",
};

function midiasDe(anexos: unknown[]): { tipo: TipoNormalizado; midias: MidiaRecebida[] } | { naoSuportado: string } {
  const midias: MidiaRecebida[] = [];
  let tipo: TipoNormalizado | null = null;
  for (const bruto of anexos) {
    const anexo = comoObjeto(bruto);
    const tipoOriginal = texto(anexo?.type) ?? "";
    const mapeado = ANEXOS[tipoOriginal];
    if (!mapeado) return { naoSuportado: tipoOriginal || "anexo" };
    const url = texto(comoObjeto(anexo?.payload)?.url);
    if (!url) continue;
    tipo ??= mapeado;
    midias.push({ url });
  }
  return tipo ? { tipo, midias } : { naoSuportado: "anexo" };
}

/** Parser do webhook. Puro, nunca lança. */
export function interpretarInstagram(corpoCru: string): InterpretacaoDeWebhook {
  const saida = vazio();
  const corpo = lerJson(corpoCru);
  if (!corpo) return saida;

  for (const e of comoLista(corpo.entry)) {
    const entrada = comoObjeto(e);
    const contaExterna = texto(entrada?.id);
    if (!entrada || !contaExterna) continue;

    for (const ev of comoLista(entrada.messaging)) {
      const evento = comoObjeto(ev);
      if (!evento) continue;
      const remetenteId = texto(comoObjeto(evento.sender)?.id);
      const ocorridoEm = paraData(evento.timestamp);

      const lido = comoObjeto(evento.read);
      if (lido) {
        const mid = texto(lido.mid);
        if (mid) saida.status.push({ externoId: mid, status: "lida", ocorridoEm });
        continue;
      }

      const msg = comoObjeto(evento.message);
      if (!msg) {
        const tipoOriginal = Object.keys(evento).find(
          (k) => !["sender", "recipient", "timestamp"].includes(k),
        );
        saida.descartados.push({
          motivo: "tipo_nao_suportado",
          ...(tipoOriginal ? { tipoOriginal } : {}),
        });
        continue;
      }
      if (msg.is_echo === true) {
        saida.descartados.push({ motivo: "eco_de_pagina" });
        continue;
      }
      const externoId = texto(msg.mid);
      if (!remetenteId || !externoId) {
        saida.descartados.push({ motivo: "sem_remetente" });
        continue;
      }
      if (msg.is_unsupported === true || msg.is_deleted === true) {
        saida.descartados.push({
          motivo: "tipo_nao_suportado",
          tipoOriginal: msg.is_deleted === true ? "apagada" : "nao_suportada",
        });
        continue;
      }

      const normalizada: MensagemNormalizada = {
        contaExterna,
        externoId,
        remetenteId,
        tipo: "texto",
        deMim: false,
        ocorridoEm,
        bruto: evento,
      };
      const conteudo = texto(msg.text);
      const anexos = comoLista(msg.attachments);
      if (anexos.length > 0) {
        const lidas = midiasDe(anexos);
        if ("naoSuportado" in lidas) {
          if (!conteudo) {
            saida.descartados.push({ motivo: "tipo_nao_suportado", tipoOriginal: lidas.naoSuportado });
            continue;
          }
        } else {
          normalizada.tipo = lidas.tipo;
          normalizada.midias = lidas.midias;
        }
      } else if (!conteudo) {
        saida.descartados.push({ motivo: "tipo_nao_suportado", tipoOriginal: "vazia" });
        continue;
      }
      if (conteudo) normalizada.texto = conteudo;
      const citada = texto(comoObjeto(msg.reply_to)?.mid);
      if (citada) normalizada.respondendoA = citada;
      saida.mensagens.push(normalizada);
    }
  }
  return saida;
}

export type DepsInstagram = {
  accessToken: string;
  versaoGraph: string;
  http: ClienteHttp;
  conferirAssinatura: (corpoCru: string, cabecalhos: Headers) => boolean;
};

function resultado(r: { status: number; corpo: Bruto }): ResultadoEnvio {
  if (r.status >= 200 && r.status < 300) {
    const id = texto(r.corpo.message_id);
    return id
      ? { ok: true, externoId: id }
      : { ok: false, motivo: "O provedor não devolveu o id da mensagem.", permanente: false };
  }
  const erro = comoObjeto(r.corpo.error);
  return {
    ok: false,
    motivo: primeiro(erro?.error_user_msg, erro?.message) ?? `HTTP ${r.status}`,
    permanente: ehPermanente(r.status),
  };
}

export function criarInstagram(deps: DepsInstagram): AdaptadorDeCanal {
  const base = `https://graph.facebook.com/${deps.versaoGraph}`;
  const cabecalhos = {
    authorization: `Bearer ${deps.accessToken}`,
    "content-type": "application/json",
  };

  return {
    provedor: "instagram",
    limites: { imagemMb: 8, videoMb: 25, audioMb: 25, documentoMb: 25, textoMax: 1000 },
    exigeJanela24h: true,

    async enviarTexto(destino, conteudo) {
      const r = await chamar(deps.http, `${base}/me/messages`, {
        provedor: "meta",
        metodo: "POST",
        corpo: JSON.stringify({ recipient: { id: destino }, message: { text: conteudo } }),
        cabecalhos,
      });
      return r.ok ? resultado(r) : r.resultado;
    },

    async baixarMidia(ref) {
      const arquivo = await deps.http(ref, { provedor: "meta" });
      if (arquivo.status !== 200) throw new Error(`download da mídia falhou: HTTP ${arquivo.status}`);
      return { bytes: arquivo.bytes, mime: arquivo.tipo ?? "application/octet-stream" };
    },

    verificarAssinatura: deps.conferirAssinatura,
    interpretarWebhook: interpretarInstagram,
  };
}
