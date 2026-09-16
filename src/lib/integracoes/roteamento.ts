import "server-only";
import { env } from "@/lib/env";
import { enfileirar } from "@/lib/fila/filas";
import { jobId } from "@/lib/fila/idempotencia";
import type { Provedor } from "@/lib/db/schema/_enums/plataforma";
import {
  conferirAssinaturaMeta,
  conferirSegredoPorHash,
  conferirTokenDeChallenge,
} from "@/lib/seguranca/assinaturas";
import { rotaDeMaquina, type EntradaDeMaquina } from "@/lib/seguranca/maquina";
import { contaPorId, contaPorReferencia, type ContaParaWebhook } from "./_consultas";
import { cabecalhosDoDiario, registrarEventoRecebido } from "./diario";
import { lerJson, rotearInstagram, rotearUazapi, rotearWhatsapp, type ItemRoteado } from "./payload";

/**
 * Borda de máquina dos três canais (03-arquitetura.md §11; 02-seguranca.md §12).
 *
 * A ORDEM é a de `rotaDeMaquina` e não muda: teto por IP → teto por conta →
 * content-length → corpo cru com teto → carregar → assinatura sobre o corpo
 * cru → (daqui para baixo, já autenticado) parse → anti-repetição → persistir
 * → enfileirar → 200.
 *
 * NENHUM `JSON.parse` antes de autenticar: a chave de roteamento sai da URL
 * (uazapi) ou é o próprio app da Meta, que assina com um segredo só.
 */

const NO_STORE = { "cache-control": "no-store" };
const ok = () => new Response(null, { status: 200, headers: NO_STORE });

/** Falha ao ENFILEIRAR também é 500: sem job, o evento nunca sairia de `recebido`. */
class ErroDeEnfileiramento extends Error {}

async function exigirEnfileirado(id: Promise<string | null>): Promise<void> {
  if ((await id) === null) throw new ErroDeEnfileiramento("fila indisponível");
}

/**
 * Persiste e despacha UM item. Conta desconhecida, sem loja ou revogada vira
 * `recusado`; com `status = 'erro'`, `descartado` (06/INV-53). Nenhum dos dois
 * vira contato: a loja nunca é "chutada".
 */
async function despachar(
  provedor: Provedor,
  item: ItemRoteado,
  conta: ContaParaWebhook | null,
  entrada: EntradaDeMaquina<unknown>,
): Promise<void> {
  const cabecalhos = cabecalhosDoDiario(entrada.req.headers);
  const base = {
    provedor,
    eventoExternoId: item.externoId,
    assinaturaOk: true,
    ip: entrada.ip,
    corpo: item.corpo,
    cabecalhos,
  };

  // Modelo da Meta vem pela WABA, não por número: dispara a sincronização.
  if (item.tipo === "modelo") {
    const r = await registrarEventoRecebido({ ...base, integracaoId: null, lojaId: null, tipo: "recebido" });
    if (r.pendente) {
      await exigirEnfileirado(
        enfileirar("integracoes", "sincronizar-templates", { eventoId: r.id }, { jobId: jobId("modelos", r.id) }),
      );
    }
    return;
  }

  const motivo =
    conta === null
      ? "conta desconhecida ou revogada"
      : conta.lojaId === null
        ? "conta sem loja"
        : conta.status === "erro" && item.tipo !== "sessao"
          ? "integracao com erro"
          : item.tipo === "outro"
            ? "tipo de evento nao tratado"
            : null;

  if (motivo !== null) {
    await registrarEventoRecebido({
      ...base,
      integracaoId: conta?.id ?? null,
      lojaId: conta?.lojaId ?? null,
      tipo: conta === null || conta.lojaId === null ? "recusado" : "descartado",
      erro: motivo,
    });
    return;
  }

  const r = await registrarEventoRecebido({
    ...base,
    integracaoId: conta!.id,
    lojaId: conta!.lojaId,
    tipo: "recebido",
  });
  if (!r.pendente) return; // reentrega de evento já processado: nada a fazer

  if (item.tipo === "sessao") {
    await exigirEnfileirado(
      enfileirar(
        "integracoes",
        "conferir-sessao-uazapi",
        { integracaoId: conta!.id, lojaId: conta!.lojaId, eventoId: r.id },
        { jobId: jobId("sessao", r.id) },
      ),
    );
    return;
  }
  // `jobId` determinístico: a reentrega que chega com o job ainda na fila não
  // cria um segundo; a que chega depois bate no `pendente = false` acima.
  await exigirEnfileirado(
    enfileirar(
      "mensagens-entrada",
      "processar-evento",
      { eventoId: r.id, provedor },
      { jobId: jobId("evento", r.id) },
    ),
  );
}

/** Lote com contas diferentes: cada conta é resolvida uma vez só. */
async function despacharLote(
  provedor: Provedor,
  itens: ItemRoteado[],
  entrada: EntradaDeMaquina<unknown>,
): Promise<Response> {
  const cache = new Map<string, Promise<ContaParaWebhook | null>>();
  for (const item of itens) {
    let conta: ContaParaWebhook | null = null;
    if (item.conta !== null) {
      const chave = item.conta;
      if (!cache.has(chave)) cache.set(chave, contaPorReferencia(provedor, chave));
      conta = (await cache.get(chave)) ?? null;
      if (conta && conta.provedor !== provedor) conta = null;
    }
    await despachar(provedor, item, conta, entrada);
  }
  return ok();
}

/** O app da Meta: um segredo só, então a "conta" autenticada é o próprio app. */
type AppMeta = { app: true };
const APP_META: AppMeta = { app: true };

/** GET de verificação: token POR CANAL, comparado em tempo constante. */
function verificacaoMeta(esperado: string | undefined) {
  return (req: Request): Response => {
    const q = new URL(req.url).searchParams;
    const desafio = q.get("hub.challenge") ?? "";
    const valido =
      q.get("hub.mode") === "subscribe" &&
      conferirTokenDeChallenge(q.get("hub.verify_token"), esperado) &&
      /^[A-Za-z0-9_-]{1,128}$/.test(desafio);
    if (!valido) return new Response(null, { status: 403, headers: NO_STORE });
    return new Response(desafio, { status: 200, headers: { ...NO_STORE, "content-type": "text/plain" } });
  };
}

function webhookMeta(provedor: "whatsapp_oficial" | "instagram", rotear: (corpo: unknown) => ItemRoteado[]) {
  return rotaDeMaquina<AppMeta>({
    provedor,
    // A Meta entrega de poucos IPs e em lote: o balde por "conta" aqui é o do
    // app inteiro, então é mais largo que o padrão.
    limiteIntegracao: { janela: 60, max: 3_000 },
    limiteIp: { janela: 60, max: 3_000 },
    chave: () => "app",
    carregar: async () => APP_META,
    conferir: (corpoCru, req) => conferirAssinaturaMeta(corpoCru, req.headers.get("x-hub-signature-256")),
    verificar: verificacaoMeta(
      provedor === "whatsapp_oficial" ? env.WHATSAPP_VERIFY_TOKEN : env.INSTAGRAM_VERIFY_TOKEN,
    ),
    processar: (entrada) => despacharLote(provedor, rotear(lerJson(entrada.corpoCru)), entrada),
  });
}

export const webhookWhatsapp = webhookMeta("whatsapp_oficial", rotearWhatsapp);
export const webhookInstagram = webhookMeta("instagram", rotearInstagram);

/** `/api/webhooks/uazapi/[integracaoId]`: o último segmento é a chave. */
export function idDaUrl(req: Request): string | null {
  const segmentos = new URL(req.url).pathname.split("/").filter(Boolean);
  const ultimo = segmentos.at(-1);
  return ultimo && segmentos.at(-2) === "uazapi" ? ultimo : null;
}

export const webhookUazapi = rotaDeMaquina<ContaParaWebhook>({
  provedor: "uazapi",
  chave: idDaUrl,
  // Provedor errado é o mesmo "não existe": a resposta não pode separar os casos.
  carregar: async (chave) => {
    const conta = await contaPorId(chave);
    return conta && conta.provedor === "uazapi" ? conta : null;
  },
  // Segredo POR INTEGRAÇÃO, só em cabeçalho. Com conta nula a comparação roda
  // contra o hash fixo, e gasta o mesmo tempo.
  conferir: (_corpoCru, req, conta) =>
    conferirSegredoPorHash(req.headers.get("x-uazapi-secret"), conta?.segredoHash ?? null),
  processar: async (entrada) => {
    for (const item of rotearUazapi(lerJson(entrada.corpoCru))) {
      await despachar("uazapi", item, entrada.integracao, entrada);
    }
    return ok();
  },
});
