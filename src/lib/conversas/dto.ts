import type { BloqueioDoComposer } from "./regras";

/**
 * DTOs do atendimento (03-arquitetura.md §14.2).
 *
 * O que sai para a tela é PROJEÇÃO, nunca a linha crua: nada de
 * `url_externa`, `chave_objeto`, `credenciais_cifradas` nem `chave_idempotencia`.
 * A mídia sai como ENDEREÇO DA ROTA INTERNA (`/api/midias/<id>`), derivado do
 * id — a URL do provedor é pública e contornaria o portão (trava
 * `tests/unidade/dto-midia.test.ts`).
 *
 * Datas saem como string ISO: atravessam a fronteira servidor → cliente sem
 * virar objeto diferente em cada lado.
 */

export type ItemDaLista = {
  id: string;
  contatoId: string;
  contatoNome: string;
  contatoAvatar: string | null;
  provedor: string;
  contaRotulo: string;
  contaStatus: string;
  lojaNome: string;
  status: string;
  prioridade: string;
  responsavelId: string | null;
  responsavelNome: string | null;
  ultimaMensagemEm: string | null;
  previa: string | null;
  naoLidas: number;
  semResposta: boolean;
  slaEstouradoEm: string | null;
};

export type PaginaDeConversas = {
  itens: ItemDaLista[];
  proximo: string | null;
  semResposta: number;
};

export type MidiaDaMensagem = {
  id: string;
  tipo: string;
  mime: string;
  legenda: string | null;
  /** `null` = mídia indisponível (download falhou ou ainda não aconteceu). */
  endereco: string | null;
  miniatura: string | null;
};

export type CartaoDaMensagem = { tipo: "produto" | "pedido" | "pagamento"; id: string };

export type MensagemDto = {
  id: string;
  direcao: string;
  autorTipo: string;
  autorNome: string | null;
  /** Saída que a vendedora mandou pelo próprio celular (uazapi, `deMim`). */
  doAparelho: boolean;
  conteudo: string | null;
  tipo: string;
  status: string | null;
  falhaMotivo: string | null;
  notaInterna: boolean;
  ocorridaEm: string;
  cartao: CartaoDaMensagem | null;
  midias: MidiaDaMensagem[];
};

export type PaginaDeMensagens = {
  itens: MensagemDto[];
  /** Cursor para as mais ANTIGAS. */
  anterior: string | null;
};

export type ColegaDto = { id: string; nome: string; papel: string };

export type RespostaRapidaDto = { id: string; titulo: string; conteudo: string; atalho: string | null };

export type ModeloDto = { id: string; nome: string; idioma: string; corpo: string; variaveis: number };

export type ContatoDoPainel = {
  id: string;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  lojaNome: string;
  optOut: boolean;
  etiquetas: { id: string; nome: string; cor: string | null }[];
  outrasConversas: { id: string; contaRotulo: string; status: string; ultimaMensagemEm: string | null }[];
};

export type ConversaDto = {
  id: string;
  lojaId: string;
  contatoId: string;
  contatoNome: string;
  contatoAvatar: string | null;
  integracaoId: string;
  provedor: string;
  contaRotulo: string;
  contaStatus: string;
  status: string;
  prioridade: string;
  responsavelId: string | null;
  responsavelNome: string | null;
  naoLidas: number;
  /** Trava de colisão: volta em toda ação de gestão (04-ui.md §7.4). */
  updatedAt: string;
  bloqueio: BloqueioDoComposer | null;
  aviso: string | null;
  podeGerir: boolean;
  limiteTexto: number;
  /** O número sobe anexo E a pessoa pode enviar mídia (`midia:enviar`). */
  aceitaAnexo: boolean;
};

export type AtendimentoAberto = {
  conversa: ConversaDto;
  mensagens: PaginaDeMensagens;
  contato: ContatoDoPainel;
  colegas: ColegaDto[];
  modelos: ModeloDto[];
  respostas: RespostaRapidaDto[];
};

/** O que a action de gestão devolve: o `updated_at` NOVO serve ao "Desfazer" (§7.5). */
export type ResultadoDeGestao = { conversaId: string; lojaId: string; updatedAt: string };

/** Endereço da única rota de leitura de binário (03-arquitetura.md §13.2). */
export function enderecoDaMidia(midiaId: string | null, miniatura = false): string | null {
  if (!midiaId) return null;
  return miniatura ? `/api/midias/${midiaId}?miniatura=1` : `/api/midias/${midiaId}`;
}
