"use client";

import { useActionState, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Campo } from "@/components/comum/campo";
import { BotaoEnviar } from "@/components/comum/botao-enviar";
import { ResumoDeErros } from "@/components/comum/resumo-de-erros";
import type { Resultado } from "@/lib/erros";
import { definirSenhaDoConvite } from "../../_acoes";
import { CampoSenha } from "../../_components/campo-senha";

const INICIAL: Resultado<null> = { ok: false, codigo: "", mensagem: "" };

/**
 * Passo 1 de `/primeiro-acesso`: nome e senha própria (02-seguranca.md §9.2).
 *
 * Quem define a senha é a pessoa — o administrador nunca escolhe senha de
 * ninguém (E8). O nome entra aqui porque o convite guarda só o e-mail e o
 * papel.
 */
export function DefinirSenha({
  token,
  senha,
  aoMudarSenha,
  aoConcluir,
}: {
  token: string;
  senha: string;
  aoMudarSenha: (valor: string) => void;
  aoConcluir: () => void;
}) {
  const [nome, setNome] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [estado, acao] = useActionState(definirSenhaDoConvite, INICIAL);

  useEffect(() => {
    if (estado.ok) aoConcluir();
  }, [estado, aoConcluir]);

  const erros = estado.ok ? {} : (estado.erros ?? {});
  const geral = !estado.ok && estado.mensagem && Object.keys(erros).length === 0
    ? estado.mensagem
    : "";

  return (
    <form action={acao} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />

      <ResumoDeErros erros={erros} />

      {geral ? (
        <p role="alert" className="text-corpo text-perigo">
          {geral}
        </p>
      ) : null}

      <Campo nome="nome" rotulo="Seu nome">
        <Input
          id="nome"
          name="nome"
          autoComplete="name"
          value={nome}
          onChange={(evento) => setNome(evento.target.value)}
          aria-invalid={Boolean(erros["nome"])}
          required
        />
      </Campo>

      <CampoSenha
        nome="senha"
        rotulo="Crie a sua senha"
        valor={senha}
        aoMudar={aoMudarSenha}
        contexto={{ nome }}
        {...(erros["senha"]?.[0] ? { erro: erros["senha"][0] } : {})}
      />
      <CampoSenha
        nome="confirmacao"
        rotulo="Repita a senha"
        valor={confirmacao}
        aoMudar={setConfirmacao}
        comRequisitos={false}
        {...(erros["confirmacao"]?.[0] ? { erro: erros["confirmacao"][0] } : {})}
      />

      <BotaoEnviar>Continuar</BotaoEnviar>
    </form>
  );
}
