// .claude/skills/how-to-use-guide/scripts/capturar-prints.mjs
//
// Captura os prints do guia dirigindo o Chrome headless por CDP.
// Sem dependência: o Node 24 desta máquina já tem WebSocket global.
//
//   node .claude/skills/how-to-use-guide/scripts/capturar-prints.mjs <perfil> <saida> <email> <senha>
//
// PRÉ-REQUISITOS
//   • `npm run dev` em http://localhost:3005  (porta do .claude/launch.json)
//   • usuário ERP válido com permissão nas telas do guia
//
// ⚠️ LEIA ANTES DE EDITAR O ROTEIRO ⚠️
// O `.env` desta máquina aponta para o banco de PRODUÇÃO. Este script é
// READ-ONLY de propósito: navega, abre painel e preenche campo — nunca envia.
// O helper `clicar()` RECUSA botões de ação destrutiva/gravação (Salvar,
// Receber, Estornar, Cancelar, Excluir, Importar…). Se você precisa de um
// desses, o lugar certo é um ambiente com banco LOCAL, não `{ perigoso: true }`.

import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const [PERFIL, SAIDA, EMAIL, SENHA] = process.argv.slice(2)
const BASE = process.env.GUIA_BASE_URL ?? 'http://localhost:3005'

if (!PERFIL || !SAIDA) {
  console.error('uso: node capturar-prints.mjs <perfil> <saida> [email] [senha]')
  console.error('  email/senha só são necessários para telas do ERP (o checkout público não pede login)')
  process.exit(1)
}
if (!existsSync(CHROME)) {
  console.error(`❌ Chrome não encontrado em ${CHROME}`)
  process.exit(1)
}

mkdirSync(SAIDA, { recursive: true })

// O JS de anonimização vive em ARQUIVO PRÓPRIO de propósito: dentro de um
// template literal o JS engoliria `\s` e `\/`, quebrando a função em silêncio —
// os prints sairiam sem anonimização nenhuma, com aparência correta.
const ANON = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'anonimizar.js'), 'utf8')

// MODO VISIVEL (GUIA_HEADED=1): no macOS o Chrome cifra os cookies com uma chave do
// Keychain, e em --headless o acesso ao Keychain falha — a sessao gravada no perfil e
// DESCARTADA e a captura cai em /login mesmo com o cookie no disco. Rodando visivel a
// sessao do perfil e reaproveitada, o que evita passar senha por linha de comando.
const HEADLESS = process.env.GUIA_HEADED === '1' ? [] : ['--headless=new']

// MODO ATTACH (GUIA_CDP_PORT): usa um Chrome JA ABERTO, com sessao viva na memoria.
// Existe porque no macOS o cookie de sessao e cifrado com chave do Keychain: perfil
// copiado ou aberto em --headless nao decifra, e a captura cai em /login. Anexando,
// nenhuma senha precisa ser digitada nem passada por linha de comando.
const PORTA_CDP = Number(process.env.GUIA_CDP_PORT || 9333)
const ANEXAR = Boolean(process.env.GUIA_CDP_PORT)

const chrome = ANEXAR ? null : spawn(CHROME, [
  ...HEADLESS, `--remote-debugging-port=${PORTA_CDP}`, `--user-data-dir=${PERFIL}`,
  '--window-size=1440,900', '--hide-scrollbars', '--force-device-scale-factor=2',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' })

const esperarCDP = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORTA_CDP}/json/version`)
      if (r.ok) return (await r.json()).webSocketDebuggerUrl
    } catch {}
    await sleep(300)
  }
  throw new Error('CDP não subiu')
}

const ws = new WebSocket(await esperarCDP())
await new Promise((res) => (ws.onopen = res))

let id = 0
const pendentes = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pendentes.has(m.id)) { pendentes.get(m.id)(m); pendentes.delete(m.id) }
}
const cmd = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const i = ++id
    pendentes.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)))
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }))
  })

const { targetId } = await cmd('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await cmd('Target.attachToTarget', { targetId, flatten: true })
const s = (method, params) => cmd(method, params, sessionId)

await s('Page.enable')
await s('Runtime.enable')
await s('Network.enable')
await s('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false })
// Tema CLARO forçado: o documento é papel branco, print escuro vira um
// retângulo preto no meio da página. `defaultTheme` do app é "system".
await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })

// `exceptionDetails` NÃO pode ser ignorado: sem esta checagem uma exceção
// dentro do anonimizar.js resolve como `undefined`, a captura continua e o PNG
// sai CRU com aparência correta — exatamente o modo de falha que a skill teme.
const avaliar = async (expression, { rotulo = 'avaliar' } = {}) => {
  const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) {
    const detalhe = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'exceção sem descrição'
    throw new Error(`${rotulo}: a página lançou → ${String(detalhe).split('\n')[0]}`)
  }
  return r.result?.value
}

const urlAtual = () => avaliar('location.pathname')

const irPara = async (path, espera = 3800) => {
  await s('Page.navigate', { url: BASE + path })
  await sleep(espera)
}

/** Trava de segurança: rótulos que GRAVAM não são clicáveis por este script. */
const PROIBIDOS = /salvar|receber|estornar|cancelar|excluir|apagar|deletar|confirmar|enviar|emitir|importar|sincronizar|renovar|baixar nota|gerar cobran/i

const clicar = async (seletorOuTexto, { perigoso = false, espera = 900 } = {}) => {
  // Busca + guarda + clique numa ÚNICA avaliação (duas idas ao CDP abririam
  // janela para a página mudar entre a checagem e o clique).
  // Casa por seletor CSS, por texto, por `title` E por `aria-label`: neste ERP
  // vários botões são só ícone e o rótulo vive no `title`
  // (ex.: title="Aplicar Filtros" na barra de /financeiro/receber).
  const acao = await avaliar(`(() => {
    const alvo = ${JSON.stringify(seletorOuTexto)};
    const proibidos = new RegExp(${JSON.stringify(PROIBIDOS.source)}, 'i');
    const chave = alvo.toLowerCase();
    let el = null;
    try { el = document.querySelector(alvo) } catch {}
    if (!el) {
      const cands = [...document.querySelectorAll('button, a, [role="button"], [role="tab"]')];
      el = cands.find((b) => (b.textContent || '').trim().toLowerCase().includes(chave))
        || cands.find((b) => (b.getAttribute('title') || '').toLowerCase().includes(chave))
        || cands.find((b) => (b.getAttribute('aria-label') || '').toLowerCase().includes(chave));
    }
    if (!el) return { ok: false };
    const rotulo = ((el.textContent || '').trim() || el.getAttribute('title') || el.getAttribute('aria-label') || '').trim().slice(0, 60);
    if (${perigoso ? 'false' : 'true'} && proibidos.test(rotulo)) return { ok: true, bloqueado: true, rotulo };
    el.click();
    return { ok: true, bloqueado: false, rotulo };
  })()`, { rotulo: `clicar(${seletorOuTexto})` })

  if (!acao?.ok) throw new Error(`clicar: não encontrei "${seletorOuTexto}" (nem por texto, title ou aria-label)`)
  if (acao.bloqueado) {
    throw new Error(`🚫 clicar bloqueado em "${acao.rotulo}" — este script é READ-ONLY (banco de produção).`)
  }
  await sleep(espera)
}

/** Preenche input controlado do React (só estado do cliente — nunca envia). */
const preencher = async (seletor, valor) => {
  const ok = await avaliar(`(() => {
    const el = document.querySelector(${JSON.stringify(seletor)});
    if (!el) return false;
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(el, ${JSON.stringify(valor)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  if (!ok) throw new Error(`preencher: não encontrei ${seletor}`)
  await sleep(300)
}

/** Máscara NATIVA de valores do próprio ERP (o olho 👁 do cabeçalho). */
const mascararValores = () => avaliar(`(() => { document.documentElement.dataset.valuePrivacy = 'masked'; return 'masked' })()`)

/**
 * Roda o anonimizar.js e LÊ o relatório que ele devolve. Descartar esse retorno
 * (o que este script já fez) deixa a captura "✅" mesmo sem ter substituído nada.
 */
const anonimizar = async () => {
  const rel = await avaliar(ANON, { rotulo: 'anonimizar' })
  await sleep(400)
  if (!rel || typeof rel !== 'object') {
    throw new Error('anonimizar: o script não devolveu relatório — confira scripts/anonimizar.js')
  }
  const total = ['celulas', 'emails', 'documentos', 'telefones', 'enderecos', 'codigos', 'urls', 'painel', 'usuarioLogado']
    .reduce((acc, k) => acc + (rel[k] || 0), 0) + (rel.campos?.length || 0)
  console.log(`  🔒 ${total} substituição(ões) · colunas: ${(rel.colunas || []).join(', ') || '—'} · campos: ${(rel.campos || []).join(', ') || '—'}`)
  for (const aviso of rel.conferirManualmente || []) console.log(`     ⚠️  ${aviso}`)
  if (total === 0) {
    console.log('     🚨 NADA foi substituído. Se esta tela mostra dado de cliente, o print está CRU.')
  }
  return rel
}

const tirar = async (nome, { altura } = {}) => {
  if (altura) await s('Emulation.setDeviceMetricsOverride', { width: 1440, height: altura, deviceScaleFactor: 2, mobile: false })
  const { data } = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(`${SAIDA}/${nome}.png`, Buffer.from(data, 'base64'))
  console.log(`  ✅ ${nome}.png`)
  if (altura) await s('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false })
}

/**
 * Login REAL no formulário. O cookie de sessão do Better Auth é `httpOnly`, então
 * não existe token para injetar — este é o único caminho que autentica.
 * Falha de login ABORTA: senão o script tira 10 prints da tela de login.
 */
const entrar = async () => {
  if (!EMAIL || !SENHA) throw new Error('login: informe email e senha nos argumentos')
  await irPara('/login', 2500)
  await avaliar(`localStorage.setItem('theme','light')`)
  await preencher('#email', EMAIL)
  await preencher('#password', SENHA)
  await clicar('Entrar', { espera: 4500 })
  const destino = await urlAtual()
  if (destino.includes('/login')) throw new Error('login falhou — confira e-mail/senha e se o usuário está ativo')
  console.log(`  🔓 sessão ativa (${destino})`)
}

const encerrar = (codigo = 0) => { if (!ANEXAR) chrome?.kill(); ws.close(); process.exit(codigo) }

export { s, avaliar, irPara, tirar, clicar, preencher, mascararValores, anonimizar, entrar, sleep, ANON, encerrar }

// ────────────────────────── roteiro dos prints ──────────────────────────────
// TROQUE daqui para baixo pelo fluxo do recurso da vez. Regra: navegar, abrir
// painel, preencher campo, mascarar, anonimizar, tirar. NUNCA enviar.
try {
  console.log('Capturando:')

  // ── ROTEIRO: interruptor "Notificar o cliente" (guia do operador) ─────────
  // TUDO read-only: navegar, abrir modal, rolar e clicar no interruptor (estado
  // do React). NENHUM Salvar/Receber/Estornar — o `clicar` bloquearia mesmo.
  //
  // SESSÃO REAPROVEITADA DO PERFIL: quando o `--user-data-dir` já tem sessão ERP
  // válida, não é preciso passar e-mail e senha. No macOS isso exige Chrome
  // VISÍVEL (GUIA_HEADED=1) ou modo attach (GUIA_CDP_PORT): em --headless a chave
  // do Keychain não abre e o cookie do perfil é descartado.
  await irPara('/dashboard', 3200)
  await avaliar(`localStorage.setItem("theme","light")`)
  if ((await urlAtual()).includes('/login')) {
    if (!EMAIL || !SENHA) {
      throw new Error(
        'sem sessão neste perfil e sem credenciais: abra o Chrome com o MESMO --user-data-dir, ' +
        'faça login em http://localhost:3005/login e rode de novo (GUIA_CDP_PORT para anexar)',
      )
    }
    await entrar()
  } else {
    console.log('  🔓 sessão reaproveitada do perfil (nenhuma senha usada)')
  }

  /*
   * ANONIMIZAÇÃO DO TEXTO DO SWITCH — camada que o `anonimizar.js` NÃO cobre.
   *
   * O rótulo de destino de "Notificar o cliente" é TEXTO CORRIDO com o telefone e o
   * e-mail REAIS do cliente ("WhatsApp +55 55 99961-8895 e e-mail ..."). Não é célula
   * de tabela nem campo de formulário, então nenhuma camada do anonimizar.js casa com
   * ele — e o print sai com dado pessoal de cliente num PDF que vai para terceiros.
   * Verificado: a primeira captura vazou telefone e e-mail.
   *
   * Também troca o ID da transação do gateway, que aparece em "Detalhes do Pagamento".
   */
  const anonimizarDestinos = () => avaliar(`(() => {
    let n = 0
    for (const p of document.querySelectorAll('p')) {
      const t = (p.textContent || '').trim()
      if (/WhatsApp \\+?\\d|Somente por e-mail|Somente por WhatsApp|e-mail [^ ]+@/i.test(t)) {
        p.textContent = 'WhatsApp +55 51 99999-8888 e e-mail financeiro@suaempresa.com.br.'
        n++
      }
    }
    // Campos de INPUT: nome do cliente selecionado na modal e ID da transacao do
    // gateway. Atribuicao DIRETA na propriedade value, SEM disparar evento: com o
    // setter nativo + evento input o React re-renderiza o campo controlado e devolve
    // o valor REAL na tela — foi assim que o ID da transacao sobreviveu a 1a tentativa.
    // (Sem backtick neste comentario: ele vive DENTRO de um template literal.)
    for (const i of document.querySelectorAll('input')) {
      const ph = i.getAttribute('placeholder') || ''
      if (/buscar um cliente/i.test(ph) && String(i.value || '').trim()) {
        i.value = 'ÓTICAS EXEMPLO LTDA'
        n++
      }
      if (/^[0-9]{6,}$/.test(String(i.value || ''))) {
        i.value = '000000000'
        n++
      }
    }
    return n
  })()`, { rotulo: 'anonimizarDestinos' })

  const centralizarSwitch = () =>
    avaliar(`(() => { document.querySelector('#shouldNotifyClient')?.scrollIntoView({ block: 'center' }); return 'ok' })()`)

  // 01 — a lista, com o botão "Novo" visível
  await irPara('/financeiro/receber')
  await mascararValores()
  await anonimizar()
  await tirar('01-contas-a-receber')

  // 02 — modal "Novo Lançamento a Receber": os DOIS interruptores desligados
  await clicar('Novo', { espera: 1600 })
  await centralizarSwitch()
  await sleep(600)
  await anonimizar()
  await anonimizarDestinos()
  await tirar('02-modal-novo-desligados')

  // recarrega para fechar a modal sem clicar em nada que grave
  await irPara('/financeiro/receber')
  await mascararValores()

  // 03 — modal de EDIÇÃO: interruptor ligado, com os destinos (fictícios) à vista.
  // `altura` menor mantém o print focado nos dois interruptores, sem arrastar
  // "Detalhes do Pagamento" e o estado da nota para dentro do quadro.
  await clicar('Editar', { espera: 2000 })
  await centralizarSwitch()
  await sleep(600)
  await anonimizar()
  const trocas = await anonimizarDestinos()
  if (!trocas) throw new Error('anonimizarDestinos: nada substituído — o print sairia com telefone/e-mail REAIS')
  console.log(`  🔒 ${trocas} substituição(ões) no texto de destino`)
  await centralizarSwitch()
  await tirar('03-notificar-ligado', { altura: 820 })

  // 04 — o mesmo interruptor DESLIGADO (só estado do formulário; nada é salvo)
  await clicar('#shouldNotifyClient', { espera: 700 })
  await anonimizarDestinos()
  await centralizarSwitch()
  await tirar('04-notificar-desligado', { altura: 820 })

  // 05 — Cobrança Avulsa, seção "4. Comunicação" (nasce LIGADO)
  await irPara('/cobrancas/avulsa')
  await centralizarSwitch()
  await sleep(600)
  await anonimizar()
  await anonimizarDestinos()
  await tirar('05-avulsa-comunicacao')

  // 06 — cobrança CANCELADA: os dois interruptores desaparecem da modal
  await irPara('/financeiro/receber?status=canceled&from=2026-01-01&to=2026-12-31')
  await mascararValores()
  await clicar('Editar', { espera: 2000 })
  // Posiciona o print EXATAMENTE onde os interruptores estariam se a cobrança não
  // estivesse encerrada (logo abaixo de "Calcular custos líquidos") — é a ausência
  // deles que o passo 6 do guia mostra.
  await avaliar(`(() => {
    const l = [...document.querySelectorAll('label')].find((x) => /Calcular custos/i.test(x.textContent || ''));
    l?.scrollIntoView({ block: 'center' });
    return 'ok'
  })()`)
  await sleep(600)
  await anonimizar()
  await anonimizarDestinos()
  await tirar('06-cancelado-sem-switches')

  console.log('\nfechando')
  encerrar(0)
} catch (erro) {
  console.error(`\n❌ ${erro.message}`)
  encerrar(1)
}
