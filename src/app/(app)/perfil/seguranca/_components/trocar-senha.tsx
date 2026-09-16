"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CircleCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Campo, idsDeApoio } from "@/components/comum/campo";
import { BotaoEnviar } from "@/components/comum/botao-enviar";
import { ResumoDeErros } from "@/components/comum/resumo-de-erros";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { ModalReautenticacao } from "@/components/comum/modal-reautenticacao";
import { Tempo } from "@/components/comum/tempo";
import type { Resultado } from "@/lib/erros";
import { motivosDeSenha, MIN_SENHA } from "@/lib/auth/senha-regras";
import { reautenticar, trocarSenha } from "@/lib/actions/seguranca";
import { pediuProva, useReautenticacao } from "./usar-reautenticacao";

const INICIAL: Resultado<null> = { ok: false, codigo: "", mensagem: "" };

/**
 * Trocar a própria senha (02-seguranca.md §11.1).
 *
 * Exige a senha ATUAL, além do frescor da sessão. A política — tamanho,
 * sequência, contexto, vazamento público e histórico — roda no servidor, dentro
 * do `hooks.before` do Better Auth; os motivos determinísticos aparecem aqui ao
 * vivo, vindos do MESMO módulo (`senha-regras.ts`).
 *
 * Quando a sessão passou dos 15 minutos, a action devolve `SESSAO_NAO_FRESCA`,
 * o modal abre e o formulário é REENVIADO com os mesmos dados — os campos
 * continuam preenchidos, então `requestSubmit()` refaz exatamente a mesma
 * tentativa.
 */
export function TrocarSenha({
  alteradaEm,
  precisaTrocar,
}: {
  alteradaEm: string | null;
  precisaTrocar: boolean;
}) {
  const formulario = useRef<HTMLFormElement>(null);
  const [senha, setSenha] = useState("");
  const [estado, acao] = useActionState(trocarSenha, INICIAL);
  const { aberto, exigirProva, confirmado, cancelar } = useReautenticacao();

  useEffect(() => {
    if (pediuProva(estado)) exigirProva(() => formulario.current?.requestSubmit());
  }, [estado, exigirProva]);

  const erros = estado.ok ? {} : (estado.erros ?? {});
  const motivos = senha ? motivosDeSenha(senha) : [];

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-titulo-secao font-medium">Senha</h2>
        <p className="text-denso text-muted-foreground">
          {alteradaEm ? (
            <>
              Alterada pela última vez em <Tempo valor={alteradaEm} formato="data" />.
            </>
          ) : (
            "Ainda sem registro de troca nesta conta."
          )}
        </p>
      </div>

      {precisaTrocar ? (
        <FaixaAviso
          tom="aviso"
          titulo="Você precisa criar uma senha nova para continuar."
          descricao="Enquanto isso, esta é a única tela que a sua sessão alcança."
        />
      ) : null}

      <form ref={formulario} action={acao} className="flex max-w-md flex-col gap-4">
        <ResumoDeErros erros={erros} />

        <Campo
          nome="senhaAtual"
          rotulo="Senha atual"
          {...(erros["senhaAtual"]?.[0] ? { erro: erros["senhaAtual"][0] } : {})}
        >
          <Input
            id="senhaAtual"
            name="senhaAtual"
            type="password"
            autoComplete="current-password"
            aria-invalid={Boolean(erros["senhaAtual"])}
            aria-describedby={idsDeApoio("senhaAtual", { erro: erros["senhaAtual"]?.[0] })}
            required
          />
        </Campo>

        <Campo
          nome="senha"
          rotulo="Nova senha"
          ajuda={`Ao menos ${MIN_SENHA} caracteres. Uma frase de que você se lembre serve melhor do que trocar letra por símbolo.`}
          {...(erros["senha"]?.[0] ? { erro: erros["senha"][0] } : {})}
        >
          <Input
            id="senha"
            name="senha"
            type="password"
            autoComplete="new-password"
            value={senha}
            onChange={(evento) => setSenha(evento.target.value)}
            aria-invalid={Boolean(erros["senha"])}
            aria-describedby={idsDeApoio("senha", {
              ajuda: "sim",
              erro: erros["senha"]?.[0],
            })}
            required
          />
        </Campo>

        <div aria-live="polite" className="flex flex-col gap-1">
          {motivos.map((motivo) => (
            <p key={motivo} className="text-legenda text-muted-foreground">
              {motivo}
            </p>
          ))}
        </div>

        <Campo
          nome="confirmacao"
          rotulo="Repita a nova senha"
          {...(erros["confirmacao"]?.[0] ? { erro: erros["confirmacao"][0] } : {})}
        >
          <Input
            id="confirmacao"
            name="confirmacao"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(erros["confirmacao"])}
            required
          />
        </Campo>

        <div className="flex items-center gap-4">
          <BotaoEnviar>Salvar a nova senha</BotaoEnviar>
          {estado.ok ? (
            <p role="status" className="flex items-center gap-1.5 text-denso text-sucesso">
              <CircleCheck aria-hidden="true" strokeWidth={2} className="size-4 shrink-0" />
              Senha alterada. Os outros aparelhos foram desconectados.
            </p>
          ) : null}
        </div>
      </form>

      {/*
       * Só a prova por senha: a prova por passkey cria uma SESSÃO NOVA, e trocar
       * a sessão no meio de um formulário aberto perderia o que a pessoa
       * digitou. `ModalReautenticacao` não mostra o botão quando a prop falta.
       */}
      <ModalReautenticacao
        aberto={aberto}
        reautenticarComSenha={reautenticar}
        onConfirmado={confirmado}
        onCancelar={cancelar}
      />
    </section>
  );
}
