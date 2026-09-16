import { TODOS, type MapaPermissao } from "./_papeis";

/**
 * A PRÓPRIA conta (02-seguranca.md §2.2 e §11.1, REQ-G1; ADR 0030).
 *
 * "Meu perfil" e "Meu perfil > Segurança" são alcançáveis por qualquer sessão
 * ativa — a matriz não tinha chave para isso, e `executarAcao` exige uma
 * (trava T1). Antes desta família, as actions da conta usavam `lojas:ler`, que
 * não descreve nada do que elas fazem: se um dia `viewer` perdesse a leitura
 * de lojas, perderia também o próprio "sair".
 *
 * `conta:gerir` é a única chave: nome, senha, fatores, sessões, sair e a loja
 * ativa do seletor. O ALVO nunca vem do pedido — é sempre `ctx.sessao` (T11) —,
 * por isso esta chave não alcança conta alheia, e a escrita do `viewer` aqui
 * não fere INV-19, que é sobre dado de NEGÓCIO.
 */
export const CONTA: MapaPermissao = {
  "conta:gerir": TODOS,
};
