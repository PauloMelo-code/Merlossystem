import type { Metadata } from "next";
import Link from "next/link";
import { CartaoAcesso } from "../_components/cartao-acesso";
import { FormularioEsqueci } from "./_components/formulario-esqueci";

export const metadata: Metadata = { title: "Esqueci a senha" };

/**
 * `/esqueci-a-senha` (04-ui.md §5.1, REQ-E1).
 *
 * A resposta é SEMPRE a mesma, exista ou não a conta — e o servidor garante
 * isso byte a byte e no tempo. A tela não tem estado de "e-mail não
 * encontrado"; ele seria o oráculo que a uniformidade fecha.
 */
export default function PaginaEsqueciASenha() {
  return (
    <CartaoAcesso
      titulo="Esqueci a senha"
      descricao="Informe o seu e-mail. Se existir conta com ele, enviamos um link para você criar uma senha nova."
      rodape={
        <p>
          <Link href="/entrar" className="underline">
            Voltar para entrar
          </Link>
        </p>
      }
    >
      <FormularioEsqueci />
    </CartaoAcesso>
  );
}
