#!/usr/bin/env node
/**
 * Icones do aplicativo instalavel (PWA), gerados da logo que ja esta no repo.
 *
 * Nao e decoracao: sem 192 e 512 o navegador NAO oferece instalar, e sem a
 * versao `maskable` o Android recorta a logo dentro do circulo do sistema.
 * Gerados por script para nascerem da mesma logo — logo trocada, `npm run
 * icones` e pronto.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import sharp from "sharp"

const RAIZ = process.cwd()
const ORIGEM = join(RAIZ, "public", "logo-dark-bg.png")
const DESTINO = join(RAIZ, "public", "icones")
/** Mesmo tom do cabecalho do sistema; vira a cor de fundo do icone e da splash. */
const FUNDO = { r: 23, g: 23, b: 23, alpha: 1 }

mkdirSync(DESTINO, { recursive: true })

async function gerar(tamanho, arquivo, margem) {
  const area = Math.round(tamanho * (1 - margem * 2))
  const logo = await sharp(ORIGEM).resize(area, area, { fit: "contain", background: FUNDO }).toBuffer()
  const borda = Math.round((tamanho - area) / 2)
  await sharp({ create: { width: tamanho, height: tamanho, channels: 4, background: FUNDO } })
    .composite([{ input: logo, top: borda, left: borda }])
    .png()
    .toFile(join(DESTINO, arquivo))
  console.log("gerado:", arquivo, `${tamanho}x${tamanho}`)
}

// A `maskable` leva margem maior: o Android recorta ate 20% de cada lado.
await gerar(192, "icone-192.png", 0.08)
await gerar(512, "icone-512.png", 0.08)
await gerar(512, "icone-maskable-512.png", 0.2)
await gerar(180, "apple-touch-icon.png", 0.08)

/**
 * Icone da ABA do navegador. O Next 14 serve `src/app/icon.png` e
 * `src/app/apple-icon.png` sozinho, sem tag nenhuma no layout — e eles ganham
 * do `favicon.ico` padrao que vem com o projeto.
 */
async function noApp(arquivo, tamanho, margem) {
  const area = Math.round(tamanho * (1 - margem * 2))
  const logo = await sharp(ORIGEM).resize(area, area, { fit: "contain", background: FUNDO }).toBuffer()
  const borda = Math.round((tamanho - area) / 2)
  await sharp({ create: { width: tamanho, height: tamanho, channels: 4, background: FUNDO } })
    .composite([{ input: logo, top: borda, left: borda }])
    .png()
    .toFile(join(RAIZ, "src", "app", arquivo))
  console.log("gerado:", `src/app/${arquivo}`, `${tamanho}x${tamanho}`)
}

await noApp("icon.png", 512, 0.08)
await noApp("apple-icon.png", 180, 0.08)
