import type { Metadata } from "next";
import { exigirSessao, pode } from "@/lib/auth/guard";
import { listarLojas } from "@/lib/actions/lojas";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { EstadoErro } from "@/components/comum/estado-erro";
import { PainelLojas } from "./_components/painel-lojas";

export const metadata: Metadata = { title: "Lojas" };

/**
 * `/configuracoes/lojas` — unidades e de-para com o depósito do Bling
 * (04-ui.md §5.6). Ver é `lojas:ler`; gravar é de dono e admin. O portão roda
 * aqui E em cada action: o layout não cobre Server Action (N1/N5).
 */
export default async function PaginaLojas() {
  const sessao = await exigirSessao();
  if (!pode(sessao.papel, "lojas", "ler")) {
    return <EstadoErro titulo="Você não tem acesso a esta área." descricao="Fale com o administrador." />;
  }

  const resultado = await listarLojas();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <CabecalhoPagina
        titulo="Lojas"
        descricao="Unidades da rede, a sigla que entra no número do pedido e o depósito de cada uma no Bling."
        breadcrumb={[{ rotulo: "Configurações", rota: "/configuracoes" }, { rotulo: "Lojas" }]}
      />
      {resultado.ok ? (
        <PainelLojas
          lojas={resultado.dados.map((l) => ({ ...l, updatedAt: l.updatedAt.toISOString() }))}
          pode={{
            criar: pode(sessao.papel, "lojas", "criar"),
            editar: pode(sessao.papel, "lojas", "editar"),
            excluir: pode(sessao.papel, "lojas", "excluir"),
          }}
        />
      ) : (
        <EstadoErro titulo="Não foi possível carregar as lojas." descricao={resultado.mensagem} />
      )}
    </div>
  );
}
