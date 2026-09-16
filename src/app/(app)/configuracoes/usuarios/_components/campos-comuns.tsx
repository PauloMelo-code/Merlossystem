"use client";

import type { ZodType } from "zod";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Campo, idsDeApoio } from "@/components/comum/campo";
import type { Papel } from "@/lib/db/schema/_enums/auth";
import { rotuloDePapel } from "@/lib/ui/tons";

/**
 * Campos que o convite e as ações da linha repetem (04-ui.md §7.1): motivo,
 * papel (rádio: são 5 opções ou menos) e loja (só para quem opera numa loja).
 */

export type LojaNaTela = { id: string; nome: string; sigla: string };

export const PAPEIS_COM_LOJA: readonly Papel[] = ["vendedor", "viewer"];

/** Zod no envio, com o primeiro erro de cada campo — o servidor valida de novo. */
export function errosDe(esquema: ZodType, entrada: unknown): Record<string, string> {
  const analise = esquema.safeParse(entrada);
  if (analise.success) return {};
  const erros: Record<string, string> = {};
  for (const problema of analise.error.issues) {
    const campo = String(problema.path[0] ?? "_");
    erros[campo] ??= problema.message;
  }
  return erros;
}

export function CampoMotivo({
  valor,
  onMudar,
  erro,
  rotulo = "Motivo",
}: {
  valor: string;
  onMudar: (valor: string) => void;
  erro?: string | undefined;
  rotulo?: string;
}) {
  const ajuda = "De 8 a 255 caracteres. Fica registrado na trilha de auditoria.";
  return (
    <Campo nome="motivo" rotulo={rotulo} ajuda={ajuda} {...(erro ? { erro } : {})}>
      <Textarea
        id="motivo"
        name="motivo"
        rows={3}
        maxLength={255}
        value={valor}
        onChange={(evento) => onMudar(evento.target.value)}
        aria-invalid={Boolean(erro)}
        aria-describedby={idsDeApoio("motivo", { ajuda, erro })}
      />
    </Campo>
  );
}

export function CampoPapel({
  opcoes,
  valor,
  onMudar,
  erro,
}: {
  opcoes: readonly Papel[];
  valor: string;
  onMudar: (valor: Papel) => void;
  erro?: string | undefined;
}) {
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={erro ? "papel-erro" : undefined}>
      <legend className="text-denso font-medium">Papel</legend>
      <RadioGroup value={valor} onValueChange={(v) => onMudar(v as Papel)}>
        {opcoes.map((papel) => (
          <div key={papel} className="flex items-center gap-2">
            <RadioGroupItem id={`papel-${papel}`} value={papel} />
            <Label htmlFor={`papel-${papel}`} className="text-corpo font-normal">
              {rotuloDePapel(papel)}
            </Label>
          </div>
        ))}
      </RadioGroup>
      {erro ? (
        <p id="papel-erro" className="text-legenda text-perigo">
          {erro}
        </p>
      ) : null}
    </fieldset>
  );
}

export function CampoLoja({
  lojas,
  valor,
  onMudar,
  erro,
}: {
  lojas: readonly LojaNaTela[];
  valor: string;
  onMudar: (valor: string) => void;
  erro?: string | undefined;
}) {
  const ajuda = "Vendedora e somente leitura trabalham numa loja só.";
  return (
    <Campo nome="lojaId" rotulo="Loja" ajuda={ajuda} {...(erro ? { erro } : {})}>
      <Select value={valor} onValueChange={onMudar}>
        <SelectTrigger
          id="lojaId"
          className="w-full"
          aria-invalid={Boolean(erro)}
          aria-describedby={idsDeApoio("lojaId", { ajuda, erro })}
        >
          <SelectValue placeholder="Escolha a loja" />
        </SelectTrigger>
        <SelectContent>
          {lojas.map((loja) => (
            <SelectItem key={loja.id} value={loja.id}>
              {loja.nome} ({loja.sigla})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Campo>
  );
}
