"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EstadoErro } from "@/components/comum/estado-erro";

/**
 * Fronteira de erro do segmento (04-ui.md §4.1 e §10).
 *
 * O `digest` aparece só como "Código para o suporte" — é o identificador que
 * o log do servidor também tem, e é o que faz o telefonema com o suporte
 * terminar rápido. Nenhuma mensagem de exceção chega à tela.
 */
export default function ErroDoAplicativo({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-4 md:p-6">
      <EstadoErro
        titulo="Não foi possível abrir esta página."
        descricao="A falha foi registrada. Você pode tentar de novo ou voltar para as conversas."
        {...(error.digest ? { codigoDeSuporte: error.digest } : {})}
        acao={
          <>
            <Button type="button" onClick={reset}>
              Tentar de novo
            </Button>
            <Button asChild variant="outline">
              <Link href="/conversas">Voltar para Conversas</Link>
            </Button>
          </>
        }
      />
    </div>
  );
}
