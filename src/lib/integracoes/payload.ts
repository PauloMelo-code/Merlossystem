import { createHash } from "node:crypto";

/**
 * Roteamento do corpo dos webhooks — Meta e uazapi (03-arquitetura.md §11).
 *
 * Módulo PURO, e só roda DEPOIS de autenticar: é aqui o primeiro `JSON.parse`
 * do fluxo. Ele NÃO normaliza mensagem (isso é do adaptador de canal, pacote
 * M1) — só descobre de qual CONTA é cada item e qual é o id do evento, e corta
 * o lote em pedaços que continuam tendo a forma do payload original. Assim o
 * `interpretarWebhook(corpoCru)` do adaptador lê a linha do diário sem saber
 * que ela foi cortada.
 *
 * O sistema antigo roteava o lote INTEIRO pela primeira entrada: mensagem da
 * loja B entrava na conta da loja A. Aqui o lote é agrupado por conta.
 */

export type TipoDeItem = "mensagem" | "status" | "modelo" | "sessao" | "outro";

export type ItemRoteado = {
  /** Chave de roteamento: `phone_number_id`, `entry.id` ou `null` (modelo). */
  conta: string | null;
  tipo: TipoDeItem;
  /** Id do evento no provedor: é a idempotência do diário. */
  externoId: string;
  /** Pedaço do corpo, com a forma do payload original. */
  corpo: unknown;
};

type Objeto = Record<string, unknown>;

const ehObjeto = (v: unknown): v is Objeto => typeof v === "object" && v !== null && !Array.isArray(v);
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const texto = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : null;

/** Id estável para item que o provedor não identifica. */
export function idDeConteudo(valor: unknown): string {
  return createHash("sha256").update(JSON.stringify(valor) ?? "", "utf8").digest("hex").slice(0, 40);
}

/** `JSON.parse` que nunca lança: corpo ilegível vira `null`. */
export function lerJson(corpoCru: string): unknown {
  try {
    return JSON.parse(corpoCru) as unknown;
  } catch {
    return null;
  }
}

/** Junta itens com a MESMA conta e o MESMO id (vários anexos = uma mensagem). */
function agrupar(itens: { conta: string | null; tipo: TipoDeItem; externoId: string; parte: unknown }[]) {
  const mapa = new Map<string, { conta: string | null; tipo: TipoDeItem; externoId: string; partes: unknown[] }>();
  for (const item of itens) {
    const chave = `${item.conta ?? ""}|${item.externoId}`;
    const atual = mapa.get(chave);
    if (atual) atual.partes.push(item.parte);
    else mapa.set(chave, { conta: item.conta, tipo: item.tipo, externoId: item.externoId, partes: [item.parte] });
  }
  return [...mapa.values()];
}

/**
 * WhatsApp Cloud API. A conta é `value.metadata.phone_number_id`; o modelo
 * (`message_template_status_update`) vem pela WABA (`entry.id`), que mora
 * cifrada na credencial — por isso ele sai com `conta = null` e a sincronização
 * de modelos é disparada para as contas oficiais.
 */
export function rotearWhatsapp(corpo: unknown): ItemRoteado[] {
  if (!ehObjeto(corpo)) return [];
  const objeto = texto(corpo.object) ?? "whatsapp_business_account";
  const brutos: { conta: string | null; tipo: TipoDeItem; externoId: string; parte: unknown }[] = [];

  for (const entrada of lista(corpo.entry)) {
    if (!ehObjeto(entrada)) continue;
    const waba = texto(entrada.id);
    for (const mudanca of lista(entrada.changes)) {
      if (!ehObjeto(mudanca) || !ehObjeto(mudanca.value)) continue;
      const valor = mudanca.value;
      const campo = texto(mudanca.field) ?? "messages";

      if (campo === "message_template_status_update") {
        const id = `modelo-${texto(valor.message_template_id) ?? "x"}-${texto(valor.event) ?? "x"}-${idDeConteudo(valor)}`;
        brutos.push({ conta: null, tipo: "modelo", externoId: id, parte: { waba, field: campo, value: valor } });
        continue;
      }

      const metadados = ehObjeto(valor.metadata) ? valor.metadata : {};
      const conta = texto(metadados.phone_number_id);
      const base = { messaging_product: valor.messaging_product, metadata: metadados };

      for (const m of lista(valor.messages)) {
        const id = ehObjeto(m) ? texto(m.id) : null;
        brutos.push({
          conta,
          tipo: "mensagem",
          externoId: `msg-${id ?? idDeConteudo(m)}`,
          parte: { ...base, contacts: valor.contacts, messages: [m] },
        });
      }
      for (const s of lista(valor.statuses)) {
        const id = ehObjeto(s) ? `${texto(s.id) ?? idDeConteudo(s)}-${texto(s.status) ?? "x"}` : idDeConteudo(s);
        brutos.push({ conta, tipo: "status", externoId: `st-${id}`, parte: { ...base, statuses: [s] } });
      }
      if (lista(valor.messages).length === 0 && lista(valor.statuses).length === 0) {
        brutos.push({ conta, tipo: "outro", externoId: `outro-${idDeConteudo(mudanca)}`, parte: { ...valor } });
      }
    }
  }

  return agrupar(brutos).map((g) => ({
    conta: g.conta,
    tipo: g.tipo,
    externoId: g.externoId,
    corpo:
      g.tipo === "modelo"
        ? { object: objeto, entry: g.partes }
        : {
            object: objeto,
            entry: [
              {
                changes: [
                  {
                    field: "messages",
                    value: juntarValores(g.partes as Objeto[]),
                  },
                ],
              },
            ],
          },
  }));
}

function juntarValores(partes: Objeto[]): Objeto {
  const [primeira = {}] = partes;
  const messages = partes.flatMap((p) => lista(p.messages));
  const statuses = partes.flatMap((p) => lista(p.statuses));
  return {
    ...primeira,
    ...(messages.length > 0 ? { messages } : {}),
    ...(statuses.length > 0 ? { statuses } : {}),
  };
}

/**
 * Instagram (Messenger Platform). A conta é `entry.id`. Eco de página e
 * leitura chegam no mesmo array `messaging`: o roteamento não descarta nada —
 * quem registra o descarte com motivo é o adaptador (M1).
 */
export function rotearInstagram(corpo: unknown): ItemRoteado[] {
  if (!ehObjeto(corpo)) return [];
  const objeto = texto(corpo.object) ?? "instagram";
  const brutos: { conta: string | null; tipo: TipoDeItem; externoId: string; parte: unknown }[] = [];

  for (const entrada of lista(corpo.entry)) {
    if (!ehObjeto(entrada)) continue;
    const conta = texto(entrada.id);
    for (const evento of lista(entrada.messaging)) {
      if (!ehObjeto(evento)) continue;
      const mensagem = ehObjeto(evento.message) ? evento.message : null;
      const lido = ehObjeto(evento.read) ? evento.read : null;
      const id = mensagem
        ? `msg-${texto(mensagem.mid) ?? idDeConteudo(evento)}`
        : lido
          ? `lido-${texto(lido.mid) ?? idDeConteudo(evento)}`
          : `outro-${idDeConteudo(evento)}`;
      brutos.push({ conta, tipo: mensagem ? "mensagem" : lido ? "status" : "outro", externoId: id, parte: evento });
    }
  }

  return agrupar(brutos).map((g) => ({
    conta: g.conta,
    tipo: g.tipo,
    externoId: g.externoId,
    corpo: { object: objeto, entry: [{ id: g.conta, messaging: g.partes }] },
  }));
}

/** Campos que o uazapi repete no corpo e que NUNCA vão para o diário. */
const SEGREDOS_DO_UAZAPI = ["token", "apikey", "api_key", "adminToken"];

/**
 * uazapi: uma entrega = um evento. A conta já veio da URL e foi autenticada;
 * aqui só sai o id e o tipo. O corpo perde o token da instância que algumas
 * versões repetem no payload — credencial não entra no diário.
 */
export function rotearUazapi(corpo: unknown): ItemRoteado[] {
  if (!ehObjeto(corpo)) return [];
  const limpo: Objeto = { ...corpo };
  for (const campo of SEGREDOS_DO_UAZAPI) delete limpo[campo];

  const tipoBruto = (texto(corpo.EventType) ?? texto(corpo.event) ?? texto(corpo.type) ?? "").toLowerCase();
  const mensagem = ehObjeto(corpo.message) ? corpo.message : ehObjeto(corpo.data) ? corpo.data : null;
  const idDaMensagem = mensagem ? (texto(mensagem.messageid) ?? texto(mensagem.id)) : null;

  let tipo: TipoDeItem = "outro";
  if (tipoBruto.startsWith("connection") || tipoBruto === "qrcode") tipo = "sessao";
  else if (tipoBruto === "messages_update") tipo = "status";
  else if (tipoBruto.startsWith("message")) tipo = "mensagem";

  const sufixo = idDaMensagem ?? idDeConteudo(limpo);
  const externoId =
    tipo === "mensagem" ? `msg-${sufixo}` : tipo === "status" ? `st-${idDeConteudo(limpo)}` : `${tipo}-${idDeConteudo(limpo)}`;
  return [{ conta: null, tipo, externoId, corpo: limpo }];
}
