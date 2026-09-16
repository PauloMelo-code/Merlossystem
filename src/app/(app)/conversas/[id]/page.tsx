import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { EsqueletoChat } from "@/components/comum/esqueletos/esqueleto-chat";
import { EstadoErro } from "@/components/comum/estado-erro";
import { abrirConversa } from "@/lib/actions/conversas";
import { Chat } from "../_components/chat";
import { PainelVenda } from "../_components/painel-venda";
import {
  filtrosDaUrl,
  mensagemDeFalha,
  TelaAtendimento,
  type ParametrosDaLista,
} from "../_components/tela-atendimento";

export const metadata: Metadata = { title: "Conversa" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ColunaConversa({ id, voltarPara }: { id: string; voltarPara: string }) {
  const r = await abrirConversa({ conversaId: id });
  if (!r.ok) {
    // Registro de outra loja responde igual a inexistente (INV-09).
    if (r.codigo === "NAO_ENCONTRADO" || r.codigo === "VALIDACAO") notFound();
    if (r.codigo === "NAO_AUTENTICADO") redirect("/entrar?motivo=sessao");
    const f = mensagemDeFalha(r.codigo, r.mensagem);
    return <EstadoErro titulo={f.titulo} descricao={f.descricao} />;
  }
  const { conversa } = r.dados;
  return (
    <Chat
      key={conversa.id}
      inicial={r.dados}
      voltarPara={voltarPara}
      pedidos={
        <Suspense fallback={<p className="text-denso text-muted-foreground">Carregando pedidos…</p>}>
          <PainelVenda conversaId={conversa.id} lojaId={conversa.lojaId} contatoId={conversa.contatoId} />
        </Suspense>
      }
    />
  );
}

/** `/conversas/[id]` — `conversas:ler` (04-ui.md §5.2). */
export default async function PaginaConversa({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ParametrosDaLista>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const filtros = filtrosDaUrl(await searchParams);
  const consulta = new URLSearchParams(filtros).toString();
  const voltarPara = consulta ? `/conversas?${consulta}` : "/conversas";

  return (
    <TelaAtendimento filtros={filtros} selecionadaId={id}>
      <Suspense key={id} fallback={<EsqueletoChat />}>
        <ColunaConversa id={id} voltarPara={voltarPara} />
      </Suspense>
    </TelaAtendimento>
  );
}
