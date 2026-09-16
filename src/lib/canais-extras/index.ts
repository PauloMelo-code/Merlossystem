import "server-only";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: R2-D (canais extras). API pública consumida por M1 (envio e
 * ingestão do TikTok) e por M5 (job diário `renovar-token`).
 *
 * Sem o pacote não existe como conectar conta `facebook` ou `tiktok`, então
 * as duas primeiras são inalcançáveis antes dele.
 */

export async function garantirTokenTiktok(lojaId: string, integracaoId: string): Promise<void> {
  throw naoImplementado(`garantirTokenTiktok [loja ${lojaId}, conta ${integracaoId}] (pacote R2-D)`);
}

export async function destinoTiktok(lojaId: string, conversaId: string): Promise<string | null> {
  throw naoImplementado(`destinoTiktok [loja ${lojaId}, conversa ${conversaId}] (pacote R2-D)`);
}

/** Nada a conferir antes do pacote: no-op de propósito, para o job diário não falhar. */
export async function conferirContasCanaisExtras(): Promise<void> {
  return;
}
