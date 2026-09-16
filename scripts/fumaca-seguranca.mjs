#!/usr/bin/env node
// @ts-check
/**
 * fumaca-seguranca.mjs — CI-3 (02-seguranca.md §20).
 *
 *   node scripts/fumaca-seguranca.mjs https://hml.exemplo.com.br
 *
 * Roda DEPOIS do deploy em HML e em PRD, contra o sistema no ar. É a única
 * prova que enxerga o ambiente de verdade: proxy, TLS, DNS e as variáveis que
 * o build não viu. Teste de fonte prova o que está escrito; isto prova o que
 * está servindo.
 *
 * Node puro, sem dependência: um script de pós-deploy que precisa de `npm ci`
 * não roda no runner mínimo que faz o deploy.
 *
 * `DATABASE_URL` vem do ambiente (não de `argv`, para não aparecer na lista de
 * processos). É a quinta exceção nomeada da trava T17, pelo mesmo motivo das
 * outras quatro: este arquivo roda FORA do processo da aplicação e não pode
 * importar `src/lib/env.ts`, que exige o ambiente inteiro do app.
 *
 * Saída: `OK`, `FALHOU` ou `PENDENTE`. Só `FALHOU` derruba o deploy. `PENDENTE`
 * é a conferência cuja rota ainda pertence a um pacote da onda 2 — some quando
 * a rota nasce, e o P-INT liga o modo estrito.
 */

import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";

/** Aceita `--alvo <url>` (a forma que o CI usa) e a posicional. */
function urlDoAlvo() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--alvo");
  const bruta = i >= 0 ? (args[i + 1] ?? "") : (args[0] ?? "");
  return bruta.replace(/\/+$/, "");
}

const base = urlDoAlvo();
if (!base.startsWith("http")) {
  console.error("Uso: node scripts/fumaca-seguranca.mjs --alvo <url-base-do-ambiente>");
  process.exit(2);
}

/**
 * Valor descartavel, gerado a cada execucao. Literal aqui seria credencial
 * versionada, e a trava T17 reprova — com razao: o que esta no repositorio
 * acaba colado em algum ambiente.
 */
const VALOR_DA_SONDA = randomBytes(24).toString("base64url");

/** @type {{nome: string, estado: "OK"|"FALHOU"|"PENDENTE", detalhe: string}[]} */
const resultados = [];

/** @param {string} nome @param {() => Promise<string|null>} fn */
async function conferir(nome, fn) {
  try {
    const problema = await fn();
    resultados.push(
      problema === null
        ? { nome, estado: "OK", detalhe: "" }
        : { nome, estado: "FALHOU", detalhe: problema },
    );
  } catch (erro) {
    resultados.push({ nome, estado: "FALHOU", detalhe: String(erro) });
  }
}

/** @param {string} nome @param {string} porque */
function pendente(nome, porque) {
  resultados.push({ nome, estado: "PENDENTE", detalhe: porque });
}

/** @param {string} caminho @param {RequestInit} [init] */
function buscar(caminho, init) {
  return fetch(`${base}${caminho}`, { redirect: "manual", ...init });
}

// ── 1. liveness e sessão ────────────────────────────────────────────────────

await conferir("GET /api/saude responde 200", async () => {
  const r = await buscar("/api/saude");
  return r.status === 200 ? null : `status ${r.status}`;
});

await conferir("GET /api/auth/get-session responde 200 (G27)", async () => {
  const r = await buscar("/api/auth/get-session");
  return r.status === 200 ? null : `status ${r.status} — o schema do Better Auth não subiu`;
});

// ── 2. caminhos desligados ──────────────────────────────────────────────────

await conferir("POST /api/auth/sign-up/email responde 404 sem corpo", async () => {
  const r = await buscar("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email: "sonda@exemplo.com", password: "x" }),
  });
  const corpo = (await r.text()).trim();
  if (r.status !== 404) return `status ${r.status}: o cadastro público está aberto`;
  return corpo === "" ? null : `404 com corpo (${corpo.length} bytes): a sonda aprende o caminho`;
});

// ── 3. origem e CSRF ────────────────────────────────────────────────────────

await conferir("origem forjada é recusada", async () => {
  const r = await buscar("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://atacante.invalido" },
    body: JSON.stringify({ email: "sonda@exemplo.com", password: VALOR_DA_SONDA }),
  });
  return r.status === 403 ? null : `status ${r.status}, esperado 403`;
});

pendente(
  "action autenticada sem cookie responde 401",
  "depende de uma rota autenticada de domínio (/api/eventos, pacote M1)",
);

// ── 4. cabeçalhos e CSP ─────────────────────────────────────────────────────

const FIXOS = {
  "strict-transport-security": /max-age=\d{7,}/,
  "x-content-type-options": /nosniff/,
  "referrer-policy": /strict-origin-when-cross-origin/,
  "x-frame-options": /DENY/,
  "permissions-policy": /camera=\(\)/,
};

await conferir("cabeçalhos de §14.1 presentes em /entrar", async () => {
  const r = await buscar("/entrar");
  const faltando = Object.entries(FIXOS)
    .filter(([chave, padrao]) => !padrao.test(r.headers.get(chave) ?? ""))
    .map(([chave]) => chave);
  return faltando.length === 0 ? null : `faltando: ${faltando.join(", ")}`;
});

await conferir("CSP em ENFORCE, com nonce e sem 'unsafe-inline' em script-src", async () => {
  const r = await buscar("/entrar");
  const csp = r.headers.get("content-security-policy");
  if (!csp) return "sem Content-Security-Policy: Report-Only puro não protege nada";
  const script = /script-src([^;]*)/.exec(csp)?.[1] ?? "";
  if (script.includes("'unsafe-inline'")) return "script-src com 'unsafe-inline'";
  if (!script.includes("'nonce-")) return "script-src sem nonce";
  const img = /img-src([^;]*)/.exec(csp)?.[1] ?? "";
  if (/minio|:900\d/.test(img)) return "img-src cita o host do MinIO: o bucket é privado";
  return null;
});

await conferir("página de acesso sai com Cache-Control: no-store", async () => {
  const r = await buscar("/entrar");
  const cache = r.headers.get("cache-control") ?? "";
  return cache.includes("no-store") ? null : `cache-control: "${cache}"`;
});

// ── 5. recusa única de login ────────────────────────────────────────────────

/** @param {string} email @param {string} senha */
async function tempoDaRecusa(email, senha) {
  const inicio = performance.now();
  const r = await buscar("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email, password: senha }),
  });
  return { ms: performance.now() - inicio, status: r.status, corpo: await r.text() };
}

/** @param {number[]} valores */
function p50(valores) {
  const ordenado = [...valores].sort((a, b) => a - b);
  return ordenado[Math.floor(ordenado.length / 2)] ?? 0;
}

await conferir("as duas recusas são iguais em corpo e em tempo (±50 ms)", async () => {
  const inexistente = [];
  const errada = [];
  /** @type {Set<string>} */
  const corpos = new Set();
  for (let i = 0; i < 7; i++) {
    const a = await tempoDaRecusa(`nao-existe-${i}@sonda.invalido`, VALOR_DA_SONDA);
    const b = await tempoDaRecusa("sonda-existente@sonda.invalido", VALOR_DA_SONDA);
    inexistente.push(a.ms);
    errada.push(b.ms);
    corpos.add(`${a.status}|${a.corpo}`);
    corpos.add(`${b.status}|${b.corpo}`);
  }
  if (corpos.size > 1) return `respostas diferentes: ${[...corpos].join(" <> ")}`;
  const diferenca = Math.abs(p50(inexistente) - p50(errada));
  return diferenca <= 50 ? null : `p50 difere em ${diferenca.toFixed(0)} ms`;
});

// ── 6. readiness com segredo de maquina ─────────────────────────────────────

const sonda = process.env.SONDA_SEGREDO;
if (!sonda) {
  pendente("GET /api/pronto com segredo responde 200", "SONDA_SEGREDO ausente no runner");
} else {
  await conferir("GET /api/pronto recusa sem segredo e aceita com segredo", async () => {
    const semSegredo = await buscar("/api/pronto");
    if (semSegredo.status === 200) return "respondeu 200 sem o segredo de maquina";
    const comSegredo = await buscar("/api/pronto", { headers: { "x-merlo-sonda": sonda } });
    return comSegredo.status === 200 ? null : `com segredo respondeu ${comSegredo.status}`;
  });
}

// ── 7. DNS do remetente ─────────────────────────────────────────────────────

await conferir("_dmarc do domínio tem registro TXT", async () => {
  const dominio = new URL(base).hostname.replace(/^www\./, "");
  try {
    const registros = await resolveTxt(`_dmarc.${dominio}`);
    return registros.length > 0 ? null : "nenhum TXT em _dmarc";
  } catch {
    return `_dmarc.${dominio} não resolve: o convite vai cair em spam ou ser recusado`;
  }
});

// ── 7. conferências no banco ────────────────────────────────────────────────

const urlBanco = process.env.DATABASE_URL;
if (!urlBanco) {
  pendente("conta ativa sem 2º fator", "DATABASE_URL ausente no ambiente do runner");
  pendente("XFF forjado não muda o IP gravado", "DATABASE_URL ausente no ambiente do runner");
} else {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: urlBanco, max: 1 });
  try {
    await conferir("nenhuma conta ativa sem 2º fator", async () => {
      const r = await pool.query(
        `select count(*)::int as n from usuarios u
          where u.ativo = true and u.is_deleted = false
            and not exists (select 1 from usuarios_totp t where t.usuario_id = u.id)
            and not exists (select 1 from usuarios_passkeys p where p.usuario_id = u.id)`,
      );
      const n = r.rows[0]?.n ?? 0;
      return n === 0 ? null : `${n} conta(s) ativa(s) sem segundo fator`;
    });

    await conferir("XFF forjado não muda o IP gravado", async () => {
      const marca = `xff-sonda-${Date.now()}@sonda.invalido`;
      await buscar("/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: base,
          "x-forwarded-for": "203.0.113.7",
        },
        body: JSON.stringify({ email: marca, password: VALOR_DA_SONDA }),
      });
      await new Promise((r) => setTimeout(r, 1500));
      const r = await pool.query(
        `select ip from auth_eventos
          where criado_em > now() - interval '1 minute' and ip = '203.0.113.7' limit 1`,
      );
      return r.rowCount === 0 ? null : "o x-forwarded-for forjado virou o IP da trilha";
    });
  } finally {
    await pool.end();
  }
}

// ── relatório ───────────────────────────────────────────────────────────────

const largura = Math.max(...resultados.map((r) => r.nome.length));
for (const r of resultados) {
  console.log(`${r.estado.padEnd(9)} ${r.nome.padEnd(largura)} ${r.detalhe}`);
}

const falhas = resultados.filter((r) => r.estado === "FALHOU");
const pendentes = resultados.filter((r) => r.estado === "PENDENTE");
console.log(
  `\n${resultados.length - falhas.length - pendentes.length} ok · ` +
    `${falhas.length} falha(s) · ${pendentes.length} pendente(s)`,
);
process.exit(falhas.length > 0 ? 1 : 0);
