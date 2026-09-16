"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { BotaoEnviar } from "@/components/comum/botao-enviar";
import { ResumoDeErros } from "@/components/comum/resumo-de-erros";
import type { Resultado } from "@/lib/erros";
import { redefinirSenha } from "../../_acoes";
import { CampoSenha } from "../../_components/campo-senha";

const INICIAL: Resultado<null> = { ok: false, codigo: "", mensagem: "" };

/**
 * Formulário da senha nova (04-ui.md §5.1 e §7.1).
 *
 * O formulário NUNCA é limpo: os motivos voltam por campo, com o vocabulário
 * de E10 — nada de "token", "inválido" ou "expirado". Senha fraca e link
 * queimado não podem ser confundidos.
 */
export function NovaSenha({ token }: { token: string }) {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [estado, acao] = useActionState(redefinirSenha, INICIAL);

  if (estado.ok) {
    return (
      <div role="status" className="flex flex-col gap-3">
        <p className="flex items-center gap-1.5 text-corpo text-sucesso">
          <CircleCheck aria-hidden="true" strokeWidth={2} className="size-4 shrink-0" />
          Senha alterada. As sessões abertas em outros aparelhos foram encerradas.
        </p>
        <Link href="/entrar" className="text-corpo underline">
          Entrar com a senha nova
        </Link>
      </div>
    );
  }

  const erros = estado.erros ?? {};

  return (
    <form action={acao} className="flex flex-col gap-4">
      {/* O token vem do fragmento e viaja no CORPO, nunca na URL (U12). */}
      <input type="hidden" name="token" value={token} />

      <ResumoDeErros erros={erros} />

      <CampoSenha
        nome="senha"
        rotulo="Nova senha"
        valor={senha}
        aoMudar={setSenha}
        {...(erros["senha"]?.[0] ? { erro: erros["senha"][0] } : {})}
      />
      <CampoSenha
        nome="confirmacao"
        rotulo="Repita a nova senha"
        valor={confirmacao}
        aoMudar={setConfirmacao}
        comRequisitos={false}
        {...(erros["confirmacao"]?.[0] ? { erro: erros["confirmacao"][0] } : {})}
      />

      <BotaoEnviar>Salvar a nova senha</BotaoEnviar>
    </form>
  );
}
