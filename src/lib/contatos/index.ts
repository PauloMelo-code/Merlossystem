import "server-only";
import type { Contexto } from "@/lib/auth/guard";
import { ErroDeEscopo, ErroDeValidacao } from "@/lib/erros";
import {
  atualizarComTrava,
  excluirLogico,
  inserirAuditado,
  type Transacao,
} from "@/lib/db/mutacoes";
import { contatos, contatos_etiquetas } from "@/lib/db/schema/contatos";
import type {
  criarContatoSchema,
  editarContatoSchema,
  etiquetarEmMassaSchema,
  etiquetasDoContatoSchema,
  excluirContatoSchema,
  FiltrosContatos,
} from "@/lib/validadores/contatos";
import type { z } from "zod";
import {
  carteiraParaCsv,
  contatosDaLoja,
  conversasDoContato,
  etiquetasDaLoja,
  etiquetasDisponiveis,
  etiquetasDoContato,
  existeExcluidoComTelefone,
  lerContato,
  listarCarteira,
  pedidosDoContato,
  telefoneEmUso,
  vinculosExistentes,
} from "./_consultas";
import { montarCsv } from "./_regras";

/**
 * API pública do módulo de contatos (03-arquitetura.md §4.2): carteira por
 * loja, ficha, etiquetas e exclusão lógica. Consentimento, dossiê e
 * anonimização moram em `src/lib/lgpd`.
 *
 * `contatos.opt_out` NÃO é escrito aqui: o espelho só muda por
 * `registrarConsentimento()` (01-dados-dominio.md §7.2).
 */

export { normalizarTelefone } from "./telefone";
export { codificarCursor, decodificarCursor } from "./_regras";
export type { LinhaDaCarteira } from "./_consultas";

type DadosContato = z.output<typeof criarContatoSchema>;

/** A loja da escrita: `executarAcao` com `loja: "grava"` já garantiu uma só. */
function lojaDaEscrita(ctx: Contexto): string {
  if (ctx.escopo.tipo !== "uma") throw new ErroDeEscopo();
  return ctx.escopo.lojaId;
}

function colunas(dados: DadosContato) {
  return {
    nome: dados.nome ?? null,
    telefone: dados.telefone ?? null,
    email: dados.email ?? null,
    tamanho_preferido: dados.tamanhoPreferido ?? null,
    observacoes: dados.observacoes ?? null,
    aniversario: dados.aniversario ?? null,
    endereco: dados.endereco,
  };
}

const TELEFONE_EM_USO = "Já existe um contato com este telefone nesta loja.";

export async function buscarCarteira(tx: Transacao, ctx: Contexto, filtros: FiltrosContatos) {
  // Em sequência: a transação tem UMA conexão, e `Promise.all` só enfileiraria.
  const pagina = await listarCarteira(tx, ctx.escopo, filtros);
  const etiquetas = await etiquetasDisponiveis(tx, ctx.escopo);
  return { ...pagina, etiquetas, variasLojas: ctx.escopo.tipo === "todas" };
}

export async function exportarCsv(tx: Transacao, ctx: Contexto, filtros: FiltrosContatos) {
  const linhas = await carteiraParaCsv(tx, ctx.escopo, filtros);
  const csv = montarCsv(
    ["Nome", "Telefone", "E-mail", "Loja", "Não quer promoções", "Último contato", "Pedidos"],
    linhas.map((l) => [
      l.nome,
      l.telefone,
      l.email,
      l.lojaNome,
      l.optOut ? "sim" : "não",
      l.ultimoContatoEm,
      l.pedidosContagem,
    ]),
  );
  return { csv, quantidade: linhas.length };
}

/** Ficha do contato (04-ui.md §5.3). `null` = não existe NESTE escopo (404). */
export async function lerFicha(tx: Transacao, ctx: Contexto, id: string) {
  const linha = await lerContato(tx, ctx.escopo, id);
  if (!linha) return null;
  const { contato } = linha;
  const etiquetas = await etiquetasDoContato(tx, contato.loja_id, id);
  const disponiveis = await etiquetasDisponiveis(tx, { tipo: "uma", lojaId: contato.loja_id });
  const conversas = await conversasDoContato(tx, contato.loja_id, id);
  const pedidos = await pedidosDoContato(tx, contato.loja_id, id);
  return {
    contato: {
      id: contato.id,
      lojaId: contato.loja_id,
      lojaNome: linha.lojaNome,
      nome: contato.nome,
      telefone: contato.telefone,
      email: contato.email,
      whatsappId: contato.whatsapp_id,
      instagramId: contato.instagram_id,
      facebookId: contato.facebook_id,
      tiktokId: contato.tiktok_id,
      avatarUrl: contato.avatar_url,
      tamanhoPreferido: contato.tamanho_preferido,
      observacoes: contato.observacoes,
      aniversario: contato.aniversario,
      endereco: contato.endereco,
      ultimoContatoEm: contato.ultimo_contato_em,
      ultimaCompraEm: contato.ultima_compra_em,
      optOut: contato.opt_out,
      optOutEm: contato.opt_out_em,
      pedidosContagem: contato.pedidos_contagem,
      pedidosValorTotal: contato.pedidos_valor_total,
      anonimizadoEm: contato.anonimizado_em,
      atualizadoEm: contato.updated_at,
    },
    etiquetas: etiquetas.map(({ id: etiquetaId, nome, cor }) => ({ id: etiquetaId, nome, cor })),
    etiquetasDisponiveis: disponiveis,
    conversas,
    pedidos,
  };
}

export async function criarContato(tx: Transacao, ctx: Contexto, dados: DadosContato) {
  const lojaId = lojaDaEscrita(ctx);
  let existeExcluido = false;
  if (dados.telefone) {
    if (await telefoneEmUso(tx, lojaId, dados.telefone)) {
      throw new ErroDeValidacao({ telefone: [TELEFONE_EM_USO] });
    }
    existeExcluido = await existeExcluidoComTelefone(tx, lojaId, dados.telefone);
  }
  const linha = await inserirAuditado(
    tx,
    contatos,
    { loja_id: lojaId, ...colunas(dados) },
    ctx,
    "contato_criado",
  );
  return { id: String(linha.id), existeExcluido };
}

export async function editarContato(
  tx: Transacao,
  ctx: Contexto,
  dados: z.output<typeof editarContatoSchema>,
) {
  const lojaId = lojaDaEscrita(ctx);
  const atual = await lerContato(tx, ctx.escopo, dados.id);
  if (!atual) throw new ErroDeEscopo();
  if (atual.contato.anonimizado_em) {
    throw new ErroDeValidacao({ nome: ["Os dados deste contato foram eliminados a pedido do titular."] });
  }
  if (dados.telefone && (await telefoneEmUso(tx, lojaId, dados.telefone, dados.id))) {
    throw new ErroDeValidacao({ telefone: [TELEFONE_EM_USO] });
  }
  const linha = await atualizarComTrava(
    tx,
    contatos,
    { id: dados.id, escopo: ctx.escopo, updatedAtOriginal: dados.updatedAt, dados: colunas(dados) },
    ctx,
    "contato_alterado",
  );
  return { id: dados.id, atualizadoEm: linha.updated_at as Date };
}

export async function excluirContato(
  tx: Transacao,
  ctx: Contexto,
  dados: z.output<typeof excluirContatoSchema>,
) {
  lojaDaEscrita(ctx);
  await excluirLogico(
    tx,
    contatos,
    { id: dados.id, escopo: ctx.escopo, updatedAtOriginal: dados.updatedAt },
    ctx,
    "contato_excluido",
  );
  return { id: dados.id };
}

/**
 * Troca o conjunto de etiquetas de um contato. Ligação pura, sem trava de
 * colisão (01-dados-dominio.md §2.6): some o que saiu (exclusão lógica), nasce
 * o que entrou. As duas pontas vão para a trilha.
 */
export async function definirEtiquetas(
  tx: Transacao,
  ctx: Contexto,
  dados: z.output<typeof etiquetasDoContatoSchema>,
) {
  const lojaId = lojaDaEscrita(ctx);
  const [contato] = await contatosDaLoja(tx, lojaId, [dados.contatoId]);
  if (!contato) throw new ErroDeEscopo();

  const pedidas = new Set(dados.etiquetaIds);
  const validas = new Set(await etiquetasDaLoja(tx, lojaId, [...pedidas]));
  if (validas.size !== pedidas.size) throw new ErroDeEscopo("Etiqueta não encontrada.");

  const atuais = await etiquetasDoContato(tx, lojaId, dados.contatoId);
  const escopo = { tipo: "uma", lojaId } as const;
  for (const vinculo of atuais) {
    if (validas.has(vinculo.id)) continue;
    await excluirLogico(
      tx,
      contatos_etiquetas,
      { id: vinculo.vinculoId, escopo, updatedAtOriginal: vinculo.vinculoAtualizadoEm },
      ctx,
      "contato_etiqueta_alterada",
    );
  }
  const jaTem = new Set(atuais.map((v) => v.id));
  for (const etiquetaId of validas) {
    if (jaTem.has(etiquetaId)) continue;
    await inserirAuditado(
      tx,
      contatos_etiquetas,
      { loja_id: lojaId, contato_id: dados.contatoId, etiqueta_id: etiquetaId, origem: "manual" },
      ctx,
      "contato_etiqueta_alterada",
    );
  }
  return { contatoId: dados.contatoId, etiquetas: validas.size };
}

/** Seleção em massa: SÓ acrescenta uma etiqueta. Não remove, não exclui. */
export async function etiquetarEmMassa(
  tx: Transacao,
  ctx: Contexto,
  dados: z.output<typeof etiquetarEmMassaSchema>,
) {
  const lojaId = lojaDaEscrita(ctx);
  const [etiqueta] = await etiquetasDaLoja(tx, lojaId, [dados.etiquetaId]);
  if (!etiqueta) throw new ErroDeEscopo("Etiqueta não encontrada.");
  const pedidos = [...new Set(dados.contatoIds)];
  const validos = await contatosDaLoja(tx, lojaId, pedidos);
  if (validos.length !== pedidos.length) throw new ErroDeEscopo();

  const jaTem = new Set(await vinculosExistentes(tx, lojaId, etiqueta, validos));
  let criados = 0;
  for (const contatoId of validos) {
    if (jaTem.has(contatoId)) continue;
    await inserirAuditado(
      tx,
      contatos_etiquetas,
      { loja_id: lojaId, contato_id: contatoId, etiqueta_id: etiqueta, origem: "manual" },
      ctx,
      "contato_etiqueta_alterada",
    );
    criados += 1;
  }
  return { etiquetados: criados, jaTinham: jaTem.size };
}
