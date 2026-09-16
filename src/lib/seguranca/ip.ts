import "server-only";
import { isIP } from "node:net";

/**
 * IP canônico do cliente — UMA implementação (02-seguranca.md §7.3, REQ-C6).
 *
 * `grep -rn "x-forwarded-for" src` só pode achar ESTE arquivo (trava T21).
 *
 * A função `getIP()` que o `@better-auth/core` exporta faz o mesmo
 * caminhamento, mas não tem o teto de UM salto nem o evento
 * `ip_cadeia_inesperada`, e recebe o `BetterAuthOptions` inteiro — o que criaria
 * o ciclo `ip.ts -> auth.ts -> ip.ts`, já que `auth.ts` importa
 * `PROXIES_CONFIAVEIS` daqui. Decisão registrada em
 * docs/seguranca/conferencia-ba-1.7.5.md §2.
 */

/**
 * Constante VERSIONADA, nunca variável de ambiente (§7.3, INV rejeitado R-09).
 *
 * Por ambiente, um valor errado em produção (`0.0.0.0/0`) faria o
 * `x-forwarded-for` voltar a ser forjável, e a trava — que lê o fonte — não
 * teria como pegar. Mudar esta lista é PR + ADR.
 */
export const PROXIES_CONFIAVEIS = [
  "127.0.0.0/8",
  "::1/128",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "fc00::/7",
] as const;

/**
 * Topologia real: cliente -> Traefik do EasyPanel -> app (S-10). Precisar
 * descartar mais de um salto significa cadeia inesperada.
 */
export const MAX_SALTOS_CONFIAVEIS = 1;

/** Agrupamento do limitador para IPv6 (CVE-2026-45364). A trilha grava inteiro. */
export const PREFIXO_IPV6 = 64;

export type ResolucaoDeIp = {
  /** O IP a gravar na trilha, completo. `null` quando nem o socket veio. */
  ip: string | null;
  /** `true` quando a cadeia não bateu com a topologia e caiu para o socket. */
  cadeiaInesperada: boolean;
};

function paraBytes(endereco: string): Uint8Array | null {
  const versao = isIP(endereco);
  if (versao === 4) {
    const partes = endereco.split(".").map(Number);
    if (partes.length !== 4 || partes.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return null;
    }
    return Uint8Array.from(partes);
  }
  if (versao !== 6) return null;

  const [esquerda = "", direita = ""] = endereco.split("::", 2);
  const expandir = (lado: string) => (lado === "" ? [] : lado.split(":"));
  const cabeca = expandir(esquerda);
  const cauda = expandir(direita);
  const grupos = endereco.includes("::")
    ? [...cabeca, ...Array<string>(8 - cabeca.length - cauda.length).fill("0"), ...cauda]
    : cabeca;
  if (grupos.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    const valor = Number.parseInt(grupos[i] ?? "0", 16);
    if (!Number.isInteger(valor) || valor < 0 || valor > 0xffff) return null;
    bytes[i * 2] = valor >> 8;
    bytes[i * 2 + 1] = valor & 0xff;
  }
  return bytes;
}

/** Compara os `bits` mais significativos de dois endereços já em bytes. */
function mesmoPrefixo(a: Uint8Array, b: Uint8Array, bits: number): boolean {
  if (a.length !== b.length) return false;
  const inteiros = Math.floor(bits / 8);
  for (let i = 0; i < inteiros; i += 1) if (a[i] !== b[i]) return false;
  const resto = bits % 8;
  if (resto === 0) return true;
  const mascara = 0xff << (8 - resto);
  return ((a[inteiros] ?? 0) & mascara) === ((b[inteiros] ?? 0) & mascara);
}

/** IPv4 mapeado em IPv6 (`::ffff:10.0.0.1`) é comparado como IPv4. */
function normalizar(endereco: string): string {
  const limpo = endereco.trim().replace(/^\[|\]$/g, "");
  const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(limpo);
  return mapeado?.[1] ?? limpo;
}

export function ehProxyConfiavel(endereco: string): boolean {
  const bytes = paraBytes(normalizar(endereco));
  if (!bytes) return false;
  return PROXIES_CONFIAVEIS.some((faixa) => {
    const [rede = "", bits = ""] = faixa.split("/");
    const redeBytes = paraBytes(rede);
    if (!redeBytes) return false;
    return mesmoPrefixo(bytes, redeBytes, Number(bits));
  });
}

/**
 * Percorre o `x-forwarded-for` da DIREITA para a ESQUERDA, descarta enquanto o
 * valor estiver na lista confiável e para no primeiro que não estiver.
 *
 * - mais de `MAX_SALTOS_CONFIAVEIS` descartes => cadeia inesperada: usa o socket
 *   e quem chamou grava `ip_cadeia_inesperada`;
 * - cabeçalho ausente, vazio ou cadeia inteira confiável => socket.
 */
export function resolverIp(cabecalhos: Headers, enderecoSocket?: string | null): ResolucaoDeIp {
  const socket = enderecoSocket ? normalizar(enderecoSocket) : null;
  const bruto = cabecalhos.get("x-forwarded-for");
  if (!bruto) return { ip: socket, cadeiaInesperada: false };

  const cadeia = bruto
    .split(",")
    .map(normalizar)
    .filter((v) => isIP(v) !== 0);

  let descartados = 0;
  for (let i = cadeia.length - 1; i >= 0; i -= 1) {
    const atual = cadeia[i] as string;
    if (!ehProxyConfiavel(atual)) {
      if (descartados > MAX_SALTOS_CONFIAVEIS) {
        return { ip: socket, cadeiaInesperada: true };
      }
      return { ip: atual, cadeiaInesperada: false };
    }
    descartados += 1;
  }
  return { ip: socket, cadeiaInesperada: descartados > MAX_SALTOS_CONFIAVEIS };
}

/** Atalho para quem só quer o endereço (o caso comum). */
export function ipDoCliente(cabecalhos: Headers, enderecoSocket?: string | null): string | null {
  return resolverIp(cabecalhos, enderecoSocket).ip;
}

/**
 * Chave do limitador: IPv6 colapsado em /64, IPv4 inteiro. Sem isto, quem tem
 * um /64 residencial tem 18 quintilhões de baldes (CVE-2026-45364).
 */
export function chaveDeIp(ip: string | null): string {
  if (!ip) return "sem-ip";
  const normalizado = normalizar(ip);
  if (isIP(normalizado) !== 6) return normalizado;
  const bytes = paraBytes(normalizado);
  if (!bytes) return normalizado;
  const prefixo = Array.from(bytes.slice(0, PREFIXO_IPV6 / 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${prefixo}::/${PREFIXO_IPV6}`;
}

/** Boot: nenhuma faixa confiável pode ser pública (§7.3). */
export function conferirProxiesConfiaveis(): void {
  for (const faixa of PROXIES_CONFIAVEIS) {
    const [rede = "", bits = ""] = faixa.split("/");
    if (Number(bits) === 0) {
      throw new Error(`PROXIES_CONFIAVEIS: faixa aberta demais (${faixa}).`);
    }
    if (!ehProxyConfiavel(rede)) {
      throw new Error(`PROXIES_CONFIAVEIS: ${faixa} não é endereço privado ou de loopback.`);
    }
  }
}
