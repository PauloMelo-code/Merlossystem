// Prepara .tmp_guia/marca/ para o montar-guia.mjs.
//
// O modelo da BahTech resolvia a marca pela tag do plano (brandIdentity.ts).
// Este projeto tem UMA marca, entao os ativos ja vivem em assets/marca/ e este
// script so os copia para o lugar que o montador procura.
//
//   node .claude/skills/how-to-use-guide/scripts/preparar-marca.mjs
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const ORIGEM = join(AQUI, '../assets/marca')
const DESTINO = '.tmp_guia/marca'

mkdirSync(DESTINO, { recursive: true })
cpSync(ORIGEM, DESTINO, { recursive: true })
console.log(`marca copiada: ${ORIGEM} -> ${DESTINO}`)
console.log('Falta o logo? Ver assets/marca/LEIA-ME.md.')
