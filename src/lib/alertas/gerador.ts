import "server-only";
import { db } from "@/lib/db/client";
import { atualizarContador } from "@/lib/db/mutacoes";
import { conversas } from "@/lib/db/schema/conversas/conversas";
import { logger } from "@/lib/logger";
import {
  alertasAbertos,
  atrasosVigentes,
  candidatosDe,
  conversasComSlaMarcado,
  type Candidato,
} from "./_consultas";
import { abrir, resolver } from "./escrita";
import {
  ALVO_POR_TIPO,
  chaveDeDeduplicacao,
  lerChave,
  mensagemDoAlerta,
  SEVERIDADE_POR_TIPO,
  TIPOS_GERADOS_R1,
  type TipoGerado,
} from "./regras";

/**
 * O GERADOR (job `gerar-alertas`, fila `manutencao`, a cada 5 min).
 *
 * Quem resolve alerta é ELE, nunca a pessoa (01-dados.md §6.6). A cada
 * rodada, para cada tipo:
 *
 *   1. busca quem satisfaz a condição AGORA (`candidatosDe`);
 *   2. alerta aberto cuja chave não está mais entre os candidatos -> resolve;
 *   3. candidato sem alerta aberto -> abre (a dedupe do banco segura corrida).
 *
 * Reconhecer não entra na conta: um alerta reconhecido cuja condição continua
 * valendo segue aberto e NÃO duplica; quando a condição some, ele é resolvido;
 * se ela voltar depois, nasce um alerta novo. Era o defeito 04/F05.
 *
 * Cada gravação tem a própria transação: um alerta que falha não desfaz os
 * outros. Falha é contada e relançada no fim, para a fila retentar.
 */

export type ResumoDaGeracao = {
  abertos: number;
  resolvidos: number;
  slaMarcados: number;
  slaDesmarcados: number;
};

type Opcoes = {
  lojaId?: string | null;
  agora?: Date;
};

function porChave(tipo: TipoGerado, candidatos: Candidato[]): Map<string, Candidato> {
  return new Map(
    candidatos.map((c) => [chaveDeDeduplicacao(tipo, { tipo: ALVO_POR_TIPO[tipo], id: c.alvoId }), c]),
  );
}

/**
 * `sla_estourado_em` é o carimbo que a lista de conversas mostra ("Atrasada
 * 12 min"). É contador (01-dados.md §4.7): `atualizarContador`, sem trilha e
 * sem tocar `updated_at`. Não depende da gravação de alertas.
 */
async function sincronizarCarimboDeSla(
  candidatos: Candidato[],
  mantidos: ReadonlySet<string>,
  lojaId: string | null,
  agora: Date,
): Promise<{ marcados: number; desmarcados: number }> {
  const marcadas = await conversasComSlaMarcado(lojaId);
  const jaMarcadas = new Set(marcadas.map((m) => m.id));
  const atrasadas = new Set(candidatos.map((c) => c.alvoId));
  let marcados = 0;
  let desmarcados = 0;

  for (const c of candidatos) {
    if (jaMarcadas.has(c.alvoId)) continue;
    await db.transaction((tx) =>
      atualizarContador(tx, conversas, { id: c.alvoId, escopo: { tipo: "uma", lojaId: c.lojaId } }, {
        sla_estourado_em: agora,
      }),
    );
    marcados += 1;
  }
  for (const m of marcadas) {
    if (atrasadas.has(m.id) || mantidos.has(m.id)) continue;
    await db.transaction((tx) =>
      atualizarContador(tx, conversas, { id: m.id, escopo: { tipo: "uma", lojaId: m.lojaId } }, {
        sla_estourado_em: null,
      }),
    );
    desmarcados += 1;
  }
  return { marcados, desmarcados };
}

export async function gerarAlertas(opcoes: Opcoes = {}): Promise<ResumoDaGeracao> {
  const lojaId = opcoes.lojaId ?? null;
  const agora = opcoes.agora ?? new Date();
  const resumo: ResumoDaGeracao = { abertos: 0, resolvidos: 0, slaMarcados: 0, slaDesmarcados: 0 };
  let falhas = 0;

  // Afrouxar o prazo não desfaz atraso que já aconteceu (ADR 0060).
  const mantidos = await atrasosVigentes(lojaId);
  const vigentes = new Map<TipoGerado, Map<string, Candidato>>();
  for (const tipo of TIPOS_GERADOS_R1) {
    const candidatos = await candidatosDe(tipo, lojaId);
    vigentes.set(tipo, porChave(tipo, candidatos));
    if (tipo === "sla_estourado") {
      const carimbo = await sincronizarCarimboDeSla(candidatos, mantidos, lojaId, agora);
      resumo.slaMarcados = carimbo.marcados;
      resumo.slaDesmarcados = carimbo.desmarcados;
    }
  }

  const gravar = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (erro) {
      falhas += 1;
      logger.error({ erro: erro instanceof Error ? erro.message : String(erro) }, "alerta não gravado");
    }
  };

  const abertos = await alertasAbertos(TIPOS_GERADOS_R1, lojaId);
  const chavesAbertas = new Set(abertos.map((a) => `${a.lojaId}|${a.chave}`));

  for (const alerta of abertos) {
    const lida = lerChave(alerta.chave);
    if (!lida) continue; // chave que não é deste gerador: não é ele quem resolve
    if (vigentes.get(lida.tipo)?.has(alerta.chave)) continue;
    // Afrouxar o prazo não resolve atraso que já aconteceu (ADR 0060).
    if (lida.tipo === "sla_estourado" && lida.alvo.tipo === "conversa" && mantidos.has(lida.alvo.id)) continue;
    await gravar(async () => {
      await db.transaction((tx) => resolver(tx, { id: alerta.id, lojaId: alerta.lojaId }, agora));
      resumo.resolvidos += 1;
    });
  }

  for (const [tipo, mapa] of vigentes) {
    for (const [chave, c] of mapa) {
      if (chavesAbertas.has(`${c.lojaId}|${chave}`)) continue;
      await gravar(async () => {
        const nasceu = await db.transaction((tx) =>
          abrir(tx, {
            lojaId: c.lojaId,
            tipo,
            severidade: SEVERIDADE_POR_TIPO[tipo],
            mensagem: mensagemDoAlerta(tipo, {
              ...(c.minutos === null ? {} : { minutos: c.minutos }),
              ...(c.rotulo === null ? {} : { rotulo: c.rotulo }),
            }),
            chave,
            conversaId: c.conversaId,
            contatoId: c.contatoId,
          }),
        );
        if (nasceu) resumo.abertos += 1;
      });
    }
  }

  logger.info({ ...resumo, falhas, lojaId }, "gerar-alertas concluído");
  if (falhas > 0) throw new Error(`gerar-alertas: ${falhas} gravação(ões) falharam`);
  return resumo;
}
