import { webhookWhatsapp } from "@/lib/integracoes";

/**
 * Webhook do WhatsApp oficial (03-arquitetura.md §5 e §11). Portão:
 * `rotaDeMaquina` — HMAC-SHA256 do corpo cru com `META_APP_SECRET`. O GET é o
 * challenge da Meta, com token próprio do canal.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = webhookWhatsapp;
export const POST = webhookWhatsapp;
