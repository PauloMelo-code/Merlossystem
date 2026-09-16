import { GESTAO, OPERACAO, TODOS, type MapaPermissao } from "./_papeis";

/**
 * IA assistiva e base de conhecimento (R2-C, ADRs 0046 e 0051).
 *
 * `ia:*` é de quem escreve na conversa: viewer só lê, e cada chamada custa
 * dinheiro. As actions de sugestão e transcrição exigem TAMBÉM
 * `conversas:escrever`. `conhecimento:*` é SEPARADO de `conteudo:*` (lookbooks)
 * porque o artigo vira resposta da IA para a loja inteira: escrever é de gerente
 * para cima. O painel de custo usa `configuracao:ler` (dono e admin).
 */
export const INTELIGENCIA: MapaPermissao = {
  "ia:sugerir": OPERACAO,
  "ia:resumir": OPERACAO,
  "ia:transcrever": OPERACAO,

  "conhecimento:ler": TODOS,
  "conhecimento:criar": GESTAO,
  "conhecimento:editar": GESTAO,
  "conhecimento:excluir": GESTAO,
};
