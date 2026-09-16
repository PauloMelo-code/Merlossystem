"use client";

import { useTheme } from "next-themes";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Preferências POR APARELHO (04-ui.md §5.1).
 *
 * Não existe coluna de preferência no modelo de dados; o tema mora no
 * `localStorage` do `next-themes`, que é exatamente o comportamento descrito.
 *
 * O QUE AINDA NÃO ESTÁ AQUI, de propósito (U8): "som de nova conversa" e
 * "notificação do navegador". Os dois dependem do canal de tempo real e da tela
 * de Conversas, que nascem no pacote M1 — um interruptor que nada lê é fachada,
 * e o lugar dele é o commit que liga a tela.
 *
 * Também não existe seletor de idioma: o sistema é PT-BR, sem i18n.
 */
export function PreferenciasDoDispositivo() {
  const { theme, setTheme } = useTheme();

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-titulo-secao font-medium">Este aparelho</h2>
        <p className="text-denso text-muted-foreground">
          Vale só neste navegador. Em outro computador, a escolha é outra.
        </p>
      </div>

      <div className="flex max-w-sm flex-col gap-1.5">
        <Label htmlFor="tema" className="text-denso font-medium">
          Tema
        </Label>
        <Select value={theme ?? "system"} onValueChange={setTheme}>
          <SelectTrigger id="tema">
            <SelectValue placeholder="Tema" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">Igual ao do sistema</SelectItem>
            <SelectItem value="light">Claro</SelectItem>
            <SelectItem value="dark">Escuro</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
