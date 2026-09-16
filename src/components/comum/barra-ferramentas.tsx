"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * Toolbar padrão das listas (04-ui.md §6.1 e §8): busca, filtros ativos,
 * contagem honesta e a ação primária da tela.
 *
 * O estado vai para a URL com `router.replace` — é o que faz o botão voltar do
 * navegador, o recarregar e o "abrir em nova aba" continuarem funcionando. Não
 * existe `useEffect + fetch` por tela: o servidor lê `searchParams`.
 *
 * A contagem é o texto que o CHAMADOR escreve. Quando o servidor não sabe o
 * total barato, ele manda "50 de muitos" — inventar número é pior do que não
 * ter número.
 */

const ESPERA_MS = 250;

export function BarraFerramentas({
  busca,
  filtros,
  contagem,
  acaoPrimaria,
}: {
  busca?: { parametro: string; placeholder: string };
  filtros?: ReactNode;
  contagem?: string;
  acaoPrimaria?: ReactNode;
}) {
  const router = useRouter();
  const caminho = usePathname();
  const parametros = useSearchParams();
  const parametroDeBusca = busca?.parametro ?? "busca";
  const daUrl = parametros.get(parametroDeBusca) ?? "";
  const [termo, setTermo] = useState(daUrl);
  // O que ESTA barra mandou para a URL por último, e a URL que já foi vista.
  const [enviado, setEnviado] = useState(daUrl);
  const [vista, setVista] = useState(daUrl);

  // A URL mudou por fora ("Limpar filtros", voltar do navegador): o campo
  // acompanha. Sem isto o debounce devolvia o termo antigo para a URL. A
  // mudança que a própria barra provocou não conta — senão a URL atrasada
  // apagaria o que a pessoa digitou depois. Ajuste no render, não em efeito.
  if (daUrl !== vista) {
    setVista(daUrl);
    if (daUrl !== enviado) {
      setEnviado(daUrl);
      setTermo(daUrl);
    }
  }

  // Debounce de 250 ms (§8.2): uma entrada na URL por pausa de digitação, não
  // uma por tecla — senão o histórico do navegador vira uma letra por passo.
  useEffect(() => {
    if (!busca) return;
    if (termo === daUrl) return;
    const relogio = window.setTimeout(() => {
      setEnviado(termo);
      const proximos = new URLSearchParams(parametros.toString());
      if (termo) proximos.set(parametroDeBusca, termo);
      else proximos.delete(parametroDeBusca);
      // Trocar a busca volta para a primeira página do cursor.
      proximos.delete("cursor");
      router.replace(`${caminho}?${proximos.toString()}`);
    }, ESPERA_MS);
    return () => window.clearTimeout(relogio);
  }, [termo, daUrl, busca, parametroDeBusca, parametros, caminho, router]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {busca ? (
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              strokeWidth={2}
              className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-texto-terciario"
            />
            <Input
              type="search"
              value={termo}
              onChange={(evento) => setTermo(evento.target.value)}
              placeholder={busca.placeholder}
              aria-label={busca.placeholder}
              className="pl-8"
            />
          </div>
        ) : null}
        {acaoPrimaria ? <div className="shrink-0">{acaoPrimaria}</div> : null}
      </div>

      {filtros ? <div className="flex flex-wrap items-center gap-2">{filtros}</div> : null}

      {contagem ? (
        <p aria-live="polite" className="text-legenda text-texto-terciario">
          {contagem}
        </p>
      ) : null}
    </div>
  );
}
