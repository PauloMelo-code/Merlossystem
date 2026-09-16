import { webhookUazapi } from "@/lib/integracoes";

/**
 * Webhook do uazapi (03-arquitetura.md §5 e §11). A conta vem da URL; o
 * segredo é POR INTEGRAÇÃO e só em `x-uazapi-secret` — `?segredo=` é recusado.
 * Sem GET: o uazapi não faz challenge.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = webhookUazapi;
