import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { contasDeCampanha, etiquetasDaLoja, modelosAprovados } from "@/lib/campanhas/_consultas";
import { abrirPagina } from "@/lib/campanhas/pagina";
import { AssistenteCampanha } from "../_components/assistente-campanha";

export const metadata: Metadata = { title: "Nova campanha" };

/** `/campanhas/nova` — assistente em 3 passos (04-ui.md §5.4). */
export default async function PaginaNovaCampanha() {
  const { lojaId } = await abrirPagina("campanhas:criar");
  const migalhas = [{ rotulo: "Campanhas", rota: "/campanhas" }, { rotulo: "Nova" }];

  if (lojaId === null) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
        <CabecalhoPagina titulo="Nova campanha" breadcrumb={migalhas} />
        <FaixaAviso tom="info" titulo="Escolha uma loja no topo da tela para criar a campanha." />
      </div>
    );
  }

  const [contas, modelos, etiquetas] = await Promise.all([
    contasDeCampanha(lojaId),
    modelosAprovados(lojaId),
    etiquetasDaLoja(lojaId),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <CabecalhoPagina
        titulo="Nova campanha"
        descricao="A campanha nasce em rascunho. O disparo é um passo separado, com confirmação."
        breadcrumb={migalhas}
      />
      {contas.length === 0 ? (
        <EstadoVazio
          titulo="Esta loja não tem número de WhatsApp"
          descricao="Conecte um número em Configurações > Integrações para criar campanhas."
        />
      ) : (
        <AssistenteCampanha contas={contas} modelos={modelos} etiquetas={etiquetas} />
      )}
    </div>
  );
}
