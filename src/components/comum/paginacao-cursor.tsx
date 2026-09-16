"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Paginação SEMPRE por cursor (04-ui.md U5 e §8.1), nunca offset: a lista de
 * conversas e a trilha mudam durante a leitura, e offset pula e repete linha.
 *
 * O cursor vai para a URL; o servidor lê `searchParams` e busca já paginado.
 * `null` nos dois lados desabilita o botão correspondente — não existe
 * "página 1 de 37", porque o total não é barato.
 */

export const TAMANHOS_DE_PAGINA = [25, 50, 100] as const;

export function PaginacaoCursor({
  cursorAnterior,
  cursorProximo,
  porPagina = 50,
}: {
  cursorAnterior: string | null;
  cursorProximo: string | null;
  porPagina?: number;
}) {
  const router = useRouter();
  const caminho = usePathname();
  const parametros = useSearchParams();

  function ir(cursor: string | null, direcao: "anterior" | "proxima") {
    if (!cursor) return;
    const proximos = new URLSearchParams(parametros.toString());
    proximos.set("cursor", cursor);
    proximos.set("direcao", direcao);
    router.replace(`${caminho}?${proximos.toString()}`);
  }

  function trocarTamanho(valor: string) {
    const proximos = new URLSearchParams(parametros.toString());
    proximos.set("porPagina", valor);
    // Tamanho novo invalida o cursor atual: ele aponta para outra fatia.
    proximos.delete("cursor");
    proximos.delete("direcao");
    router.replace(`${caminho}?${proximos.toString()}`);
  }

  return (
    <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span id="por-pagina-rotulo" className="text-legenda text-texto-terciario">
          Por página
        </span>
        <Select value={String(porPagina)} onValueChange={trocarTamanho}>
          <SelectTrigger size="sm" aria-labelledby="por-pagina-rotulo" className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TAMANHOS_DE_PAGINA.map((tamanho) => (
              <SelectItem key={tamanho} value={String(tamanho)}>
                {tamanho}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!cursorAnterior}
          onClick={() => ir(cursorAnterior, "anterior")}
        >
          <ChevronLeft aria-hidden="true" strokeWidth={2} />
          Anterior
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!cursorProximo}
          onClick={() => ir(cursorProximo, "proxima")}
        >
          Próxima
          <ChevronRight aria-hidden="true" strokeWidth={2} />
        </Button>
      </div>
    </nav>
  );
}
