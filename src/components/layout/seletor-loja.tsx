"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Store } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Contexto de loja no cabeçalho (04-ui.md §4.3).
 *
 * `dono`/`admin`/`gerente` escolhem; `vendedor`/`viewer` veem um CHIP FIXO com
 * o nome da loja — visível também no celular, onde o sistema antigo o escondia
 * e ninguém sabia em que loja estava lançando.
 *
 * A escolha vira cookie `loja_ativa` (HttpOnly, gravado por Server Action) e é
 * VALIDADA no servidor; a tela só chama `router.refresh()`, nunca
 * `window.location.reload()`, para não perder o que já está montado.
 */

export const TODAS_AS_LOJAS = "todas";

export type LojaResumo = { id: string; nome: string };

export function SeletorLoja({
  lojas,
  lojaAtiva,
  podeTrocar,
  gravarLojaAtiva,
  onAntesDeTrocar,
}: {
  lojas: readonly LojaResumo[];
  /** `null` = "Todas as lojas" (só existe para papel de gestão). */
  lojaAtiva: string | null;
  podeTrocar: boolean;
  gravarLojaAtiva: (lojaId: string) => Promise<void>;
  /**
   * Formulário alterado na tela: devolve `false` para cancelar a troca
   * ("Descartar alterações?"). Quem tem rascunho é quem sabe perguntar.
   */
  onAntesDeTrocar?: () => boolean;
}) {
  const router = useRouter();
  const [trocando, iniciarTroca] = useTransition();

  if (!podeTrocar) {
    const nome = lojas.find((l) => l.id === lojaAtiva)?.nome ?? "Sua loja";
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-denso text-secondary-foreground">
        <Store aria-hidden="true" strokeWidth={2} className="size-4" />
        <span className="max-w-32 truncate">{nome}</span>
      </span>
    );
  }

  function trocar(valor: string) {
    if (onAntesDeTrocar && !onAntesDeTrocar()) return;
    iniciarTroca(async () => {
      await gravarLojaAtiva(valor);
      router.refresh();
    });
  }

  return (
    <Select value={lojaAtiva ?? TODAS_AS_LOJAS} onValueChange={trocar} disabled={trocando}>
      <SelectTrigger size="sm" aria-label="Loja em uso" className="w-44">
        <Store aria-hidden="true" strokeWidth={2} className="size-4" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODAS_AS_LOJAS}>Todas as lojas</SelectItem>
        {lojas.map((loja) => (
          <SelectItem key={loja.id} value={loja.id}>
            {loja.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
