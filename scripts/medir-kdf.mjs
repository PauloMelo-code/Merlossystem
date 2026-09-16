import { hash, verify } from "@node-rs/argon2";

/**
 * Mede o custo real do Argon2id NESTA máquina (02-seguranca.md §6 e §22 item 2).
 *
 *   node scripts/medir-kdf.mjs [amostras] [concorrencia]
 *
 * Roda na VPS ANTES do primeiro deploy em PRD. Duas saídas importam:
 *
 *   - o p95 do `verify`, que é o valor de `PISO_RECUSA_MS` (§8). Piso abaixo do
 *     p95 devolve a recusa antes de o KDF terminar em parte das vezes, e a
 *     diferença de tempo volta a dizer se a conta existe;
 *   - o ponto em que a concorrência para de escalar, que é o teto do semáforo
 *     de `src/lib/auth/kdf.ts` (default 4, com UV_THREADPOOL_SIZE=8).
 *
 * `.mjs` e sem import da aplicação: precisa rodar numa VPS sem build.
 */

const CUSTO = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const SENHA = "frase-de-teste-sem-valor-nenhum-para-medicao";

const amostras = Number(process.argv[2] ?? 20);
const concorrencia = Number(process.argv[3] ?? 4);

function percentil(valores, p) {
  const ordenado = [...valores].sort((a, b) => a - b);
  const indice = Math.min(ordenado.length - 1, Math.ceil((p / 100) * ordenado.length) - 1);
  return ordenado[Math.max(0, indice)];
}

function resumo(rotulo, tempos) {
  const media = tempos.reduce((a, b) => a + b, 0) / tempos.length;
  console.log(
    `${rotulo.padEnd(22)} p50 ${percentil(tempos, 50).toFixed(0).padStart(5)} ms` +
      `  p95 ${percentil(tempos, 95).toFixed(0).padStart(5)} ms` +
      `  média ${media.toFixed(0).padStart(5)} ms`,
  );
}

async function medir(fn, vezes) {
  const tempos = [];
  for (let i = 0; i < vezes; i += 1) {
    const inicio = performance.now();
    await fn();
    tempos.push(performance.now() - inicio);
  }
  return tempos;
}

async function principal() {
  console.log("");
  console.log(`Argon2id m=${CUSTO.memoryCost}KiB t=${CUSTO.timeCost} p=${CUSTO.parallelism}`);
  console.log(`UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE ?? "(padrão 4)"}`);
  console.log(`amostras=${amostras} concorrencia=${concorrencia}`);
  console.log("");

  const referencia = await hash(SENHA, CUSTO);

  resumo("hash sequencial", await medir(() => hash(SENHA, CUSTO), amostras));
  resumo("verify sequencial", await medir(() => verify(referencia, SENHA), amostras));

  // Em paralelo: é aqui que o threadpool aparece. Se o p95 explodir com
  // concorrência baixa, o semáforo tem de descer.
  const lotes = Math.max(1, Math.floor(amostras / concorrencia));
  const paralelos = await medir(
    () => Promise.all(Array.from({ length: concorrencia }, () => verify(referencia, SENHA))),
    lotes,
  );
  resumo(`verify x${concorrencia} juntos`, paralelos);

  const p95 = percentil(await medir(() => verify(referencia, SENHA), amostras), 95);
  const piso = Math.max(300, Math.ceil(p95 / 50) * 50);
  console.log("");
  console.log(`Sugestão:  PISO_RECUSA_MS=${piso}   (p95 do verify arredondado, mínimo 300)`);
  console.log("Anote o resultado no ADR e em docs/seguranca/runbook.md.");
  console.log("");
}

void principal().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
