import type { Metadata } from "next";
import Link from "next/link";
import { destinoSeguro } from "@/lib/seguranca/origem";
import { CartaoAcesso } from "../../_components/cartao-acesso";
import { FormularioTotp } from "./_components/formulario-totp";

export const metadata: Metadata = { title: "Confirmar o acesso" };

/**
 * `/entrar/verificar` — segundo fator, SÓ TOTP (04-ui.md §5.1, U13).
 *
 * Quem entra por passkey nunca chega aqui: a verificação do usuário no
 * aparelho já é o segundo fator (§9.1). Por isso a tela oferece o caminho de
 * volta em vez de um "reenviar código" que não existe.
 *
 * NÃO tem, e não pode ter: "Reenviar código", "Usar código de recuperação" e
 * OTP por e-mail. Os caminhos do Better Auth que fariam isso respondem 404 sem
 * corpo (G4/G5, S-07) e a trava T11 reprova a chamada.
 *
 * O estado do desafio é o cookie de 5 minutos do plugin; a página não o lê nem
 * o devolve para o cliente.
 */
export default async function PaginaVerificar({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const pedido = typeof parametros["volta"] === "string" ? parametros["volta"] : null;
  const destino = destinoSeguro(pedido?.split("?")[0] ?? null, "/conversas");

  return (
    <CartaoAcesso
      titulo="Confirme que é você"
      descricao="Abra o aplicativo autenticador e digite o código de 6 dígitos."
      rodape={
        <div className="flex flex-col gap-2">
          <p>
            <Link href="/entrar" className="underline">
              Entrar com passkey
            </Link>{" "}
            em vez do código.
          </p>
          <p>
            Perdeu o acesso ao aplicativo autenticador? Fale com o administrador — ele
            consegue liberar um novo cadastro para você.
          </p>
        </div>
      }
    >
      <FormularioTotp destino={destino} />
    </CartaoAcesso>
  );
}
