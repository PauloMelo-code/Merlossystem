import type { Metadata } from "next";
import Link from "next/link";
import { emailDesligado } from "@/lib/auth/emails";
import { CartaoAcesso } from "../_components/cartao-acesso";
import { FormularioEsqueci } from "./_components/formulario-esqueci";
import { ORIENTACAO_SEM_EMAIL } from "./_components/textos";

export const metadata: Metadata = { title: "Esqueci a senha" };

/**
 * `/esqueci-a-senha` (04-ui.md §5.1, REQ-E1).
 *
 * A resposta é SEMPRE a mesma, exista ou não a conta — e o servidor garante
 * isso byte a byte e no tempo. A tela não tem estado de "e-mail não
 * encontrado"; ele seria o oráculo que a uniformidade fecha.
 *
 * Com o e-mail desligado (ADR 0062) a resposta do servidor continua a mesma;
 * a tela só deixa de prometer o link e orienta a recuperação assistida.
 */
export default function PaginaEsqueciASenha() {
  const semEmail = emailDesligado();
  return (
    <CartaoAcesso
      titulo="Esqueci a senha"
      descricao={
        semEmail
          ? ORIENTACAO_SEM_EMAIL
          : "Informe o seu e-mail. Se existir conta com ele, enviamos um link para você criar uma senha nova."
      }
      rodape={
        <p>
          <Link href="/entrar" className="underline">
            Voltar para entrar
          </Link>
        </p>
      }
    >
      <FormularioEsqueci emailDesligado={semEmail} />
    </CartaoAcesso>
  );
}
