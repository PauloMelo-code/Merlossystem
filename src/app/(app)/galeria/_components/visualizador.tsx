"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tempo } from "@/components/comum/tempo";
import { rotuloDeTamanho } from "@/lib/armazenamento/limites";
import { rotaDaMidia, type MidiaDto } from "@/lib/midias/dto";
import { ROTULO_TIPO } from "./rotulos";

/**
 * Visualizador de mídia (04-ui.md §3: `dialog`). Tudo passa por
 * `/api/midias/[id]`; `<img>` puro, sem `next/image` (02-seguranca.md §15).
 */
export function Visualizador({ midia, aoFechar }: { midia: MidiaDto | null; aoFechar: () => void }) {
  const titulo = midia?.nomeOriginal ?? (midia ? `${ROTULO_TIPO[midia.tipoArquivo]} sem nome` : "");
  return (
    <Dialog open={midia !== null} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="max-w-3xl">
        {midia ? (
          <>
            <DialogHeader>
              <DialogTitle className="truncate">{titulo}</DialogTitle>
              <DialogDescription>
                {ROTULO_TIPO[midia.tipoArquivo]} · {rotuloDeTamanho(midia.tamanhoBytes)} · enviada em{" "}
                <Tempo valor={midia.criadaEm} />
              </DialogDescription>
            </DialogHeader>
            <div className="flex max-h-[70dvh] items-center justify-center overflow-hidden rounded-md bg-muted">
              {midia.tipoArquivo === "imagem" ? (
                // eslint-disable-next-line @next/next/no-img-element -- mídia privada não passa pelo otimizador (02-seguranca.md §15)
                <img
                  src={rotaDaMidia(midia.id)}
                  alt={titulo}
                  className="max-h-[70dvh] w-auto object-contain"
                />
              ) : midia.tipoArquivo === "video" ? (
                <video src={rotaDaMidia(midia.id)} controls className="max-h-[70dvh] w-full">
                  <track kind="captions" />
                </video>
              ) : midia.tipoArquivo === "audio" ? (
                <audio src={rotaDaMidia(midia.id)} controls className="w-full p-4" />
              ) : (
                <p className="p-8 text-corpo text-muted-foreground">
                  Documentos não abrem aqui. Baixe para ver.
                </p>
              )}
            </div>
            <Button asChild variant="outline" className="self-end">
              <a href={rotaDaMidia(midia.id)} download={midia.nomeOriginal ?? true}>
                <Download aria-hidden="true" strokeWidth={2} />
                Baixar
              </a>
            </Button>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
