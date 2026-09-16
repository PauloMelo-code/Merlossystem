"use client";

import { Input } from "@/components/ui/input";
import { Campo, idsDeApoio } from "@/components/comum/campo";
import { FRASE_CIENCIA_ADMIN, TEXTO_CIENCIA_ADMIN } from "@/lib/validadores/usuarios";

/**
 * Ciência versionada para conceder acesso de administração (02-seguranca.md
 * §11.2; 04-ui.md §5.6). É um campo de TEXTO, não caixa de marcar: digitar a
 * frase é o que prova que a pessoa leu o que está concedendo.
 *
 * Usado no convite de `admin`, na promoção e na transferência de posse.
 */
export function CampoCienciaAdmin({
  valor,
  onMudar,
  erro,
  aviso,
}: {
  valor: string;
  onMudar: (valor: string) => void;
  erro?: string | undefined;
  /** Texto extra da cerimônia (a transferência avisa que quem transfere vira admin). */
  aviso?: string;
}) {
  const ajuda = `Digite: ${FRASE_CIENCIA_ADMIN}`;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-aviso-borda bg-aviso-fundo p-3">
      <p className="text-denso text-aviso">{TEXTO_CIENCIA_ADMIN}</p>
      {aviso ? <p className="text-denso text-aviso">{aviso}</p> : null}
      <Campo nome="ciencia" rotulo="Ciência" ajuda={ajuda} {...(erro ? { erro } : {})}>
        <Input
          id="ciencia"
          name="ciencia"
          autoComplete="off"
          value={valor}
          onChange={(evento) => onMudar(evento.target.value)}
          aria-invalid={Boolean(erro)}
          aria-describedby={idsDeApoio("ciencia", { ajuda, erro })}
        />
      </Campo>
    </div>
  );
}

/** A mesma regra do Zod, para a tela não liberar o botão antes da hora. */
export function cienciaConfere(valor: string): boolean {
  return valor.trim().toUpperCase() === FRASE_CIENCIA_ADMIN;
}
