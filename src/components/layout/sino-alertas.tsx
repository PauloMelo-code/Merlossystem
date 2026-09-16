"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SeloStatus } from "@/components/comum/selo-status";
import { Tempo } from "@/components/comum/tempo";

/**
 * Sino de alertas (04-ui.md §4.3).
 *
 * O contador é ESCOPADO PELA LOJA ATIVA — no sistema antigo era o total da
 * rede, e a gerente de uma loja via o número da outra.
 *
 * Cada item leva AO OBJETO (conversa, pedido, contato), não a uma lista
 * genérica: o clique tem de terminar onde o problema está.
 */

export type AlertaResumo = {
  id: string;
  tipo: string;
  severidade: string;
  titulo: string;
  conversaId: string | null;
  pedidoId: string | null;
  contatoId: string | null;
  criadoEm: string;
};

/**
 * O destino do alerta é O OBJETO. Sem objeto vinculado sobra `/alertas`, que é
 * o único caso em que a lista genérica é a resposta certa.
 */
export function rotaDoAlerta(alerta: AlertaResumo): string {
  if (alerta.conversaId) return `/conversas/${alerta.conversaId}`;
  if (alerta.pedidoId) return `/pedidos/${alerta.pedidoId}`;
  if (alerta.contatoId) return `/contatos/${alerta.contatoId}`;
  return "/alertas";
}

export function SinoAlertas({
  contador,
  ultimos,
}: {
  contador: number;
  /** Os 5 últimos, já escopados pela loja ativa no servidor. */
  ultimos: readonly AlertaResumo[];
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={contador > 0 ? `Alertas: ${contador} sem ler` : "Alertas"}
          className="relative"
        >
          <Bell aria-hidden="true" strokeWidth={2} />
          {contador > 0 ? (
            <span
              aria-hidden="true"
              className="absolute top-0.5 right-0.5 size-2 rounded-full bg-perigo"
            />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b border-border px-3 py-2 text-denso font-medium">Alertas</p>
        {ultimos.length === 0 ? (
          <p className="px-3 py-6 text-center text-corpo text-muted-foreground">
            Nenhum alerta por aqui.
          </p>
        ) : (
          <ul className="flex flex-col">
            {ultimos.map((alerta) => (
              <li key={alerta.id} className="border-b border-border last:border-b-0">
                <Link
                  href={rotaDoAlerta(alerta)}
                  className="flex flex-col gap-1 px-3 py-2 hover:bg-accent"
                >
                  <span className="flex items-center gap-2">
                    <SeloStatus dominio="severidade" valor={alerta.severidade} />
                    <span className="min-w-0 flex-1 truncate text-denso">
                      {alerta.titulo}
                    </span>
                  </span>
                  <Tempo
                    valor={alerta.criadoEm}
                    formato="lista"
                    className="text-legenda text-texto-terciario"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/alertas"
          className="block border-t border-border px-3 py-2 text-center text-denso text-marca-texto"
        >
          Ver todos
        </Link>
      </PopoverContent>
    </Popover>
  );
}
