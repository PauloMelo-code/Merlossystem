import { GESTAO, OPERACAO, TODOS, type MapaPermissao } from "./_papeis";

/**
 * Pedidos, catálogo, campanhas, modelos, respostas rápidas, agendamentos e
 * relatórios (02-seguranca.md §2.2).
 *
 * NÃO existe `produtos:criar|editar|excluir`: o catálogo é alimentado pelo job
 * `sincronizar-bling` e a tela `/produtos` é 100% leitura
 * (01-dados-dominio.md §4). Chave que ninguém usa é chave que um dia alguém
 * liga por engano.
 */
export const COMERCIAL: MapaPermissao = {
  "pedidos:ler": TODOS,
  "produtos:ler": TODOS,
  "campanhas:ler": TODOS,
  "modelos:ler": TODOS,
  "respostas:ler": TODOS,
  "agendamentos:ler": TODOS,
  "relatorios:ler": TODOS,

  "pedidos:criar": OPERACAO,
  "pedidos:editar": OPERACAO,
  "pedidos:lancar_masc": OPERACAO,
  "agendamentos:criar": OPERACAO,
  "agendamentos:editar": OPERACAO,
  /** Exceção escrita de INV-20: é cancelamento LÓGICO, não exclusão. */
  "agendamentos:cancelar": OPERACAO,
  "campanhas:editar": OPERACAO,
  "respostas:criar": OPERACAO,
  "respostas:editar": OPERACAO,
  "modelos:criar": OPERACAO,
  "modelos:editar": OPERACAO,

  /** Criar campanha já é decidir quem recebe: gerente para cima (05 §6 M6). */
  "campanhas:criar": GESTAO,
  /** Iniciar/retomar disparo — gasta janela de 24 h e reputação do número. */
  "campanhas:disparar": GESTAO,
  "modelos:enviar_aprovacao": GESTAO,
  /** Motivo obrigatório, trilha antes do efeito. */
  "pedidos:cancelar": GESTAO,
  "pedidos:dispensar_masc": GESTAO,
  "pedidos:excluir": GESTAO,
  "campanhas:excluir": GESTAO,
  "respostas:excluir": GESTAO,
  "modelos:excluir": GESTAO,
  /** `produtos.preco_custo` sai do DTO quando falso. */
  "produtos:ver_custo": GESTAO,
  "relatorios:exportar": GESTAO,

  /**
   * Lookbooks (R2-E1, ADR 0058). Todos veem; quem vende monta e edita;
   * excluir é da gestão. ENVIAR não é chave daqui: é `conversas:escrever`.
   */
  "conteudo:ler": TODOS,
  "conteudo:criar": OPERACAO,
  "conteudo:editar": OPERACAO,
  "conteudo:excluir": GESTAO,
};
