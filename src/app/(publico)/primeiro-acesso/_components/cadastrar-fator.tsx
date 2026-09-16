"use client";

import { useActionState, useEffect, useState } from "react";
import { Fingerprint, Loader2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Campo } from "@/components/comum/campo";
import { BotaoEnviar } from "@/components/comum/botao-enviar";
import { ChaveDoTotp } from "@/components/comum/chave-do-totp";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import type { Resultado } from "@/lib/erros";
import {
  confirmarPasskeyDoPrimeiroAcesso,
  confirmarTotpDoPrimeiroAcesso,
  prepararPasskeyDoPrimeiroAcesso,
  prepararTotpDoPrimeiroAcesso,
} from "../../_acoes";
import { criarPasskeyNoAparelho } from "../../_components/porta-de-auth";

const INICIAL_URI: Resultado<{ uri: string; qr: string }> = {
  ok: false,
  codigo: "",
  mensagem: "",
};
type Conclusao = { concluido: boolean; falta: "passkey" | "totp" | null };
const INICIAL_FIM: Resultado<Conclusao> = { ok: false, codigo: "", mensagem: "" };

/**
 * Política de fatores (ADR 0029): `dono` e `admin` cadastram os DOIS. A tela
 * não sabe o papel de antemão — quem decide é o servidor, que devolve o que
 * `falta` depois de cada fator.
 */
const O_QUE_FALTA = {
  passkey:
    "Contas de dono e de administração usam as duas formas. O aplicativo já está cadastrado; agora cadastre a passkey.",
  totp: "Contas de dono e de administração usam as duas formas. A passkey já está cadastrada; agora cadastre o aplicativo autenticador — ele é a segunda porta se este aparelho se perder.",
} as const;

/**
 * Passo 2: cadastrar o segundo fator (02-seguranca.md §9.1 e §9.2 item 7).
 *
 * PASSKEY é a recomendada — é a resistente a phishing e, para `dono` e `admin`,
 * é obrigatória (H7), junto com o aplicativo (ADR 0029). O aplicativo
 * autenticador existe também para o celular de loja sem biometria.
 *
 * Não há terceira opção: OTP por e-mail, SMS e código de recuperação não
 * existem no sistema (S-07, D3/D4, G4), e desenhar a tela deles seria prometer
 * o que o código não faz (U8).
 */
export function CadastrarFator({
  senha,
  aoConcluir,
}: {
  senha: string;
  aoConcluir: () => void;
}) {
  const [escolha, setEscolha] = useState<"nenhuma" | "passkey" | "totp">("nenhuma");
  const [falta, setFalta] = useState<Conclusao["falta"]>(null);

  function terminou(resultado: Conclusao) {
    if (resultado.concluido) {
      aoConcluir();
      return;
    }
    setFalta(resultado.falta);
    setEscolha(resultado.falta ?? "nenhuma");
  }

  const aviso = falta ? (
    <FaixaAviso tom="info" titulo="Falta mais um passo." descricao={O_QUE_FALTA[falta]} />
  ) : null;

  if (escolha === "totp") {
    return (
      <div className="flex flex-col gap-4">
        {aviso}
        <ComAplicativo key="totp" senha={senha} aoTerminar={terminou} />
      </div>
    );
  }
  if (escolha === "passkey") {
    return (
      <div className="flex flex-col gap-4">
        {aviso}
        <ComPasskey key="passkey" aoTerminar={terminou} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-corpo text-muted-foreground">
        Escolha como você vai confirmar que é você toda vez que entrar. Contas de dono e
        de administração cadastram as duas formas, uma depois da outra.
      </p>

      <Button type="button" onClick={() => setEscolha("passkey")}>
        <Fingerprint aria-hidden="true" strokeWidth={2} />
        Usar uma passkey (recomendado)
      </Button>
      <p className="text-legenda text-muted-foreground">
        Usa a digital, o rosto ou o PIN deste aparelho. É a forma mais segura e a mais
        rápida no dia a dia.
      </p>

      <Button type="button" variant="outline" onClick={() => setEscolha("totp")}>
        <Smartphone aria-hidden="true" strokeWidth={2} />
        Usar um aplicativo autenticador
      </Button>
      <p className="text-legenda text-muted-foreground">
        Para celular de loja sem biometria. Você digita um código de 6 dígitos ao entrar.
      </p>
    </div>
  );
}

function ComPasskey({ aoTerminar }: { aoTerminar: (resultado: Conclusao) => void }) {
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const apelido = "Meu aparelho";

  async function cadastrar() {
    setOcupado(true);
    setErro("");
    try {
      const preparo = await prepararPasskeyDoPrimeiroAcesso(apelido);
      if (!preparo.ok) {
        setErro(preparo.mensagem);
        return;
      }
      const prova = await criarPasskeyNoAparelho(preparo.dados.opcoes);
      const fim = await confirmarPasskeyDoPrimeiroAcesso({ apelido, resposta: prova });
      if (!fim.ok) {
        setErro(fim.mensagem);
        return;
      }
      aoTerminar(fim.dados);
    } catch {
      setErro("O cadastro foi cancelado no aparelho. Tente de novo quando quiser.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-corpo">
        O aparelho vai pedir a sua digital, o seu rosto ou o PIN. Nada disso chega ao
        sistema — ele só recebe a confirmação.
      </p>
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
        Cadastrar a passkey
      </Button>
    </div>
  );
}

function ComAplicativo({
  senha,
  aoTerminar,
}: {
  senha: string;
  aoTerminar: (resultado: Conclusao) => void;
}) {
  const [preparo, prepararAcao] = useActionState(prepararTotpDoPrimeiroAcesso, INICIAL_URI);
  const [fim, confirmarAcao] = useActionState(confirmarTotpDoPrimeiroAcesso, INICIAL_FIM);

  useEffect(() => {
    if (fim.ok) aoTerminar(fim.dados);
  }, [fim, aoTerminar]);

  if (!preparo.ok) {
    return (
      <form action={prepararAcao} className="flex flex-col gap-4">
        <p className="text-corpo text-muted-foreground">
          Tenha o aplicativo autenticador aberto no celular (Google Authenticator,
          Microsoft Authenticator, 1Password, Bitwarden). Você vai ler um código QR — ou
          digitar a chave, se preferir.
        </p>

        {/*
         * A senha acompanha o passo 1 em memória. Quem VOLTOU para concluir o
         * cadastro (fechou a aba, trocou de aparelho) não a tem mais, e o
         * `/two-factor/enable` do Better Auth a exige — então a tela pede, em
         * vez de falhar com um erro que a pessoa não consegue corrigir.
         */}
        {senha ? (
          <input type="hidden" name="senhaAtual" value={senha} />
        ) : (
          <Campo nome="senhaAtual" rotulo="Sua senha">
            <Input
              id="senhaAtual"
              name="senhaAtual"
              type="password"
              autoComplete="current-password"
              required
            />
          </Campo>
        )}
        {preparo.mensagem ? (
          <p role="alert" className="text-corpo text-perigo">
            {preparo.mensagem}
          </p>
        ) : null}
        <BotaoEnviar>Gerar a chave</BotaoEnviar>
      </form>
    );
  }

  const erro = fim.ok ? undefined : (fim.erros?.["codigo"]?.[0] ?? fim.mensagem);

  return (
    <div className="flex flex-col gap-6">
      <ChaveDoTotp uri={preparo.dados.uri} qr={preparo.dados.qr} />
      <form action={confirmarAcao} className="flex flex-col gap-4">
        <Campo
          nome="codigo"
          rotulo="Código de 6 dígitos"
          ajuda="Digite o código que o aplicativo está mostrando agora."
          {...(erro ? { erro } : {})}
        >
          <Input
            id="codigo"
            name="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            aria-invalid={Boolean(erro)}
            required
          />
        </Campo>
        <BotaoEnviar>Confirmar e concluir</BotaoEnviar>
      </form>
    </div>
  );
}
