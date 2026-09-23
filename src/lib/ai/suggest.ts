import { getAnthropicClient } from "./client"
import { MERLOS_SYSTEM_PROMPT, SUGGEST_PROMPT } from "./prompts"
import { prisma } from "@/lib/db/prisma"

interface SuggestOptions {
  conversationId: string
  /**
   * Loja da conversa. O catalogo e POR LOJA: sem isto a sugestao oferecia
   * peca da outra loja, com preco da outra loja, dentro do texto pronto para
   * mandar a cliente. Passava despercebido enquanto `products` estava vazia;
   * com o catalogo do Bling espelhado, vira vazamento diario.
   */
  storeId: string
  contactName?: string
  preferredSize?: string
}

export async function suggestResponse(opts: SuggestOptions): Promise<string> {
  const client = getAnthropicClient()

  // Fetch last 20 messages
  const messages = await prisma.message.findMany({
    where: { conversationId: opts.conversationId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      senderType: true,
      content: true,
      contentType: true,
      createdAt: true,
    },
  })

  // Build conversation history
  const history = messages
    .reverse()
    .map((m) => {
      const role = m.senderType === "customer" ? "Cliente" : "Atendente"
      const content = m.content || `[${m.contentType}]`
      return `${role}: ${content}`
    })
    .join("\n")

  // Fetch relevant products (mentioned in recent messages)
  let catalogContext = ""
  const recentText = messages.map((m) => m.content || "").join(" ").toLowerCase()
  const products = await prisma.product.findMany({
    where: { active: true, storeId: opts.storeId },
    take: 10,
    orderBy: { featured: "desc" },
  })

  const relevant = products.filter(
    (p) =>
      recentText.includes(p.name.toLowerCase()) ||
      (p.category && recentText.includes(p.category))
  )

  if (relevant.length > 0) {
    catalogContext = "\n\nProdutos relevantes:\n" +
      relevant
        .map((p) => `- ${p.name} | R$ ${Number(p.price).toFixed(2)} | Tamanhos: ${p.sizes.join(", ")} | ${p.sizeType}`)
        .join("\n")
  }

  // Fetch quick replies for context
  const quickReplies = await prisma.quickReply.findMany({
    where: { isActive: true },
    select: { shortcut: true, title: true },
  })
  const qrContext = quickReplies.length > 0
    ? "\n\nRespostas rápidas disponíveis: " + quickReplies.map((q) => `${q.shortcut} (${q.title})`).join(", ")
    : ""

  const clientContext = opts.contactName
    ? `\n\nNome da cliente: ${opts.contactName}`
    : ""
  const sizeContext = opts.preferredSize
    ? `\nPreferência de tamanho: ${opts.preferredSize}`
    : ""

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    system: MERLOS_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `${SUGGEST_PROMPT}${clientContext}${sizeContext}${catalogContext}${qrContext}\n\n--- CONVERSA ---\n${history}`,
      },
    ],
  })

  const textBlock = response.content.find((b) => b.type === "text")
  return textBlock?.text || "Não foi possível gerar sugestão."
}
