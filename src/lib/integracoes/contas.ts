import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { vivosE } from "@/lib/db/consultas";
import {
  atualizarComTrava,
  atualizarContador,
  emTransacao,
  excluirLogico,
  inserirAuditado,
  type Transacao,
} from "@/lib/db/mutacoes";
import { lojas } from "@/lib/db/schema/lojas";
import { lojas_integracoes } from "@/lib/db/schema/integracoes";
import type { AcaoAuditada } from "@/lib/db/schema/_enums/auditoria";
import type { StatusIntegracao } from "@/lib/db/schema/_enums/plataforma";
import type { Contexto } from "@/lib/auth/guard";
import { ErroDeEscopo, ErroDeValidacao } from "@/lib/erros";
import { hashDeSegredo } from "@/lib/seguranca/assinaturas";
import { cifrar, conferirCofre } from "@/lib/seguranca/cofre";
import { publicarNaLoja } from "@/lib/tempo-real/publicar";
import type {
  ConectarPorToken,
  DesconectarConta,
  EditarConta,
  SubstituirCredencial,
} from "@/lib/validadores/integracoes";
import { UUID } from "./_consultas";
import { contextoDoSistema } from "./_sistema";

/**
 * Escrita das contas conectadas (01-dados.md §6.3; 02-seguranca.md §13).
 *
 * Credencial SÓ no cofre (AES-256-GCM, AAD = id da linha). O id nasce aqui,
 * antes do INSERT, porque o envelope precisa dele. Chave do cofre ausente =
 * `ErroDoCofre` (503) ANTES de qualquer gravação: jamais texto plano.
 */

function avisar(lojaId: string | null, integracaoId: string): void {
  if (lojaId) publicarNaLoja(lojaId, { tipo: "integracao-atualizada", versao: Date.now(), integracaoId });
}

function erroDeUnico(erro: unknown): boolean {
  const e = erro as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const pg = e?.code ? e : e?.cause;
  return pg?.code === "23505" && pg.constraint === "uq_lojas_integracoes_referencia";
}

async function exigirLojaViva(tx: Transacao, lojaId: string): Promise<void> {
  const [linha] = await tx
    .select({ id: lojas.id })
    .from(lojas)
    .where(vivosE(lojas, eq(lojas.id, lojaId)))
    .limit(1);
  if (!linha) throw new ErroDeValidacao({ lojaId: ["Escolha uma loja ativa."] });
}

export type ContaConectada = {
  id: string;
  /** Só no uazapi, e só AGORA: o banco guarda apenas o SHA-256. */
  segredoWebhook: string | null;
};

/**
 * Conta de canal por token (WhatsApp oficial, uazapi, Instagram). A loja é
 * ESCRITA e escolhida no formulário — nunca implícita pelo cookie (§5.6).
 */
export async function conectarPorToken(
  tx: Transacao,
  dados: ConectarPorToken,
  ctx: Contexto,
): Promise<ContaConectada> {
  conferirCofre();
  await exigirLojaViva(tx, dados.lojaId);

  const id = randomUUID();
  const segredo = dados.provedor === "uazapi" ? randomBytes(32).toString("base64url") : null;
  const linha = {
    id,
    loja_id: dados.lojaId,
    provedor: dados.provedor,
    rotulo: dados.rotulo,
    // Oficial e Instagram valem ao salvar; o uazapi só depois do pareamento.
    status: (dados.provedor === "uazapi" ? "desconectado" : "conectado") satisfies StatusIntegracao,
    referencia_externa: dados.referencia,
    credenciais_cifradas: cifrar(JSON.stringify(dados.credencial), id),
    credenciais_aad: id,
    segredo_webhook_hash: segredo === null ? null : hashDeSegredo(segredo),
  };

  try {
    await tx.transaction((sp) => inserirAuditado(sp, lojas_integracoes, linha, ctx, "integracao_conectada"));
  } catch (erro) {
    if (erroDeUnico(erro)) {
      throw new ErroDeValidacao(
        { referencia: ["Já existe uma conta conectada com este identificador."] },
        { rotulo: dados.rotulo, referencia: dados.referencia, lojaId: dados.lojaId, provedor: dados.provedor },
      );
    }
    throw erro;
  }
  avisar(dados.lojaId, id);
  return { id, segredoWebhook: segredo };
}

/** Renomear e atribuir loja. Conta de rede (Bling) nunca ganha loja. */
export async function editarConta(
  tx: Transacao,
  dados: EditarConta,
  ctx: Contexto,
): Promise<{ updatedAt: Date }> {
  const provedor = await provedorDe(tx, dados.id);
  const mudanca: Record<string, unknown> = { rotulo: dados.rotulo };
  if (dados.lojaId && provedor !== "bling") {
    await exigirLojaViva(tx, dados.lojaId);
    mudanca.loja_id = dados.lojaId;
  }
  const linha = await atualizarComTrava(
    tx,
    lojas_integracoes,
    { id: dados.id, escopo: ctx.escopo, updatedAtOriginal: dados.updatedAt, dados: mudanca },
    ctx,
    "integracao_alterada",
  );
  avisar((linha.loja_id as string | null) ?? null, dados.id);
  return { updatedAt: linha.updated_at as Date };
}

async function provedorDe(tx: Transacao, id: string): Promise<string> {
  if (!UUID.test(id)) throw new ErroDeEscopo();
  const [linha] = await tx
    .select({ provedor: lojas_integracoes.provedor })
    .from(lojas_integracoes)
    .where(vivosE(lojas_integracoes, eq(lojas_integracoes.id, id)))
    .limit(1);
  if (!linha) throw new ErroDeEscopo();
  return linha.provedor;
}

/** "Reautenticar": troca a credencial sem trocar a conta (nem o id do AAD). */
export async function substituirCredencial(
  tx: Transacao,
  dados: SubstituirCredencial,
  ctx: Contexto,
): Promise<{ updatedAt: Date }> {
  conferirCofre();
  const provedor = await provedorDe(tx, dados.id);
  if (provedor === "bling") {
    throw new ErroDeValidacao({ _: ["O Bling reconecta pelo botão de autorização, não por token."] });
  }
  // As chaves validadas são as do provedor que o CLIENTE disse; vale o do banco.
  if (provedor !== dados.provedor) throw new ErroDeEscopo();
  const linha = await atualizarComTrava(
    tx,
    lojas_integracoes,
    {
      id: dados.id,
      escopo: ctx.escopo,
      updatedAtOriginal: dados.updatedAt,
      dados: {
        credenciais_cifradas: cifrar(JSON.stringify(dados.credencial), dados.id),
        credenciais_aad: dados.id,
        status: provedor === "uazapi" ? "desconectado" : "conectado",
        ultimo_erro: null,
      },
    },
    ctx,
    "integracao_alterada",
  );
  avisar((linha.loja_id as string | null) ?? null, dados.id);
  return { updatedAt: linha.updated_at as Date };
}

/**
 * Desconectar: APAGA a credencial cifrada e o hash do segredo, carimba
 * `revogada_em` e marca a linha excluída (§13). A trilha fica.
 */
export async function desconectarConta(tx: Transacao, dados: DesconectarConta, ctx: Contexto): Promise<void> {
  const limpa = await atualizarComTrava(
    tx,
    lojas_integracoes,
    {
      id: dados.id,
      escopo: ctx.escopo,
      updatedAtOriginal: dados.updatedAt,
      dados: {
        credenciais_cifradas: null,
        credenciais_aad: null,
        segredo_webhook_hash: null,
        status: "desconectado",
        revogada_em: new Date(),
      },
    },
    ctx,
    "integracao_alterada",
  );
  await excluirLogico(
    tx,
    lojas_integracoes,
    { id: dados.id, escopo: ctx.escopo, updatedAtOriginal: limpa.updated_at as Date },
    ctx,
    "integracao_desconectada",
  );
  avisar((limpa.loja_id as string | null) ?? null, dados.id);
}

/**
 * Estado escrito pelo SISTEMA (sessão do uazapi, token vencido, erro de
 * credencial). Lê o `updated_at` na hora e grava com trava: se uma pessoa
 * editou no meio, esta rodada perde e a próxima tenta de novo.
 */
export async function registrarEstadoDoSistema(
  integracaoId: string,
  estado: { status: StatusIntegracao; ultimoErro: string | null; extra?: Record<string, unknown> },
  acao: AcaoAuditada = "integracao_alterada",
): Promise<boolean> {
  const [linha] = await db
    .select({
      lojaId: lojas_integracoes.loja_id,
      status: lojas_integracoes.status,
      ultimoErro: lojas_integracoes.ultimo_erro,
      updatedAt: lojas_integracoes.updated_at,
    })
    .from(lojas_integracoes)
    .where(vivosE(lojas_integracoes, eq(lojas_integracoes.id, integracaoId)))
    .limit(1);
  if (!linha) return false;

  const escopo = linha.lojaId ? { tipo: "uma" as const, lojaId: linha.lojaId } : { tipo: "todas" as const };
  const ctx = contextoDoSistema("worker", escopo);
  const mudouStatus = linha.status !== estado.status || estado.extra !== undefined;

  await emTransacao(ctx, async (tx) => {
    if (mudouStatus) {
      await atualizarComTrava(
        tx,
        lojas_integracoes,
        {
          id: integracaoId,
          escopo,
          updatedAtOriginal: linha.updatedAt,
          dados: { status: estado.status, ...(estado.extra ?? {}) },
        },
        ctx,
        acao,
      );
    }
    // `ultimo_erro` é contador/cache: relógio separado, sem trilha.
    if (linha.ultimoErro !== estado.ultimoErro) {
      await atualizarContador(tx, lojas_integracoes, { id: integracaoId, escopo }, { ultimo_erro: estado.ultimoErro });
    }
  });
  if (mudouStatus) avisar(linha.lojaId, integracaoId);
  return mudouStatus;
}

/** Carimbo de sincronização bem-sucedida (contador, sem trilha). */
export async function marcarSincronizacao(integracaoId: string, lojaId: string | null): Promise<void> {
  const escopo = lojaId ? { tipo: "uma" as const, lojaId } : { tipo: "todas" as const };
  const ctx = contextoDoSistema("worker", escopo);
  await emTransacao(ctx, (tx) =>
    atualizarContador(
      tx,
      lojas_integracoes,
      { id: integracaoId, escopo },
      { ultima_sincronizacao: new Date(), ultimo_erro: null },
    ),
  );
}
