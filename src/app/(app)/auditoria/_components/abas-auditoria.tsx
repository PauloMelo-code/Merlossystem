"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type Aba = { rotulo: string; rota: string };

/**
 * As abas de `/auditoria` são LINKS (cada uma é uma rota), não `tabs` de
 * estado: abrir em nova aba e voltar do navegador precisam funcionar.
 * `aria-current="page"` marca a ativa para o leitor de tela.
 */
export function AbasAuditoria({ abas }: { abas: readonly Aba[] }) {
  const caminho = usePathname();
  return (
    <nav aria-label="Seções da auditoria" className="border-b border-border">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {abas.map((aba) => {
          const ativa = caminho === aba.rota;
          return (
            <li key={aba.rota}>
              <Link
                href={aba.rota}
                aria-current={ativa ? "page" : undefined}
                className={`inline-flex h-10 items-center border-b-2 px-3 text-denso font-medium whitespace-nowrap ${
                  ativa
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {aba.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
