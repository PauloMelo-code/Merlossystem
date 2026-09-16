import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "cn";
import { exigirSessao, pode } from "@/lib/auth/guard";
import { listarGaleria } from "@/lib/actions/midias";
import { PASTAS_MIDIA, TIPOS_ARQUIVO_MIDIA } from "@/lib/db/schema/_enums/catalogo";
import { filtrosGaleriaSchema } from "@/lib/validadores/midias";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { EstadoErro } from "@/components/comum/estado-erro";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { PaginacaoCursor } from "@/components/comum/paginacao-cursor";
import { AreaUpload } from "./_components/area-upload";
import { GradeMidias } from "./_components/grade-midias";
import { ABAS_DE_ORIGEM, ROTULO_PASTA, ROTULO_TIPO } from "./_components/rotulos";

export const metadata: Metadata = { title: "Galeria" };

type Parametros = Record<string, string | string[] | undefined>;

function primeiro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * `/galeria` (04-ui.md §5.4). Filtros e cursor moram na URL; o servidor busca
 * já filtrado. Mídia recebida de cliente fica numa aba própria, com aviso de
 * dado pessoal — a galeria de produtos filtra `origem = 'upload'` por
 * construção (D-51).
 *
 * Editar pasta e etiquetas NÃO existe aqui: a matriz não tem `midia:editar` e a
 * trilha não tem ação para isso (bloqueio registrado). Sem backend, sem tela (U8).
 */
export default async function PaginaGaleria({ searchParams }: { searchParams: Promise<Parametros> }) {
  const sessao = await exigirSessao();
  if (!pode(sessao.papel, "midia", "ler")) {
    return (
      <div className="p-4 md:p-6">
        <EstadoErro
          titulo="Você não tem acesso a esta área."
          descricao="Fale com o administrador."
        />
      </div>
    );
  }

  const bruto = await searchParams;
  const pedidos = Object.fromEntries(Object.entries(bruto).map(([k, v]) => [k, primeiro(v)]));
  const filtros = filtrosGaleriaSchema.safeParse(pedidos);
  const atuais = filtros.success ? filtros.data : filtrosGaleriaSchema.parse({});
  const resultado = await listarGaleria(atuais);

  const podeEnviar = pode(sessao.papel, "midia", "enviar");
  const podeExcluir = pode(sessao.papel, "midia", "excluir");

  /** Link que troca UM filtro e volta à primeira página. */
  const link = (mudanca: Record<string, string | undefined>) => {
    const proximos = new URLSearchParams();
    const base = { origem: atuais.origem, pasta: atuais.pasta, tipo: atuais.tipo, ...mudanca };
    for (const [chave, valor] of Object.entries(base)) if (valor) proximos.set(chave, valor);
    if (atuais.porPagina !== 50) proximos.set("porPagina", String(atuais.porPagina));
    return `/galeria?${proximos.toString()}`;
  };

  const chip = (ativo: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-legenda",
      ativo
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border bg-secondary text-secondary-foreground hover:bg-muted",
    );

  return (
    <div className="flex w-full flex-col gap-6 p-4 md:p-6">
      <CabecalhoPagina
        titulo="Galeria"
        descricao="Fotos, vídeos e documentos da loja. A mídia só é aberta por aqui, com a sua sessão."
      />

      <nav aria-label="Origem das mídias" className="flex flex-wrap gap-2">
        {ABAS_DE_ORIGEM.map((aba) => (
          <Link
            key={aba.valor}
            href={link({ origem: aba.valor, pasta: undefined })}
            aria-current={atuais.origem === aba.valor ? "page" : undefined}
            className={chip(atuais.origem === aba.valor)}
          >
            {aba.rotulo}
          </Link>
        ))}
      </nav>

      {atuais.origem === "recebida" ? (
        <FaixaAviso
          tom="aviso"
          titulo="Dado pessoal de clientes"
          descricao="Estas mídias vieram das conversas. Use só para o atendimento; elas não entram na galeria de produtos."
        />
      ) : null}

      {atuais.origem === "upload" && podeEnviar ? (
        resultado.ok && resultado.dados.lojaAtiva ? (
          <AreaUpload lojaId={resultado.dados.lojaAtiva} pastaInicial={atuais.pasta ?? "produtos"} />
        ) : (
          <FaixaAviso
            tom="info"
            titulo="Escolha uma loja para enviar"
            descricao="Escolha uma loja no topo da tela para continuar."
          />
        )
      ) : null}

      <div className="flex flex-col gap-2">
        {atuais.origem === "upload" ? (
          <div role="group" aria-label="Filtrar por pasta" className="flex flex-wrap gap-2">
            <Link href={link({ pasta: undefined })} className={chip(!atuais.pasta)}>
              Todas as pastas
            </Link>
            {PASTAS_MIDIA.map((pasta) => (
              <Link
                key={pasta}
                href={link({ pasta })}
                aria-current={atuais.pasta === pasta ? "true" : undefined}
                className={chip(atuais.pasta === pasta)}
              >
                {ROTULO_PASTA[pasta]}
              </Link>
            ))}
          </div>
        ) : null}
        <div role="group" aria-label="Filtrar por tipo" className="flex flex-wrap gap-2">
          <Link href={link({ tipo: undefined })} className={chip(!atuais.tipo)}>
            Todos os tipos
          </Link>
          {TIPOS_ARQUIVO_MIDIA.map((tipo) => (
            <Link
              key={tipo}
              href={link({ tipo })}
              aria-current={atuais.tipo === tipo ? "true" : undefined}
              className={chip(atuais.tipo === tipo)}
            >
              {ROTULO_TIPO[tipo]}
            </Link>
          ))}
        </div>
      </div>

      {!resultado.ok ? (
        <EstadoErro
          titulo="Não foi possível carregar a galeria."
          descricao={resultado.mensagem}
          acao={
            <Link href="/galeria" className="text-denso underline">
              Tentar de novo
            </Link>
          }
        />
      ) : resultado.dados.itens.length === 0 ? (
        <EstadoVazio
          titulo={atuais.pasta || atuais.tipo ? "Nenhuma mídia com esses filtros." : "Nenhuma mídia por aqui ainda."}
          {...(atuais.origem === "upload" && podeEnviar && !(atuais.pasta || atuais.tipo)
            ? { descricao: "Arraste arquivos para a área acima ou use o botão Escolher arquivos." }
            : {})}
          {...(atuais.pasta || atuais.tipo
            ? {
                acao: (
                  <Link href={link({ pasta: undefined, tipo: undefined })} className="text-denso underline">
                    Limpar filtros
                  </Link>
                ),
              }
            : {})}
        />
      ) : (
        <>
          <GradeMidias midias={resultado.dados.itens} podeExcluir={podeExcluir} />
          <PaginacaoCursor
            cursorAnterior={resultado.dados.cursorAnterior}
            cursorProximo={resultado.dados.cursorProximo}
            porPagina={atuais.porPagina}
          />
        </>
      )}
    </div>
  );
}
