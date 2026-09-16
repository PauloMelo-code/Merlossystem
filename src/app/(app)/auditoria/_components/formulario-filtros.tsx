import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Filtros das telas de gestão (`/alertas`, `/relatorios` e as abas de
 * `/auditoria`) como `<form method="get">` NATIVO: o estado mora na URL (04-ui.md
 * §8), o voltar do navegador funciona, e nada depende de JavaScript.
 *
 * Trocar filtro sempre volta à primeira página: o cursor não entra no form.
 */

export type Opcao = { valor: string; rotulo: string };

export type CampoFiltro =
  | { tipo: "lista"; nome: string; rotulo: string; opcoes: readonly Opcao[]; valor?: string | undefined; vazio: string }
  | { tipo: "data"; nome: string; rotulo: string; valor?: string | undefined }
  | { tipo: "oculto"; nome: string; valor?: string | undefined };

const CLASSE_LISTA =
  "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-corpo shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30";

export function FormularioFiltros({
  destino,
  campos,
  rotuloBotao = "Filtrar",
}: {
  destino: string;
  campos: readonly CampoFiltro[];
  rotuloBotao?: string;
}) {
  return (
    <form
      method="get"
      action={destino}
      role="search"
      aria-label="Filtros"
      className="flex flex-wrap items-end gap-3"
    >
      {campos.map((campo) => {
        const id = `filtro-${campo.nome}`;
        if (campo.tipo === "oculto") {
          return campo.valor ? (
            <input key={campo.nome} type="hidden" name={campo.nome} value={campo.valor} />
          ) : null;
        }
        return (
          <div key={campo.nome} className="flex min-w-40 flex-col gap-1.5">
            <Label htmlFor={id} className="text-denso font-medium">
              {campo.rotulo}
            </Label>
            {campo.tipo === "lista" ? (
              <select id={id} name={campo.nome} defaultValue={campo.valor ?? ""} className={CLASSE_LISTA}>
                <option value="">{campo.vazio}</option>
                {campo.opcoes.map((opcao) => (
                  <option key={opcao.valor} value={opcao.valor}>
                    {opcao.rotulo}
                  </option>
                ))}
              </select>
            ) : (
              <Input id={id} type="date" name={campo.nome} defaultValue={campo.valor ?? ""} />
            )}
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        <Button type="submit">{rotuloBotao}</Button>
        <Button asChild variant="ghost">
          <Link href={destino}>Limpar filtros</Link>
        </Button>
      </div>
    </form>
  );
}
