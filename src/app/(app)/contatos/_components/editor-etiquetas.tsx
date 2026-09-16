"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Tags } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { definirEtiquetasDoContato } from "@/lib/actions/contatos";

/**
 * Etiquetas do contato (04-ui.md §5.3: "etiquetar (`command`)"). Etiquetar é
 * reversível e interno: grava na hora, sem block. As etiquetas vêm do catálogo
 * da LOJA do contato — criar etiqueta nova é da configuração da loja.
 */

type Etiqueta = { id: string; nome: string; cor: string | null };

export interface EditorEtiquetasProps {
  contatoId: string;
  lojaId: string;
  etiquetas: readonly Etiqueta[];
  disponiveis: readonly Etiqueta[];
  podeEditar: boolean;
}

export function EditorEtiquetas({ contatoId, lojaId, etiquetas, disponiveis, podeEditar }: EditorEtiquetasProps) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set(etiquetas.map((e) => e.id)));
  const [salvando, iniciar] = useTransition();

  function salvar(proximas: ReadonlySet<string>) {
    const anteriores = marcadas;
    setMarcadas(proximas);
    iniciar(async () => {
      const r = await definirEtiquetasDoContato({ contatoId, loja: lojaId, etiquetaIds: [...proximas] });
      if (!r.ok) {
        setMarcadas(anteriores);
        toast.error(r.mensagem);
        return;
      }
      router.refresh();
    });
  }

  function alternar(id: string) {
    const proximas = new Set(marcadas);
    if (proximas.has(id)) proximas.delete(id);
    else proximas.add(id);
    salvar(proximas);
  }

  const visiveis = disponiveis.filter((e) => marcadas.has(e.id));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {visiveis.length === 0 ? (
        <span className="text-denso text-muted-foreground">Sem etiquetas.</span>
      ) : (
        visiveis.map((e) => (
          <Badge key={e.id} variant="secondary">
            {e.cor ? <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: e.cor }} /> : null}
            {e.nome}
          </Badge>
        ))
      )}

      {podeEditar ? (
        <Popover open={aberto} onOpenChange={setAberto}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" aria-busy={salvando}>
              <Tags aria-hidden="true" strokeWidth={2} />
              Etiquetar
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <Command>
              <CommandInput placeholder="Buscar etiqueta" />
              <CommandList>
                <CommandEmpty>Nenhuma etiqueta nesta loja.</CommandEmpty>
                <CommandGroup>
                  {disponiveis.map((e) => (
                    <CommandItem key={e.id} value={e.nome} onSelect={() => alternar(e.id)}>
                      <Check
                        aria-hidden="true"
                        strokeWidth={2}
                        className={marcadas.has(e.id) ? "opacity-100" : "opacity-0"}
                      />
                      {e.nome}
                      <span className="sr-only">{marcadas.has(e.id) ? "(marcada)" : ""}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
