import type { Metadata } from "next";
import { exigirSessao } from "@/lib/auth/guard";
import { CartaoAcesso } from "../_components/cartao-acesso";
import { LeitorDeToken } from "./_components/leitor-de-token";

export const metadata: Metadata = { title: "Primeiro acesso" };

/**
 * A pessoa já consumiu o convite e está com a SESSÃO PROVISÓRIA aberta, mas
 * ainda sem segundo fator.
 *
 * Sem esta conferência, fechar a aba no meio do passo 2 tranca a conta: o gate
 * de §9.4 só libera `/primeiro-acesso`, e `/primeiro-acesso` sem o token do
 * fragmento diria "este convite não vale mais". A pessoa ficaria sem nenhuma
 * rota alcançável.
 */
async function emProvisionamento(): Promise<boolean> {
  try {
    const sessao = await exigirSessao({ provisoria: true, renovaAtividade: false });
    return sessao.precisaConfigurarFator;
  } catch {
    return false;
  }
}

/**
 * `/primeiro-acesso` — SEM segmento `[token]` (U12, trava T27).
 *
 * A página NÃO consome nada: quem lê o fragmento, limpa a barra de endereço e
 * manda o token no corpo é o componente cliente. Um GET nesta rota — o que o
 * scanner de e-mail corporativo faz — não queima convite nenhum.
 *
 * São dois passos, e os dois são obrigatórios: a conta só fica ativa com um
 * segundo fator cadastrado (§9.2 item 7).
 */
export default async function PaginaPrimeiroAcesso() {
  const retomando = await emProvisionamento();

  return (
    <CartaoAcesso
      titulo="Bem-vinda ao sistema"
      descricao={
        retomando
          ? "Falta o segundo passo: cadastrar a forma de confirmar que é você."
          : "Dois passos: criar a sua senha e cadastrar a forma de confirmar que é você."
      }
    >
      <LeitorDeToken retomando={retomando} />
    </CartaoAcesso>
  );
}
