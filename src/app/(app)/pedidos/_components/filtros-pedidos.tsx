"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STATUS_PEDIDO } from "@/lib/db/schema/_enums/pedidos";
import { tomDe } from "@/lib/ui/tons";

const OPCOES_MASC = [
  { valor: "fila", rotulo: "Falta lançar no Masc" },
  { valor: "lancado", rotulo: "Lançados" },
  { valor: "dispensado", rotulo: "Dispensados" },
  { valor: "todos", rotulo: "Todos" },
] as const;

const CLASSE_SELECT =
  "h-9 rounded-md border border-input bg-background px-3 text-denso focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Filtros da lista de pedidos, todos na URL (04-ui.md §8): voltar, recarregar
 * e abrir em nova aba continuam funcionando. Trocar filtro zera o cursor.
 */
export function FiltrosPedidos({ mascAtual }: { mascAtual: string }) {
  const router = useRouter();
  const caminho = usePathname();
  const parametros = useSearchParams();

  function aplicar(chave: string, valor: string) {
    const proximos = new URLSearchParams(parametros.toString());
    if (valor) proximos.set(chave, valor);
    else proximos.delete(chave);
    proximos.delete("cursor");
    proximos.delete("direcao");
    router.replace(`${caminho}?${proximos.toString()}`);
  }

  const temFiltro = ["status", "de", "ate", "q"].some((c) => parametros.has(c));

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-masc">Masc</Label>
        <select
          id="filtro-masc"
          className={CLASSE_SELECT}
          value={mascAtual}
          onChange={(e) => aplicar("masc", e.target.value)}
        >
          {OPCOES_MASC.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-status">Status</Label>
        <select
          id="filtro-status"
          className={CLASSE_SELECT}
          value={parametros.get("status") ?? ""}
          onChange={(e) => aplicar("status", e.target.value)}
        >
          <option value="">Todos</option>
          {STATUS_PEDIDO.map((s) => (
            <option key={s} value={s}>
              {tomDe("status_pedido", s)?.rotulo ?? s}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-de">De</Label>
        <Input
          id="filtro-de"
          type="date"
          className="h-9 w-40"
          defaultValue={parametros.get("de") ?? ""}
          onChange={(e) => aplicar("de", e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-ate">Até</Label>
        <Input
          id="filtro-ate"
          type="date"
          className="h-9 w-40"
          defaultValue={parametros.get("ate") ?? ""}
          onChange={(e) => aplicar("ate", e.target.value)}
        />
      </div>
      {temFiltro ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => router.replace(`${caminho}?masc=${mascAtual}`)}
        >
          Limpar filtros
        </Button>
      ) : null}
    </div>
  );
}
