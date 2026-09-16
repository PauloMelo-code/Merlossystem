"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PASTAS_MIDIA, type PastaMidia } from "@/lib/db/schema/_enums/catalogo";
import { ACEITOS, conferirDeclarado } from "@/lib/armazenamento/limites";
import { ROTULO_PASTA } from "./rotulos";

/**
 * Upload por botão ou arrastar (04-ui.md §5.4). Um `XMLHttpRequest` por
 * arquivo contra a NOSSA rota — é o `upload.onprogress` que dá a barra
 * (03-arquitetura.md §13.1). Nada de URL do bucket no navegador.
 *
 * Os tetos são conferidos aqui só para poupar a viagem; quem decide é o
 * servidor. Ao fim, UM toast diz quantos foram e, se algum falhou, qual e por quê.
 */

type Envio = { nome: string; progresso: number; erro?: string; feito?: boolean };

/** Resposta de erro da rota: `{ codigo, mensagem }`. */
function motivoDaResposta(xhr: XMLHttpRequest): string {
  try {
    const corpo = JSON.parse(xhr.responseText) as { mensagem?: string };
    if (corpo.mensagem) return corpo.mensagem;
  } catch {
    // corpo vazio ou não JSON: cai no genérico
  }
  if (xhr.status === 401) return "Sua sessão expirou. Entre de novo.";
  return "Não foi possível enviar. Tente de novo.";
}

export function enviarArquivo(
  arquivo: File,
  destino: string,
  aoProgredir: (fracao: number) => void,
): Promise<string | null> {
  return new Promise((resolver) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", destino);
    xhr.setRequestHeader("Content-Type", arquivo.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) aoProgredir(e.loaded / e.total);
    };
    xhr.onload = () => resolver(xhr.status < 300 ? null : motivoDaResposta(xhr));
    xhr.onerror = () => resolver("Sem conexão. Confira a internet e tente de novo.");
    xhr.send(arquivo);
  });
}

export function AreaUpload({ lojaId, pastaInicial }: { lojaId: string; pastaInicial: PastaMidia }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const idPasta = useId();
  const [pasta, setPasta] = useState<PastaMidia>(pastaInicial);
  const [arrastando, setArrastando] = useState(false);
  const [envios, setEnvios] = useState<Envio[]>([]);
  const ocupado = envios.some((e) => !e.feito);

  async function enviarTodos(lista: File[]) {
    if (lista.length === 0 || ocupado) return;
    setEnvios(lista.map((a) => ({ nome: a.name, progresso: 0 })));
    const atualizar = (i: number, mudanca: Partial<Envio>) =>
      setEnvios((atual) => atual.map((e, j) => (j === i ? { ...e, ...mudanca } : e)));

    const falhas: string[] = [];
    for (const [i, arquivo] of lista.entries()) {
      const previa = conferirDeclarado(arquivo.type, arquivo.size);
      let erro: string | null = "status" in previa ? previa.motivo : null;
      if (!erro) {
        const params = new URLSearchParams({ pasta, loja: lojaId, nome: arquivo.name });
        erro = await enviarArquivo(arquivo, `/api/midias?${params.toString()}`, (f) =>
          atualizar(i, { progresso: Math.round(f * 100) }),
        );
      }
      atualizar(i, { feito: true, progresso: 100, ...(erro ? { erro } : {}) });
      if (erro) falhas.push(`${arquivo.name}: ${erro}`);
    }

    const enviados = lista.length - falhas.length;
    if (falhas.length === 0) {
      toast.success(`${enviados} ${enviados === 1 ? "arquivo enviado" : "arquivos enviados"}.`);
    } else {
      toast.error(`${enviados} de ${lista.length} enviados. ${falhas.length} falharam.`, {
        description: falhas.join(" · "),
        duration: Infinity,
      });
    }
    router.refresh();
  }

  function soltar(evento: DragEvent<HTMLDivElement>) {
    evento.preventDefault();
    setArrastando(false);
    void enviarTodos([...evento.dataTransfer.files]);
  }

  return (
    <section aria-label="Enviar mídias" className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <fieldset className="flex flex-col gap-2">
        <legend id={idPasta} className="text-denso font-medium">
          Pasta de destino
        </legend>
        <RadioGroup
          aria-labelledby={idPasta}
          value={pasta}
          onValueChange={(v) => setPasta(v as PastaMidia)}
          className="flex flex-wrap gap-4"
        >
          {PASTAS_MIDIA.map((p) => (
            <div key={p} className="flex items-center gap-2">
              <RadioGroupItem id={`${idPasta}-${p}`} value={p} />
              <Label htmlFor={`${idPasta}-${p}`}>{ROTULO_PASTA[p]}</Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={soltar}
        className={cn(
          "flex flex-col items-center gap-3 rounded-md border-2 border-dashed px-4 py-8 text-center",
          arrastando ? "border-primary bg-muted" : "border-border",
        )}
      >
        <Upload aria-hidden="true" strokeWidth={2} className="size-6 text-muted-foreground" />
        <p className="text-corpo text-muted-foreground">
          Arraste os arquivos para cá. Imagem até 5 MB, vídeo e áudio até 16 MB, PDF e Office até 100 MB.
        </p>
        <Button type="button" onClick={() => !ocupado && entrada.current?.click()} aria-disabled={ocupado}>
          {ocupado ? "Enviando…" : "Escolher arquivos"}
        </Button>
        <input
          ref={entrada}
          type="file"
          multiple
          accept={ACEITOS}
          className="sr-only"
          tabIndex={-1}
          aria-label="Escolher arquivos"
          onChange={(e) => {
            void enviarTodos([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>

      {envios.length > 0 ? (
        <ul aria-label="Progresso do envio" className="flex flex-col gap-2">
          {envios.map((e, i) => (
            <li key={`${e.nome}-${String(i)}`} className="flex flex-col gap-1">
              <div className="flex justify-between gap-2 text-legenda">
                <span className="truncate">{e.nome}</span>
                <span className={e.erro ? "text-perigo" : "text-muted-foreground"}>
                  {e.erro ?? (e.feito ? "Enviado" : `${e.progresso}%`)}
                </span>
              </div>
              <Progress value={e.progresso} aria-label={`Envio de ${e.nome}`} className="h-1" />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
