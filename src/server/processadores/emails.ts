import { and, eq } from "drizzle-orm";
import type { Job } from "bullmq";
import { avisarNoSino, ehAvisoSemLink } from "@/lib/auth/avisos-no-sino";
import { emailDesligado, type AssuntoDeSeguranca, type DadosEmailSeguranca } from "@/lib/auth/emails";
import { registrarEventoAuth } from "@/lib/auth/trilha";
import { db } from "@/lib/db/client";
import { vivos } from "@/lib/db/consultas";
import { usuarios } from "@/lib/db/schema/auth/usuarios";
import { env } from "@/lib/env";
import { ErroDeIntegracao, naoImplementado } from "@/lib/erros";
import { logger } from "@/lib/logger";
import { NOME_COMPLETO } from "@/lib/marca";
import { alertar } from "@/lib/seguranca/alertas";

/**
 * Fila `emails`, job `email-seguranca` (03-arquitetura.md §8.1;
 * 02-seguranca.md §11.3 e §17).
 *
 * O MOTIVO DESTE PROCESSADOR EXISTIR é conferir o RETORNO do provedor. A
 * armadilha registrada é o provedor que responde `200 { success:false }` sem
 * lançar exceção: com `await enviar(...)` solto, o convite "sai" e ninguém
 * nunca recebe. Aqui, retorno negativo é FALHA do job — retentativa, DLQ,
 * `email_seguranca_falhou` na trilha e alerta.
 *
 * Nada de valor entra no `data` do job (02 §11.3): o link do convite e do reset
 * chega pronto, com o token no FRAGMENTO, e não é logado em nenhum nível.
 */

const ASSUNTOS: Record<AssuntoDeSeguranca, string> = {
  convite: "Seu acesso ao " + NOME_COMPLETO,
  reset: "Redefinição de senha",
  "senha-alterada": "Sua senha foi alterada",
  "fator-adicionado": "Um segundo fator foi adicionado à sua conta",
  "fator-removido": "Um segundo fator foi removido da sua conta",
  "passkey-adicionada": "Uma chave de acesso foi adicionada à sua conta",
  "passkey-removida": "Uma chave de acesso foi removida da sua conta",
  "email-trocado": "O e-mail da sua conta foi alterado",
  "email-troca-codigo": "Confirme o novo e-mail da sua conta",
  "email-troca-solicitada": "Pediram a troca do e-mail da sua conta",
  "conta-bloqueada": "Sua conta foi bloqueada temporariamente",
  "recuperacao-assistida": "Seu acesso foi recuperado por um administrador",
};

/** "Não foi você?" é a única saída que a pessoa tem; nunca sai do texto. */
const RODAPE =
  "Não foi você? Fale com o administrador da sua loja imediatamente e peça o bloqueio da conta.";

export type MensagemDeSeguranca = {
  para: string;
  assunto: string;
  texto: string;
};

export type RespostaDoProvedor = {
  enviado: boolean;
  /** Id do provedor, quando houver: é o que permite rastrear a entrega depois. */
  referencia?: string;
  motivo?: string;
};

function corpo(dados: DadosEmailSeguranca, nome: string): string {
  const quando = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  const linhas = [
    `Olá, ${nome}.`,
    "",
    ASSUNTOS[dados.assunto],
    `Quando: ${quando}`,
    dados.ip ? `Origem aproximada: ${dados.ip}` : null,
    dados.link ? "" : null,
    dados.link ? `Continue por aqui: ${dados.link}` : null,
    dados.link ? "O link vale por tempo limitado e só pode ser usado uma vez." : null,
    "",
    RODAPE,
  ];
  return linhas.filter((l) => l !== null).join("\n");
}

/**
 * TRANSPORTE — pendência §22.3 de 02-seguranca.md (dono: Paulo, prazo: antes do
 * primeiro convite real). O provedor transacional e o domínio com SPF/DKIM/DMARC
 * ainda não foram escolhidos, e escolher aqui seria decidir por fora do desenho.
 *
 * O que já está fechado e NÃO muda quando o provedor chegar: esta função
 * devolve `RespostaDoProvedor` e quem chama confere `enviado`. Ligar um provedor
 * é escrever um `case` e acrescentar o host à allowlist de
 * `src/lib/rede/buscarExterno.ts` — nenhuma outra linha deste arquivo muda.
 */
async function entregar(mensagem: MensagemDeSeguranca): Promise<RespostaDoProvedor> {
  const provedor = env.EMAIL_PROVEDOR;
  if (!provedor || !env.EMAIL_REMETENTE || !env.EMAIL_API_KEY) {
    // Dev e teste com provedor pela metade: `env.ts` só exige EMAIL_* em
    // produção. O destinatário não entra no log — "reset de senha para
    // fulano" já é informação sobre a conta.
    logger.warn({ assunto: mensagem.assunto }, "e-mail de segurança não enviado: sem provedor");
    return { enviado: false, motivo: "sem provedor configurado" };
  }
  throw naoImplementado(`transporte do provedor de e-mail "${provedor}"`);
}

export async function emailSeguranca(job: Job<DadosEmailSeguranca>): Promise<void> {
  const dados = job.data;
  if (emailDesligado()) {
    // ADR 0062. Job com link (enfileirado antes de desligar) é descartado sem
    // tocar no link: nem log, nem DLQ.
    if (dados.link === undefined && ehAvisoSemLink(dados.assunto)) {
      await avisarNoSino({ usuarioId: dados.usuarioId, assunto: dados.assunto, referencia: String(job.id) });
    } else {
      logger.warn({ assunto: dados.assunto }, "e-mail de segurança descartado: envio desligado");
    }
    return;
  }
  const [pessoa] = await db
    .select({ nome: usuarios.nome, email: usuarios.email })
    .from(usuarios)
    .where(and(eq(usuarios.id, dados.usuarioId), vivos(usuarios)))
    .limit(1);

  const para = dados.paraEmail ?? pessoa?.email;
  if (!para) {
    // Conta que sumiu entre o enfileiramento e o processamento. Não retenta: o
    // destinatário não vai voltar a existir.
    logger.error({ usuarioId: dados.usuarioId }, "e-mail de segurança sem destinatário");
    return;
  }

  const mensagem: MensagemDeSeguranca = {
    para,
    assunto: ASSUNTOS[dados.assunto],
    texto: corpo(dados, pessoa?.nome ?? "tudo bem"),
  };

  let resposta: RespostaDoProvedor;
  try {
    resposta = await entregar(mensagem);
  } catch (erro) {
    await registrarFalha(dados, String(erro));
    throw erro;
  }

  if (!resposta.enviado) {
    const motivo = resposta.motivo ?? "provedor recusou sem motivo";
    await registrarFalha(dados, motivo);
    // A exceção é o que faz a fila retentar e, esgotada, mandar para a DLQ.
    throw new ErroDeIntegracao(`Provedor de e-mail não entregou: ${motivo}`, false);
  }

  logger.info(
    { assunto: dados.assunto, usuarioId: dados.usuarioId, referencia: resposta.referencia },
    "e-mail de segurança entregue",
  );
}

/** Trilha + alerta. `motivo` nunca carrega o link nem o endereço do destinatário. */
async function registrarFalha(dados: DadosEmailSeguranca, motivo: string): Promise<void> {
  await registrarEventoAuth({
    tipo: "email_seguranca_falhou",
    atorTipo: "sistema",
    usuarioId: dados.usuarioId,
    resultado: "falha",
    motivo: motivo.slice(0, 200),
    detalhes: { acao: dados.assunto },
  });
  alertar("email_seguranca_falhou", dados.usuarioId);
}
