import type { ReactNode } from "react";
import { Marca } from "@/components/comum/marca";
import { NOME_COMPLETO } from "@/lib/marca";

/**
 * Casca da área pública (04-ui.md §4.1 e §5.1): marca à esquerda a partir de
 * `lg`, cartão à direita, coluna única no celular.
 *
 * `Cache-Control: no-store` em toda página desta área vem de `src/proxy.ts`,
 * que carimba a resposta antes de qualquer render — repetir aqui seria uma
 * segunda fonte para a mesma regra.
 *
 * Densidade CONFORTÁVEL (§2.6): autenticação não é tela de trabalho repetido.
 */
/**
 * NENHUMA página desta área é estática.
 *
 * Dois motivos, os dois de segurança: o nonce da CSP é gerado por REQUISIÇÃO em
 * `src/proxy.ts`, e HTML prerenderizado no build carrega um nonce que não
 * confere — com `script-src 'self' 'nonce-...'` e sem `'unsafe-inline'`, a
 * página simplesmente não hidrata. E toda página de acesso responde
 * `Cache-Control: no-store` (§5.1), o que é incompatível com resposta guardada
 * na borda.
 */
export const dynamic = "force-dynamic";

export default function LayoutPublico({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-accent p-12 lg:flex">
        <Marca className="text-titulo-pagina" />
        <div className="max-w-md">
          <p className="text-destaque font-semibold text-foreground">
            O atendimento da loja em um lugar só.
          </p>
          <p className="mt-4 text-corpo text-muted-foreground">
            Conversas, contatos, pedidos e campanhas da {NOME_COMPLETO}, com o histórico de
            cada cliente à mão.
          </p>
        </div>
        <p className="text-legenda text-texto-terciario">
          Acesso restrito à equipe. Cada entrada fica registrada.
        </p>
      </aside>

      <main
        id="conteudo"
        className="flex flex-col items-center justify-center gap-8 px-4 py-12 md:px-6"
      >
        <Marca className="text-titulo-pagina lg:hidden" />
        {children}
      </main>
    </div>
  );
}
