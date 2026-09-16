import type { Metadata } from "next";
import { exigirSessao, pode } from "@/lib/auth/guard";
import { listarIntegracoes } from "@/lib/actions/integracoes";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { EstadoErro } from "@/components/comum/estado-erro";
import { textoDaCredencial } from "./_credencial";
import { PainelIntegracoes } from "./_components/painel-integracoes";

export const metadata: Metadata = { title: "Integrações" };

const RETORNOS = new Set(["conectado", "negado", "expirado", "invalido", "sem-permissao", "falhou"]);

/**
 * `/configuracoes/integracoes` — contas conectadas por loja (04-ui.md §5.6).
 * `integracoes:ler` é de dono e admin: a leitura expõe estado de credencial
 * (INV-22). O segredo nunca chega ao navegador — só os 4 últimos caracteres.
 */
export default async function PaginaIntegracoes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sessao = await exigirSessao();
  if (!pode(sessao.papel, "integracoes", "ler")) {
    return <EstadoErro titulo="Você não tem acesso a esta área." descricao="Fale com o administrador." />;
  }
  const { bling } = await searchParams;
  const retorno = typeof bling === "string" && RETORNOS.has(bling) ? bling : null;
  const resultado = await listarIntegracoes();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <CabecalhoPagina
        titulo="Integrações"
        descricao="Números de WhatsApp, Instagram e a conta do Bling. Cada número pertence a uma loja."
        breadcrumb={[{ rotulo: "Configurações", rota: "/configuracoes" }, { rotulo: "Integrações" }]}
      />
      {resultado.ok ? (
        <PainelIntegracoes
          contas={resultado.dados.contas.map((c) => ({
            id: c.id,
            provedor: c.provedor,
            rotulo: c.rotulo,
            lojaNome: c.lojaNome,
            status: c.status,
            expiraEm: c.expiraEm?.toISOString() ?? null,
            ultimoErro: c.ultimoErro,
            ultimaSincronizacao: c.ultimaSincronizacao?.toISOString() ?? null,
            finalDaCredencial: textoDaCredencial(c.credencial),
          }))}
          lojas={resultado.dados.lojas.map((l) => ({ id: l.id, nome: l.nome }))}
          podeConectar={pode(sessao.papel, "integracoes", "conectar")}
          blingConfigurado={resultado.dados.blingConfigurado}
          retornoBling={retorno}
        />
      ) : (
        <EstadoErro titulo="Não foi possível carregar as integrações." descricao={resultado.mensagem} />
      )}
    </div>
  );
}
