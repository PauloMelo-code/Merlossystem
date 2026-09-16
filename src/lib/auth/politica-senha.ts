import { ErroDeValidacao } from "@/lib/erros";
import { CONTEXTO_DA_CASA, ehSenhaComum } from "./senhas-comuns";

/**
 * Política de senha (02-seguranca.md §6).
 *
 * A parte determinística é PURA e este arquivo NÃO tem `import "server-only"`:
 * é o mesmo módulo que o servidor e o componente da tela importam, para a lista
 * de motivos ser idêntica dos dois lados (B6). Os dois pedaços que precisam de
 * rede ou banco (HIBP e histórico) entram por `import()` dentro da função
 * assíncrona — o cliente nunca chama `politicaDeSenha`, então o módulo do banco
 * nunca é avaliado no navegador.
 *
 * ONDE RODA: só onde a senha é GRAVADA — convite, `/reset-password`,
 * `/change-password` e a troca pela action. NUNCA em `password.hash`/`verify`,
 * que rodam no login e virariam oráculo (B9/G22/G23).
 *
 * VOCABULÁRIO: nenhuma mensagem fala em "token", "link", "inválido" ou
 * "expirado" (E10) — senha fraca não pode ser confundida com link queimado.
 */

export const MIN_SENHA = 15;
export const MAX_SENHA = 128;
/** Teto bruto, conferido ANTES de qualquer avaliação ou hash (B8). */
export const MAX_BYTES_SENHA = 1024;

export const CAMINHOS_QUE_GRAVAM_SENHA = [
  "/reset-password",
  "/change-password",
] as const;

export type ContextoDeSenha = {
  nome?: string | null;
  email?: string | null;
  loja?: string | null;
};

/** Sequência de alfabeto, de teclado ou de dígitos, em qualquer direção. */
const SEQUENCIAS = [
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
];

function temSequencia(senha: string, tamanho = 5): boolean {
  const baixa = senha.toLowerCase();
  for (const linha of SEQUENCIAS) {
    const invertida = [...linha].reverse().join("");
    for (const fonte of [linha, invertida]) {
      for (let i = 0; i + tamanho <= fonte.length; i += 1) {
        if (baixa.includes(fonte.slice(i, i + tamanho))) return true;
      }
    }
  }
  return false;
}

/** `aaaaaaa` ou `abababab`: repetição de um bloco curto cobrindo tudo. */
function ehRepeticao(senha: string): boolean {
  const baixa = senha.toLowerCase();
  for (let tamanho = 1; tamanho <= 3; tamanho += 1) {
    const bloco = baixa.slice(0, tamanho);
    if (bloco.repeat(Math.ceil(baixa.length / tamanho)).slice(0, baixa.length) === baixa) {
      return true;
    }
  }
  return false;
}

function pedacosDoContexto(contexto: ContextoDeSenha): string[] {
  const cru = [
    contexto.nome ?? "",
    (contexto.email ?? "").split("@")[0] ?? "",
    contexto.loja ?? "",
  ].join(" ");
  return cru
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 4);
}

/**
 * A parte determinística, pura. Devolve a lista de motivos — vazia quer dizer
 * "passou nesta camada". É esta função que a tela usa ao vivo.
 */
export function motivosDeSenha(senha: string, contexto: ContextoDeSenha = {}): string[] {
  const motivos: string[] = [];

  if (Buffer.byteLength(senha, "utf8") > MAX_BYTES_SENHA) {
    return ["A senha é longa demais."];
  }
  if (senha.length < MIN_SENHA) {
    motivos.push(`Use ao menos ${MIN_SENHA} caracteres — uma frase curta serve.`);
  }
  if (senha.length > MAX_SENHA) {
    motivos.push(`Use no máximo ${MAX_SENHA} caracteres.`);
  }
  if (ehSenhaComum(senha)) {
    motivos.push("Esta senha é conhecida e está em listas públicas. Escolha outra.");
  }
  if (temSequencia(senha)) {
    motivos.push("Evite sequências de teclado, alfabeto ou números.");
  }
  if (ehRepeticao(senha)) {
    motivos.push("Evite repetir o mesmo trecho do começo ao fim.");
  }

  const baixa = senha
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const contextuais = [...pedacosDoContexto(contexto), ...CONTEXTO_DA_CASA];
  if (contextuais.some((p) => p.length >= 4 && baixa.includes(p))) {
    motivos.push("Não use seu nome, seu e-mail, o nome da loja nem o da marca.");
  }

  return motivos;
}

/**
 * HIBP por k-anonimato: manda só os 5 primeiros do SHA-1 e compara o sufixo.
 * `Add-Padding: true` para o tamanho da resposta não contar quantos vazamentos
 * o prefixo tem. Teto de 1,5 s e **fail-open** com evento — o plugin do BA é
 * fail-closed e pendurado no hash: HIBP fora do ar travaria toda troca de senha
 * (G23).
 */
async function vazouNoHibp(senha: string): Promise<boolean> {
  const { createHash } = await import("node:crypto");
  const sha1 = createHash("sha1").update(senha, "utf8").digest("hex").toUpperCase();
  const prefixo = sha1.slice(0, 5);
  const sufixo = sha1.slice(5);

  const abortar = new AbortController();
  const expirar = setTimeout(() => abortar.abort(), 1_500);
  try {
    const resposta = await fetch(`https://api.pwnedpasswords.com/range/${prefixo}`, {
      headers: { "Add-Padding": "true" },
      signal: abortar.signal,
      cache: "no-store",
    });
    if (!resposta.ok) throw new Error(`HIBP ${resposta.status}`);
    const corpo = await resposta.text();
    return corpo
      .split("\n")
      .some((linha) => linha.slice(0, 35).trim().toUpperCase() === sufixo);
  } catch (erro) {
    const { registrarEventoAuth } = await import("./trilha");
    void registrarEventoAuth({
      tipo: "hibp_indisponivel",
      resultado: "falha",
      atorTipo: "sistema",
      detalhes: { acao: String(erro) },
    });
    return false;
  } finally {
    clearTimeout(expirar);
  }
}

/**
 * Histórico: as 5 mais recentes de `usuarios_senhas_historico`, hash Argon2id,
 * leitura **fail-closed** — se a consulta falha, a troca não acontece. A tabela
 * é append-only e nunca podada (podar exigiria `DELETE`).
 */
async function repetiuSenha(usuarioId: string, senha: string): Promise<boolean> {
  const [{ db }, { sql }, { kdf }] = await Promise.all([
    import("@/lib/db/client"),
    import("drizzle-orm"),
    import("./kdf"),
  ]);
  const linhas = await db.execute<{ senha_hash: string }>(sql`
    select senha_hash from usuarios_senhas_historico
    where usuario_id = ${usuarioId}
    order by criado_em desc
    limit 5
  `);
  for (const linha of linhas.rows) {
    if (await kdf.verify(linha.senha_hash, senha)) return true;
  }
  return false;
}

export type OpcoesDaPolitica = {
  usuarioId?: string | undefined;
  contexto?: ContextoDeSenha;
  /** Interruptor `AUTH_HIBP_HABILITADO` já resolvido por quem chama. */
  conferirHibp?: boolean;
};

/**
 * Política completa. Lança `ErroDeValidacao` com TODOS os motivos de uma vez —
 * devolver um motivo por vez faz a pessoa tentar cinco senhas ruins seguidas.
 */
export async function politicaDeSenha(
  senha: unknown,
  opcoes: OpcoesDaPolitica = {},
): Promise<void> {
  if (typeof senha !== "string") {
    throw new ErroDeValidacao({ senha: ["Informe a nova senha."] });
  }

  const motivos = motivosDeSenha(senha, opcoes.contexto ?? {});

  if (motivos.length === 0 && opcoes.conferirHibp !== false && (await vazouNoHibp(senha))) {
    motivos.push("Esta senha já apareceu em vazamento público. Escolha outra.");
  }

  if (motivos.length === 0 && opcoes.usuarioId && (await repetiuSenha(opcoes.usuarioId, senha))) {
    motivos.push("Você já usou esta senha. Escolha uma que ainda não usou.");
  }

  if (motivos.length > 0) throw new ErroDeValidacao({ senha: motivos });
}
