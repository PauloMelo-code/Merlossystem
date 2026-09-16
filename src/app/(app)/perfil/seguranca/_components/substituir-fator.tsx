"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, Loader2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Campo } from "@/components/comum/campo";
import { BotaoEnviar } from "@/components/comum/botao-enviar";
import { Copiar } from "@/components/comum/copiar";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { ModalConfirmacaoBlock } from "@/components/comum/modal-confirmacao-block";
import { ModalReautenticacao } from "@/components/comum/modal-reautenticacao";
import type { Resultado } from "@/lib/erros";
import {
  confirmarCadastroDePasskey,
  confirmarCadastroDeTotp,
  iniciarCadastroDePasskey,
  iniciarCadastroDeTotp,
  reautenticar,
} from "@/lib/actions/seguranca";
import { pediuProva, useReautenticacao } from "./usar-reautenticacao";

const INICIAL_URI: Resultado<{ uri: string }> = { ok: false, codigo: "", mensagem: "" };
const INICIAL_FIM: Resultado<null> = { ok: false, codigo: "", mensagem: "" };

/**
 * Segundo fator: cadastrar e SUBSTITUIR (02-seguranca.md §9.3, 04-ui.md §5.1).
 *
 * Não existe "desligar o segundo fator" nem "remover o último": a única porta é
 * substituir, e trocar o aplicativo autenticador só é oferecido a quem já tem
 * passkey — assim a conta nunca fica sem prova nenhuma no meio do caminho. A
 * recusa final é do servidor, não desta tela.
 *
 * SUBSTITUIR passa pelo bloqueio de 3 s (§9.1, item 18): a chave antiga para de
 * valer no instante em que a nova é gerada.
 */
export function SubstituirFator({
  totpAtivo,
  temPasskey,
}: {
  totpAtivo: boolean;
  temPasskey: boolean;
}) {
  const [abrindo, setAbrindo] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const podeSubstituirTotp = totpAtivo && temPasskey;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-titulo-secao font-medium">Segundo fator</h2>
        <p className="text-denso text-muted-foreground">
          {totpAtivo
            ? "Aplicativo autenticador cadastrado."
            : "Nenhum aplicativo autenticador cadastrado."}
          {temPasskey ? " Passkey cadastrada." : " Nenhuma passkey cadastrada."}
        </p>
      </div>

      {abrindo ? (
        <AssistenteDeTotp aoSair={() => setAbrindo(false)} substituindo={totpAtivo} />
      ) : (
        <div className="flex flex-col gap-3">
          <CadastrarPasskey />

          {totpAtivo ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={!podeSubstituirTotp}
                onClick={() => setConfirmando(true)}
              >
                <Smartphone aria-hidden="true" strokeWidth={2} />
                Substituir o aplicativo autenticador
              </Button>
              {podeSubstituirTotp ? null : (
                <FaixaAviso
                  tom="neutro"
                  titulo="Cadastre uma passkey antes de trocar o aplicativo."
                  descricao="A chave antiga para de valer assim que a nova é gerada; com uma passkey cadastrada, você continua entrando enquanto refaz o cadastro."
                />
              )}
            </>
          ) : (
            <Button type="button" variant="outline" onClick={() => setAbrindo(true)}>
              <Smartphone aria-hidden="true" strokeWidth={2} />
              Cadastrar um aplicativo autenticador
            </Button>
          )}
        </div>
      )}

      <ModalConfirmacaoBlock
        aberto={confirmando}
        titulo="Substituir o aplicativo autenticador"
        resumo="A chave atual para de valer assim que a nova for gerada. Você vai precisar cadastrar a chave nova no aplicativo e confirmar um código para concluir."
        textoConfirmar="Substituir"
        variante="destrutiva"
        onConfirmar={() => {
          setConfirmando(false);
          setAbrindo(true);
        }}
        onCancelar={() => setConfirmando(false)}
      />
    </section>
  );
}

/** Cadastro de passkey: acrescenta um fator, nunca remove — sem block. */
function CadastrarPasskey() {
  const router = useRouter();
  const [apelido, setApelido] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const { aberto, exigirProva, confirmado, cancelar } = useReautenticacao();

  async function cadastrar() {
    setOcupado(true);
    setErro("");
    try {
      const nome = apelido.trim() || "Este aparelho";
      const preparo = await iniciarCadastroDePasskey(nome);
      if (pediuProva(preparo)) {
        exigirProva(() => void cadastrar());
        return;
      }
      if (!preparo.ok) {
        setErro(preparo.mensagem);
        return;
      }

      // O aparelho cria a credencial. `userVerification: "required"` está nas
      // opções do servidor, e quem recusa prova sem verificação do usuário é o
      // `afterVerification` de `auth.ts` (G9).
      const prova = await startRegistration({ optionsJSON: preparo.dados.opcoes as never });
      const corpo = Object.fromEntries(
        Object.entries(prova).filter(([campo]) => campo !== "clientExtensionResults"),
      );

      const fim = await confirmarCadastroDePasskey({ apelido: nome, resposta: corpo });
      if (!fim.ok) {
        setErro(fim.mensagem);
        return;
      }
      setApelido("");
      router.refresh();
    } catch {
      setErro("O cadastro foi cancelado no aparelho. Tente de novo quando quiser.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <Campo
        nome="apelido"
        rotulo="Nome deste aparelho"
        ajuda="Serve para você reconhecer a chave na lista. Ex.: iPhone da loja Centro."
        opcional
      >
        <Input
          id="apelido"
          name="apelido"
          value={apelido}
          onChange={(evento) => setApelido(evento.target.value)}
          maxLength={60}
        />
      </Campo>

      {erro ? (
        <p role="alert" className="text-corpo text-perigo">
          {erro}
        </p>
      ) : null}

      <Button
        type="button"
        onClick={() => void cadastrar()}
        disabled={ocupado}
        aria-busy={ocupado}
        className="self-start"
      >
        {ocupado ? (
          <Loader2
            aria-hidden="true"
            strokeWidth={2}
            className="movimento-essencial animate-spin"
          />
        ) : (
          <Fingerprint aria-hidden="true" strokeWidth={2} />
        )}
        Cadastrar uma passkey
      </Button>

      <ModalReautenticacao
        aberto={aberto}
        reautenticarComSenha={reautenticar}
        onConfirmado={confirmado}
        onCancelar={cancelar}
      />
    </div>
  );
}

function AssistenteDeTotp({
  aoSair,
  substituindo,
}: {
  aoSair: () => void;
  substituindo: boolean;
}) {
  const router = useRouter();
  const formularioDeChave = useRef<HTMLFormElement>(null);
  const [preparo, prepararAcao] = useActionState(iniciarCadastroDeTotp, INICIAL_URI);
  const [fim, confirmarAcao] = useActionState(confirmarCadastroDeTotp, INICIAL_FIM);
  const { aberto, exigirProva, confirmado, cancelar } = useReautenticacao();

  useEffect(() => {
    if (pediuProva(preparo)) exigirProva(() => formularioDeChave.current?.requestSubmit());
  }, [preparo, exigirProva]);

  useEffect(() => {
    if (fim.ok) {
      router.refresh();
      aoSair();
    }
  }, [fim, router, aoSair]);

  if (!preparo.ok) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <p className="text-corpo text-muted-foreground">
          {substituindo
            ? "Confirme a sua senha para gerar a chave nova. A antiga para de valer neste momento."
            : "Confirme a sua senha e tenha o aplicativo autenticador aberto no celular."}
        </p>
        <form ref={formularioDeChave} action={prepararAcao} className="flex flex-col gap-4">
          <Campo
            nome="senhaAtual"
            rotulo="Sua senha"
            {...(preparo.mensagem && !pediuProva(preparo)
              ? { erro: preparo.mensagem }
              : {})}
          >
            <Input
              id="senhaAtual"
              name="senhaAtual"
              type="password"
              autoComplete="current-password"
              required
            />
          </Campo>
          <div className="flex gap-2">
            <BotaoEnviar>Gerar a chave</BotaoEnviar>
            <Button type="button" variant="ghost" onClick={aoSair}>
              Cancelar
            </Button>
          </div>
        </form>

        <ModalReautenticacao
          aberto={aberto}
          reautenticarComSenha={reautenticar}
          onConfirmado={confirmado}
          onCancelar={cancelar}
        />
      </div>
    );
  }

  const erroDoCodigo = fim.ok ? undefined : (fim.erros?.["codigo"]?.[0] ?? fim.mensagem);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <ChaveDoAplicativo uri={preparo.dados.uri} />
      <form action={confirmarAcao} className="flex flex-col gap-4">
        <Campo
          nome="codigo"
          rotulo="Código de 6 dígitos"
          ajuda="Digite o código que o aplicativo está mostrando agora."
          {...(erroDoCodigo ? { erro: erroDoCodigo } : {})}
        >
          <Input
            id="codigo"
            name="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            aria-invalid={Boolean(erroDoCodigo)}
            required
          />
        </Campo>
        <BotaoEnviar>Confirmar</BotaoEnviar>
      </form>
    </div>
  );
}

/**
 * ponytail: a chave aparece como TEXTO, sem imagem de QR. Nenhuma biblioteca de
 * QR está instalada e a CSP aceita só `img-src 'self' data: blob:` — a
 * dependência nova é decisão do orquestrador. A chave digitada funciona em todo
 * aplicativo autenticador.
 */
function ChaveDoAplicativo({ uri }: { uri: string }) {
  let chave = "";
  try {
    chave = new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    chave = "";
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted p-4">
      <p className="text-denso font-medium">Cadastre esta chave no aplicativo</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-denso">{chave}</code>
        <Copiar valor={chave} rotulo="a chave" />
      </div>
      <p className="text-legenda text-muted-foreground">
        Ela aparece uma vez só: depois de confirmar, não é mostrada de novo.
      </p>
    </div>
  );
}
