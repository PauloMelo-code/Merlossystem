"use client";

import { useId, useState } from "react";
import { Check, Eye, EyeOff, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Campo, idsDeApoio } from "@/components/comum/campo";
import { MIN_SENHA, motivosDeSenha, type ContextoDeSenha } from "@/lib/auth/senha-regras";

/**
 * Campo de senha com mostrar/ocultar e requisitos AO VIVO (04-ui.md §5.1).
 *
 * Os motivos vêm de `senha-regras.ts` — o MESMO módulo que o servidor cobra.
 * Se a lista divergir, a pessoa tenta cinco senhas que a tela aceitou e o
 * servidor recusou.
 *
 * O que a tela NÃO sabe: HIBP e histórico de senha. Esses só existem no
 * servidor e voltam como erro do campo — está escrito no texto de apoio para a
 * recusa não parecer arbitrária.
 *
 * Colar é liberado de propósito: bloquear colagem empurra a pessoa para senha
 * curta e digitável.
 */
export function CampoSenha({
  nome,
  rotulo,
  valor,
  aoMudar,
  contexto,
  erro,
  autoComplete = "new-password",
  comRequisitos = true,
}: {
  nome: string;
  rotulo: string;
  valor: string;
  aoMudar: (valor: string) => void;
  contexto?: ContextoDeSenha;
  erro?: string;
  autoComplete?: "new-password" | "current-password";
  comRequisitos?: boolean;
}) {
  const [visivel, setVisivel] = useState(false);
  const idDosRequisitos = useId();

  const motivos = comRequisitos && valor ? motivosDeSenha(valor, contexto ?? {}) : [];
  const aprovada = comRequisitos && valor.length > 0 && motivos.length === 0;

  return (
    <div className="flex flex-col gap-2">
      <Campo nome={nome} rotulo={rotulo} {...(erro ? { erro } : {})}>
        <div className="flex items-center gap-2">
          <Input
            id={nome}
            name={nome}
            type={visivel ? "text" : "password"}
            autoComplete={autoComplete}
            value={valor}
            onChange={(evento) => aoMudar(evento.target.value)}
            aria-invalid={Boolean(erro)}
            aria-describedby={
              [idsDeApoio(nome, { erro }), comRequisitos ? idDosRequisitos : ""]
                .filter(Boolean)
                .join(" ") || undefined
            }
            required
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setVisivel((atual) => !atual)}
            aria-pressed={visivel}
            aria-label={visivel ? "Ocultar a senha" : "Mostrar a senha"}
          >
            {visivel ? (
              <EyeOff aria-hidden="true" strokeWidth={2} />
            ) : (
              <Eye aria-hidden="true" strokeWidth={2} />
            )}
          </Button>
        </div>
      </Campo>

      {comRequisitos ? (
        <div id={idDosRequisitos} className="flex flex-col gap-1" aria-live="polite">
          {valor.length === 0 ? (
            <p className="text-legenda text-muted-foreground">
              Use ao menos {MIN_SENHA} caracteres. Uma frase de que você se lembre serve
              melhor do que trocar letra por símbolo.
            </p>
          ) : null}

          {aprovada ? (
            <p className="flex items-center gap-1.5 text-legenda text-sucesso">
              <Check aria-hidden="true" strokeWidth={2} className="size-3.5 shrink-0" />
              Senha aceita. O servidor ainda confere vazamentos públicos e as suas senhas
              anteriores.
            </p>
          ) : null}

          {motivos.map((motivo) => (
            <p
              key={motivo}
              className="flex items-center gap-1.5 text-legenda text-muted-foreground"
            >
              <Minus aria-hidden="true" strokeWidth={2} className="size-3.5 shrink-0" />
              {motivo}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
