import type { Transacao } from "@/lib/db/mutacoes";
import type { Severidade, TipoAlerta } from "@/lib/db/schema/_enums/plataforma";
import { candidatosDeAlertaDeNegocio } from "@/lib/negocios/alertas";
import { candidatosDeAlertaDePagamento } from "@/lib/pagamentos/costuras";

/**
 * Única porta pela qual os pacotes do R2 entram no gerador de alertas (M8).
 * Dono: FUNDAÇÃO. As fontes NÃO importam `@/lib/alertas`: só devolvem esta
 * mesma forma. O SLA do R2-E não é fonte (muda a própria regra `sla_estourado`).
 */
export type CandidatoDeAlerta = {
  tipo: TipoAlerta;
  severidade: Severidade;
  mensagem: string;
  chaveDeduplicacao: string;
  pedidoId: string | null;
  contatoId: string | null;
  conversaId: string | null;
  negocioId: string | null;
};

/**
 * O gerador abre o candidato novo e RESOLVE o alerta aberto cujo `tipo` está
 * em `tipos` E cuja chave começa com `prefixo`, quando a chave não voltou
 * nesta rodada. As duas condições juntas impedem uma fonte de resolver alerta
 * de outra regra do mesmo tipo.
 */
export type FonteDeAlerta = {
  tipos: readonly TipoAlerta[];
  prefixo: string;
  candidatos: (tx: Transacao, lojaId: string, agora: Date) => Promise<CandidatoDeAlerta[]>;
};

export const FONTES_R2: readonly FonteDeAlerta[] = [
  { tipos: ["negocio_parado"], prefixo: "negocio-parado-", candidatos: candidatosDeAlertaDeNegocio },
  {
    tipos: ["pagamento_pendente", "pagamento_conferir"],
    prefixo: "pagamento-",
    candidatos: candidatosDeAlertaDePagamento,
  },
];
