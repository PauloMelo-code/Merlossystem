import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/comum/estado-vazio";

/**
 * Não encontrado (04-ui.md §4.1 e §10).
 *
 * Registro de OUTRA LOJA cai aqui também, e não em 403: confirmar que o
 * registro existe já entrega o que o escopo esconde. Por isso o texto não
 * distingue "não existe" de "não é sua".
 */
export default function NaoEncontradoDoAplicativo() {
  return (
    <div className="p-4 md:p-6">
      <EstadoVazio
        titulo="Não encontramos esta página."
        descricao="O endereço pode ter mudado, ou o registro não está disponível para você."
        acao={
          <Button asChild>
            <Link href="/conversas">Ir para Conversas</Link>
          </Button>
        }
      />
    </div>
  );
}
