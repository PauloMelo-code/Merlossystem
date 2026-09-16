"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ModeloDto } from "@/lib/conversas/dto";

/**
 * Modelo aprovado (WhatsApp oficial) para quando a janela de 24 h fechou. A
 * quantidade de variáveis é a do modelo: o servidor recusa se divergir.
 */
export function EscolherModelo({
  aberto,
  modelos,
  aoFechar,
  aoEnviar,
}: {
  aberto: boolean;
  modelos: readonly ModeloDto[];
  aoFechar: () => void;
  aoEnviar: (modeloId: string, variaveis: string[]) => Promise<string | null>;
}) {
  const [modeloId, setModeloId] = useState("");
  const [variaveis, setVariaveis] = useState<string[]>([]);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const modelo = modelos.find((m) => m.id === modeloId);

  async function enviar() {
    if (!modelo) return;
    setEnviando(true);
    setErro("");
    const falha = await aoEnviar(modelo.id, variaveis.slice(0, modelo.variaveis));
    setEnviando(false);
    if (falha) setErro(falha);
    else aoFechar();
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? aoFechar() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Escolher modelo</DialogTitle>
          <DialogDescription>Só modelos aprovados pela Meta para este número.</DialogDescription>
        </DialogHeader>
        {modelos.length === 0 ? (
          <p className="text-denso text-muted-foreground">Este número não tem modelo aprovado. Fale com o gerente.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <Label htmlFor="modelo">Modelo</Label>
            <select
              id="modelo"
              value={modeloId}
              onChange={(e) => {
                setModeloId(e.target.value);
                setVariaveis([]);
              }}
              className="h-9 rounded-md border border-input bg-card px-2 text-corpo"
            >
              <option value="">Selecione…</option>
              {modelos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome} ({m.idioma})
                </option>
              ))}
            </select>
            {modelo ? (
              <>
                <p className="rounded-md bg-muted p-3 text-denso whitespace-pre-wrap">{modelo.corpo}</p>
                {Array.from({ length: modelo.variaveis }, (_, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <Label htmlFor={`variavel-${i}`}>{`Variável {{${i + 1}}}`}</Label>
                    <Input
                      id={`variavel-${i}`}
                      value={variaveis[i] ?? ""}
                      onChange={(e) =>
                        setVariaveis((v) => {
                          const nova = [...v];
                          nova[i] = e.target.value;
                          return nova;
                        })
                      }
                    />
                  </div>
                ))}
              </>
            ) : null}
            {erro ? <p role="alert" className="text-denso text-perigo">{erro}</p> : null}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!modelo || enviando || variaveis.slice(0, modelo.variaveis).filter((v) => v?.trim()).length < modelo.variaveis}
            onClick={() => void enviar()}
          >
            {enviando ? "Enviando…" : "Enviar modelo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
