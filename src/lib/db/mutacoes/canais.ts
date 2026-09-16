import { and, eq, sql } from "drizzle-orm";
import { ErroDeEscopo } from "@/lib/erros";
import { vivos } from "../consultas";
import type { OrigemConsentimento, TipoConsentimento } from "../schema/_enums/auditoria";
import { STATUS_ENTREGA } from "../schema/_enums/conversas";
import { campanhas_destinatarios } from "../schema/campanhas";
import { contatos } from "../schema/contatos";
import { conversas_mensagens } from "../schema/conversas/mensagens";
import type { ContextoDeGravacao } from "../sistema";
import { atualizarComTrava, registrarAuditoria, type Transacao } from "./base";

/**
 * Escritas de canal (contato, entrega, reenvio, destinatários) e de
 * consentimento. Reexportado por `src/lib/db/mutacoes.ts`.
 */

type Linha = Record<string, unknown>;

/** Colunas de identificador de canal aceitas pelo casamento de contato. */
export type CanalDeContato = "whatsapp_id" | "instagram_id" | "facebook_id" | "tiktok_id";

/**
 * Casamento do contato na entrada de mensagem — TRÊS PASSOS, uma transação
 * (01-dados-dominio.md §2.1). Fecha 02/C-01 e 01/D-03, em que toda mensagem
 * daquele cliente se perdia para sempre com 200 devolvido ao provedor.
 *
 * O upsert sozinho não basta: `ON CONFLICT (loja_id, whatsapp_id)` não enxerga
 * o contato criado pelo CRM, que tem o mesmo telefone e `whatsapp_id` nulo — e
 * a inserção nova viola `(loja_id, telefone)`. O passo 1 roda em SAVEPOINT
 * (`tx.transaction`) porque no Postgres um erro aborta a transação inteira.
 */
export async function upsertContatoPorCanal(
  tx: Transacao,
  lojaId: string,
  identificadores: { canal: CanalDeContato; valor: string; telefone?: string; nome?: string },
  agora: Date,
): Promise<Linha> {
  const { canal, valor, telefone, nome } = identificadores;
  const coluna = contatos[canal];
  const porCanal = async () => {
    const [linha] = await tx.transaction((sp) =>
      sp
        .insert(contatos)
        .values({ loja_id: lojaId, [canal]: valor, telefone, nome, ultimo_contato_em: agora })
        .onConflictDoUpdate({
          target: [contatos.loja_id, coluna],
          // REPETE o predicado do índice parcial: sem ele o Postgres não
          // encontra o índice e o comando levanta erro.
          targetWhere: sql.raw(`${canal} is not null and is_deleted = false`),
          set: { ultimo_contato_em: agora },
        })
        .returning(),
    );
    return (linha ?? null) as Linha | null;
  };

  try {
    const criado = await porCanal();
    if (criado) return criado;
  } catch (erro) {
    if (!violacaoDeTelefone(erro)) throw erro;
  }

  if (telefone) {
    const [porTelefone] = await tx
      .update(contatos)
      .set({ [canal]: valor, ultimo_contato_em: agora })
      .where(
        and(
          eq(contatos.loja_id, lojaId),
          eq(contatos.telefone, telefone),
          sql`${coluna} is null`,
          vivos(contatos),
        ),
      )
      .returning();
    if (porTelefone) return porTelefone as Linha;
  }

  // Corrida: outra transação carimbou o canal entre os dois passos.
  const segundaTentativa = await porCanal();
  if (!segundaTentativa) throw new ErroDeEscopo();
  return segundaTentativa;
}

/** O Drizzle 0.45 embrulha o erro do `pg` em `cause`: olha os dois níveis. */
export function violacaoDeTelefone(erro: unknown): boolean {
  type ErroPg = { code?: string; constraint?: string; cause?: unknown };
  const e = erro as ErroPg | null | undefined;
  const causa = e?.cause as ErroPg | null | undefined;
  return [e, causa].some((x) => x?.code === "23505" && x?.constraint === "uq_contatos_telefone");
}

/**
 * Status de entrega MONOTÔNICO (01-dados-dominio.md §2.3): `delivered` atrasado
 * não rebaixa `lida` (01/D-26), e o recibo do provedor nunca sai de `falhou` —
 * essa transição é exclusiva do reenvio.
 */
export async function avancarStatusDeEntrega(
  tx: Transacao,
  mensagemId: string,
  novoStatus: (typeof STATUS_ENTREGA)[number],
  ocorridoEm: Date,
): Promise<boolean> {
  const escala = sql.raw(`array[${STATUS_ENTREGA.map((s) => `'${s}'`).join(", ")}]::text[]`);
  const linhas = await tx
    .update(conversas_mensagens)
    .set({ status_entrega: novoStatus, status_atualizado_em: ocorridoEm })
    .where(
      and(
        eq(conversas_mensagens.id, mensagemId),
        vivos(conversas_mensagens),
        sql`${conversas_mensagens.status_entrega} is distinct from 'falhou'`,
        sql`coalesce(array_position(${escala}, ${conversas_mensagens.status_entrega}), 0)
            < array_position(${escala}, ${novoStatus})`,
      ),
    )
    .returning({ id: conversas_mensagens.id });
  return linhas.length > 0;
}

/**
 * Reenvio: a ÚNICA transição que sai de `falhou`, e é um claim atômico. Zero
 * linhas = alguém já reenviou e nada acontece (409 na action).
 */
export async function reivindicarReenvio(tx: Transacao, mensagemId: string): Promise<boolean> {
  const linhas = await tx
    .update(conversas_mensagens)
    .set({ status_entrega: "pendente", falha_motivo: null, status_atualizado_em: new Date() })
    .where(
      and(
        eq(conversas_mensagens.id, mensagemId),
        eq(conversas_mensagens.status_entrega, "falhou"),
        vivos(conversas_mensagens),
      ),
    )
    .returning({ id: conversas_mensagens.id });
  return linhas.length > 0;
}

/**
 * Reserva de destinatários por lote: `FOR UPDATE SKIP LOCKED` para dois workers
 * não pegarem a mesma cliente, e `reservado_em` é o lease que devolve a linha à
 * fila se o worker morrer (03/A2).
 */
export async function reservarDestinatarios(
  tx: Transacao,
  campanhaId: string,
  lote: number,
): Promise<string[]> {
  const resultado = await tx.execute<{ id: string }>(sql`
    update ${campanhas_destinatarios} as d
       set status = 'reservado', reservado_em = now()
      from (select id from ${campanhas_destinatarios}
             where campanha_id = ${campanhaId}
               and status = 'pendente'
               and is_deleted = false
             order by created_at
             limit ${lote}
               for update skip locked) as s
     where d.id = s.id
    returning d.id`);
  return resultado.rows.map((linha) => linha.id);
}


export type ConsentimentoBase = {
  contatoId: string;
  tipo: TipoConsentimento;
  concedido: boolean;
  origem: OrigemConsentimento;
  canal?: string | null;
  mensagemId?: string | null;
  termoVersao: string;
  /** Do servidor (`ipDoCliente()`), nunca do corpo. Webhook e worker: `null`. */
  ip: string | null;
  /** O espelho que a regra de negócio decidiu; `null` = não mexe no espelho. */
  optOut: boolean | null;
};

/**
 * A ÚNICA gravação de `consentimentos` + espelho `contatos.opt_out`, na MESMA
 * transação (01-dados-dominio.md §7.2). A regra (o que `concedido` significa)
 * é do módulo de contatos, que passa o `optOut` decidido. Trilha append-only:
 * INSERT por `execute(sql)`; contato em `FOR UPDATE` para o espelho não divergir.
 */
export async function registrarConsentimentoBase(
  tx: Transacao,
  ctx: ContextoDeGravacao,
  novo: ConsentimentoBase,
): Promise<{ optOut: boolean; espelhoMudou: boolean }> {
  if (ctx.escopo.tipo !== "uma") throw new ErroDeEscopo();
  const lojaId = ctx.escopo.lojaId;
  const [contato] = await tx
    .select({ id: contatos.id, optOut: contatos.opt_out, updatedAt: contatos.updated_at })
    .from(contatos)
    .where(and(eq(contatos.id, novo.contatoId), eq(contatos.loja_id, lojaId), vivos(contatos)))
    .for("update");
  if (!contato) throw new ErroDeEscopo();

  await tx.execute(sql`
    insert into consentimentos
      (loja_id, contato_id, tipo, concedido, origem, canal, mensagem_id, termo_versao, ip, registrado_por)
    values (${lojaId}, ${contato.id}, ${novo.tipo}, ${novo.concedido}, ${novo.origem},
            ${novo.canal ?? null}, ${novo.mensagemId ?? null}, ${novo.termoVersao},
            ${novo.ip}, ${ctx.origem === "ui" ? ctx.autorId : null})`);

  const depois = { tipo: novo.tipo, concedido: novo.concedido, origem: novo.origem };
  if (novo.optOut === null || novo.optOut === contato.optOut) {
    await registrarAuditoria(tx, ctx, "consentimento_registrado", "contatos", contato.id, {
      antes: null,
      depois,
    });
    return { optOut: contato.optOut, espelhoMudou: false };
  }
  // `updated_at` relido com a linha travada: espelho não colide com formulário.
  await atualizarComTrava(
    tx,
    contatos,
    {
      id: contato.id,
      escopo: ctx.escopo,
      updatedAtOriginal: contato.updatedAt,
      dados: { opt_out: novo.optOut, opt_out_em: novo.optOut ? new Date() : null },
    },
    ctx,
    "consentimento_registrado",
  );
  return { optOut: novo.optOut, espelhoMudou: true };
}
