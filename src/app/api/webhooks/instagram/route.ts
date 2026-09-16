import { webhookInstagram } from "@/lib/integracoes";

/**
 * Webhook do Instagram (03-arquitetura.md §5 e §11). Mesmo HMAC do app da
 * Meta; o token do challenge é o do Instagram, nunca o do WhatsApp.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = webhookInstagram;
export const POST = webhookInstagram;
