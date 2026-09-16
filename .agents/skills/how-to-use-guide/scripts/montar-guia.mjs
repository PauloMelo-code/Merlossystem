// .claude/skills/how-to-use-guide/scripts/montar-guia.mjs
//
// Junta CSS base + tokens da marca + páginas + ativos num ÚNICO arquivo HTML,
// pronto para o Chrome imprimir. É a parte mecânica do guia — e a mais fácil de
// errar à mão (token esquecido, print faltando, SVG estourando a página).
//
//   node .claude/skills/how-to-use-guide/scripts/montar-guia.mjs \
//     .tmp_guia/paginas.html .tmp_guia/guia.html \
//     [--marca .tmp_guia/marca] [--prints .tmp_guia/prints] [--titulo "Como pagar por PIX"]
//
// PLACEHOLDERS aceitos no arquivo de páginas:
//   {{LOGO_NEGATIVO}}   SVG inline do logotipo branco  → só sobre a faixa escura da capa
//   {{LOGO_TINTA}}      SVG inline em tinta escura     → cabeçalho de página branca
//   {{ICONE}}           data URI do ícone colorido     → dentro de <img src="…">
//   {{PRINT:nome}}      data URI de <prints>/nome.png  → dentro de <img src="…">
//
// Falha RUIDOSA de propósito: placeholder sem ativo aborta. Um print faltando
// que virasse string vazia produziria um PDF com retângulo escuro e ninguém veria.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Consome os pares `--flag valor` ANTES de separar os posicionais: filtrar só
// por `startsWith('--')` deixava o VALOR da flag virar posicional quando ela
// vinha primeiro (ordem natural de CLI), e o script morria com stack trace de fs.
const argv = process.argv.slice(2)
const flags = new Map()
const posicionais = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { flags.set(argv[i].slice(2), argv[i + 1]); i++ }
  else posicionais.push(argv[i])
}
const [entrada, saida] = posicionais
const flag = (n, d) => flags.get(n) ?? d
const DIR_MARCA = resolve(flag('marca', '.tmp_guia/marca'))
const DIR_PRINTS = resolve(flag('prints', '.tmp_guia/prints'))
const BASE_CSS = resolve('.claude/skills/how-to-use-guide/assets/base.css.html')

if (!entrada || !saida) {
  console.error('uso: node montar-guia.mjs <paginas.html> <saida.html> [--marca dir] [--prints dir] [--titulo "texto"]')
  process.exit(1)
}
const exigir = (caminho, dica) => {
  if (!existsSync(caminho)) { console.error(`❌ não encontrei ${caminho}\n   ${dica}`); process.exit(1) }
  return caminho
}
exigir(entrada, 'é o arquivo com as <section class="pagina">…</section>')
exigir(BASE_CSS, 'rode a partir da RAIZ do repositório')
const DICA_MARCA = 'rode antes: npx tsx .claude/skills/how-to-use-guide/scripts/preparar-marca.ts --plan <id>'
exigir(join(DIR_MARCA, 'tokens.css'), DICA_MARCA)
exigir(join(DIR_MARCA, 'marca.json'), DICA_MARCA)

/* ---- marca (validada ANTES de qualquer escrita) ------------------------- */
// Sem guarda, marca.json corrompido derrubava com stack trace de JSON.parse, e
// `tokens` ausente estourava TypeError DEPOIS de o guia já ter sido gravado.
let marcaJson
try {
  marcaJson = JSON.parse(readFileSync(join(DIR_MARCA, 'marca.json'), 'utf8'))
} catch (erro) {
  console.error(`❌ marca.json inválido em ${DIR_MARCA} — ${erro.message}`)
  console.error(`   ${DICA_MARCA}`)
  process.exit(1)
}
if (!marcaJson?.label || !marcaJson?.tokens?.marca) {
  console.error(`❌ marca.json em ${DIR_MARCA} está incompleto (falta label e/ou tokens.marca).`)
  console.error(`   ${DICA_MARCA}`)
  process.exit(1)
}

/* ---- CSS base + tokens da marca ---------------------------------------- */
const cabeca = readFileSync(BASE_CSS, 'utf8')
const tokens = readFileSync(join(DIR_MARCA, 'tokens.css'), 'utf8')
  .replace(/^\/\*[\s\S]*?\*\/\s*/, '')
  .replace(/:root\s*\{\s*/, '')
  .replace(/\}\s*$/, '')
  .trim()

const BLOCO = /\/\* ↓↓↓ SUBSTITUA[\s\S]*?\/\* ↑↑↑ fim do bloco substituível ↑↑↑ \*\//
if (!BLOCO.test(cabeca)) { console.error('❌ o bloco de tokens do base.css.html mudou de forma — ajuste este script.'); process.exit(1) }
// Comentário HTML do arquivo de páginas é nota PARA QUEM ESCREVE, não conteúdo
// do guia: some antes da expansão. Sem isso um placeholder citado dentro de um
// comentário era expandido — embutia o SVG inteiro (10 KB) num comentário,
// inflava os contadores e fazia a montagem abortar por uma ocorrência que o
// operador não vê. (Regressão real, pega em auditoria.)
const paginas = readFileSync(entrada, 'utf8')
const comentarios = (paginas.match(/<!--[\s\S]*?-->/g) || []).length
const paginasLimpas = paginas.replace(/<!--[\s\S]*?-->/g, '')

// A remoção só é confiável se os comentários estiverem BEM FORMADOS. Comentário
// sem `-->` faz a regex casar até o PRÓXIMO fechamento do arquivo e apagar as
// `<section>` do meio — e, como a contagem sai do HTML já mutilado, o número
// bateria com o PDF e a verificação do §7.1 pararia de acusar. Falha ruidosa:
const contarSecoes = (txt) => (txt.match(/<section class="pagina/g) || []).length
const secoesAntes = contarSecoes(paginas)
const secoesDepois = contarSecoes(paginasLimpas)

if (paginasLimpas.includes('<!--')) {
  // Varre os PARES para achar o abre sem fecha. Procurar "linha que tem <!-- e
  // não tem -->" acusaria qualquer comentário de várias linhas (o primeiro do
  // esqueleto é assim) e apontaria a linha errada.
  let cursor = 0
  let orfao = -1
  for (;;) {
    const abre = paginas.indexOf('<!--', cursor)
    if (abre === -1) break
    const fecha = paginas.indexOf('-->', abre + 4)
    if (fecha === -1) { orfao = abre; break }
    cursor = fecha + 3
  }
  const linha = orfao === -1 ? 0 : paginas.slice(0, orfao).split('\n').length
  console.error(`❌ comentário HTML sem "-->" em ${entrada}${linha ? `:${linha}` : ''} — feche o comentário antes de montar.`)
  process.exit(1)
}
if (secoesDepois !== secoesAntes) {
  console.error(`❌ a remoção de comentários engoliu ${secoesAntes - secoesDepois} seção(ões) de ${entrada}:`)
  console.error(`   ${secoesAntes} <section class="pagina"> antes, ${secoesDepois} depois.`)
  console.error('   Quase sempre é comentário mal fechado ou aninhado. Corrija o arquivo de páginas.')
  process.exit(1)
}

let html = `${cabeca.replace(BLOCO, tokens)}\n${paginasLimpas}\n</body></html>\n`

/* ---- título (vira propriedade do PDF, então segue a MARCA) -------------- */
// Título fixo gravaria "BahTech" no metadado de um guia BahVitrine — o mesmo
// vazamento de marca que a skill existe para evitar.
const titulo = flag('titulo', `Como usar — ${marcaJson.label}`)
// ESCAPA (não remove) e usa FUNÇÃO de reposição: com string, `$&`/`$\``/`$'`
// seriam interpretados e um título com "R$&" reinjetaria o próprio placeholder
// — e "R$" é o caso normal num guia de cobrança.
const tituloSeguro = titulo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
html = html.replace(/\{\{TITULO\}\}/g, () => tituloSeguro)

/* ---- ativos ------------------------------------------------------------ */
const b64 = (caminho, mime) => `data:${mime};base64,${readFileSync(caminho).toString('base64')}`
const svgInline = (caminho) => readFileSync(caminho, 'utf8').replace(/<\?xml[^>]*\?>/g, '').trim()

const usados = { logoNegativo: 0, logoTinta: 0, icone: 0, prints: [] }

html = html.replace(/\{\{LOGO_NEGATIVO\}\}/g, () => {
  const svg = join(DIR_MARCA, 'logo-negativo.svg')
  const png = join(DIR_MARCA, 'logo-negativo.png')
  usados.logoNegativo++
  if (existsSync(svg)) return svgInline(svg)
  exigir(png, 'rode preparar-marca.ts')
  return `<img src="${b64(png, 'image/png')}" alt="">`
})

html = html.replace(/\{\{LOGO_TINTA\}\}/g, () => {
  const svg = join(DIR_MARCA, 'logo-tinta.svg')
  if (!existsSync(svg)) {
    console.error('❌ esta marca não tem logo-tinta.svg (o ativo oficial é PNG negativo).')
    console.error('   Em página branca use {{ICONE}} + o nome da marca escrito. Ver references/branding-e-marca.md §3.')
    process.exit(1)
  }
  usados.logoTinta++
  return svgInline(svg)
})

html = html.replace(/\{\{ICONE\}\}/g, () => {
  usados.icone++
  return b64(exigir(join(DIR_MARCA, 'icone.png'), 'rode preparar-marca.ts'), 'image/png')
})

html = html.replace(/\{\{PRINT:([\w.-]+)\}\}/g, (_, nome) => {
  const arquivo = join(DIR_PRINTS, nome.endsWith('.png') ? nome : `${nome}.png`)
  if (!existsSync(arquivo)) {
    const tem = existsSync(DIR_PRINTS) ? readdirSync(DIR_PRINTS).filter((f) => f.endsWith('.png')) : []
    console.error(`❌ print "${nome}" não existe em ${DIR_PRINTS}`)
    console.error(`   disponíveis: ${tem.length ? tem.join(', ') : '(nenhum — rode capturar-prints.mjs)'}`)
    process.exit(1)
  }
  usados.prints.push(nome)
  return b64(arquivo, 'image/png')
})

const RE_PLACEHOLDER = /\{\{[A-Z_]+(:[\w.-]+)?\}\}/
const sobrou = html.match(new RegExp(RE_PLACEHOLDER.source, 'g'))
if (sobrou) {
  console.error(`❌ placeholder não reconhecido: ${[...new Set(sobrou)].join(', ')}`)
  // Aponta SÓ as linhas do placeholder que sobrou (varrer por RE_PLACEHOLDER
  // listaria também os válidos, já expandidos no buffer), e numera sobre o
  // ARQUIVO DE PÁGINAS: o buffer montado nunca é gravado e traz ~118 linhas de
  // CSS na frente, então o número apontaria para um arquivo que não existe.
  const naoResolvidos = [...new Set(sobrou)]
  paginas.split('\n').forEach((linha, i) => {
    if (naoResolvidos.some((ph) => linha.includes(ph))) {
      console.error(`   ${entrada}:${i + 1}: ${linha.trim().slice(0, 100)}`)
    }
  })
  process.exit(1)
}

writeFileSync(saida, html)

const totalPaginas = (html.match(/<section class="pagina/g) || []).length
const mb = (Buffer.byteLength(html) / 1024 / 1024).toFixed(2)
const arquivoSugerido = `${marcaJson.label}-Guia.pdf`.replace(/\s+/g, '-')

console.log(`\n📄 ${saida}`)
// A MARCA é dita em voz alta SEMPRE: com `--titulo` próprio, o rótulo da marca
// desaparecia da saída e um `--marca` trocado passava sem ninguém ver.
console.log(`   marca: ${marcaJson.label} (${marcaJson.key}) · --marca ${marcaJson.tokens.marca} · pasta ${DIR_MARCA}`)
console.log(`   ${totalPaginas} página(s) · ${mb} MB · ${usados.prints.length} print(s) · ${comentarios} comentário(s) removido(s)`)
console.log(`   logo negativo ${usados.logoNegativo}x · logo tinta ${usados.logoTinta}x · ícone ${usados.icone}x`)
// Imprime o valor DO OPERADOR: o escapado (`&amp;`) divergia do `/Title` do PDF
// (`&`) e fazia a conferência do §7.5 parecer defeito.
console.log(`   título do PDF: "${titulo}"`)
if (!usados.prints.length) console.log('   ⚠️  nenhum print embutido — guia sem print não ensina nada')

// Marca sem logotipo próprio (hoje BahFlash): o ativo é o da marca do fallback,
// então o guia sairia com o logotipo de OUTRA marca no cabeçalho e na capa.
if (marcaJson.logo?.ehFallbackDe && (usados.logoNegativo || usados.logoTinta)) {
  const dona = marcaJson.logo.ehFallbackDe
  console.log(`   🚨 ${marcaJson.label} NÃO tem logotipo próprio: o que foi embutido é o da marca "${dona}".`)
  console.log(`      Troque por <img src="{{ICONE}}" alt="">${marcaJson.label.toUpperCase()} ou escreva o nome ao lado.`)
}

console.log(`\nGere o PDF e confira que o PDF tem ${totalPaginas} página(s):`)
console.log(`   "C:/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \\`)
console.log(`     --no-pdf-header-footer --print-to-pdf="$HOME/Downloads/${arquivoSugerido}" "file://$PWD/${saida}"\n`)
