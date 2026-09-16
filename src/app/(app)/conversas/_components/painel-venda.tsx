import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: M4, dentro da pasta de M1 (05-plano-construcao.md §5).
 *
 * Painel lateral da tela de conversa: produto, tamanho, disponibilidade e
 * "gerar pedido" sem sair do atendimento (04-ui.md §5.2). Mora aqui porque é
 * pedaço da tela de conversa, mas quem sabe o que é um produto é M4 — por isso
 * o arquivo nasce nesta pasta com a assinatura fechada e M4 preenche o corpo,
 * sem que nenhum pacote edite arquivo do outro.
 *
 * Servidor por padrão: os dados vêm por action, com o portão reaplicado.
 */

export type PainelVendaProps = {
  conversaId: string;
  lojaId: string;
  contatoId: string;
};

export function PainelVenda(props: PainelVendaProps): never {
  throw naoImplementado(`PainelVenda [conversa ${props.conversaId}] (pacote M4)`);
}
