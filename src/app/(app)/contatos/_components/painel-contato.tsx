"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { FormularioContato, type ContatoEditavel } from "./formulario-contato";

/**
 * Abre o formulário de contato numa `sheet` (04-ui.md §5.3): "Novo contato" na
 * carteira, "Editar" na ficha. Ao salvar, fecha e recarrega os dados do
 * servidor — o sucesso já é visível, então o toast só aparece na criação.
 */
export interface PainelContatoProps {
  contato?: ContatoEditavel;
}

export function PainelContato({ contato }: PainelContatoProps) {
  const [aberto, setAberto] = useState(false);
  const router = useRouter();

  return (
    <Sheet open={aberto} onOpenChange={setAberto}>
      <SheetTrigger asChild>
        {contato ? (
          <Button type="button" variant="outline">
            <Pencil aria-hidden="true" strokeWidth={2} />
            Editar
          </Button>
        ) : (
          <Button type="button">
            <Plus aria-hidden="true" strokeWidth={2} />
            Novo contato
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{contato ? "Editar contato" : "Novo contato"}</SheetTitle>
          <SheetDescription>
            {contato
              ? "As alterações ficam registradas na trilha, sem o conteúdo dos dados pessoais."
              : "O contato nasce na loja escolhida no topo da tela."}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <FormularioContato
            {...(contato ? { contato } : {})}
            onConcluido={(saida) => {
              if (!saida.existeExcluido) setAberto(false);
              if (!contato) {
                toast.success("Contato cadastrado.", {
                  action: { label: "Abrir ficha", onClick: () => router.push(`/contatos/${saida.id}`) },
                });
              }
              router.refresh();
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
