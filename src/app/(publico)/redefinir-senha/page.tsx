import type { Metadata } from "next";
import Link from "next/link";
import { CartaoAcesso } from "../_components/cartao-acesso";
import { LeitorDeToken } from "./_components/leitor-de-token";

export const metadata: Metadata = { title: "Criar uma senha nova" };

/**
 * `/redefinir-senha` — SEM segmento `[token]` (U12, trava T27).
 *
 * O servidor não recebe o token: ele vem no FRAGMENTO da URL, que não sai do
 * navegador, e o cliente o manda no corpo do POST. Token em caminho vaza em log
 * do Traefik, em `Referer` e no histórico, e é consumido por scanner de e-mail
 * corporativo com um GET (F12/G15).
 */
export default function PaginaRedefinirSenha() {
  return (
    <CartaoAcesso
      titulo="Criar uma senha nova"
      descricao="Escolha uma senha que você não use em outro lugar."
      rodape={
        <p>
          <Link href="/entrar" className="underline">
            Voltar para entrar
          </Link>
        </p>
      }
    >
      <LeitorDeToken />
    </CartaoAcesso>
  );
}
