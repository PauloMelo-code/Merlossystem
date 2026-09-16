import "server-only";
import { sql } from "drizzle-orm";
import { CIENCIA_ADMIN_V1 } from "@/lib/auth/convites";
import type { Contexto } from "@/lib/auth/guard";
import { podeChave } from "@/lib/auth/permissoes";
import { estadoDosFatores, fatorQueFalta } from "@/lib/auth/fatores";
import { revogarSessoesDe } from "@/lib/auth/sessoes";
import { gravarEventoAuth } from "@/lib/auth/trilha";
import { atualizarComTrava, excluirLogico, type Transacao } from "@/lib/db/mutacoes";
import { usuarios } from "@/lib/db/schema/auth/usuarios";
import { usuarios_convites } from "@/lib/db/schema/auth/convites";
import type { Papel } from "@/lib/db/schema/_enums/auth";
import { ErroDeValidacao } from "@/lib/erros";
import { ESCOPO_DE_REDE, baseDoEvento, recusaDeAlvo, travarAlvo, type LinhaTravada } from "./_alvo";
import {
  conferirDestinoDePapel,
  conferirQuadro,
  conferirReativacao,
  eventoDaTroca,
  quadroDepois,
} from "./regras";

/**
 * Papel, posse e ativo (02-seguranca.md §11.2, §2.3, §9.2; 04-ui.md §5.6).
 *
 * Toda função recebe a transação aberta por `executarAcao` e segue a MESMA
 * ordem, que é o que a régua exige e o que o teste de corrida prova:
 *
 *   1. `travarAlvo` — `FOR UPDATE` no quadro, relê o papel do ator, aplica a
 *      escada de `exigirAlvoPermitido` e grava `recusa_403` quando recusa;
 *   2. regra pura (`regras.ts`) sobre o quadro travado;
 *   3. trilha de `auth_eventos` GRAVADA ANTES do efeito, na mesma transação e
 *      fail-closed — falha na trilha = o efeito não acontece;
 *   4. efeito por `atualizarComTrava` (trava de colisão + `auditoria_eventos`),
 *      campo a campo — nunca `...input` sobre a linha (H12);
 *   5. revogação das sessões do alvo (F5).
 */

type Saida = { updatedAt: Date };

/** `atualizarComTrava` grava `loja_id` da trilha a partir do escopo: aqui é rede. */
function naRede(ctx: Contexto): Contexto {
  return { ...ctx, escopo: ESCOPO_DE_REDE };
}

async function gravarPapel(
  tx: Transacao,
  ctx: Contexto,
  alvo: LinhaTravada,
  updatedAt: Date,
  dados: { papel: Papel; loja_id: string | null },
): Promise<Date> {
  const linha = await atualizarComTrava(
    tx,
    usuarios,
    { id: alvo.id, escopo: ESCOPO_DE_REDE, updatedAtOriginal: updatedAt, dados },
    naRede(ctx),
    "usuario_papel_alterado",
  );
  return linha.updated_at as Date;
}

/** Dono e admin precisam de passkey E aplicativo (H7, ADR 0029). */
async function exigirFatoresDeAdministracao(alvo: LinhaTravada, papel: Papel): Promise<void> {
  const falta = fatorQueFalta(papel, await estadoDosFatores(alvo.id));
  if (!falta) return;
  throw new ErroDeValidacao(
    {},
    undefined,
    "Esta pessoa precisa cadastrar uma passkey e o aplicativo autenticador em “Meu perfil › Segurança” antes de receber este acesso.",
  );
}

export async function trocarPapel(
  tx: Transacao,
  ctx: Contexto,
  dados: { alvoId: string; updatedAt: Date; papel: Papel; lojaId: string | null; motivo: string },
): Promise<Saida> {
  const { alvo, ator, quadro } = await travarAlvo(tx, ctx, dados.alvoId, "usuarios:editar");
  // Mexer em `admin` ou `dono` é rebaixamento: chave só do dono.
  const chaveDeRebaixar = "usuarios:rebaixar_admin" as const;
  if ((alvo.papel === "admin" || alvo.papel === "dono") && !podeChave(ator.papel, chaveDeRebaixar)) {
    throw await recusaDeAlvo(ctx, chaveDeRebaixar, alvo.id, ator.papel);
  }
  conferirDestinoDePapel(ator.papel, alvo.papel, dados.papel);
  if (alvo.papel === dados.papel && alvo.lojaId === dados.lojaId) {
    throw new ErroDeValidacao({}, undefined, "Nada mudou: o papel e a loja são os mesmos.");
  }

  const mudanca = {
    antes: { papel: alvo.papel, ativo: alvo.ativo },
    depois: { papel: dados.papel, ativo: alvo.ativo },
  };
  conferirQuadro(quadro, quadroDepois(quadro, [mudanca]));

  await gravarEventoAuth(
    {
      tipo: eventoDaTroca(alvo.papel, dados.papel),
      ...baseDoEvento(ctx, alvo, dados.motivo),
      detalhes: { papel: dados.papel, acao: `de:${alvo.papel}` },
    },
    tx,
  );
  const updatedAt = await gravarPapel(tx, ctx, alvo, dados.updatedAt, {
    papel: dados.papel,
    loja_id: dados.lojaId,
  });
  await revogarSessoesDe(alvo.id);
  return { updatedAt };
}

/** Só `dono`, com ciência digitada (conferida no Zod) e trilha antes do UPDATE. */
export async function promoverAAdmin(
  tx: Transacao,
  ctx: Contexto,
  dados: { alvoId: string; updatedAt: Date; motivo: string },
): Promise<Saida> {
  const { alvo, quadro } = await travarAlvo(tx, ctx, dados.alvoId, "usuarios:promover_admin");
  if (alvo.papel === "admin" || alvo.papel === "dono") {
    throw new ErroDeValidacao({}, undefined, "Esta pessoa já tem acesso de administração.");
  }
  if (!alvo.ativo || alvo.precisaConfigurarFator) {
    throw new ErroDeValidacao({}, undefined, "Só uma conta ativa pode virar administradora.");
  }
  await exigirFatoresDeAdministracao(alvo, "admin");

  const mudanca = {
    antes: { papel: alvo.papel, ativo: true },
    depois: { papel: "admin" as const, ativo: true },
  };
  conferirQuadro(quadro, quadroDepois(quadro, [mudanca]));

  await gravarEventoAuth(
    {
      tipo: "admin_promovido",
      ...baseDoEvento(ctx, alvo, dados.motivo),
      detalhes: { papel: "admin", ciencia_versao: CIENCIA_ADMIN_V1 },
    },
    tx,
  );
  const updatedAt = await gravarPapel(tx, ctx, alvo, dados.updatedAt, {
    papel: "admin",
    loja_id: null,
  });
  await revogarSessoesDe(alvo.id);
  return { updatedAt };
}

/**
 * O alvo (um `admin`) vira `dono` e quem transfere vira `admin` (04-ui.md
 * §5.6). O `FOR UPDATE` de `travarAlvo` é o que garante ≥ 1 e ≤ 2 donos: uma
 * segunda transferência concorrente relê o ator já rebaixado e é recusada.
 */
export async function transferirPosse(
  tx: Transacao,
  ctx: Contexto,
  dados: { alvoId: string; updatedAt: Date; motivo: string },
): Promise<Saida> {
  const { alvo, ator, quadro } = await travarAlvo(tx, ctx, dados.alvoId, "usuarios:transferir_posse");
  if (alvo.papel !== "admin" || !alvo.ativo || alvo.precisaConfigurarFator) {
    throw new ErroDeValidacao(
      {},
      undefined,
      "A posse só vai para um administrador ativo. Promova a pessoa antes.",
    );
  }
  await exigirFatoresDeAdministracao(alvo, "dono");

  const mudancas = [
    { antes: { papel: "admin" as const, ativo: true }, depois: { papel: "dono" as const, ativo: true } },
    { antes: { papel: ator.papel, ativo: true }, depois: { papel: "admin" as const, ativo: true } },
  ];
  conferirQuadro(quadro, quadroDepois(quadro, mudancas));

  await gravarEventoAuth(
    {
      tipo: "posse_transferida",
      ...baseDoEvento(ctx, alvo, dados.motivo),
      detalhes: { papel: "dono", ciencia_versao: CIENCIA_ADMIN_V1 },
    },
    tx,
  );
  const updatedAt = await gravarPapel(tx, ctx, alvo, dados.updatedAt, {
    papel: "dono",
    loja_id: null,
  });
  await gravarPapel(tx, ctx, ator, ator.updatedAt, { papel: "admin", loja_id: null });
  await revogarSessoesDe(alvo.id);
  await revogarSessoesDe(ator.id);
  return { updatedAt };
}

/**
 * Soft delete de convite aberto para o e-mail — é o que "fecha o
 * provisionamento" de quem é desativado antes de concluir (§4.3).
 */
export async function encerrarConvitesAbertos(
  tx: Transacao,
  ctx: Contexto,
  email: string,
): Promise<void> {
  const abertos = await tx.execute<{ id: string; updated_at: Date | string }>(sql`
    select id, updated_at from usuarios_convites
    where lower(email) = ${email.toLowerCase()} and usado_em is null and is_deleted = false
    for update
  `);
  for (const convite of abertos.rows) {
    await excluirLogico(
      tx,
      usuarios_convites,
      { id: convite.id, escopo: ESCOPO_DE_REDE, updatedAtOriginal: new Date(convite.updated_at) },
      naRede(ctx),
      "usuario_alterado",
    );
  }
}

export async function desativarUsuario(
  tx: Transacao,
  ctx: Contexto,
  dados: { alvoId: string; updatedAt: Date; motivo: string },
): Promise<Saida> {
  const { alvo, quadro } = await travarAlvo(tx, ctx, dados.alvoId, "usuarios:desativar");
  if (!alvo.ativo && !alvo.precisaConfigurarFator) {
    throw new ErroDeValidacao({}, undefined, "Esta conta já está desativada.");
  }
  const mudanca = {
    antes: { papel: alvo.papel, ativo: alvo.ativo },
    depois: { papel: alvo.papel, ativo: false },
  };
  conferirQuadro(quadro, quadroDepois(quadro, [mudanca]));

  await gravarEventoAuth(
    { tipo: "usuario_desativado", ...baseDoEvento(ctx, alvo, dados.motivo) },
    tx,
  );
  // Conta em provisionamento sai do estado 3 e passa a cair no 2 de
  // `podeCriarSessao`: desativada de verdade (02-seguranca.md §4.3).
  const linha = await atualizarComTrava(
    tx,
    usuarios,
    {
      id: alvo.id,
      escopo: ESCOPO_DE_REDE,
      updatedAtOriginal: dados.updatedAt,
      dados: { ativo: false, precisa_configurar_fator: false },
    },
    naRede(ctx),
    "usuario_desativado",
  );
  await encerrarConvitesAbertos(tx, ctx, alvo.email);
  await revogarSessoesDe(alvo.id);
  return { updatedAt: linha.updated_at as Date };
}

export async function reativarUsuario(
  tx: Transacao,
  ctx: Contexto,
  dados: { alvoId: string; updatedAt: Date; motivo: string },
): Promise<Saida> {
  const { alvo, quadro } = await travarAlvo(tx, ctx, dados.alvoId, "usuarios:desativar");
  conferirReativacao({ ativo: alvo.ativo || alvo.precisaConfigurarFator, temFator: alvo.temFator });
  const mudanca = {
    antes: { papel: alvo.papel, ativo: false },
    depois: { papel: alvo.papel, ativo: true },
  };
  conferirQuadro(quadro, quadroDepois(quadro, [mudanca]));
  if (alvo.papel === "dono" || alvo.papel === "admin") {
    await exigirFatoresDeAdministracao(alvo, alvo.papel);
  }

  await gravarEventoAuth(
    { tipo: "usuario_reativado", ...baseDoEvento(ctx, alvo, dados.motivo) },
    tx,
  );
  const linha = await atualizarComTrava(
    tx,
    usuarios,
    {
      id: alvo.id,
      escopo: ESCOPO_DE_REDE,
      updatedAtOriginal: dados.updatedAt,
      dados: { ativo: true },
    },
    naRede(ctx),
    "usuario_reativado",
  );
  return { updatedAt: linha.updated_at as Date };
}
