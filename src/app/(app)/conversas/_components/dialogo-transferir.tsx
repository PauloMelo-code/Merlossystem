"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { rotuloDePapel } from "@/lib/ui/tons";
import type { Papel } from "@/lib/db/schema/_enums/auth";
import type { ColegaDto } from "@/lib/conversas/dto";

/**
 * Transferir (04-ui.md §5.2): busca entre quem atende a loja, nome + papel
 * traduzido, e confirmação LEVE — nunca no `onChange`. É reversível: a tela
 * executa já e oferece "Desfazer".
 */
export function DialogoTransferir({
  aberto,
  colegas,
  responsavelAtual,
  aoFechar,
  aoConfirmar,
}: {
  aberto: boolean;
  colegas: readonly ColegaDto[];
  responsavelAtual: string | null;
  aoFechar: () => void;
  aoConfirmar: (responsavelId: string | null) => Promise<void>;
}) {
  const [escolhido, setEscolhido] = useState<ColegaDto | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    if (!escolhido) return;
    setEnviando(true);
    await aoConfirmar(escolhido.id);
    setEnviando(false);
    setEscolhido(null);
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!v) {
          setEscolhido(null);
          aoFechar();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transferir conversa</DialogTitle>
          <DialogDescription>Só aparecem pessoas que atendem esta loja.</DialogDescription>
        </DialogHeader>
        {escolhido ? (
          <p className="text-corpo">
            Transferir para <strong>{escolhido.nome}</strong> ({rotuloDePapel(escolhido.papel as Papel)})?
          </p>
        ) : (
          <Command className="rounded-md border border-border">
            <CommandInput placeholder="Buscar pelo nome" />
            <CommandList>
              <CommandEmpty>Ninguém com esse nome nesta loja.</CommandEmpty>
              {colegas
                .filter((c) => c.id !== responsavelAtual)
                .map((c) => (
                  <CommandItem key={c.id} value={`${c.nome} ${c.id}`} onSelect={() => setEscolhido(c)}>
                    <span className="flex-1">{c.nome}</span>
                    <span className="text-legenda text-muted-foreground">{rotuloDePapel(c.papel as Papel)}</span>
                  </CommandItem>
                ))}
            </CommandList>
          </Command>
        )}
        <DialogFooter>
          {escolhido ? (
            <>
              <Button type="button" variant="outline" onClick={() => setEscolhido(null)}>
                Voltar
              </Button>
              <Button type="button" disabled={enviando} onClick={() => void confirmar()}>
                {enviando ? "Transferindo…" : "Transferir"}
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={aoFechar}>
              Cancelar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
