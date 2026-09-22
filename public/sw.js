/**
 * Service worker do aplicativo instalavel.
 *
 * DE PROPOSITO MINIMO. Conversa, pedido e estoque mudam a cada minuto: cachear
 * resposta de `/api` faria a vendedora responder a cliente olhando mensagem
 * velha, e isso e pior do que ficar sem app. Entao:
 *
 *   - `/api`, login e qualquer metodo que nao seja GET passam DIRETO pela rede;
 *   - arquivo estatico do Next (`/_next/static`, icone) vem do cache e e
 *     atualizado em segundo plano — e imutavel, tem hash no nome;
 *   - navegacao tenta a rede e, sem internet, mostra a pagina de offline.
 *
 * Existe tambem porque o navegador so oferece INSTALAR quando ha um service
 * worker com tratamento de `fetch`.
 */
const VERSAO = "merlos-v1"
const ESTATICOS = `${VERSAO}-estaticos`
const OFFLINE = "/offline.html"

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(ESTATICOS).then((cache) => cache.addAll([OFFLINE, "/icones/icone-192.png"]))
  )
  self.skipWaiting()
})

self.addEventListener("activate", (evento) => {
  // Versao nova: joga fora o cache das anteriores, senao o app velho sobrevive.
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) =>
        Promise.all(chaves.filter((c) => !c.startsWith(VERSAO)).map((c) => caches.delete(c)))
      )
      .then(() => self.clients.claim())
  )
})

function ehEstatico(url) {
  return url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/icones/")
}

self.addEventListener("fetch", (evento) => {
  const req = evento.request
  if (req.method !== "GET") return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // Dado vivo e sessao nunca passam pelo cache.
  if (url.pathname.startsWith("/api")) return

  if (ehEstatico(url)) {
    evento.respondWith(
      caches.match(req).then((guardado) => {
        const rede = fetch(req)
          .then((resposta) => {
            if (resposta.ok) {
              const copia = resposta.clone()
              caches.open(ESTATICOS).then((cache) => cache.put(req, copia))
            }
            return resposta
          })
          .catch(() => guardado)
        return guardado || rede
      })
    )
    return
  }

  if (req.mode === "navigate") {
    evento.respondWith(fetch(req).catch(() => caches.match(OFFLINE)))
  }
})
