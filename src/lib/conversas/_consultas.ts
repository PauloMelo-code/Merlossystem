import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { EscopoLoja } from "@/lib/auth/loja";
import { db } from "@/lib/db/client";
import { condicaoDeLoja, vivos, vivosE } from "@/lib/db/consultas";
import { auditoria_eventos } from "@/lib/db/schema/auditoria";
import { usuarios } from "@/lib/db/schema/auth/usuarios";
import { contatos, contatos_etiquetas } from "@/lib/db/schema/contatos";
import { respostas_rapidas } from "@/lib/db/schema/conteudo/respostas-rapidas";
import { conversas } from "@/lib/db/schema/conversas/conversas";
import { conversas_mensagens } from "@/lib/db/schema/conversas/mensagens";
import { conversas_mensagens_midias } from "@/lib/db/schema/conversas/mensagens-midias";
import { lojas_integracoes, lojas_integracoes_templates } from "@/lib/db/schema/integracoes";
import { lojas, lojas_etiquetas } from "@/lib/db/schema/lojas";
import type { Cursor } from "./regras";

/**
 * LEITURAS do atendimento (03-arquitetura.md §6.3). Toda consulta de tabela
 * com `loja_id` passa por `condicaoDeLoja` e por `vivos`/`vivosE`. Tabela de
 * outro domínio (contatos, integrações, etiquetas) é lida direto do schema,
 * por aqui — nunca por import do módulo do outro pacote.
 *
 * `url_externa` NÃO é selecionada em lugar nenhum deste arquivo.
 */

export type Leitor = Pick<typeof db, "select" | "execute">;

export type FiltrosDaLista = {
  visao: "minhas" | "sem_responsavel" | "todas";
  status: "andamento" | "aberta" | "pendente" | "resolvida" | "arquivada" | "todas";
  integracaoId?: string | undefined;
  prioridade?: string | undefined;
  etiquetaId?: string | undefined;
  busca?: string | undefined;
  semResposta?: boolean | undefined;
  slaEstourado?: boolean | undefined;
};

const responsavel = alias(usuarios, "responsavel");

function escaparLike(termo: string): string {
  return termo.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function filtroDeStatus(status: FiltrosDaLista["status"]): SQL | undefined {
  if (status === "todas") return undefined;
  if (status === "andamento") return inArray(conversas.status, ["aberta", "pendente"]);
  return eq(conversas.status, status);
}

function filtroDeBusca(busca: string | undefined): SQL | undefined {
  const termo = busca?.trim();
  if (!termo || termo.length < 2) return undefined;
  const digitos = termo.replace(/\D/g, "");
  const porNome = ilike(contatos.nome, `${escaparLike(termo)}%`);
  return digitos.length >= 4 ? or(porNome, sql`${contatos.telefone} like ${`%${digitos}%`}`) : porNome;
}

export async function listarConversas(
  leitor: Leitor,
  escopo: EscopoLoja,
  usuarioId: string,
  f: FiltrosDaLista,
  cursor: Cursor | null,
  limite: number,
) {
  const condicoes: (SQL | undefined)[] = [
    condicaoDeLoja(conversas, escopo),
    filtroDeStatus(f.status),
    f.visao === "minhas" ? eq(conversas.responsavel_id, usuarioId) : undefined,
    f.visao === "sem_responsavel" ? isNull(conversas.responsavel_id) : undefined,
    f.integracaoId ? eq(conversas.integracao_id, f.integracaoId) : undefined,
    f.prioridade ? eq(conversas.prioridade, f.prioridade) : undefined,
    f.semResposta ? isNull(conversas.primeira_resposta_em) : undefined,
    f.slaEstourado ? isNotNull(conversas.sla_estourado_em) : undefined,
    filtroDeBusca(f.busca),
    f.etiquetaId
      ? sql`exists (select 1 from ${contatos_etiquetas} ce
                     where ce.contato_id = ${conversas.contato_id}
                       and ce.etiqueta_id = ${f.etiquetaId}
                       and ce.is_deleted = false)`
      : undefined,
    cursor
      ? sql`(${conversas.ultima_mensagem_em}, ${conversas.id}) < (${cursor.em}, ${cursor.id})`
      : undefined,
  ];

  return leitor
    .select({
      id: conversas.id,
      contatoId: conversas.contato_id,
      contatoNome: contatos.nome,
      contatoTelefone: contatos.telefone,
      contatoAvatar: contatos.avatar_url,
      provedor: lojas_integracoes.provedor,
      contaRotulo: lojas_integracoes.rotulo,
      contaStatus: lojas_integracoes.status,
      lojaNome: lojas.nome,
      status: conversas.status,
      prioridade: conversas.prioridade,
      responsavelId: conversas.responsavel_id,
      responsavelNome: responsavel.nome,
      ultimaMensagemEm: conversas.ultima_mensagem_em,
      previa: conversas.ultima_mensagem_previa,
      naoLidas: conversas.nao_lidas,
      primeiraRespostaEm: conversas.primeira_resposta_em,
      slaEstouradoEm: conversas.sla_estourado_em,
    })
    .from(conversas)
    .innerJoin(contatos, eq(contatos.id, conversas.contato_id))
    .innerJoin(lojas_integracoes, eq(lojas_integracoes.id, conversas.integracao_id))
    .innerJoin(lojas, eq(lojas.id, conversas.loja_id))
    .leftJoin(responsavel, eq(responsavel.id, conversas.responsavel_id))
    .where(vivosE(conversas, ...condicoes))
    .orderBy(sql`${conversas.ultima_mensagem_em} desc nulls last`, desc(conversas.id))
    .limit(limite + 1);
}

export async function contarSemResposta(leitor: Leitor, escopo: EscopoLoja): Promise<number> {
  const [linha] = await leitor
    .select({ total: count() })
    .from(conversas)
    .where(
      vivosE(
        conversas,
        condicaoDeLoja(conversas, escopo),
        inArray(conversas.status, ["aberta", "pendente"]),
        isNull(conversas.primeira_resposta_em),
      ),
    );
  return Number(linha?.total ?? 0);
}

export async function lerConversa(leitor: Leitor, escopo: EscopoLoja, id: string) {
  const [linha] = await leitor
    .select({
      id: conversas.id,
      lojaId: conversas.loja_id,
      contatoId: conversas.contato_id,
      contatoNome: contatos.nome,
      contatoTelefone: contatos.telefone,
      contatoAvatar: contatos.avatar_url,
      whatsappId: contatos.whatsapp_id,
      instagramId: contatos.instagram_id,
      integracaoId: conversas.integracao_id,
      provedor: lojas_integracoes.provedor,
      contaRotulo: lojas_integracoes.rotulo,
      contaStatus: lojas_integracoes.status,
      contaAlteradaEm: lojas_integracoes.updated_at,
      status: conversas.status,
      prioridade: conversas.prioridade,
      responsavelId: conversas.responsavel_id,
      responsavelNome: responsavel.nome,
      naoLidas: conversas.nao_lidas,
      ultimaEntradaEm: conversas.ultima_entrada_em,
      primeiraRespostaEm: conversas.primeira_resposta_em,
      updatedAt: conversas.updated_at,
    })
    .from(conversas)
    .innerJoin(contatos, eq(contatos.id, conversas.contato_id))
    .innerJoin(lojas_integracoes, eq(lojas_integracoes.id, conversas.integracao_id))
    .leftJoin(responsavel, eq(responsavel.id, conversas.responsavel_id))
    .where(vivosE(conversas, eq(conversas.id, id), condicaoDeLoja(conversas, escopo)))
    .limit(1);
  return linha ?? null;
}

export type ConversaLida = NonNullable<Awaited<ReturnType<typeof lerConversa>>>;

export async function listarMensagens(
  leitor: Leitor,
  escopo: EscopoLoja,
  conversaId: string,
  cursor: Cursor | null,
  limite: number,
) {
  return leitor
    .select({
      id: conversas_mensagens.id,
      direcao: conversas_mensagens.direcao,
      autorTipo: conversas_mensagens.autor_tipo,
      autorUsuarioId: conversas_mensagens.autor_usuario_id,
      autorNome: usuarios.nome,
      conteudo: conversas_mensagens.conteudo,
      tipo: conversas_mensagens.tipo_conteudo,
      status: conversas_mensagens.status_entrega,
      falhaMotivo: conversas_mensagens.falha_motivo,
      notaInterna: conversas_mensagens.nota_interna,
      ocorridaEm: conversas_mensagens.ocorrida_em,
      metadados: conversas_mensagens.metadados,
    })
    .from(conversas_mensagens)
    .leftJoin(usuarios, eq(usuarios.id, conversas_mensagens.autor_usuario_id))
    .where(
      vivosE(
        conversas_mensagens,
        eq(conversas_mensagens.conversa_id, conversaId),
        condicaoDeLoja(conversas_mensagens, escopo),
        cursor
          ? sql`(${conversas_mensagens.ocorrida_em}, ${conversas_mensagens.id}) < (${cursor.em}, ${cursor.id})`
          : undefined,
      ),
    )
    .orderBy(desc(conversas_mensagens.ocorrida_em), desc(conversas_mensagens.id))
    .limit(limite + 1);
}

/** Projeção SEM `url_externa`: o endereço de leitura é derivado de `midia_id`. */
export async function listarMidiasDe(leitor: Leitor, escopo: EscopoLoja, mensagemIds: string[]) {
  if (mensagemIds.length === 0) return [];
  return leitor
    .select({
      id: conversas_mensagens_midias.id,
      mensagemId: conversas_mensagens_midias.mensagem_id,
      midiaId: conversas_mensagens_midias.midia_id,
      tipo: conversas_mensagens_midias.tipo_arquivo,
      mime: conversas_mensagens_midias.mime_type,
      legenda: conversas_mensagens_midias.legenda,
    })
    .from(conversas_mensagens_midias)
    .where(
      vivosE(
        conversas_mensagens_midias,
        inArray(conversas_mensagens_midias.mensagem_id, mensagemIds),
        condicaoDeLoja(conversas_mensagens_midias, escopo),
      ),
    )
    .orderBy(asc(conversas_mensagens_midias.created_at));
}

export async function lerContatoDoPainel(leitor: Leitor, escopo: EscopoLoja, contatoId: string, conversaId: string) {
  const [contato] = await leitor
    .select({
      id: contatos.id,
      nome: contatos.nome,
      telefone: contatos.telefone,
      email: contatos.email,
      optOut: contatos.opt_out,
      lojaNome: lojas.nome,
    })
    .from(contatos)
    .innerJoin(lojas, eq(lojas.id, contatos.loja_id))
    .where(vivosE(contatos, eq(contatos.id, contatoId), condicaoDeLoja(contatos, escopo)))
    .limit(1);
  if (!contato) return null;

  const [etiquetas, outras] = await Promise.all([
    leitor
      .select({ id: lojas_etiquetas.id, nome: lojas_etiquetas.nome, cor: lojas_etiquetas.cor })
      .from(contatos_etiquetas)
      .innerJoin(lojas_etiquetas, eq(lojas_etiquetas.id, contatos_etiquetas.etiqueta_id))
      .where(vivosE(contatos_etiquetas, eq(contatos_etiquetas.contato_id, contatoId), vivos(lojas_etiquetas)))
      .orderBy(asc(lojas_etiquetas.nome)),
    leitor
      .select({
        id: conversas.id,
        contaRotulo: lojas_integracoes.rotulo,
        status: conversas.status,
        ultimaMensagemEm: conversas.ultima_mensagem_em,
      })
      .from(conversas)
      .innerJoin(lojas_integracoes, eq(lojas_integracoes.id, conversas.integracao_id))
      .where(
        vivosE(
          conversas,
          eq(conversas.contato_id, contatoId),
          ne(conversas.id, conversaId),
          condicaoDeLoja(conversas, escopo),
        ),
      )
      .orderBy(desc(conversas.created_at))
      .limit(10),
  ]);
  return { ...contato, etiquetas, outras };
}

/** Colegas que atendem a loja: sem e-mail (`usuarios:listar_colegas`) e sem `viewer`. */
export async function listarColegas(leitor: Leitor, lojaId: string) {
  return leitor
    .select({ id: usuarios.id, nome: usuarios.nome, papel: usuarios.papel })
    .from(usuarios)
    .where(
      vivosE(
        usuarios,
        eq(usuarios.ativo, true),
        inArray(usuarios.papel, ["dono", "admin", "gerente", "vendedor"]),
        or(eq(usuarios.loja_id, lojaId), isNull(usuarios.loja_id)),
      ),
    )
    .orderBy(asc(usuarios.nome));
}

export async function colegaAtendeALoja(leitor: Leitor, usuarioId: string, lojaId: string): Promise<boolean> {
  const colegas = await leitor
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(
      vivosE(
        usuarios,
        eq(usuarios.id, usuarioId),
        eq(usuarios.ativo, true),
        inArray(usuarios.papel, ["dono", "admin", "gerente", "vendedor"]),
        or(eq(usuarios.loja_id, lojaId), isNull(usuarios.loja_id)),
      ),
    )
    .limit(1);
  return colegas.length > 0;
}

export async function listarModelosAprovados(leitor: Leitor, lojaId: string, integracaoId: string) {
  return leitor
    .select({
      id: lojas_integracoes_templates.id,
      nome: lojas_integracoes_templates.nome,
      idioma: lojas_integracoes_templates.idioma,
      corpo: lojas_integracoes_templates.corpo,
      variaveis: lojas_integracoes_templates.variaveis_contagem,
    })
    .from(lojas_integracoes_templates)
    .where(
      vivosE(
        lojas_integracoes_templates,
        eq(lojas_integracoes_templates.loja_id, lojaId),
        eq(lojas_integracoes_templates.integracao_id, integracaoId),
        eq(lojas_integracoes_templates.status, "aprovado"),
      ),
    )
    .orderBy(asc(lojas_integracoes_templates.nome));
}

/**
 * Eventos de sistema da linha do tempo ("Ana transferiu para Bia · 14:32")
 * saem da trilha de negócio — nenhuma linha extra é gravada para desenhá-los.
 */
export async function listarEventosDaConversa(leitor: Leitor, conversaId: string, desde: Date | null, ate: Date | null) {
  return leitor
    .select({
      id: auditoria_eventos.id,
      acao: auditoria_eventos.acao,
      criadoEm: auditoria_eventos.criado_em,
      depois: auditoria_eventos.depois,
      atorNome: usuarios.nome,
    })
    .from(auditoria_eventos)
    .leftJoin(usuarios, eq(usuarios.id, auditoria_eventos.ator_id))
    .where(
      and(
        eq(auditoria_eventos.entidade, "conversas"),
        eq(auditoria_eventos.entidade_id, conversaId),
        // `antes` nulo = criação da conversa (gravada com a ação provisória): não é evento de tela.
        isNotNull(auditoria_eventos.antes),
        inArray(auditoria_eventos.acao, [
          "conversa_resolvida",
          "conversa_reaberta",
          "conversa_transferida",
          "conversa_prioridade_alterada",
        ]),
        desde ? sql`${auditoria_eventos.criado_em} >= ${desde}` : undefined,
        ate ? sql`${auditoria_eventos.criado_em} <= ${ate}` : undefined,
      ),
    )
    .orderBy(asc(auditoria_eventos.criado_em))
    .limit(100);
}

export async function nomesDeUsuarios(leitor: Leitor, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const linhas = await leitor
    .select({ id: usuarios.id, nome: usuarios.nome })
    .from(usuarios)
    .where(inArray(usuarios.id, ids));
  return new Map(linhas.map((l) => [l.id, l.nome]));
}

/** Respostas rápidas ativas da loja (tabela do módulo de conteúdo, só leitura). */
export async function listarRespostasRapidas(leitor: Leitor, lojaId: string) {
  return leitor
    .select({
      id: respostas_rapidas.id,
      titulo: respostas_rapidas.titulo,
      conteudo: respostas_rapidas.conteudo,
      atalho: respostas_rapidas.atalho,
    })
    .from(respostas_rapidas)
    .where(vivosE(respostas_rapidas, eq(respostas_rapidas.loja_id, lojaId), eq(respostas_rapidas.ativa, true)))
    .orderBy(asc(respostas_rapidas.titulo))
    .limit(200);
}

/** Opções dos filtros da lista: contas de canal e etiquetas no escopo. */
export async function listarOpcoesDeFiltro(leitor: Leitor, escopo: EscopoLoja) {
  const [contas, etiquetas] = await Promise.all([
    leitor
      .select({ id: lojas_integracoes.id, rotulo: lojas_integracoes.rotulo, provedor: lojas_integracoes.provedor })
      .from(lojas_integracoes)
      .where(
        vivosE(
          lojas_integracoes,
          inArray(lojas_integracoes.provedor, ["whatsapp_oficial", "uazapi", "instagram"]),
          escopo.tipo === "uma" ? eq(lojas_integracoes.loja_id, escopo.lojaId) : escopo.tipo === "nenhuma" ? sql`false` : undefined,
        ),
      )
      .orderBy(asc(lojas_integracoes.rotulo)),
    leitor
      .select({ id: lojas_etiquetas.id, nome: lojas_etiquetas.nome })
      .from(lojas_etiquetas)
      .where(vivosE(lojas_etiquetas, condicaoDeLoja(lojas_etiquetas, escopo)))
      .orderBy(asc(lojas_etiquetas.nome)),
  ]);
  return { contas, etiquetas };
}
