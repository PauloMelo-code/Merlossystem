import type { ReactNode } from "react";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { exigirSessao, pode } from "@/lib/auth/guard";
import { AbasAuditoria, type Aba } from "./_components/abas-auditoria";

/**
 * Casca das quatro abas de `/auditoria` (04-ui.md §4.1 e §5.5).
 *
 * A aba "Acessos" (`/auditoria/seguranca`) só aparece para quem tem
 * `seguranca:ler_eventos` — `pode()` puro, sem gravar recusa por renderizar
 * menu. Esconder a aba NÃO é a proteção: a página e a action conferem de novo.
 * Este layout também não protege action nenhuma (N1/N5).
 */
export default async function LayoutAuditoria({ children }: { children: ReactNode }) {
  // O layout de (app) já redireciona quem não tem sessão; aqui só decide a aba.
  const sessao = await exigirSessao().catch(() => null);
  const abas: Aba[] = [
    { rotulo: "Trilha", rota: "/auditoria" },
    { rotulo: "Qualidade", rota: "/auditoria/qualidade" },
    { rotulo: "Excluídos", rota: "/auditoria/excluidos" },
    ...(sessao && pode(sessao.papel, "seguranca", "ler_eventos")
      ? [{ rotulo: "Acessos", rota: "/auditoria/seguranca" }]
      : []),
  ];

  return (
    <div className="flex w-full flex-col gap-6 p-4 md:p-6">
      <CabecalhoPagina
        titulo="Auditoria"
        descricao="Quem fez o quê, quando. A trilha só cresce: nada aqui é editado ou apagado."
      />
      <AbasAuditoria abas={abas} />
      {children}
    </div>
  );
}
