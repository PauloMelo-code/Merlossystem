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
import { rotaDaMidia, type EtiquetaDaGaleria, type MidiaDto } from "@/lib/midias/dto";
import { OrganizarMidia } from "./organizar-midia";
import { ROTULO_TIPO } from "./rotulos";

/**
 * Visualizador de mídia (04-ui.md §3: `dialog`). Tudo passa por
 * `/api/midias/[id]`; `<img>` puro, sem `next/image` (02-seguranca.md §15).
 * Com `midia:editar`, organiza pasta e etiquetas aqui mesmo.
 */
export function Visualizador({
  midia,
  etiquetas,
  podeEditar,
  aoFechar,
}: {
  midia: MidiaDto | null;
  etiquetas: readonly EtiquetaDaGaleria[];
  podeEditar: boolean;
  aoFechar: () => void;
}) {
  const titulo = midia?.nomeOriginal ?? (midia ? `${ROTULO_TIPO[midia.tipoArquivo]} sem nome` : "");
  const daLoja = midia ? etiquetas.filter((e) => e.lojaId === midia.lojaId) : [];
  const nomes = midia ? daLoja.filter((e) => midia.etiquetaIds.includes(e.id)).map((e) => e.nome) : [];
  return (
    <Dialog open={midia !== null} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="max-h-dvh max-w-3xl overflow-y-auto">
        {midia ? (
          <>
            <DialogHeader>
              <DialogTitle className="truncate">{titulo}</DialogTitle>
              <DialogDescription>
                {ROTULO_TIPO[midia.tipoArquivo]} · {rotuloDeTamanho(midia.tamanhoBytes)} · enviada em{" "}
                <Tempo valor={midia.criadaEm} />
              </DialogDescription>
            </DialogHeader>
            <div className="flex max-h-96 items-center justify-center overflow-hidden rounded-md bg-muted">
              {midia.tipoArquivo === "imagem" ? (
                // eslint-disable-next-line @next/next/no-img-element -- mídia privada não passa pelo otimizador (02-seguranca.md §15)
                <img
                  src={rotaDaMidia(midia.id)}
                  alt={titulo}
                  className="max-h-96 w-auto object-contain"
                />
              ) : midia.tipoArquivo === "video" ? (
                <video src={rotaDaMidia(midia.id)} controls className="max-h-96 w-full">
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
            {podeEditar ? (
              <OrganizarMidia key={midia.id} midia={midia} etiquetas={daLoja} aoSalvar={aoFechar} />
            ) : nomes.length > 0 ? (
              <p className="text-denso text-muted-foreground">Etiquetas: {nomes.join(", ")}</p>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
