import type { Contexto } from "@/lib/auth/guard";
import { pode } from "@/lib/auth/permissoes";
import type { EscopoLoja } from "@/lib/auth/loja";
import type { Transacao } from "@/lib/db/mutacoes";
import { ErroDeEscopo } from "@/lib/erros";
import {
  contarSemResposta,
  lerContatoDoPainel,
  lerConversa,
  listarColegas,
  listarConversas,
  listarEventosDaConversa,
  listarMensagens,
  listarMidiasDe,
  listarModelosAprovados,
  listarOpcoesDeFiltro,
  listarRespostasRapidas,
  nomesDeUsuarios,
  type FiltrosDaLista,
  type Leitor,
} from "./_consultas";
import {
  enderecoDaMidia,
  type AtendimentoAberto,
  type ContatoDoPainel,
  type ConversaDto,
  type ItemDaLista,
  type MensagemDto,
  type PaginaDeConversas,
  type PaginaDeMensagens,
} from "./dto";
import {
  avisoDoComposer,
  bloqueioDoComposer,
  codificarCursor,
  decodificarCursor,
  PAGINA_CONVERSAS,
  PAGINA_MENSAGENS,
} from "./regras";

/**
 * Montagem dos DTOs das telas (04-ui.md §5.2, §8.1). Projeção, nunca linha
 * crua; datas em ISO; mídia pelo endereço da rota interna.
 */

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export type { FiltrosDaLista };

export type OpcoesDeFiltro = {
  contas: { id: string; rotulo: string; provedor: string }[];
  etiquetas: { id: string; nome: string }[];
};

export function opcoesDeFiltro(leitor: Leitor, escopo: EscopoLoja): Promise<OpcoesDeFiltro> {
  return listarOpcoesDeFiltro(leitor, escopo);
}

export async function paginaDeConversas(
  leitor: Leitor,
  escopo: EscopoLoja,
  usuarioId: string,
  filtros: FiltrosDaLista,
  cursor: string | null,
): Promise<PaginaDeConversas> {
  const [linhas, semResposta] = await Promise.all([
    listarConversas(leitor, escopo, usuarioId, filtros, decodificarCursor(cursor), PAGINA_CONVERSAS),
    contarSemResposta(leitor, escopo),
  ]);
  const temMais = linhas.length > PAGINA_CONVERSAS;
  const pagina = linhas.slice(0, PAGINA_CONVERSAS);
  const ultima = pagina.at(-1);
  const itens: ItemDaLista[] = pagina.map((l) => ({
    id: l.id,
    contatoId: l.contatoId,
    contatoNome: l.contatoNome ?? l.contatoTelefone ?? "Contato sem nome",
    contatoAvatar: l.contatoAvatar,
    provedor: l.provedor,
    contaRotulo: l.contaRotulo,
    contaStatus: l.contaStatus,
    lojaNome: l.lojaNome,
    status: l.status,
    prioridade: l.prioridade,
    responsavelId: l.responsavelId,
    responsavelNome: l.responsavelNome,
    ultimaMensagemEm: iso(l.ultimaMensagemEm),
    previa: l.previa,
    naoLidas: l.naoLidas,
    semResposta: l.primeiraRespostaEm === null,
    slaEstouradoEm: iso(l.slaEstouradoEm),
  }));
  return {
    itens,
    semResposta,
    proximo:
      temMais && ultima?.ultimaMensagemEm
        ? codificarCursor({ em: ultima.ultimaMensagemEm, id: ultima.id })
        : null,
  };
}

export async function paginaDeMensagens(
  leitor: Leitor,
  escopo: EscopoLoja,
  conversaId: string,
  cursor: string | null,
): Promise<PaginaDeMensagens> {
  const antesDe = decodificarCursor(cursor);
  const linhas = await listarMensagens(leitor, escopo, conversaId, antesDe, PAGINA_MENSAGENS);
  const temMais = linhas.length > PAGINA_MENSAGENS;
  const pagina = linhas.slice(0, PAGINA_MENSAGENS).reverse(); // mais antiga primeiro
  const midias = await listarMidiasDe(leitor, escopo, pagina.map((m) => m.id));

  const mais = pagina[0];
  // Eventos do mesmo intervalo da página: da mensagem mais antiga (se houver
  // mais para trás) até o cursor (se esta não for a primeira página).
  const eventos = await listarEventosDaConversa(
    leitor,
    conversaId,
    temMais && mais ? mais.ocorridaEm : null,
    antesDe?.em ?? null,
  );
  const alvos = eventos
    .map((e) => (e.depois as Record<string, unknown> | null)?.responsavel_id)
    .filter((v): v is string => typeof v === "string");
  const nomes = await nomesDeUsuarios(leitor, [...new Set(alvos)]);

  const itens: MensagemDto[] = pagina.map((m) => {
    const meta = (m.metadados ?? {}) as Record<string, unknown>;
    const card = meta.card as MensagemDto["cartao"] | undefined;
    return {
      id: m.id,
      direcao: m.direcao,
      autorTipo: m.autorTipo,
      autorNome: m.autorNome,
      doAparelho: meta.enviada_pelo_aparelho === true,
      conteudo: m.conteudo,
      tipo: m.tipo,
      status: m.status,
      falhaMotivo: m.falhaMotivo,
      notaInterna: m.notaInterna,
      ocorridaEm: m.ocorridaEm.toISOString(),
      cartao: card && typeof card.id === "string" ? { tipo: card.tipo, id: card.id } : null,
      midias: midias
        .filter((x) => x.mensagemId === m.id)
        .map((x) => ({
          id: x.id,
          tipo: x.tipo,
          mime: x.mime,
          legenda: x.legenda,
          endereco: enderecoDaMidia(x.midiaId),
          miniatura: x.tipo === "imagem" ? enderecoDaMidia(x.midiaId, true) : null,
        })),
    };
  });

  // Eventos de sistema entram como mensagens `sistema` na mesma linha do tempo.
  for (const e of eventos) {
    itens.push({
      id: e.id,
      direcao: "saida",
      autorTipo: "sistema",
      autorNome: e.atorNome,
      doAparelho: false,
      conteudo: textoDoEvento(e.acao, e.atorNome, e.depois as Record<string, unknown> | null, nomes),
      tipo: "sistema",
      status: null,
      falhaMotivo: null,
      notaInterna: false,
      ocorridaEm: e.criadoEm.toISOString(),
      cartao: null,
      midias: [],
    });
  }
  itens.sort((a, b) => a.ocorridaEm.localeCompare(b.ocorridaEm));

  return {
    itens,
    anterior: temMais && mais ? codificarCursor({ em: mais.ocorridaEm, id: mais.id }) : null,
  };
}

const PRIORIDADE: Record<string, string> = { baixa: "baixa", media: "média", alta: "alta", urgente: "urgente" };

export function textoDoEvento(
  acao: string,
  ator: string | null,
  depois: Record<string, unknown> | null,
  nomes: Map<string, string>,
): string {
  const quem = ator ?? "O sistema";
  switch (acao) {
    case "conversa_transferida": {
      const alvo = depois?.responsavel_id;
      if (typeof alvo !== "string") return `${quem} deixou a conversa sem responsável`;
      return `${quem} transferiu para ${nomes.get(alvo) ?? "outra pessoa"}`;
    }
    case "conversa_resolvida":
      return depois?.status === "arquivada" ? `${quem} arquivou a conversa` : `${quem} resolveu a conversa`;
    case "conversa_reaberta":
      return `${quem} reabriu a conversa`;
    case "conversa_prioridade_alterada":
      return `${quem} mudou a prioridade para ${PRIORIDADE[String(depois?.prioridade)] ?? "outra"}`;
    default:
      return quem;
  }
}

export async function abrirAtendimento(leitor: Leitor, ctx: Contexto, conversaId: string): Promise<AtendimentoAberto> {
  const c = await lerConversa(leitor, ctx.escopo, conversaId);
  if (!c) throw new ErroDeEscopo();
  const papel = ctx.sessao.papel;

  const [mensagens, painel, colegas, modelos, respostas] = await Promise.all([
    paginaDeMensagens(leitor, ctx.escopo, c.id, null),
    lerContatoDoPainel(leitor, ctx.escopo, c.contatoId, c.id),
    listarColegas(leitor, c.lojaId),
    c.provedor === "whatsapp_oficial" ? listarModelosAprovados(leitor, c.lojaId, c.integracaoId) : Promise.resolve([]),
    listarRespostasRapidas(leitor, c.lojaId),
  ]);
  if (!painel) throw new ErroDeEscopo();

  const podeEscrever = pode(papel, "conversas", "escrever");
  const conversa: ConversaDto = {
    id: c.id,
    lojaId: c.lojaId,
    contatoId: c.contatoId,
    contatoNome: c.contatoNome ?? c.contatoTelefone ?? "Contato sem nome",
    contatoAvatar: c.contatoAvatar,
    integracaoId: c.integracaoId,
    provedor: c.provedor,
    contaRotulo: c.contaRotulo,
    contaStatus: c.contaStatus,
    status: c.status,
    prioridade: c.prioridade,
    responsavelId: c.responsavelId,
    responsavelNome: c.responsavelNome,
    naoLidas: c.naoLidas,
    updatedAt: c.updatedAt.toISOString(),
    bloqueio: bloqueioDoComposer({
      podeEscrever,
      provedor: c.provedor,
      statusConta: c.contaStatus,
      rotuloConta: c.contaRotulo,
      contaAlteradaEm: c.contaAlteradaEm,
      ultimaEntradaEm: c.ultimaEntradaEm,
      podeReconectar: pode(papel, "integracoes", "conectar"),
    }),
    aviso: podeEscrever ? avisoDoComposer(c.status, c.responsavelId !== null) : null,
    podeGerir: pode(papel, "conversas", "gerir"),
    limiteTexto: c.provedor === "instagram" ? 1000 : 4096,
  };

  const contato: ContatoDoPainel = {
    id: painel.id,
    nome: painel.nome,
    telefone: painel.telefone,
    email: painel.email,
    lojaNome: painel.lojaNome,
    optOut: painel.optOut,
    etiquetas: painel.etiquetas,
    outrasConversas: painel.outras.map((o) => ({ ...o, ultimaMensagemEm: iso(o.ultimaMensagemEm) })),
  };

  return { conversa, mensagens, contato, colegas, modelos, respostas };
}

/** Para a leitura dentro da transação de `executarAcao`. */
export type LeitorOuTx = Leitor | Transacao;
