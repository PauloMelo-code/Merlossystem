import type { Metadata } from "next";
import { MessagesSquare } from "lucide-react";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { filtrosDaUrl, TelaAtendimento, type ParametrosDaLista } from "./_components/tela-atendimento";

export const metadata: Metadata = { title: "Conversas" };

/**
 * `/conversas` — `conversas:ler` (04-ui.md §5.2). O portão roda na action de
 * cada leitura (o layout não cobre action nenhuma).
 */
export default async function PaginaConversas({ searchParams }: { searchParams: Promise<ParametrosDaLista> }) {
  const filtros = filtrosDaUrl(await searchParams);
  return (
    <TelaAtendimento filtros={filtros} selecionadaId={null}>
      <div className="grid h-full place-items-center bg-chat-fundo p-6">
        <EstadoVazio
          titulo="Escolha uma conversa"
          descricao="As mensagens da conversa selecionada aparecem aqui."
          acao={<MessagesSquare aria-hidden="true" className="size-8 text-muted-foreground" />}
        />
      </div>
    </TelaAtendimento>
  );
}
