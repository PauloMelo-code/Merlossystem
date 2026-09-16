"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Campo, idsDeApoio } from "@/components/comum/campo";
import { editarMidia } from "@/lib/actions/midias";
import { PASTAS_MIDIA, type PastaMidia } from "@/lib/db/schema/_enums/catalogo";
import type { EtiquetaDaGaleria, MidiaDto } from "@/lib/midias/dto";
import { ROTULO_PASTA } from "./rotulos";

/**
 * Organizar a mídia (04-ui.md §5.4: "editar pasta/etiquetas"). Não é ação
 * crítica (fora de §9.1): salva direto e avisa por toast. Colisão ou erro fica
 * na tela, com o que a pessoa marcou. Salvou? Fecha: o `updated_at` que o
 * diálogo levou envelheceu.
 */
export function OrganizarMidia({
  midia,
  etiquetas,
  aoSalvar,
}: {
  midia: MidiaDto;
  /** Só as da loja da mídia. */
  etiquetas: readonly EtiquetaDaGaleria[];
  aoSalvar: () => void;
}) {
  const router = useRouter();
  const [pasta, setPasta] = useState<PastaMidia | null>(midia.pasta);
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set(midia.etiquetaIds));
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [erroPasta, setErroPasta] = useState<string | undefined>(undefined);
  const [salvando, iniciar] = useTransition();

  function alternar(id: string, marcada: boolean) {
    const proximas = new Set(marcadas);
    if (marcada) proximas.add(id);
    else proximas.delete(id);
    setMarcadas(proximas);
  }

  function salvar() {
    setErro(undefined);
    setErroPasta(undefined);
    iniciar(async () => {
      const r = await editarMidia({
        id: midia.id,
        updated_at: midia.updatedAt,
        loja: midia.lojaId,
        ...(pasta ? { pasta } : {}),
        etiquetaIds: [...marcadas],
      });
      if (!r.ok) {
        setErro(r.mensagem);
        setErroPasta(r.erros?.pasta?.[0]);
        return;
      }
      toast.success("Mídia atualizada.");
      aoSalvar();
      router.refresh();
    });
  }

  return (
    <section aria-label="Organizar mídia" className="flex flex-col gap-4 border-t border-border pt-4">
      {midia.origem === "upload" ? (
        <Campo nome="pasta" rotulo="Pasta" {...(erroPasta ? { erro: erroPasta } : {})}>
          <Select {...(pasta ? { value: pasta } : {})} onValueChange={(v) => setPasta(v as PastaMidia)}>
            <SelectTrigger
              id="pasta"
              className="w-full sm:w-60"
              aria-invalid={Boolean(erroPasta)}
              aria-describedby={idsDeApoio("pasta", { erro: erroPasta })}
            >
              <SelectValue placeholder="Escolha a pasta" />
            </SelectTrigger>
            <SelectContent>
              {PASTAS_MIDIA.map((p) => (
                <SelectItem key={p} value={p}>
                  {ROTULO_PASTA[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-denso font-medium">Etiquetas</legend>
        {etiquetas.length === 0 ? (
          <p className="text-denso text-muted-foreground">Nenhuma etiqueta nesta loja.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {etiquetas.map((e) => (
              <li key={e.id} className="flex items-center gap-2">
                <Checkbox
                  id={`etiqueta-${e.id}`}
                  checked={marcadas.has(e.id)}
                  onCheckedChange={(v) => alternar(e.id, v === true)}
                />
                <Label htmlFor={`etiqueta-${e.id}`} className="text-denso font-normal">
                  {e.nome}
                </Label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {erro ? (
        <p role="alert" className="text-legenda text-perigo">
          {erro}
        </p>
      ) : null}

      <Button type="button" className="self-start" onClick={salvar} disabled={salvando} aria-busy={salvando}>
        {salvando ? "Salvando…" : "Salvar organização"}
      </Button>
    </section>
  );
}
