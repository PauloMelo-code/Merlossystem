import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { ErroDoAplicativo } from "@/lib/erros";
import {
  emTransacao,
  excluirLogico,
  inserirAuditado,
  type ContextoDeGravacao,
  type Transacao,
} from "@/lib/db/mutacoes";
import { usuarios_convites } from "@/lib/db/schema/auth/convites";
import { usuarios } from "@/lib/db/schema/auth/usuarios";
import { usuarios_contas } from "@/lib/db/schema/auth/contas";
import type { Papel } from "@/lib/db/schema/_enums/auth";
import type { Contexto } from "./guard";
import { enfileirarEmailSeguranca } from "./emails";
import { kdf } from "./kdf";
import { gravarEventoAuth } from "./trilha";
import {
  CIENCIA_ADMIN_V1,
  VALIDADE_CONVITE_HORAS,
  hashToken,
  linkComToken,
  novoToken,
} from "./tokens";

/**
 * Provisionamento por convite (02-seguranca.md §9.2, REQ-C11/E13/D1).
 *
 * É o ÚNICO caminho que cria identidade: `/sign-up/email` responde 404,
 * `disableSignUp: true`, `/set-password` desligado e o plugin `admin` é
 * proibido (S-02). Por isso a criação é nossa — e usa `inserirAuditado`, não
 * `tx.insert`, para a trava do modelo de dados seguir intacta.
 */

export { CIENCIA_ADMIN_V1, VALIDADE_CONVITE_HORAS };

export class ErroDeConvite extends ErroDoAplicativo {
  constructor(mensagem = "Não foi possível concluir o primeiro acesso. Peça um convite novo.") {
    // Vocabulário de E10: nada de "token", "link", "inválido" ou "expirado".
    super("CONVITE_NAO_UTILIZAVEL", mensagem, 400);
  }
}

export type ConviteEmitido = { id: string; token: string; link: string; expiraEm: Date };

export function linkDoConvite(token: string): string {
  return linkComToken(env.APP_URL, "/primeiro-acesso", token);
}

type LinhaConvite = {
  id: string;
  email: string;
  papel: Papel;
  loja_id: string | null;
  bootstrap: boolean;
  ciencia_versao: string | null;
};

type DadosDoConvite = {
  email: string;
  papel: Papel;
  lojaId?: string | null;
  cienciaVersao?: string | null;
  motivo?: string | null;
};

/**
 * Emite o convite DENTRO da transação de quem chama (reenvio, convite que
 * aposenta o anterior): o índice único parcial de e-mail aberto só aceita os
 * dois passos na MESMA transação.
 *
 * Grava `convite_emitido` fail-closed na transação — convite sem prova de quem
 * emitiu não existe (§17.2). NÃO enfileira o e-mail: quem chama enfileira
 * DEPOIS do commit (`enviarConvite`), senão um rollback deixaria um link morto
 * na caixa da pessoa.
 *
 * `criado_por` é nulo SÓ no bootstrap — o CHECK `usuarios_convites_bootstrap`
 * é quem garante isso, não esta função.
 */
export async function emitirConviteEm(
  tx: Transacao,
  dados: DadosDoConvite,
  ctx: ContextoDeGravacao,
): Promise<ConviteEmitido & { email: string }> {
  const email = dados.email.trim().toLowerCase();
  const { token, hash } = novoToken();

  const linhas = await tx.execute<{ id: string; expira_em: Date }>(sql`
    insert into usuarios_convites
      (email, papel, loja_id, token_hash, expira_em, criado_por, ciencia_versao,
       motivo, created_at, updated_at, modified_by)
    values (
      ${email}, ${dados.papel}, ${dados.lojaId ?? null}, ${hash},
      now() + make_interval(hours => ${VALIDADE_CONVITE_HORAS}),
      ${ctx.autorId}::uuid, ${dados.cienciaVersao ?? null}, ${dados.motivo ?? null},
      now(), now(), ${ctx.autorId}::uuid
    )
    returning id, expira_em
  `);
  const linha = linhas.rows[0];
  if (!linha) throw new ErroDeConvite();

  await gravarEventoAuth(
    {
      tipo: "convite_emitido",
      atorId: ctx.autorId,
      email,
      meio: "convite",
      motivo: dados.motivo ?? null,
      detalhes: {
        papel: dados.papel,
        ...(dados.cienciaVersao ? { ciencia_versao: dados.cienciaVersao } : {}),
      },
    },
    tx,
  );

  return {
    id: linha.id,
    email,
    token,
    link: linkDoConvite(token),
    expiraEm: new Date(linha.expira_em),
  };
}

/** O e-mail do convite, SÓ depois do commit. O token nunca vai para o log. */
export function enviarConvite(convite: { link: string; email: string }, autorId: string): void {
  enfileirarEmailSeguranca("convite", autorId, convite.link, { paraEmail: convite.email });
}

/** Emissão avulsa: abre a própria transação e envia depois do commit. */
export async function emitirConvite(dados: DadosDoConvite, ctx: Contexto): Promise<ConviteEmitido> {
  const emitido = await emTransacao(ctx, (tx) => emitirConviteEm(tx, dados, ctx));
  enviarConvite(emitido, ctx.autorId);
  return { id: emitido.id, token: emitido.token, link: emitido.link, expiraEm: emitido.expiraEm };
}

/**
 * Fecha (exclusão LÓGICA) o convite aberto que já venceu, com a trilha
 * `convite_expirado`. Vencido já não é aceito (`consumirToken`), mas continua
 * segurando `uq_usuarios_convites_email_aberto` e impede um convite novo para a
 * mesma pessoa. Com `email`, fecha só o daquele endereço (quem vai reemitir);
 * sem, varre a rede (job `expirar-convites`, com `contextoDeSistema`).
 *
 * `SKIP LOCKED`: duas execuções do job não brigam pela mesma linha.
 */
export async function fecharConviteVencido(
  tx: Transacao,
  ctx: ContextoDeGravacao,
  filtro: { email?: string } = {},
): Promise<number> {
  const email = filtro.email?.trim().toLowerCase();
  const vencidos = await tx.execute<{ id: string; updated_at: Date | string }>(sql`
    select id, updated_at from usuarios_convites
    where usado_em is null and is_deleted = false and expira_em <= now()
      ${email === undefined ? sql`` : sql`and lower(email) = ${email}`}
    for update skip locked
  `);
  for (const convite of vencidos.rows) {
    await excluirLogico(
      tx,
      usuarios_convites,
      { id: convite.id, escopo: { tipo: "todas" }, updatedAtOriginal: new Date(convite.updated_at) },
      ctx,
      "convite_expirado",
    );
  }
  return vencidos.rows.length;
}

/**
 * Consumo ATÔMICO. Duas requisições simultâneas com o mesmo token: uma
 * atualiza a linha, a outra recebe zero linhas e recusa.
 *
 * Erro DEPOIS do consumo desfaz a transação inteira e o token volta a valer —
 * é por isso que a política de senha roda ANTES (§9.2 item 4).
 */
async function consumirToken(tx: Transacao, tokenHash: string): Promise<LinhaConvite> {
  const linhas = await tx.execute<LinhaConvite>(sql`
    update usuarios_convites set usado_em = now()
    where token_hash = ${tokenHash} and usado_em is null and expira_em > now()
      and is_deleted = false
    returning id, email, papel, loja_id, bootstrap, ciencia_versao
  `);
  const convite = linhas.rows[0];
  if (!convite) throw new ErroDeConvite();
  return convite;
}

/** No bootstrap, e só se ainda não houver dono vivo, o convidado nasce `dono`. */
async function papelFinal(tx: Transacao, convite: LinhaConvite): Promise<Papel> {
  if (!convite.bootstrap) return convite.papel;
  const linhas = await tx.execute<{ donos: string }>(sql`
    select count(*)::text as donos from usuarios
    where papel = 'dono' and is_deleted = false
  `);
  return Number(linhas.rows[0]?.donos ?? "0") === 0 ? "dono" : convite.papel;
}

export type ResultadoDoPrimeiroAcesso = { email: string; usuarioId: string | null };

/**
 * Cria a identidade a partir do convite. Chamado DENTRO da transação que
 * consumiu o token.
 *
 * O hash da senha usa o MESMO `kdf.hash` de `emailAndPassword.password.hash` —
 * senão o `verify` do Better Auth nunca bateria e a pessoa ficaria com uma
 * conta que não entra (a trava T28 é exatamente esse teste).
 */
export async function criarUsuarioPorConvite(
  tx: Transacao,
  convite: LinhaConvite,
  dados: { nome: string; senha: string },
  papel: Papel,
): Promise<string> {
  const usuarioId = randomUUID();
  // O ator é a própria pessoa: `modified_by` e `ator_id` apontam para ela, o
  // que é verdade e o que a FK de `modified_by` exige.
  const ctx: Contexto = {
    sessao: {
      usuarioId,
      sessaoId: usuarioId,
      papel,
      lojaId: convite.loja_id,
      ativo: true,
      precisaTrocarSenha: false,
      precisaConfigurarFator: true,
    },
    escopo: convite.loja_id ? { tipo: "uma", lojaId: convite.loja_id } : { tipo: "todas" },
    autorId: usuarioId,
    origem: "ui",
  };

  await inserirAuditado(
    tx,
    usuarios,
    {
      id: usuarioId,
      nome: dados.nome.trim(),
      email: convite.email,
      // A posse do e-mail já foi provada por ter aberto o convite (§9.2).
      email_verificado: true,
      papel,
      loja_id: convite.loja_id,
      ativo: false,
      precisa_configurar_fator: true,
    },
    ctx,
    "usuario_criado",
  );

  await inserirAuditado(
    tx,
    usuarios_contas,
    {
      usuario_id: usuarioId,
      provedor_id: "credential",
      conta_id: usuarioId,
      senha_hash: await kdf.hash(dados.senha),
    },
    ctx,
    "usuario_criado",
  );

  await tx.execute(sql`
    update usuarios_convites set usado_por_usuario_id = ${usuarioId}::uuid
    where id = ${convite.id}::uuid
  `);

  await tx.execute(sql`
    insert into usuarios_senhas_historico (usuario_id, senha_hash)
    select ${usuarioId}::uuid, senha_hash from usuarios_contas
    where usuario_id = ${usuarioId}::uuid and provedor_id = 'credential'
  `);

  if (convite.bootstrap) {
    await gravarEventoAuth(
      {
        tipo: "dono_semeado",
        atorTipo: "sistema",
        usuarioId,
        alvoId: usuarioId,
        email: convite.email,
        meio: "convite",
        detalhes: { papel },
      },
      tx,
    );
  }

  return usuarioId;
}

/**
 * Fluxo completo de `/primeiro-acesso`.
 *
 * C11 — E-MAIL JÁ EXISTENTE: o token é consumido (não pode ser reusado), NENHUMA
 * coluna da identidade existente é tocada e o corpo da resposta é o mesmo do
 * caso novo. É o pré-sequestro da Microsoft 2022: convite que sobrescreve
 * identidade existente entrega a conta a quem convidou.
 */
export async function usarConvite(
  tokenClaro: string,
  dados: { nome: string; senha: string },
): Promise<ResultadoDoPrimeiroAcesso> {
  const tokenHash = hashToken(tokenClaro);

  // Contexto mínimo só para abrir a transação; o contexto real é montado com o
  // id do usuário recém-criado, dentro de `criarUsuarioPorConvite`.
  const ctxAbertura: Contexto = {
    sessao: {
      usuarioId: randomUUID(),
      sessaoId: randomUUID(),
      papel: "viewer",
      lojaId: null,
      ativo: true,
      precisaTrocarSenha: false,
      precisaConfigurarFator: true,
    },
    escopo: { tipo: "todas" },
    autorId: randomUUID(),
    origem: "ui",
  };

  return emTransacao(ctxAbertura, async (tx) => {
    const convite = await consumirToken(tx, tokenHash);

    const existentes = await tx.execute<{ id: string }>(sql`
      select id from usuarios where lower(email) = ${convite.email} limit 1
    `);
    if (existentes.rows[0]) {
      // Nada é alterado. O token já foi queimado, então o convite não serve
      // mais para ninguém.
      return { email: convite.email, usuarioId: null };
    }

    const papel = await papelFinal(tx, convite);
    const usuarioId = await criarUsuarioPorConvite(tx, convite, dados, papel);

    await gravarEventoAuth(
      {
        tipo: "convite_usado",
        usuarioId,
        alvoId: usuarioId,
        email: convite.email,
        meio: "convite",
        detalhes: { papel },
      },
      tx,
    );

    return { email: convite.email, usuarioId };
  });
}
