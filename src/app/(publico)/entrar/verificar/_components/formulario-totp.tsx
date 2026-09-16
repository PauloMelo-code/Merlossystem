"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { confirmarTotpDeEntrada } from "../../../_components/porta-de-auth";

const DIGITOS = 6;

/**
 * Código TOTP de 6 dígitos (04-ui.md §5.1 e §7.1).
 *
 * `autoComplete="one-time-code"` e `inputMode="numeric"` fazem o teclado do
 * celular abrir no número e o iOS oferecer o código copiado. Colar funciona:
 * bloquear colagem só faz a pessoa digitar errado com o dedo na tela.
 *
 * Envia sozinho ao completar os 6 dígitos — é o que a pessoa faria em seguida,
 * e a espera de 30 segundos do TOTP não perdoa hesitação.
 */
export function FormularioTotp({ destino }: { destino: string }) {
  const router = useRouter();
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [pendente, iniciar] = useTransition();

  async function enviar(valor: string) {
    setOcupado(true);
    setErro("");
    const resultado = await confirmarTotpDeEntrada(valor);
    setOcupado(false);
    if (resultado.situacao !== "entrou") {
      setCodigo("");
      // `precisa-totp` não volta deste caminho; se voltasse, o desafio ainda
      // está aberto e a frase é a mesma — uma só, sem dizer o que falhou.
      setErro(
        resultado.situacao === "recusado"
          ? resultado.mensagem
          : "Código incorreto ou expirado. Entre de novo.",
      );
      return;
    }
    iniciar(() => {
      router.replace(destino);
      router.refresh();
    });
  }

  const trabalhando = ocupado || pendente;

  return (
    <form
      onSubmit={(evento) => {
        evento.preventDefault();
        void enviar(codigo);
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="codigo" className="text-denso font-medium">
          Código de 6 dígitos
        </Label>
        <InputOTP
          id="codigo"
          maxLength={DIGITOS}
          value={codigo}
          inputMode="numeric"
          autoComplete="one-time-code"
          disabled={trabalhando}
          aria-invalid={Boolean(erro)}
          aria-describedby={erro ? "codigo-erro" : undefined}
          onChange={(valor: string) => {
            setCodigo(valor);
            if (valor.length === DIGITOS) void enviar(valor);
          }}
        >
          <InputOTPGroup>
            {Array.from({ length: DIGITOS }, (_valor, indice) => (
              <InputOTPSlot key={indice} index={indice} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>

      {erro ? (
        <p id="codigo-erro" role="alert" className="text-corpo text-perigo">
          {erro}
        </p>
      ) : null}

      <Button type="submit" disabled={trabalhando || codigo.length < DIGITOS}>
        {trabalhando ? (
          <Loader2
            aria-hidden="true"
            strokeWidth={2}
            className="movimento-essencial animate-spin"
          />
        ) : null}
        Confirmar
      </Button>
    </form>
  );
}
