import "server-only";
import type { Contexto, EscopoLoja } from "@/lib/auth/guard";

/**
 * Contexto de quem grava SEM pessoa: webhook e worker (03-arquitetura.md §6.4).
 *
 * PENDÊNCIA DA FUNDAÇÃO (bloqueio registrado pelo pacote M5, o mesmo que M1
 * encontrou): a arquitetura manda gravar com `ctx.autorId = ATOR_SISTEMA`
 * (uuid fixo com linha própria em `usuarios`), mas nem a constante nem a linha
 * existem. Até existirem, o autor de sistema é NULO: `modified_by` aceita nulo
 * e `auditoria_eventos.ator_id` também, porque `ator_tipo = 'sistema'`
 * (CHECK `auditoria_eventos_ator_coerente`). Um uuid inventado violaria a FK de
 * `modified_by` na primeira gravação.
 *
 * A sessão sintética nunca passa por `pode()` nem vira cookie.
 */
export function contextoDoSistema(
  origem: "webhook" | "worker",
  escopo: EscopoLoja = { tipo: "todas" },
): Contexto {
  const autorNulo = null as unknown as string;
  return {
    sessao: {
      usuarioId: autorNulo,
      sessaoId: autorNulo,
      papel: "viewer",
      lojaId: escopo.tipo === "uma" ? escopo.lojaId : null,
      ativo: true,
      precisaTrocarSenha: false,
      precisaConfigurarFator: false,
    },
    escopo,
    autorId: autorNulo,
    origem,
  };
}
