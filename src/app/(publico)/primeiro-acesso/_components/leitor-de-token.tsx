"use client";

import { useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { useTokenDoFragmento } from "../../_components/fragmento";
import { DefinirSenha } from "./definir-senha";
import { CadastrarFator } from "./cadastrar-fator";

/**
 * Raiz cliente de `/primeiro-acesso` (04-ui.md §5.1 e §6.2).
 *
 * Lê o token do FRAGMENTO, limpa a barra de endereço e conduz os dois passos.
 * O nome do arquivo é o do inventário de §6.2: ler o token É a razão de este
 * componente existir do lado do cliente — a página, no servidor, nunca vê o
 * convite.
 *
 * A SENHA fica em memória entre os passos porque `/two-factor/enable` do Better
 * Auth exige a senha atual; pedir de novo trinta segundos depois de criá-la
 * seria atrito sem ganho. Ela nunca vai para `localStorage` nem sai desta aba.
 *
 * Quatro estados: lendo o convite, passo 1, passo 2 e concluído.
 */
export function LeitorDeToken({ retomando }: { retomando: boolean }) {
  const { token, lido } = useTokenDoFragmento();
  const [senha, setSenha] = useState("");
  const [passo, setPasso] = useState<"senha" | "fator" | "fim">(
    retomando ? "fator" : "senha",
  );

  if (!lido) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (passo === "fim") {
    return (
      <div role="status" className="flex flex-col gap-3">
        <p className="text-corpo text-sucesso">Cadastro concluído.</p>
        <p className="text-denso text-muted-foreground">
          Entre com o seu novo acesso. Por segurança, a sessão deste cadastro foi
          encerrada.
        </p>
        <Link href="/entrar" className="text-corpo underline">
          Ir para a tela de entrada
        </Link>
      </div>
    );
  }

  // Quem já consumiu o convite e voltou sem o link cai direto no passo 2: a
  // sessão provisória é a prova, e ela não alcança mais nada (§9.4).
  if (!token && !retomando) {
    return (
      <FaixaAviso
        tom="perigo"
        titulo="Este convite não vale mais."
        descricao="Peça um novo ao administrador e abra o link mais recente que receber."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex items-center gap-2 text-legenda text-muted-foreground">
        <li aria-current={passo === "senha" ? "step" : undefined}>
          <span className={passo === "senha" ? "font-semibold text-foreground" : ""}>
            1. Sua senha
          </span>
        </li>
        <li aria-hidden="true">·</li>
        <li aria-current={passo === "fator" ? "step" : undefined}>
          <span className={passo === "fator" ? "font-semibold text-foreground" : ""}>
            2. Confirmar que é você
          </span>
        </li>
      </ol>

      {passo === "senha" && token ? (
        <DefinirSenha
          token={token}
          senha={senha}
          aoMudarSenha={setSenha}
          aoConcluir={() => setPasso("fator")}
        />
      ) : (
        <CadastrarFator senha={senha} aoConcluir={() => setPasso("fim")} />
      )}
    </div>
  );
}
