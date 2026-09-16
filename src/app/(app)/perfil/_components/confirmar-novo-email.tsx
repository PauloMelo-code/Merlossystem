"use client";

import { useActionState, useEffect, useRef } from "react";
import { CircleCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Campo, idsDeApoio } from "@/components/comum/campo";
import { BotaoEnviar } from "@/components/comum/botao-enviar";
import { ResumoDeErros } from "@/components/comum/resumo-de-erros";
import { ModalReautenticacao } from "@/components/comum/modal-reautenticacao";
import { Tempo } from "@/components/comum/tempo";
import type { Resultado } from "@/lib/erros";
import { reautenticar } from "@/lib/actions/seguranca";
import { confirmarMeuNovoEmail } from "@/lib/actions/usuarios";
import { pediuProva, useReautenticacao } from "../seguranca/_components/usar-reautenticacao";

type Saida = Resultado<{ email: string }>;
const INICIAL: Saida = { ok: false, codigo: "", mensagem: "" };

async function enviar(_: Saida, formulario: FormData): Promise<Saida> {
  return confirmarMeuNovoEmail({ codigo: String(formulario.get("codigo") ?? "") });
}

/**
 * Segunda mão da troca de e-mail (02-seguranca.md §11.2, REQ-E12).
 *
 * O admin inicia; o código de 6 dígitos chega no endereço NOVO, com o link
 * `/perfil#codigo=NNNNNN`. O código vem no FRAGMENTO (não vai ao servidor nem
 * ao log de acesso) e é tirado da barra de endereço assim que o campo o lê.
 * A action exige sessão fresca: `SESSAO_NAO_FRESCA` abre a reautenticação e o
 * formulário é reenviado com o mesmo código.
 */
export function ConfirmarNovoEmail({ emailNovo, expiraEm }: { emailNovo: string; expiraEm: string }) {
  const formulario = useRef<HTMLFormElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const [estado, acao] = useActionState(enviar, INICIAL);
  const { aberto, exigirProva, confirmado, cancelar } = useReautenticacao();

  useEffect(() => {
    const achado = /(?:^#|&)codigo=(\d{6})/.exec(window.location.hash);
    if (!achado || !campo.current) return;
    campo.current.value = achado[1] ?? "";
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  useEffect(() => {
    if (pediuProva(estado)) exigirProva(() => formulario.current?.requestSubmit());
  }, [estado, exigirProva]);

  if (estado.ok) {
    return (
      <p role="status" className="flex items-center gap-1.5 text-denso text-sucesso">
        <CircleCheck aria-hidden="true" strokeWidth={2} className="size-4 shrink-0" />
        E-mail confirmado. A partir de agora os avisos vão para {estado.dados.email}.
      </p>
    );
  }

  const erros = estado.erros ?? {};
  const erroGeral = !pediuProva(estado) && estado.codigo !== "" && !estado.erros ? estado.mensagem : null;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-titulo-secao font-medium">Confirmar novo e-mail</h2>
        <p className="text-denso text-muted-foreground">
          Enviamos um código para {emailNovo}. Ele vale até <Tempo valor={expiraEm} formato="hora" />.
        </p>
      </div>

      <form ref={formulario} action={acao} className="flex max-w-md flex-col gap-4">
        <ResumoDeErros erros={erros} />
        <Campo
          nome="codigo"
          rotulo="Código de 6 dígitos"
          {...(erros["codigo"]?.[0] ? { erro: erros["codigo"][0] } : {})}
        >
          <Input
            ref={campo}
            id="codigo"
            name="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            aria-invalid={Boolean(erros["codigo"])}
            aria-describedby={idsDeApoio("codigo", { erro: erros["codigo"]?.[0] })}
            required
          />
        </Campo>
        {erroGeral ? (
          <p role="alert" className="text-denso text-perigo">
            {erroGeral}
          </p>
        ) : null}
        <div>
          <BotaoEnviar>Confirmar e-mail</BotaoEnviar>
        </div>
      </form>

      <ModalReautenticacao
        aberto={aberto}
        reautenticarComSenha={reautenticar}
        onConfirmado={confirmado}
        onCancelar={cancelar}
      />
    </section>
  );
}
