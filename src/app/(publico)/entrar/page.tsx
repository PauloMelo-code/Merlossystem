import type { Metadata } from "next";
import Link from "next/link";
import { destinoSeguro } from "@/lib/seguranca/origem";
import { CartaoAcesso } from "../_components/cartao-acesso";
import { FormularioEntrar } from "./_components/formulario-entrar";

export const metadata: Metadata = { title: "Entrar" };

/** Rota canônica: para onde a pessoa vai quando não pediu página nenhuma. */
const DESTINO_PADRAO = "/conversas";

/**
 * `/entrar` (04-ui.md §5.1).
 *
 * O servidor não busca nada: a página é pública e o formulário fala direto com
 * `/api/auth/**`, onde mora a recusa única.
 *
 * `?volta=` é escrito por `src/proxy.ts` com o caminho RELATIVO da requisição e
 * passa por `destinoSeguro()` de novo aqui — a segunda passada é o que impede
 * `//evil.example` de virar destino (CVE-2025-53535, INV-40).
 */
export default async function PaginaEntrar({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const pedido = typeof parametros["volta"] === "string" ? parametros["volta"] : null;
  const destino = destinoSeguro(pedido?.split("?")[0] ?? null, DESTINO_PADRAO);
  const expirou = parametros["motivo"] === "sessao";

  return (
    <CartaoAcesso
      titulo="Entrar"
      descricao="Use a sua passkey ou, se preferir, o e-mail e a senha."
      rodape={
        <p>
          Esqueceu a senha?{" "}
          <Link href="/esqueci-a-senha" className="underline">
            Peça um link para criar outra
          </Link>
          .
        </p>
      }
    >
      <FormularioEntrar destino={destino} sessaoExpirada={expirou} />
    </CartaoAcesso>
  );
}
