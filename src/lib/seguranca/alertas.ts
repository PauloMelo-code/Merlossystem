import "server-only";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { buscarExterno } from "@/lib/rede/buscarExterno";
import { marcarUmaVez } from "./limite";

/**
 * Alerta interno da equipe, deduplicado (02-seguranca.md §17.5).
 *
 * Dedupe `SET NX EX 3600` no Redis — e aqui, e so aqui, que o Redis serve de
 * dedupe: o aviso a VITIMA de conta bloqueada e deduplicado no BANCO, porque
 * dedupe que some quando o Redis cai vira rajada de e-mail para quem esta
 * sendo atacado (§7.1).
 *
 * CONTEUDO: o Discord leva SO "Evento de seguranca: <tipo>. Veja em
 * /auditoria/seguranca" — sem nome, e-mail, IP ou alvo. Discord e canal de
 * terceiro, sem controle de retencao, e quem tiver a URL escreve nele; mandar
 * para la o mapa de quem e admin e quando o sistema esta sob ataque e entregar
 * o reconhecimento de graca. O conteudo vai no e-mail aos admins.
 */

/** Tipos que geram alerta (§17.5). Fora desta lista, nada dispara. */
export const TIPOS_ALERTAVEIS = [
  "conta_bloqueada",
  "email_seguranca_falhou",
  "sonda_caminho_desligado",
  "senha_aceita_aguardando_2fa",
  "webhook_recusado",
  "admin_promovido",
  "posse_transferida",
  "dono_semeado",
  "limitador_indisponivel",
  "hibp_indisponivel",
  "ip_cadeia_inesperada",
] as const;

export type TipoAlertavel = (typeof TIPOS_ALERTAVEIS)[number];

export const JANELA_DEDUPE_S = 3_600;

function ehAlertavel(tipo: string): tipo is TipoAlertavel {
  return (TIPOS_ALERTAVEIS as readonly string[]).includes(tipo);
}

async function avisarDiscord(tipo: TipoAlertavel): Promise<void> {
  const url = env.DISCORD_WEBHOOK_ALERTAS;
  if (!url) return;
  // Texto fixo. Nada da requisicao entra nele.
  const conteudo = `Evento de seguranca: ${tipo}. Veja em /auditoria/seguranca`;
  await buscarExterno(url, {
    provedor: "discord",
    metodo: "POST",
    corpo: JSON.stringify({ content: conteudo }),
    cabecalhos: { "content-type": "application/json" },
    maxBytes: 8 * 1024,
  });
}

/**
 * Nunca lanca e nunca e esperado por quem responde uma requisicao: alerta que
 * derruba a resposta e alerta que vira indisponibilidade.
 *
 * `chave` separa os baldes de dedupe (o id do usuario, o id da integracao).
 * Sem ela, o primeiro alerta de um tipo cala o tipo inteiro por uma hora.
 */
export function alertar(tipo: string, chave = "geral"): void {
  if (!ehAlertavel(tipo)) return;
  void (async () => {
    try {
      const primeiro = await marcarUmaVez(`alerta:${tipo}:${chave}`, JANELA_DEDUPE_S);
      if (!primeiro) return;
      logger.warn({ tipo, chave }, "alerta de seguranca");
      await avisarDiscord(tipo);
    } catch (erro) {
      logger.error({ tipo, erro: String(erro) }, "falha ao alertar");
    }
  })();
}
