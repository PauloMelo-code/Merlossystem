/**
 * Rotas de API que o middleware NAO protege por sessao, porque quem chama nao
 * tem sessao. Cada uma se defende sozinha dentro do proprio route handler:
 *
 *   /api/auth/*         fluxo do NextAuth (login, callback, signout)
 *   /api/webhooks/*     Meta/TikTok/gateway — assinatura (src/lib/webhook-auth.ts)
 *   /api/register       bootstrap do 1o usuario; depois exige sessao de admin
 *   /api/alerts/check   cron — CRON_SECRET
 *   /api/transcription  cron — CRON_SECRET
 *
 * Fora daqui, `/api/**` inteiro exige sessao — rota nova nasce protegida.
 * Acrescentar um item nesta lista sem por a verificacao no handler e abrir a
 * rota para a internet.
 */
const API_PUBLICA = [
  /^\/api\/auth\//,
  /^\/api\/webhooks\//,
  /^\/api\/register$/,
  /^\/api\/alerts\/check$/,
  /^\/api\/transcription$/,
  // Rodada da classificacao do funil. Sem sessao porque quem chama e o cron
  // do EasyPanel; o handler confere o `CRON_SECRET` em tempo constante.
  /^\/api\/ai\/funil$/,
  // Volta do OAuth. Quem autoriza aqui e o `state` assinado
  // (src/lib/bling/estado.ts), que vale 1 minuto — nao o cookie, que nem
  // sempre acompanha o retorno de outro dominio.
  /^\/api\/integracoes\/bling\/callback$/,
  /^\/api\/integracoes\/tiktok\/callback$/,
]

export function ehApiPublica(pathname: string): boolean {
  return API_PUBLICA.some((re) => re.test(pathname))
}
