"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmarExclusao } from "@/components/comum/confirmar-exclusao";
import { Button } from "@/components/ui/button";
import { excluirContato } from "@/lib/actions/contatos";

/**
 * Excluir UM contato (04-ui.md §9.1, item 5): modal com block de 3 s e resumo
 * com o nome. A exclusão é lógica; conversas e pedidos continuam na trilha.
 * Não existe exclusão em massa (§15, R-03).
 */
export interface ExcluirContatoProps {
  contatoId: string;
  lojaId: string;
  nome: string;
  atualizadoEm: string;
}

export function ExcluirContato({ contatoId, lojaId, nome, atualizadoEm }: ExcluirContatoProps) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | undefined>();
  const [excluindo, iniciar] = useTransition();

  function confirmar() {
    iniciar(async () => {
      const r = await excluirContato({ id: contatoId, loja: lojaId, updatedAt: atualizadoEm });
      if (!r.ok) {
        setErro(r.mensagem);
        return;
      }
      setAberto(false);
      toast.success("Contato excluído.");
      router.push("/contatos");
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setErro(undefined);
          setAberto(true);
        }}
      >
        <Trash2 aria-hidden="true" strokeWidth={2} />
        Excluir
      </Button>
      <ConfirmarExclusao
        aberto={aberto}
        entidade={`o contato ${nome}`}
        descricao="Ele sai da carteira. As conversas e os pedidos continuam registrados."
        carregando={excluindo}
        {...(erro ? { erro } : {})}
        onConfirmar={confirmar}
        onCancelar={() => setAberto(false)}
      />
    </>
  );
}
