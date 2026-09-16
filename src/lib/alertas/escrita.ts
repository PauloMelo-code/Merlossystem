import type { Contexto, EscopoLoja } from "@/lib/auth/guard";
import type { Transacao } from "@/lib/db/mutacoes";
import type { Severidade } from "@/lib/db/schema/_enums/plataforma";
import { naoImplementado } from "@/lib/erros";
import type { TipoGerado } from "./regras";

/**
 * As TRÊS gravações do módulo de alertas, como porta.
 *
 * POR QUE PORTA, E NÃO CHAMADA DIRETA: `src/lib/db/mutacoes.ts` é o único
 * arquivo com INSERT/UPDATE sobre tabela de domínio (03-arquitetura.md §6.4), e
 * hoje ele NÃO oferece nenhuma das três operações que `alertas` precisa:
 *
 *   1. abrir com dedupe — `INSERT ... ON CONFLICT (loja_id, chave_deduplicacao)
 *      WHERE resolvido_em IS NULL AND is_deleted = false DO NOTHING`, sem trilha
 *      (é estado de sistema, o ator é o gerador);
 *   2. resolver — `alertas.resolvido_em` não está em `ESTADOS_DE_SISTEMA`
 *      (`src/lib/db/listas-fechadas.ts`), então `atualizarEstado()` recusa;
 *   3. reconhecer — `atualizarComTrava()` exige uma `AcaoAuditada`, e
 *      `ACOES_AUDITADAS` não tem `alerta_reconhecido` (ampliar é migração do
 *      CHECK, 01-dados.md §7.4).
 *
 * Os três pedidos estão registrados para a fundação (bloqueio do pacote M8).
 * Até lá, a implementação real é `escritaPendente`, que FALHA ALTO — nunca
 * finge que gravou — e `ESCRITA_DISPONIVEL` é `false`, o que esconde o botão
 * "Reconhecer" da tela (04-ui.md U8: nenhuma tela de fachada).
 *
 * Quando a fundação entregar, a troca é aqui e só aqui:
 *   abrir      -> abrirAlerta(tx, novo)                         (mutacoes.ts)
 *   resolver   -> atualizarEstado(tx, alertas, alvo, { resolvido_em })
 *   reconhecer -> atualizarComTrava(tx, alertas, {...}, ctx, "alerta_reconhecido")
 */

export type NovoAlerta = {
  lojaId: string;
  tipo: TipoGerado;
  severidade: Severidade;
  mensagem: string;
  chave: string;
  conversaId: string | null;
  contatoId: string | null;
};

export type AlvoReconhecimento = {
  id: string;
  escopo: EscopoLoja;
  updatedAtOriginal: Date;
};

export type EscritaDeAlertas = {
  /** `true` quando nasceu linha nova; `false` quando a dedupe segurou. */
  abrir(tx: Transacao, alerta: NovoAlerta): Promise<boolean>;
  /** Carimba `resolvido_em`. SÓ o gerador chama. */
  resolver(tx: Transacao, alvo: { id: string; lojaId: string }, quando: Date): Promise<void>;
  /** Marca ciência. Com trava de colisão e trilha. */
  reconhecer(tx: Transacao, alvo: AlvoReconhecimento, ctx: Contexto): Promise<void>;
};

const PENDENTE = "gravação de alertas (aguarda abrirAlerta, ESTADOS_DE_SISTEMA.alertas e alerta_reconhecido na fundação)";

export const escritaPendente: EscritaDeAlertas = {
  abrir: () => Promise.reject(naoImplementado(PENDENTE)),
  resolver: () => Promise.reject(naoImplementado(PENDENTE)),
  reconhecer: () => Promise.reject(naoImplementado(PENDENTE)),
};

/** A implementação em uso. Trocar junto com `ESCRITA_DISPONIVEL`. */
export const escritaDeAlertas: EscritaDeAlertas = escritaPendente;

/** Liga o botão "Reconhecer". Falso enquanto a gravação não existir. */
export const ESCRITA_DISPONIVEL = false;
