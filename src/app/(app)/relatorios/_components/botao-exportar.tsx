"use client";

import { useTransition } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportarRelatorioCsv } from "@/lib/actions/relatorios";

/** Exporta o MESMO período e a MESMA loja da tela (`relatorios:exportar`). */
export function BotaoExportar({ de, ate }: { de: string; ate: string }) {
  const [pendente, iniciar] = useTransition();

  function exportar() {
    iniciar(async () => {
      const resultado = await exportarRelatorioCsv({ de, ate });
      if (!resultado.ok) {
        toast.error(resultado.mensagem);
        return;
      }
      const blob = new Blob([resultado.dados.conteudo], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = resultado.dados.nomeArquivo;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <Button type="button" variant="outline" disabled={pendente} onClick={exportar}>
      <Download aria-hidden="true" strokeWidth={2} />
      {pendente ? "Gerando…" : "Exportar CSV"}
    </Button>
  );
}
