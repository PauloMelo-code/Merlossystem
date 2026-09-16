import { lerPaginaDoDossie } from "@/lib/actions/lgpd";

/**
 * Monta o dossiê no navegador, SEÇÃO POR SEÇÃO e página por página — o
 * servidor nunca devolve "todas as mensagens" numa resposta (01-dados-dominio.md
 * §7.3). Qualquer página recusada interrompe tudo: dossiê pela metade não é
 * entregue como se fosse completo.
 */

export type Progresso = { secao: string; linhas: number };

export async function montarDossie(
  solicitacaoId: string,
  lojaId: string,
  secoes: readonly string[],
  aoProgredir: (p: Progresso) => void,
): Promise<{ ok: true; dados: Record<string, unknown[]> } | { ok: false; mensagem: string }> {
  const dados: Record<string, unknown[]> = {};
  for (const secao of secoes) {
    const linhas: unknown[] = [];
    let cursor: string | undefined;
    do {
      const r = await lerPaginaDoDossie({
        solicitacaoId,
        loja: lojaId,
        secao,
        ...(cursor ? { cursor } : {}),
      });
      if (!r.ok) return { ok: false, mensagem: r.mensagem };
      linhas.push(...r.dados.linhas);
      cursor = r.dados.proximoCursor ?? undefined;
      aoProgredir({ secao, linhas: linhas.length });
    } while (cursor);
    dados[secao] = linhas;
  }
  return { ok: true, dados };
}
