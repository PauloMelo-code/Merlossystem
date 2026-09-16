import "server-only";
import { and, asc, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import { vivos } from "@/lib/db/consultas";
import { usuarios } from "@/lib/db/schema/auth/usuarios";
import { usuarios_convites } from "@/lib/db/schema/auth/convites";
import { usuarios_trocas_email } from "@/lib/db/schema/auth/trocas-email";
import { lojas } from "@/lib/db/schema/lojas";
import { ATOR_SISTEMA, type Papel } from "@/lib/db/schema/_enums/auth";

/**
 * Leituras de `/configuracoes/usuarios` (04-ui.md §5.6).
 *
 * Só quem tem `usuarios:ler_detalhe` chega aqui — a página confere antes. O
 * e-mail sai nesta projeção e em nenhuma outra: `usuarios:listar_colegas` não
 * tem e-mail (02-seguranca.md §2.2).
 *
 * `usuarios` nunca é soft-deletado (INV-33), mas o filtro `vivos()` fica: é a
 * regra da casa e custa nada.
 */

export type UsuarioNaLista = {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  lojaId: string | null;
  lojaNome: string | null;
  ativo: boolean;
  emProvisionamento: boolean;
  bloqueadoAte: Date | null;
  ultimoLoginEm: Date | null;
  updatedAt: Date;
  trocaDeEmailAberta: boolean;
};

export async function listarUsuarios(): Promise<UsuarioNaLista[]> {
  const agora = new Date();
  const linhas = await db
    .select({
      id: usuarios.id,
      nome: usuarios.nome,
      email: usuarios.email,
      papel: usuarios.papel,
      lojaId: usuarios.loja_id,
      lojaNome: lojas.nome,
      ativo: usuarios.ativo,
      precisaFator: usuarios.precisa_configurar_fator,
      bloqueadoAte: usuarios.bloqueado_ate,
      ultimoLoginEm: usuarios.ultimo_login_em,
      updatedAt: usuarios.updated_at,
      trocaId: usuarios_trocas_email.id,
    })
    .from(usuarios)
    .leftJoin(lojas, eq(lojas.id, usuarios.loja_id))
    .leftJoin(
      usuarios_trocas_email,
      and(
        eq(usuarios_trocas_email.usuario_id, usuarios.id),
        isNull(usuarios_trocas_email.confirmado_em),
        isNull(usuarios_trocas_email.cancelado_em),
        gt(usuarios_trocas_email.expira_em, agora),
        vivos(usuarios_trocas_email),
      ),
    )
    // O ATOR_SISTEMA (viewer inativo, "Sistema") assina worker e webhook: não é gente.
    .where(and(vivos(usuarios), ne(usuarios.id, ATOR_SISTEMA)))
    .orderBy(desc(usuarios.ativo), asc(usuarios.nome));

  return linhas.map((l) => ({
    id: l.id,
    nome: l.nome,
    email: l.email,
    papel: l.papel as Papel,
    lojaId: l.lojaId,
    lojaNome: l.lojaNome,
    ativo: l.ativo,
    emProvisionamento: l.precisaFator,
    bloqueadoAte: l.bloqueadoAte && l.bloqueadoAte > agora ? l.bloqueadoAte : null,
    ultimoLoginEm: l.ultimoLoginEm,
    updatedAt: l.updatedAt,
    trocaDeEmailAberta: l.trocaId !== null,
  }));
}

export type ConviteNaLista = {
  id: string;
  email: string;
  papel: Papel;
  lojaNome: string | null;
  expiraEm: Date;
  vencido: boolean;
  criadoPorNome: string | null;
};

/** Convites ainda não usados — vencidos inclusive, para poder reenviar. */
export async function listarConvitesAbertos(): Promise<ConviteNaLista[]> {
  const autor = alias(usuarios, "autor");
  const linhas = await db
    .select({
      id: usuarios_convites.id,
      email: usuarios_convites.email,
      papel: usuarios_convites.papel,
      lojaNome: lojas.nome,
      expiraEm: usuarios_convites.expira_em,
      criadoPorNome: autor.nome,
    })
    .from(usuarios_convites)
    .leftJoin(lojas, eq(lojas.id, usuarios_convites.loja_id))
    .leftJoin(autor, eq(autor.id, usuarios_convites.criado_por))
    .where(and(vivos(usuarios_convites), isNull(usuarios_convites.usado_em)))
    .orderBy(desc(usuarios_convites.created_at));

  const agora = Date.now();
  return linhas.map((l) => ({
    ...l,
    papel: l.papel as Papel,
    vencido: l.expiraEm.getTime() <= agora,
  }));
}

export type LojaOpcao = { id: string; nome: string; sigla: string };

export async function listarLojasVivas(): Promise<LojaOpcao[]> {
  return db
    .select({ id: lojas.id, nome: lojas.nome, sigla: lojas.sigla })
    .from(lojas)
    .where(vivos(lojas))
    .orderBy(asc(lojas.nome));
}

/** Existe identidade com este e-mail? `usuarios.email` tem único TOTAL. */
export async function emailJaTemConta(email: string): Promise<boolean> {
  const linhas = await db.execute<{ existe: boolean }>(sql`
    select exists (select 1 from usuarios where lower(email) = ${email.toLowerCase()}) as existe
  `);
  return Boolean(linhas.rows[0]?.existe);
}
