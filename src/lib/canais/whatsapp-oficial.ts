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
  AtualizacaoDeStatus,
  ClienteHttp,
  InterpretacaoDeWebhook,
  MensagemNormalizada,
  ModeloParaEnvio,
  ResultadoEnvio,
  StatusRecebido,
  TipoNormalizado,
} from "./tipos";

/**
 * WhatsApp oficial — Cloud API da Meta (03-arquitetura.md §10, §11).
 *
 * A conta é achada por `metadata.phone_number_id`; o lote pode trazer contas
 * diferentes, e cada mensagem sai com a SUA `contaExterna` (o antigo roteava o
 * lote inteiro pela primeira entrada).
 *
 * Sem `enviarMidia` no R1: a Graph exige upload multipart, e a porta única de
 * saída HTTP (`rede/buscarExterno.ts`) só aceita corpo texto. Capacidade
 * ausente = a tela não oferece anexo por este número (registrado no módulo).
 */

const STATUS: Record<string, StatusRecebido> = {
  sent: "enviada",
  delivered: "entregue",
  read: "lida",
  failed: "falhou",
};

const TIPOS: Record<string, TipoNormalizado> = {
  text: "texto",
  image: "imagem",
  video: "video",
  audio: "audio",
  voice: "audio",
  document: "documento",
  sticker: "sticker",
  location: "localizacao",
};

function mensagemDe(m: Bruto, contaExterna: string, nomes: Map<string, string>): MensagemNormalizada | null {
  const tipoOriginal = texto(m.type) ?? "";
  const tipo = TIPOS[tipoOriginal];
  const externoId = texto(m.id);
  const remetenteId = texto(m.from);
  if (!tipo || !externoId || !remetenteId) return null;

  const midia = comoObjeto(m[tipoOriginal]);
  const contexto = comoObjeto(m.context);
  const local = tipo === "localizacao" ? midia : null;
  const conteudo =
    tipo === "texto"
      ? texto(comoObjeto(m.text)?.body)
      : local
        ? primeiro(local.name, local.address, `${String(local.latitude)},${String(local.longitude)}`)
        : texto(midia?.caption);

  const normalizada: MensagemNormalizada = {
    contaExterna,
    externoId,
    remetenteId,
    tipo,
    deMim: false,
    ocorridoEm: paraData(m.timestamp),
    bruto: m,
  };
  const nome = nomes.get(remetenteId);
  if (nome) normalizada.remetenteNome = nome;
  if (conteudo) normalizada.texto = conteudo;
  const citada = texto(contexto?.id);
  if (citada) normalizada.respondendoA = citada;
  if (midia && tipo !== "texto" && tipo !== "localizacao") {
    const idMidia = texto(midia.id);
    if (idMidia) {
      normalizada.midias = [
        {
          idExterno: idMidia,
          ...(texto(midia.mime_type) ? { mime: texto(midia.mime_type)! } : {}),
          ...(texto(midia.filename) ? { nome: texto(midia.filename)! } : {}),
          ...(texto(midia.caption) ? { legenda: texto(midia.caption)! } : {}),
        },
      ];
    }
  }
  return normalizada;
}

function statusDe(s: Bruto): AtualizacaoDeStatus | null {
  const externoId = texto(s.id);
  const status = STATUS[texto(s.status) ?? ""];
  if (!externoId || !status) return null;
  const erro = comoObjeto(comoLista(s.errors)[0]);
  const motivo = primeiro(comoObjeto(erro?.error_data)?.details, erro?.message, erro?.title);
  return {
    externoId,
    status,
    ocorridoEm: paraData(s.timestamp),
    ...(motivo ? { motivo } : {}),
  };
}

/** Parser do webhook. Puro, nunca lança. */
export function interpretarWhatsappOficial(corpoCru: string): InterpretacaoDeWebhook {
  const saida = vazio();
  const corpo = lerJson(corpoCru);
  if (!corpo) return saida;

  for (const entrada of comoLista(corpo.entry)) {
    for (const mudanca of comoLista(comoObjeto(entrada)?.changes)) {
      const valor = comoObjeto(comoObjeto(mudanca)?.value);
      const contaExterna = texto(comoObjeto(valor?.metadata)?.phone_number_id);
      if (!valor || !contaExterna) continue;

      const nomes = new Map<string, string>();
      for (const c of comoLista(valor.contacts)) {
        const contato = comoObjeto(c);
        const id = texto(contato?.wa_id);
        const nome = texto(comoObjeto(contato?.profile)?.name);
        if (id && nome) nomes.set(id, nome);
      }

      for (const bruta of comoLista(valor.messages)) {
        const m = comoObjeto(bruta);
        if (!m) continue;
        const normalizada = mensagemDe(m, contaExterna, nomes);
        if (normalizada) saida.mensagens.push(normalizada);
        else if (!texto(m.from)) saida.descartados.push({ motivo: "sem_remetente" });
        else {
          const tipoOriginal = texto(m.type);
          saida.descartados.push({
            motivo: "tipo_nao_suportado",
            ...(tipoOriginal ? { tipoOriginal } : {}),
          });
        }
      }

      for (const bruto of comoLista(valor.statuses)) {
        const s = comoObjeto(bruto);
        const status = s ? statusDe(s) : null;
        if (status) saida.status.push(status);
      }
    }
  }
  return saida;
}

export type DepsWhatsappOficial = {
  accessToken: string;
  phoneNumberId: string;
  versaoGraph: string;
  http: ClienteHttp;
  conferirAssinatura: (corpoCru: string, cabecalhos: Headers) => boolean;
};

function resultadoDoEnvio(r: { status: number; corpo: Bruto }): ResultadoEnvio {
  if (r.status >= 200 && r.status < 300) {
    const id = texto(comoObjeto(comoLista(r.corpo.messages)[0])?.id);
    if (id) return { ok: true, externoId: id };
    return { ok: false, motivo: "O provedor não devolveu o id da mensagem.", permanente: false };
  }
  const erro = comoObjeto(r.corpo.error);
  const motivo = primeiro(erro?.error_user_msg, erro?.message) ?? `HTTP ${r.status}`;
  return { ok: false, motivo, permanente: ehPermanente(r.status) };
}

export function criarWhatsappOficial(deps: DepsWhatsappOficial): AdaptadorDeCanal {
  const base = `https://graph.facebook.com/${deps.versaoGraph}`;
  const cabecalhos = {
    authorization: `Bearer ${deps.accessToken}`,
    "content-type": "application/json",
  };

  async function postarMensagem(corpo: Bruto): Promise<ResultadoEnvio> {
    const r = await chamar(deps.http, `${base}/${deps.phoneNumberId}/messages`, {
      provedor: "meta",
      metodo: "POST",
      corpo: JSON.stringify({ messaging_product: "whatsapp", ...corpo }),
      cabecalhos,
    });
    return r.ok ? resultadoDoEnvio(r) : r.resultado;
  }

  return {
    provedor: "whatsapp_oficial",
    limites: { imagemMb: 5, videoMb: 16, audioMb: 16, documentoMb: 100, textoMax: 4096 },
    exigeJanela24h: true,

    enviarTexto: (destino, conteudo) =>
      postarMensagem({ to: destino, type: "text", text: { body: conteudo } }),

    enviarModelo: (destino: string, modelo: ModeloParaEnvio) =>
      postarMensagem({
        to: destino,
        type: "template",
        template: {
          name: modelo.nome,
          language: { code: modelo.idioma },
          ...(modelo.variaveis.length > 0
            ? {
                components: [
                  {
                    type: "body",
                    parameters: modelo.variaveis.map((v) => ({ type: "text", text: v })),
                  },
                ],
              }
            : {}),
        },
      }),

    async baixarMidia(ref) {
      const meta = await deps.http(`${base}/${encodeURIComponent(ref)}`, {
        provedor: "meta",
        cabecalhos,
      });
      const corpo = lerJson(meta.bytes.toString("utf8")) ?? {};
      const url = texto(corpo.url);
      if (meta.status !== 200 || !url) throw new Error(`mídia ${ref} sem endereço no provedor`);
      const arquivo = await deps.http(url, { provedor: "meta", cabecalhos });
      if (arquivo.status !== 200) throw new Error(`download da mídia falhou: HTTP ${arquivo.status}`);
      return {
        bytes: arquivo.bytes,
        mime: texto(corpo.mime_type) ?? arquivo.tipo ?? "application/octet-stream",
      };
    },

    async marcarComoLida(externoId) {
      await postarMensagem({ status: "read", message_id: externoId });
    },

    verificarAssinatura: deps.conferirAssinatura,
    interpretarWebhook: interpretarWhatsappOficial,
  };
}
