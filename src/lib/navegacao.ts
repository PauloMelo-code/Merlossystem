import type { ChavePermissao } from "@/lib/auth/permissoes";

/**
 * Catálogo ÚNICO de navegação (04-ui.md §4.2). Não existe lista de itens
 * espalhada por componente: menu lateral, tab bar do celular e o grupo
 * "Páginas" da busca global leem este array.
 *
 * Mudar o corte do que aparece é editar `fase` numa linha — não cinco arquivos.
 *
 * Módulo PURO (sem `server-only`, sem I/O): a navegação renderiza no servidor
 * já filtrada por `pode()`, e a trava de inventário de rotas lê daqui.
 */

export const GRUPOS = ["Atendimento", "Vendas", "Comunicação", "Gestão", "Rodapé"] as const;
export type Grupo = (typeof GRUPOS)[number];

/** Contadores que a casca sabe buscar. Item sem contador não mostra número. */
export type Contador = "conversas_nao_lidas" | "masc_pendentes";

export type ItemNav = {
  rotulo: string;
  rota: string;
  /** Chave de `ICONES_NAV` (`src/components/layout/navegacao-lateral.tsx`), não o componente. */
  icone: string;
  grupo: Grupo;
  /**
   * Chave da matriz de `02-seguranca.md §2.2`; a UI chama `pode(papel, ...)`,
   * NUNCA `exigirPermissao()` — este último grava `recusa_403` na trilha e
   * inundaria `auth_eventos` a cada page view.
   *
   * `null` = alcançável por qualquer sessão ativa (REQ-G1): é o caso de
   * `/perfil`, que não tem chave.
   */
  permissao: ChavePermissao | null;
  /** Item `futura` não renderiza e não tem `page.tsx` (U8). */
  fase: "entregue" | "futura";
  contador?: Contador;
};

export const NAVEGACAO: readonly ItemNav[] = [
  // -- Atendimento ----------------------------------------------------------
  {
    rotulo: "Conversas",
    rota: "/conversas",
    icone: "conversas",
    grupo: "Atendimento",
    permissao: "conversas:ler",
    fase: "entregue",
    contador: "conversas_nao_lidas",
  },
  {
    rotulo: "Contatos",
    rota: "/contatos",
    icone: "contatos",
    grupo: "Atendimento",
    permissao: "contatos:ler",
    fase: "entregue",
  },
  {
    rotulo: "Funil",
    rota: "/funil",
    icone: "funil",
    grupo: "Atendimento",
    permissao: "negocios:ler",
    fase: "entregue",
  },

  // -- Vendas ---------------------------------------------------------------
  {
    rotulo: "Pedidos",
    rota: "/pedidos",
    icone: "pedidos",
    grupo: "Vendas",
    permissao: "pedidos:ler",
    fase: "entregue",
    contador: "masc_pendentes",
  },
  {
    rotulo: "Produtos",
    rota: "/produtos",
    icone: "produtos",
    grupo: "Vendas",
    permissao: "produtos:ler",
    fase: "entregue",
  },
  {
    rotulo: "Trocas e devoluções",
    rota: "/trocas",
    icone: "trocas",
    grupo: "Vendas",
    permissao: "devolucoes:ler",
    fase: "entregue",
  },

  // -- Comunicação ----------------------------------------------------------
  {
    rotulo: "Campanhas",
    rota: "/campanhas",
    icone: "campanhas",
    grupo: "Comunicação",
    permissao: "campanhas:ler",
    fase: "entregue",
  },
  {
    rotulo: "Modelos",
    rota: "/modelos",
    icone: "modelos",
    grupo: "Comunicação",
    permissao: "campanhas:ler",
    fase: "entregue",
  },
  {
    rotulo: "Respostas rápidas",
    rota: "/respostas-rapidas",
    icone: "respostas",
    grupo: "Comunicação",
    permissao: "conversas:ler",
    fase: "entregue",
  },
  {
    rotulo: "Lookbooks",
    rota: "/lookbooks",
    icone: "lookbooks",
    grupo: "Comunicação",
    permissao: "conteudo:ler",
    fase: "entregue",
  },
  {
    rotulo: "Agendadas",
    rota: "/agendadas",
    icone: "agendadas",
    grupo: "Comunicação",
    permissao: "conversas:ler",
    fase: "entregue",
  },
  {
    rotulo: "Galeria",
    rota: "/galeria",
    icone: "galeria",
    grupo: "Comunicação",
    permissao: "midia:ler",
    fase: "entregue",
  },

  // -- Gestão ---------------------------------------------------------------
  {
    rotulo: "Relatórios",
    rota: "/relatorios",
    icone: "relatorios",
    grupo: "Gestão",
    permissao: "relatorios:ler",
    fase: "entregue",
  },
  {
    rotulo: "Alertas",
    rota: "/alertas",
    icone: "alertas",
    grupo: "Gestão",
    permissao: "alertas:ler",
    fase: "entregue",
  },
  {
    rotulo: "Auditoria",
    rota: "/auditoria",
    icone: "auditoria",
    grupo: "Gestão",
    permissao: "trilha:ler",
    fase: "entregue",
  },
  {
    rotulo: "Satisfação",
    rota: "/satisfacao",
    icone: "satisfacao",
    grupo: "Gestão",
    permissao: "pesquisas:ler",
    fase: "entregue",
  },
  {
    rotulo: "Base de conhecimento",
    rota: "/base-de-conhecimento",
    icone: "conhecimento",
    grupo: "Gestão",
    permissao: "conhecimento:ler",
    fase: "entregue",
  },

  // -- Rodapé ---------------------------------------------------------------
  {
    rotulo: "Configurações",
    rota: "/configuracoes",
    icone: "configuracoes",
    grupo: "Rodapé",
    permissao: "configuracao:ler",
    fase: "entregue",
  },
  {
    rotulo: "Meu perfil",
    rota: "/perfil",
    icone: "perfil",
    grupo: "Rodapé",
    permissao: null,
    fase: "entregue",
  },
];

/** O que existe hoje. Item `futura` nunca renderiza e nunca vira link. */
export const NAVEGACAO_ENTREGUE: readonly ItemNav[] = NAVEGACAO.filter((i) => i.fase === "entregue");

/**
 * Itens do celular (§4.2): Conversas, Contatos, Pedidos e "Mais" (o resto vai
 * para o `sheet`). A lista vive aqui para a tab bar não ter catálogo próprio.
 */
export const ROTAS_DA_TAB_BAR = ["/conversas", "/contatos", "/pedidos"] as const;

/**
 * Filtra o catálogo pelo que o papel pode ver. Recebe `pode` por parâmetro
 * para este módulo continuar puro (o portão importa `server-only`).
 */
export function itensVisiveis(
  podeFn: (recurso: string, acao: string) => boolean,
): readonly ItemNav[] {
  return NAVEGACAO_ENTREGUE.filter((item) => {
    if (item.permissao === null) return true;
    const [recurso = "", acao = ""] = item.permissao.split(":", 2);
    return podeFn(recurso, acao);
  });
}

/** Item ativo: casa a rota exata ou um caminho abaixo dela (`/perfil/seguranca`). */
export function ehRotaAtiva(rotaDoItem: string, caminho: string): boolean {
  return caminho === rotaDoItem || caminho.startsWith(`${rotaDoItem}/`);
}

/** Agrupa preservando a ordem de `GRUPOS`, para o menu não inverter seções. */
export function porGrupo(
  itens: readonly ItemNav[],
): readonly { grupo: Grupo; itens: readonly ItemNav[] }[] {
  return GRUPOS.map((grupo) => ({
    grupo,
    itens: itens.filter((i) => i.grupo === grupo),
  })).filter((g) => g.itens.length > 0);
}
