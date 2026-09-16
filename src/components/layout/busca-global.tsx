"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { ICONES_NAV } from "./navegacao-lateral";
import type { ItemNav } from "@/lib/navegacao";

/**
 * Busca global `Ctrl/Cmd+K` (04-ui.md §4.3 e §8.2).
 *
 * ESCOPO HONESTO DO R1: o grupo "Páginas" sai do catálogo de `navegacao.ts` e
 * funciona hoje. Contatos, Pedidos e Produtos entram quando as consultas
 * existirem — enquanto não existirem, a caixa NÃO promete resultado que não
 * pode entregar (U8). Busca por conteúdo de mensagem está fora do R1: não há
 * índice de texto em `conversas_mensagens`, a maior tabela do sistema.
 *
 * O escopo é sempre escrito na tela ("Buscando em: Centro"), porque o mesmo
 * termo dá respostas diferentes em lojas diferentes.
 */
export function BuscaGlobal({
  itens,
  escopo,
}: {
  itens: readonly ItemNav[];
  /** Nome da loja em uso, ou "Todas as lojas". */
  escopo: string;
}) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);

  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key.toLowerCase() !== "k") return;
      if (!evento.metaKey && !evento.ctrlKey) return;
      evento.preventDefault();
      setAberta((antes) => !antes);
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, []);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setAberta(true)}
        aria-label="Buscar"
        aria-keyshortcuts="Control+K Meta+K"
        className="gap-2 text-muted-foreground"
      >
        <Search aria-hidden="true" strokeWidth={2} />
        <span className="hidden lg:inline">Buscar</span>
        <kbd className="hidden rounded-sm border border-border px-1 text-legenda lg:inline">
          Ctrl K
        </kbd>
      </Button>

      <CommandDialog
        open={aberta}
        onOpenChange={setAberta}
        title="Buscar"
        description={`Buscando em: ${escopo}`}
      >
        <CommandInput placeholder="Buscar páginas" />
        <CommandList>
          <CommandEmpty>Nenhum resultado em {escopo}.</CommandEmpty>
          <CommandGroup heading="Páginas">
            {itens.map((item) => {
              const Icone = ICONES_NAV[item.icone] ?? Search;
              return (
                <CommandItem
                  key={item.rota}
                  value={item.rotulo}
                  onSelect={() => {
                    setAberta(false);
                    router.push(item.rota);
                  }}
                >
                  <Icone aria-hidden="true" strokeWidth={2} />
                  {item.rotulo}
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
