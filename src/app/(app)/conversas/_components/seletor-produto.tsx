import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: M4, dentro da pasta de M1 (05-plano-construcao.md §5).
 *
 * Busca de produto por nome, SKU ou código, com a disponibilidade ao lado
 * (`src/lib/catalogo/disponibilidade.ts`). Usado pelo painel de venda e pelo
 * atalho de enviar produto na conversa.
 *
 * `onEscolher` devolve o SKU escolhido; quem monta o item de pedido é quem
 * chamou. O seletor não grava nada — assim a mesma busca serve a "mandar foto
 * do produto" e a "gerar pedido", que gravam coisas diferentes.
 */

export type SeletorProdutoProps = {
  onEscolher: (sku: string) => void;
};

export function SeletorProduto(props: SeletorProdutoProps): never {
  void props.onEscolher;
  throw naoImplementado("SeletorProduto (busca de produto na conversa, pacote M4)");
}
