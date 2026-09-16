import "server-only";
import { Queue } from "bullmq";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Avisos de segurança ao dono da conta (02-seguranca.md §11.3, REQ-D12/D13).
 *
 * SEMPRE por fila, SEMPRE `void`: um `await` no SMTP dentro da resposta
 * transforma "esta conta existe" em milissegundos a mais (C7/E1). O worker
 * (`emails` / `email-seguranca`) é quem confere o retorno do provedor e grava
 * `email_seguranca_falhou` — `{success:false}` sem exceção é a armadilha
 * registrada.
 *
 * Remetente `seguranca@<dominio>`, separado do de campanhas, com SPF/DKIM/DMARC
 * (D16). Nada de valor entra no `data` do job: nem token, nem senha, nem hash.
 */

export type AssuntoDeSeguranca =
  | "convite"
  | "reset"
  | "senha-alterada"
  | "fator-adicionado"
  | "fator-removido"
  | "passkey-adicionada"
  | "passkey-removida"
  | "email-trocado"
  /** Para o endereço NOVO: o link leva o código no fragmento (`/perfil#codigo=`). */
  | "email-troca-codigo"
  /** Para o endereço ATUAL: alguém pediu a troca; "não foi você?" contesta. */
  | "email-troca-solicitada"
  | "conta-bloqueada"
  | "recuperacao-assistida";

export type DadosEmailSeguranca = {
  assunto: AssuntoDeSeguranca;
  usuarioId: string;
  /** Convite, reset e código de troca de e-mail: o segredo vai no FRAGMENTO. */
  link?: string;
  /** Endereço explícito quando o destino não é o e-mail atual (troca de e-mail). */
  paraEmail?: string;
  ip?: string | null;
};

// ponytail: a fila `emails` nasce aqui porque F5 precisa dela antes de F9
// existir. F9 move a construção para `src/lib/fila/filas.ts` e este arquivo
// passa a importar de lá — a assinatura de `enfileirarEmailSeguranca` não muda.
const global_ = globalThis as unknown as { _filaEmails?: Queue<DadosEmailSeguranca> };

function fila(): Queue<DadosEmailSeguranca> {
  const existente = global_._filaEmails;
  if (existente) return existente;
  const nova = new Queue<DadosEmailSeguranca>("emails", {
    connection: { url: env.REDIS_URL },
    defaultJobOptions: {
      attempts: env.FILA_TENTATIVAS,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: false,
    },
  });
  global_._filaEmails = nova;
  return nova;
}

/**
 * Nunca lança e nunca é esperado por quem responde uma requisição. Redis fora
 * do ar vira log, não erro na tela de quem está trocando a própria senha.
 */
export function enfileirarEmailSeguranca(
  assunto: AssuntoDeSeguranca,
  usuarioId: string,
  link?: string,
  extras: { paraEmail?: string; ip?: string | null } = {},
): void {
  const dados: DadosEmailSeguranca = {
    assunto,
    usuarioId,
    ...(link === undefined ? {} : { link }),
    ...(extras.paraEmail === undefined ? {} : { paraEmail: extras.paraEmail }),
    ...(extras.ip === undefined ? {} : { ip: extras.ip }),
  };
  void fila()
    .add("email-seguranca", dados)
    .catch((erro: unknown) => {
      logger.error({ assunto, usuarioId, erro: String(erro) }, "falha ao enfileirar e-mail");
    });
}
