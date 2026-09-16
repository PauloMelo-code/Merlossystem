import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Plug, Store, Users } from "lucide-react";
import { exigirSessao, pode } from "@/lib/auth/guard";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { EstadoErro } from "@/components/comum/estado-erro";

export const metadata: Metadata = { title: "Configurações" };

const CARTOES = [
  {
    rota: "/configuracoes/lojas",
    titulo: "Lojas",
    descricao: "Unidades, sigla do pedido e depósito do Bling.",
    icone: Store,
    permissao: ["lojas", "ler"],
  },
  {
    rota: "/configuracoes/integracoes",
    titulo: "Integrações",
    descricao: "Números de WhatsApp, Instagram e a conta do Bling.",
    icone: Plug,
    permissao: ["integracoes", "ler"],
  },
  {
    rota: "/configuracoes/usuarios",
    titulo: "Usuários",
    descricao: "Acessos, papéis e convites.",
    icone: Users,
    permissao: ["usuarios", "ler_detalhe"],
  },
] as const;

/**
 * `/configuracoes` — índice em cartões, FILTRADO POR PAPEL NO SERVIDOR
 * (04-ui.md §5.6). `configuracao:ler` é de dono e admin; o gerente nunca
 * alcança. Cartão sem permissão nem é renderizado.
 */
export default async function PaginaConfiguracoes() {
  const sessao = await exigirSessao();
  if (!pode(sessao.papel, "configuracao", "ler")) {
    return <EstadoErro titulo="Você não tem acesso a esta área." descricao="Fale com o administrador." />;
  }
  const visiveis = CARTOES.filter((c) => pode(sessao.papel, c.permissao[0], c.permissao[1]));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <CabecalhoPagina titulo="Configurações" descricao="Cadastro da rede e contas conectadas." />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visiveis.map(({ rota, titulo, descricao, icone: Icone }) => (
          <li key={rota}>
            <Link
              href={rota}
              className="flex h-full items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-2"
            >
              <Icone aria-hidden="true" strokeWidth={2} className="mt-0.5 size-5 shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-medium">{titulo}</span>
                <span className="text-denso text-muted-foreground">{descricao}</span>
              </span>
              <ChevronRight aria-hidden="true" strokeWidth={2} className="size-4 shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
