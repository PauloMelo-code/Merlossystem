"use client";

import { useEffect, useMemo, useRef } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ACEITOS, conferirDeclarado, rotuloDeTamanho } from "@/lib/armazenamento/limites";

/**
 * Anexo do composer (04-ui.md §5.2): escolher (botão, colar ou arrastar),
 * ver a prévia com a legenda e só então enviar.
 *
 * O arquivo sobe para a NOSSA rota (`POST /api/midias`, portão e assinatura
 * dos bytes do M3) e a mensagem leva só o id da mídia guardada. Os tetos são
 * conferidos aqui para poupar a viagem; quem decide é o servidor.
 */

/** `null` = arquivo aceitável; senão, o motivo em texto. */
export function motivoDeRecusa(arquivo: File): string | null {
  const previa = conferirDeclarado(arquivo.type, arquivo.size);
  return "status" in previa ? previa.motivo : null;
}

export type Subida = { ok: true; id: string } | { ok: false; motivo: string };

function motivoDaResposta(xhr: XMLHttpRequest): string {
  try {
    const corpo = JSON.parse(xhr.responseText) as { mensagem?: string };
    if (corpo.mensagem) return corpo.mensagem;
  } catch {
    // corpo vazio ou não JSON: cai no genérico
  }
  if (xhr.status === 401) return "Sua sessão expirou. Entre de novo.";
  return "O anexo não foi enviado. Tente de novo.";
}

/** `XMLHttpRequest` pelo `upload.onprogress`: é o que dá a barra. */
export function subirAnexo(arquivo: File, lojaId: string, aoProgredir: (fracao: number) => void): Promise<Subida> {
  const params = new URLSearchParams({ pasta: "geral", loja: lojaId, nome: arquivo.name });
  return new Promise((resolver) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/midias?${params.toString()}`);
    xhr.setRequestHeader("Content-Type", arquivo.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) aoProgredir(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 300) return resolver({ ok: false, motivo: motivoDaResposta(xhr) });
      try {
        const { id } = JSON.parse(xhr.responseText) as { id?: string };
        resolver(id ? { ok: true, id } : { ok: false, motivo: "O anexo não foi enviado. Tente de novo." });
      } catch {
        resolver({ ok: false, motivo: "O anexo não foi enviado. Tente de novo." });
      }
    };
    xhr.onerror = () => resolver({ ok: false, motivo: "Sem conexão. Confira a internet e tente de novo." });
    xhr.send(arquivo);
  });
}

export function BotaoAnexar({ desabilitado, aoEscolher }: { desabilitado: boolean; aoEscolher: (arquivo: File) => void }) {
  const entrada = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button type="button" variant="ghost" size="sm" disabled={desabilitado} onClick={() => entrada.current?.click()}>
        <Paperclip aria-hidden="true" />
        Anexar
      </Button>
      <input
        ref={entrada}
        type="file"
        accept={ACEITOS}
        className="sr-only"
        tabIndex={-1}
        aria-label="Escolher arquivo para anexar"
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          e.target.value = "";
          if (arquivo) aoEscolher(arquivo);
        }}
      />
    </>
  );
}

export function PreviaDoAnexo({
  arquivo,
  progresso,
  aoRemover,
}: {
  arquivo: File;
  progresso: number | null;
  aoRemover: () => void;
}) {
  // jsdom e navegadores antigos não têm `createObjectURL`: fica só o nome.
  const url = useMemo(
    () => (arquivo.type.startsWith("image/") && typeof URL.createObjectURL === "function" ? URL.createObjectURL(arquivo) : null),
    [arquivo],
  );
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  return (
    <div className="mt-2 flex items-center gap-3 rounded-md border border-border bg-card p-2">
      {url ? (
        // Prévia local (blob:), antes de subir: não passa pelo otimizador.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Prévia do anexo" className="size-14 rounded object-cover" />
      ) : (
        <FileText aria-hidden="true" className="size-8 text-muted-foreground" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-denso">{arquivo.name}</span>
        <span className="text-legenda text-muted-foreground">{rotuloDeTamanho(arquivo.size)}</span>
        {progresso !== null ? <Progress value={progresso} aria-label="Enviando anexo" /> : null}
      </div>
      <Button type="button" variant="ghost" size="icon-sm" disabled={progresso !== null} onClick={aoRemover} aria-label="Remover anexo">
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
