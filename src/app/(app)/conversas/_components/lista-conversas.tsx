"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { Button } from "@/components/ui/button";
import { listarConversas, resumoDoAtendimento } from "@/lib/actions/conversas";
import type { PaginaDeConversas } from "@/lib/conversas/dto";
import { LinhaConversa } from "./linha-conversa";
import { useTempoReal } from "./tempo-real";

/**
 * Coluna 1 (04-ui.md §5.2). Primeira página vem do servidor; "Carregar mais"
 * segue o cursor `(ultima_mensagem_em, id)`.
 *
 * Tempo real: conversa nova sobe — MAS, se o ponteiro ou o foco estão na lista
 * ou houve rolagem, aparece a pílula "N conversas atualizadas · Mostrar"
 * (`aria-live="polite"`) em vez de a lista pular debaixo do dedo.
 */

export function ListaConversas({
  inicial,
  selecionadaId,
}: {
  inicial: PaginaDeConversas;
  selecionadaId: string | null;
}) {
  const parametros = useSearchParams();
  const [itens, setItens] = useState(inicial.itens);
  const [proximo, setProximo] = useState(inicial.proximo);
  const [pendentes, setPendentes] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [agora] = useState(() => Date.now());
  const ocupada = useRef(false);
  const rolagem = useRef<HTMLDivElement>(null);

  const filtros = () => Object.fromEntries(parametros.entries());

  // Releitura pelo resumo: é automática (evento ou polling) e não renova a inatividade.
  async function recarregar() {
    const r = await resumoDoAtendimento(filtros());
    if (!r.ok) return;
    setItens(r.dados.lista.itens);
    setProximo(r.dados.lista.proximo);
    setPendentes(0);
  }

  const { estado } = useTempoReal((e) => {
    if (e.tipo === "mensagem-atualizada" || e.tipo === "integracao-atualizada") return;
    const rolou = (rolagem.current?.scrollTop ?? 0) > 8;
    if (e.tipo !== "reconciliar" && (ocupada.current || rolou)) {
      setPendentes((n) => n + 1);
      return;
    }
    void recarregar();
  });

  async function carregarMais() {
    if (!proximo) return;
    setCarregando(true);
    setErro("");
    const r = await listarConversas({ ...filtros(), cursor: proximo });
    setCarregando(false);
    if (!r.ok) {
      setErro(r.mensagem);
      return;
    }
    setItens((atuais) => [...atuais, ...r.dados.itens.filter((n) => !atuais.some((a) => a.id === n.id))]);
    setProximo(r.dados.proximo);
  }

  const sufixo = parametros.toString();
  const hrefDe = (id: string) => `/conversas/${id}${sufixo ? `?${sufixo}` : ""}`;
  const temFiltro = [...parametros.keys()].some((k) => k !== "visao");

  return (
    <div
      ref={rolagem}
      className="relative min-h-0 flex-1 overflow-y-auto"
      onPointerEnter={() => (ocupada.current = true)}
      onPointerLeave={() => (ocupada.current = false)}
      onFocus={() => (ocupada.current = true)}
      onBlur={() => (ocupada.current = false)}
    >
      <div aria-live="polite" className="sticky top-0 z-10 flex justify-center">
        {pendentes > 0 ? (
          <Button type="button" size="xs" className="mt-2 shadow-1" onClick={() => void recarregar()}>
            {pendentes === 1 ? "1 conversa atualizada" : `${pendentes} conversas atualizadas`} · Mostrar
          </Button>
        ) : null}
      </div>
      {estado === "polling" ? (
        <p className="px-3 py-2 text-legenda text-aviso">Atualização automática pausada. A lista confere a cada 15 s.</p>
      ) : null}

      {itens.length === 0 ? (
        <EstadoVazio
          titulo={temFiltro ? "Nenhuma conversa com esses filtros." : parametros.get("visao") === "minhas" ? "Nenhuma conversa com você agora." : "Nenhuma conversa por aqui."}
          descricao={temFiltro ? "Limpe os filtros para ver todas." : "As mensagens novas aparecem aqui sozinhas."}
        />
      ) : (
        <ul aria-label="Conversas">
          {itens.map((item) => (
            <LinhaConversa
              key={item.id}
              item={item}
              href={hrefDe(item.id)}
              selecionada={item.id === selecionadaId}
              agora={agora}
            />
          ))}
        </ul>
      )}

      {proximo ? (
        <div className="flex flex-col items-center gap-1 p-3">
          <Button type="button" variant="outline" size="sm" disabled={carregando} onClick={() => void carregarMais()}>
            {carregando ? "Carregando…" : "Carregar mais"}
          </Button>
          {erro ? <p role="alert" className="text-legenda text-perigo">{erro}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
