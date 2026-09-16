import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { EscopoLoja } from "@/lib/auth/loja";
import { condicaoDeLoja, vivos } from "../consultas";
import { ESTADOS_DE_SISTEMA } from "../listas-fechadas";
import type { StatusTranscricao } from "../schema/_enums/conversas";
import type { FuncaoIa, ModeloIa, ProvedorIa, ResultadoIa } from "../schema/_enums/inteligencia";
import { conversas_mensagens_midias } from "../schema/conversas/mensagens-midias";
import { lojas_ia_usos } from "../schema/lojas-ia-usos";
import { exigirPares, type Transacao } from "./base";

/**
 * Máquina de estado da transcrição (R2, ADR 0049). Atômica: o estado de ORIGEM
 * está no `where`, então duas execuções nunca andam juntas — zero linhas = outro
 * processo já andou, e nada acontece. Era o defeito do antigo: duas chamadas
 * pegavam o mesmo áudio e `processing` ficava órfão para sempre.
 */
export async function transicionarTranscricao(
  tx: Transacao,
  alvo: { id: string; escopo: EscopoLoja },
  de: readonly (StatusTranscricao | null)[],
  para: StatusTranscricao,
  transcricao?: string | null,
): Promise<boolean> {
  exigirPares(
    ESTADOS_DE_SISTEMA,
    "conversas_mensagens_midias",
    transcricao === undefined ? ["transcricao_status"] : ["transcricao_status", "transcricao"],
  );
  const t = conversas_mensagens_midias;
  const estados = de.filter((s): s is StatusTranscricao => s !== null);
  const origem = [
    ...(de.includes(null) ? [isNull(t.transcricao_status)] : []),
    ...(estados.length > 0 ? [inArray(t.transcricao_status, estados)] : []),
  ];
  if (origem.length === 0) return false;
  const linhas = await tx
    .update(t)
    .set({ transcricao_status: para, ...(transcricao === undefined ? {} : { transcricao }) })
    .where(
      and(
        eq(t.id, alvo.id),
        eq(t.tipo_arquivo, "audio"),
        condicaoDeLoja(t as never, alvo.escopo),
        vivos(t),
        or(...origem),
      ),
    )
    .returning({ id: t.id });
  return linhas.length > 0;
}

export type UsoDeIa = {
  lojaId: string;
  usuarioId: string | null;
  funcao: FuncaoIa;
  provedor: ProvedorIa;
  modelo: ModeloIa;
  conversaId?: string | null;
  mensagemMidiaId?: string | null;
  tokensEntrada?: number;
  tokensSaida?: number;
  audioSegundos?: number;
  custoUsdMicros?: number;
  resultado: ResultadoIa;
  erroCodigo?: string | null;
};

/** Registro de uso append-only (ADR 0048): só INSERT. UPDATE e DELETE o banco recusa. */
export async function registrarUsoDeIa(tx: Transacao, u: UsoDeIa): Promise<void> {
  await tx.insert(lojas_ia_usos).values({
    loja_id: u.lojaId,
    usuario_id: u.usuarioId,
    funcao: u.funcao,
    provedor: u.provedor,
    modelo: u.modelo,
    conversa_id: u.conversaId ?? null,
    mensagem_midia_id: u.mensagemMidiaId ?? null,
    tokens_entrada: u.tokensEntrada ?? 0,
    tokens_saida: u.tokensSaida ?? 0,
    audio_segundos: u.audioSegundos ?? 0,
    custo_usd_micros: u.custoUsdMicros ?? 0,
    resultado: u.resultado,
    erro_codigo: u.erroCodigo ?? null,
  });
}
