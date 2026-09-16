"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChipFiltro } from "@/components/comum/chip-filtro";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { aplicarFiltro } from "@/lib/validadores/contatos";

/**
 * Filtros da carteira (04-ui.md §5.3 e §8.1). O estado mora na URL e o servidor
 * busca já filtrado.
 *
 * "Todos" é um valor SÓ da tela: ao escolher, `aplicarFiltro(..., null)` APAGA o
 * parâmetro. `all` nunca vai para a URL nem para o servidor (bug histórico
 * `02/C-12`).
 */

const TODOS = "todos";

const OPT_OUT = [
  { valor: "nao", rotulo: "Aceita promoções" },
  { valor: "sim", rotulo: "Não quer promoções" },
] as const;

export interface FiltrosContatosProps {
  etiquetas: readonly { id: string; nome: string }[];
}

export function FiltrosContatos({ etiquetas }: FiltrosContatosProps) {
  const router = useRouter();
  const caminho = usePathname();
  const parametros = useSearchParams();

  const etiqueta = parametros.get("etiqueta");
  const optOut = parametros.get("optOut");
  const nomeDaEtiqueta = etiquetas.find((e) => e.id === etiqueta)?.nome;
  const rotuloOptOut = OPT_OUT.find((o) => o.valor === optOut)?.rotulo;

  function aplicar(chave: string, valor: string | null) {
    const proximos = aplicarFiltro(parametros, chave, valor === TODOS ? null : valor);
    const consulta = proximos.toString();
    router.replace(consulta ? `${caminho}?${consulta}` : caminho);
  }

  const algumFiltro = Boolean(nomeDaEtiqueta || rotuloOptOut);

  /**
   * A busca NÃO é limpa aqui: `BarraFerramentas` guarda o termo em estado local
   * e o devolveria à URL 250 ms depois. Quem limpa a busca é o próprio campo.
   */
  function limpar() {
    const semEtiqueta = aplicarFiltro(parametros, "etiqueta", null);
    const consulta = aplicarFiltro(semEtiqueta, "optOut", null).toString();
    router.replace(consulta ? `${caminho}?${consulta}` : caminho);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={nomeDaEtiqueta ? (etiqueta ?? TODOS) : TODOS} onValueChange={(v) => aplicar("etiqueta", v)}>
          <SelectTrigger size="sm" aria-label="Filtrar por etiqueta" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas as etiquetas</SelectItem>
            {etiquetas.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={rotuloOptOut ? (optOut ?? TODOS) : TODOS} onValueChange={(v) => aplicar("optOut", v)}>
          <SelectTrigger size="sm" aria-label="Filtrar por promoções" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos</SelectItem>
            {OPT_OUT.map((o) => (
              <SelectItem key={o.valor} value={o.valor}>
                {o.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {algumFiltro ? (
        <div className="flex flex-wrap items-center gap-2">
          {nomeDaEtiqueta ? (
            <ChipFiltro rotulo="Etiqueta" valor={nomeDaEtiqueta} onRemover={() => aplicar("etiqueta", null)} />
          ) : null}
          {rotuloOptOut ? (
            <ChipFiltro rotulo="Promoções" valor={rotuloOptOut} onRemover={() => aplicar("optOut", null)} />
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={limpar}>
            Limpar filtros
          </Button>
        </div>
      ) : null}
    </div>
  );
}
