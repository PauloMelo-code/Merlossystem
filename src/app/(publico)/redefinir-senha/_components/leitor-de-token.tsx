"use client";

import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { useTokenDoFragmento } from "../../_components/fragmento";
import { NovaSenha } from "./nova-senha";

/**
 * Raiz cliente de `/redefinir-senha` (04-ui.md §5.1 e §6.2).
 *
 * Mesma mecânica de `/primeiro-acesso`: o token vem do FRAGMENTO, a barra de
 * endereço é limpa com `history.replaceState` e o valor segue no CORPO do POST.
 * A página, no servidor, nunca recebe o token (U12).
 *
 * Três estados antes do formulário: lendo, sem token e com token.
 */
export function LeitorDeToken() {
  const { token, lido } = useTokenDoFragmento();

  if (!lido) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (!token) {
    return (
      <FaixaAviso
        tom="perigo"
        titulo="Este link não vale mais."
        descricao="Peça outro na tela de entrada e abra o mais recente que receber."
        acao={
          <Link href="/esqueci-a-senha" className="underline">
            Pedir um link novo
          </Link>
        }
      />
    );
  }

  return <NovaSenha token={token} />;
}
