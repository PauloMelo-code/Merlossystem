import "server-only";

/**
 * Leitura de corpo com teto (02-seguranca.md §5.1 item 2, §12; B8/I11).
 *
 * Route Handler não tem `bodySizeLimit`: quem lê corpo de máquina corta pelo
 * `content-length` ANTES de ler e reconfere o tamanho real depois — um
 * `content-length` mentiroso é gratuito.
 */

export class ErroCorpoGrande extends Error {
  readonly status = 413;
  constructor(readonly maxBytes: number) {
    super("Corpo acima do limite.");
    this.name = "ErroCorpoGrande";
  }
}

export const TETO_AUTH = 16 * 1024;
export const TETO_WEBHOOK = 256 * 1024;

/** Devolve o corpo CRU (é ele que a assinatura HMAC precisa), nunca o parseado. */
export async function lerCorpoComTeto(req: Request, maxBytes: number): Promise<string> {
  const declarado = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declarado) && declarado > maxBytes) throw new ErroCorpoGrande(maxBytes);

  const corpo = req.body;
  if (!corpo) return "";

  const leitor = corpo.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await leitor.cancel();
      throw new ErroCorpoGrande(maxBytes);
    }
    pedacos.push(value);
  }
  return Buffer.concat(pedacos).toString("utf8");
}
