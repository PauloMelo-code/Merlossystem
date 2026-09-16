import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AvatarContato } from "@/components/comum/avatar-contato";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { Dinheiro } from "@/components/comum/dinheiro";
import { EstadoErro } from "@/components/comum/estado-erro";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { IconeCanal, rotuloDoCanal } from "@/components/comum/icone-canal";
import { SeloStatus } from "@/components/comum/selo-status";
import { Tempo } from "@/components/comum/tempo";
import { abrirFicha } from "@/lib/actions/contatos";
import { historicoDoTitular } from "@/lib/actions/lgpd";
import { dataPuraFormatada, telefone } from "@/lib/formato";
import { AcoesLgpd } from "../_components/acoes-lgpd";
import { ConsentimentoContato } from "../_components/consentimento-contato";
import { EditorEtiquetas } from "../_components/editor-etiquetas";
import { ExcluirContato } from "../_components/excluir-contato";
import { PainelContato } from "../_components/painel-contato";

export const metadata: Metadata = { title: "Contato" };

/**
 * `/contatos/[id]` — ficha do contato (04-ui.md §5.3): dados, etiquetas,
 * conversas, pedidos, consentimento e direitos do titular.
 *
 * Contato de outra loja responde "não encontrado" (404), nunca 403. Os agregados
 * (`pedidos_contagem`, `pedidos_valor_total`, `ultima_compra_em`) são cache e
 * aparecem como estão.
 */

const TAMANHOS: Readonly<Record<string, string>> = { slim: "Slim", plussize: "Plus size", ambos: "Slim e plus size" };

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-legenda text-muted-foreground">{rotulo}</dt>
      <dd className="text-corpo">{children}</dd>
    </div>
  );
}

export default async function PaginaContato({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const resultado = await abrirFicha({ id });
  if (!resultado.ok) {
    if (resultado.codigo === "NAO_ENCONTRADO" || resultado.codigo === "VALIDACAO") notFound();
    return (
      <div className="p-4 md:p-6">
        <EstadoErro titulo={resultado.mensagem} />
      </div>
    );
  }
  const ficha = resultado.dados;
  if (!ficha) notFound();

  const { contato, permissoes } = ficha;
  const historico = await historicoDoTitular({ contatoId: id });
  const lgpd = historico.ok ? historico.dados : { consentimentos: [], solicitacoes: [] };
  const nome = contato.nome ?? (contato.telefone ? telefone(contato.telefone) : "Contato sem nome");
  const anonimizado = contato.anonimizadoEm !== null;
  const canal = contato.whatsappId ? "whatsapp" : contato.instagramId ? "instagram" : null;
  const atualizadoEm = contato.atualizadoEm.toISOString();
  const e = contato.endereco;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-4 md:p-6">
      <CabecalhoPagina
        titulo={nome}
        descricao={`Contato da loja ${contato.lojaNome ?? ""}`}
        breadcrumb={[{ rotulo: "Contatos", rota: "/contatos" }, { rotulo: nome }]}
        acoes={
          <>
            {permissoes.editar && !anonimizado ? (
              <PainelContato
                contato={{
                  id: contato.id,
                  lojaId: contato.lojaId,
                  nome: contato.nome,
                  telefone: contato.telefone,
                  email: contato.email,
                  tamanhoPreferido: contato.tamanhoPreferido,
                  observacoes: contato.observacoes,
                  aniversario: contato.aniversario,
                  endereco: contato.endereco,
                  atualizadoEm,
                }}
              />
            ) : null}
            {permissoes.excluir ? (
              <ExcluirContato contatoId={contato.id} lojaId={contato.lojaId} nome={nome} atualizadoEm={atualizadoEm} />
            ) : null}
          </>
        }
      />

      {anonimizado && contato.anonimizadoEm ? (
        <FaixaAviso
          tom="info"
          titulo="Os dados pessoais deste contato foram eliminados a pedido do titular."
          descricao={`Eliminação registrada em ${contato.anonimizadoEm.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Os pedidos continuam, sem identificação.`}
        />
      ) : null}

      <section aria-labelledby="titulo-dados" className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <AvatarContato nome={nome} url={contato.avatarUrl} canal={canal} tamanho="grande" />
          <h2 id="titulo-dados" className="text-titulo-secao font-medium">
            Dados
          </h2>
        </div>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Dado rotulo="Telefone">
            {contato.telefone ? <span className="tabular-nums">{telefone(contato.telefone)}</span> : "—"}
          </Dado>
          <Dado rotulo="E-mail">{contato.email ?? "—"}</Dado>
          <Dado rotulo="Tamanho">{contato.tamanhoPreferido ? (TAMANHOS[contato.tamanhoPreferido] ?? "—") : "—"}</Dado>
          <Dado rotulo="Aniversário">{contato.aniversario ? dataPuraFormatada(contato.aniversario) : "—"}</Dado>
          <Dado rotulo="Canais">
            {[contato.whatsappId && "whatsapp", contato.instagramId && "instagram", contato.facebookId && "facebook", contato.tiktokId && "tiktok"]
              .filter((c): c is string => Boolean(c))
              .map((c) => (
                <span key={c} className="mr-2 inline-flex items-center gap-1">
                  <IconeCanal canal={c} tamanho="pequeno" />
                  {rotuloDoCanal(c)}
                </span>
              ))}
            {!contato.whatsappId && !contato.instagramId && !contato.facebookId && !contato.tiktokId ? "—" : null}
          </Dado>
          <Dado rotulo="Último contato">
            {contato.ultimoContatoEm ? <Tempo valor={contato.ultimoContatoEm} /> : "—"}
          </Dado>
          <Dado rotulo="Pedidos">
            <span className="tabular-nums">{contato.pedidosContagem}</span> ·{" "}
            <Dinheiro valor={contato.pedidosValorTotal} />
          </Dado>
          <Dado rotulo="Última compra">
            {contato.ultimaCompraEm ? <Tempo valor={contato.ultimaCompraEm} formato="data" /> : "—"}
          </Dado>
          <Dado rotulo="Endereço">
            {e ? `${e.logradouro}, ${e.numero}${e.complemento ? ` ${e.complemento}` : ""} — ${e.bairro}, ${e.cidade}/${e.uf}` : "—"}
          </Dado>
        </dl>
        {contato.observacoes ? <p className="whitespace-pre-line text-corpo">{contato.observacoes}</p> : null}
      </section>

      <section aria-labelledby="titulo-etiquetas" className="flex flex-col gap-3">
        <h2 id="titulo-etiquetas" className="text-titulo-secao font-medium">
          Etiquetas
        </h2>
        <EditorEtiquetas
          contatoId={contato.id}
          lojaId={contato.lojaId}
          etiquetas={ficha.etiquetas}
          disponiveis={ficha.etiquetasDisponiveis}
          podeEditar={permissoes.editar && !anonimizado}
        />
      </section>

      <section aria-labelledby="titulo-conversas" className="flex flex-col gap-3">
        <h2 id="titulo-conversas" className="text-titulo-secao font-medium">
          Conversas
        </h2>
        {ficha.conversas.length === 0 ? (
          <p className="text-denso text-muted-foreground">Nenhuma conversa com este contato.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {ficha.conversas.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <Link href={`/conversas/${c.id}`} className="inline-flex items-center gap-2 font-medium hover:underline">
                  {c.provedor ? <IconeCanal canal={c.provedor} tamanho="pequeno" /> : null}
                  {c.contaRotulo ?? "Conversa"}
                </Link>
                <span className="flex items-center gap-2">
                  <SeloStatus dominio="status_conversa" valor={c.status} />
                  {c.ultimaMensagemEm ? (
                    <Tempo valor={c.ultimaMensagemEm} formato="lista" className="text-legenda text-texto-terciario" />
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="titulo-pedidos" className="flex flex-col gap-3">
        <h2 id="titulo-pedidos" className="text-titulo-secao font-medium">
          Pedidos
        </h2>
        {ficha.pedidos.length === 0 ? (
          <p className="text-denso text-muted-foreground">Nenhum pedido deste contato.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {ficha.pedidos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <Link href={`/pedidos/${p.id}`} className="font-medium tabular-nums hover:underline">
                  {p.numero}
                </Link>
                <span className="flex items-center gap-3">
                  <SeloStatus dominio="status_pedido" valor={p.status} />
                  <Dinheiro valor={p.total} />
                  <Tempo valor={p.criadoEm} formato="data" className="text-legenda text-texto-terciario" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConsentimentoContato
        contatoId={contato.id}
        lojaId={contato.lojaId}
        optOut={contato.optOut}
        optOutEm={contato.optOutEm ? contato.optOutEm.toISOString() : null}
        historico={lgpd.consentimentos.map((l) => ({ ...l, criadoEm: l.criadoEm.toISOString() }))}
        podeRegistrar={permissoes.optout && !anonimizado}
      />

      <AcoesLgpd
        contatoId={contato.id}
        lojaId={contato.lojaId}
        lojaNome={contato.lojaNome ?? "desta loja"}
        nome={nome}
        atualizadoEm={atualizadoEm}
        anonimizado={anonimizado}
        permissoes={permissoes}
      />

      {lgpd.solicitacoes.length > 0 ? (
        <section aria-labelledby="titulo-solicitacoes" className="flex flex-col gap-2">
          <h3 id="titulo-solicitacoes" className="text-denso font-medium">
            Solicitações registradas
          </h3>
          <ul className="flex flex-col gap-1 text-denso">
            {lgpd.solicitacoes.map((s) => (
              <li key={s.id}>
                <span className="tabular-nums">{s.protocolo}</span> — {s.tipo === "acesso" ? "acesso aos dados" : s.tipo === "eliminacao" ? "eliminação" : "correção"} ·{" "}
                <Tempo valor={s.solicitadoEm} formato="data" />
                {s.executadoEm ? " · concluída" : " · aguardando a correção"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
