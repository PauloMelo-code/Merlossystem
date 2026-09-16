/**
 * Parte PURA da política de senha (02-seguranca.md §6).
 *
 * Extraída de `politica-senha.ts` em F8 por um motivo mecânico: a tela de
 * senha é um Componente Cliente e precisa das MESMAS regras e das MESMAS
 * frases que o servidor cobra (04-ui.md §5.1). `politica-senha.ts` alcança o
 * banco e o HIBP por `import()`, e o empacotador do Next puxa esse grafo
 * inteiro para o pacote do navegador — onde `server-only` reprova o build.
 *
 * Aqui não entra nada com I/O. HIBP e histórico continuam em
 * `politica-senha.ts`, que reexporta tudo o que está abaixo para quem já
 * importava de lá.
 *
 * VOCABULÁRIO: nenhuma mensagem fala em "token", "link", "inválido" ou
 * "expirado" (E10) — senha fraca não pode ser confundida com link queimado.
 */

import { CONTEXTO_DA_CASA, ehSenhaComum } from "./senhas-comuns";

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
