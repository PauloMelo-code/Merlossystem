import { CAMPOS_PII } from "@/lib/db/schema/_enums/auditoria";

/**
 * Como a trilha APARECE na tela (04-ui.md §5.5). Módulo PURO.
 *
 * O gravador já não guarda valor de campo PII (`src/lib/auditoria/gravador.ts`).
 * Esta camada repete a máscara na saída, de propósito: linha gravada antes de
 * uma regra nova, ou por caminho que esqueceu o gravador, não vira vazamento na
 * tela. Defesa em profundidade custa um `Set`.
 */

export const ALTERADO = "(alterado)";

/** O mesmo filtro de segredo do gravador (01-dados.md §7.2). */
const SEGREDO = /senha|password|token|secret|credencia|authorization|apikey/i;

export type ValorExibido = string | number | boolean | null;
export type LinhaDeDiff = { campo: string; antes: ValorExibido | undefined; depois: ValorExibido | undefined };

type Diff = Record<string, unknown> | null | undefined;

function exibivel(valor: unknown): ValorExibido {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") {
    return valor;
  }
  // Objeto no diff é PII entrando pela porta lateral: nunca aparece inteiro.
  return ALTERADO;
}

/**
 * Diff campo a campo, com PII mascarada e segredo omitido. `entidade` é o
 * nome da tabela, como o gravador escreve.
 */
export function diffParaTela(entidade: string, antes: Diff, depois: Diff): LinhaDeDiff[] {
  const pii = new Set(CAMPOS_PII[entidade] ?? []);
  const campos = new Set([...Object.keys(antes ?? {}), ...Object.keys(depois ?? {})]);
  const linhas: LinhaDeDiff[] = [];
  for (const campo of [...campos].sort()) {
    if (SEGREDO.test(campo)) continue;
    const temAntes = antes != null && campo in antes;
    const temDepois = depois != null && campo in depois;
    if (pii.has(campo)) {
      linhas.push({
        campo,
        antes: temAntes ? ALTERADO : undefined,
        depois: temDepois ? ALTERADO : undefined,
      });
      continue;
    }
    linhas.push({
      campo,
      antes: temAntes ? exibivel(antes[campo]) : undefined,
      depois: temDepois ? exibivel(depois[campo]) : undefined,
    });
  }
  return linhas;
}

/** `detalhes` só leva escalar e nunca chave de segredo. */
export function detalhesParaTela(detalhes: Diff): Record<string, ValorExibido> {
  const saida: Record<string, ValorExibido> = {};
  for (const [chave, valor] of Object.entries(detalhes ?? {})) {
    if (SEGREDO.test(chave)) continue;
    saida[chave] = exibivel(valor);
  }
  return saida;
}

const ENTIDADES: Readonly<Record<string, string>> = {
  loja: "Loja",
  usuario: "Usuário",
  integracao: "Integração",
  conversa: "Conversa",
  mensagem: "Mensagem",
  midia: "Mídia",
  contato: "Contato",
  negocio: "Negócio",
  pedido: "Pedido",
  pagamento: "Pagamento",
  devolucao: "Devolução",
  campanha: "Campanha",
  template: "Modelo",
  produto: "Produto",
  lgpd: "LGPD",
  consentimento: "Consentimento",
};

const PALAVRAS: Readonly<Record<string, string>> = {
  masc: "no Masc",
  nota: "nota",
  interna: "interna",
  fila: "fila",
  voltou: "voltou para a",
  estagio: "estágio",
  papel: "papel",
  solicitacao: "solicitação",
  exportado: "dossiê exportado",
  anonimizado: "dados anonimizados",
  preco: "preço",
};

/**
 * `pedido_voltou_fila_masc` -> "Pedido: voltou para a fila no Masc". Gerado
 * da própria constante: ação nova ganha rótulo legível sem ninguém lembrar de
 * cadastrar.
 */
export function rotuloDaAcao(acao: string): string {
  const [entidade = "", ...resto] = acao.split("_");
  const sujeito = ENTIDADES[entidade] ?? entidade;
  const verbo = resto.map((p) => PALAVRAS[p] ?? p).join(" ");
  return verbo ? `${sujeito}: ${verbo}` : sujeito;
}

/** Nome da tabela como a pessoa entende. */
const TABELAS: Readonly<Record<string, string>> = {
  contatos: "Contatos",
  pedidos: "Pedidos",
  campanhas: "Campanhas",
  respostas_rapidas: "Respostas rápidas",
  conversas_agendamentos: "Mensagens agendadas",
  lojas_midias: "Galeria",
  lojas_etiquetas: "Etiquetas",
  lojas_integracoes: "Integrações",
  lojas: "Lojas",
  usuarios: "Usuários",
  conversas: "Conversas",
  conversas_mensagens: "Mensagens",
};

export function rotuloDaEntidade(tabela: string): string {
  return TABELAS[tabela] ?? tabela;
}
