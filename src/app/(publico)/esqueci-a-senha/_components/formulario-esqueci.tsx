"use client";

import { useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Campo } from "@/components/comum/campo";
import { pedirLinkDeSenha } from "../../_components/porta-de-auth";

/**
 * Pedido de link (04-ui.md §5.1).
 *
 * Um estado de sucesso só, com o mesmo texto para conta existente e
 * inexistente. O botão fica desabilitado depois do envio para a pessoa não
 * martelar o pedido — o cooldown de verdade é do servidor.
 */
export function FormularioEsqueci() {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  if (enviado) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <p className="flex items-center gap-1.5 text-corpo text-sucesso">
          <MailCheck aria-hidden="true" strokeWidth={2} className="size-4 shrink-0" />
          Se existir conta com esse e-mail, enviamos o link.
        </p>
        <p className="text-denso text-muted-foreground">
          O link vale por 30 minutos e só pode ser usado uma vez. Confira a caixa de spam
          antes de pedir outro.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(evento) => {
        evento.preventDefault();
        setOcupado(true);
        void pedirLinkDeSenha(email).finally(() => {
          setOcupado(false);
          setEnviado(true);
        });
      }}
      className="flex flex-col gap-4"
    >
      <Campo nome="email" rotulo="E-mail">
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          value={email}
          onChange={(evento) => setEmail(evento.target.value)}
          required
        />
      </Campo>

      <Button type="submit" disabled={ocupado} aria-busy={ocupado}>
        {ocupado ? (
          <Loader2
            aria-hidden="true"
            strokeWidth={2}
            className="movimento-essencial animate-spin"
          />
        ) : null}
        Enviar o link
      </Button>
    </form>
  );
}
