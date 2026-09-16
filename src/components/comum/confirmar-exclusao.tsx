"use client";

import { ModalConfirmacaoBlock } from "./modal-confirmacao-block";

/**
 * Atalho sobre o modal block para o caso mais comum: excluir um registro
 * (item 5 da lista fechada de §9.1). Toda exclusão do sistema é LÓGICA — o
 * texto diz "excluir", o banco marca `is_deleted`.
 *
 * Existe para nenhuma tela reescrever o mesmo resumo com palavras diferentes,
 * e para `window.confirm` nunca voltar (§9: proibido).
 */
export function ConfirmarExclusao({
  aberto,
  entidade,
  descricao,
  carregando,
  erro,
  onConfirmar,
  onCancelar,
}: {
  aberto: boolean;
  /** O que some da lista, com nome próprio: "o contato Maria Silva". */
  entidade: string;
  /** Consequência concreta: "As conversas dela continuam na trilha." */
  descricao?: string;
  carregando?: boolean;
  erro?: string;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <ModalConfirmacaoBlock
      aberto={aberto}
      titulo="Excluir registro"
      resumo={`Você vai excluir ${entidade}.`}
      {...(descricao === undefined ? {} : { descricao })}
      textoConfirmar="Excluir"
      variante="destrutiva"
      {...(carregando === undefined ? {} : { carregando })}
      {...(erro === undefined ? {} : { erro })}
      onConfirmar={onConfirmar}
      onCancelar={onCancelar}
    />
  );
}
