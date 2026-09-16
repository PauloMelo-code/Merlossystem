"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Copiar } from "@/components/comum/copiar";
import { SeloStatus } from "@/components/comum/selo-status";
import { Tempo } from "@/components/comum/tempo";
import { Button } from "@/components/ui/button";
import { telefone as formatarTelefone } from "@/lib/formato";
import type { ContatoDoPainel } from "@/lib/conversas/dto";

/**
 * Coluna 3 (04-ui.md §5.2). Seções recolhíveis com estado lembrado neste
 * aparelho; "Pedidos" e "Etiquetas" abertas por padrão. Edição e ações de LGPD
 * moram na ficha do contato (pacote de contatos) — aqui, o contexto para a
 * vendedora: o selo de opt-out aparece ANTES de ela oferecer promoção.
 *
 * `pedidos` é o painel de venda (costura do pacote de pedidos), um componente
 * de servidor com `Suspense` próprio, recebido pronto.
 */

function useSecaoLembrada(nome: string, padrao: boolean): [boolean, () => void] {
  const [aberta, setAberta] = useState(padrao);
  useEffect(() => {
    const quadro = requestAnimationFrame(() => {
      try {
        const salvo = localStorage.getItem(`painel:${nome}`);
        if (salvo !== null) setAberta(salvo === "1");
      } catch {
        // armazenamento indisponível: fica o padrão
      }
    });
    return () => cancelAnimationFrame(quadro);
  }, [nome]);
  const alternar = () =>
    setAberta((v) => {
      try {
        localStorage.setItem(`painel:${nome}`, v ? "0" : "1");
      } catch {
        // idem
      }
      return !v;
    });
  return [aberta, alternar];
}

function Secao({ nome, titulo, padrao, children }: { nome: string; titulo: string; padrao: boolean; children: ReactNode }) {
  const [aberta, alternar] = useSecaoLembrada(nome, padrao);
  const id = `secao-${nome}`;
  return (
    <section className="border-b border-border">
      <h3>
        <button
          type="button"
          aria-expanded={aberta}
          aria-controls={id}
          onClick={alternar}
          className="flex w-full items-center justify-between px-4 py-2.5 text-denso font-semibold hover:bg-muted"
        >
          {titulo}
          <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${aberta ? "rotate-180" : ""}`} />
        </button>
      </h3>
      <div id={id} hidden={!aberta} className="px-4 pb-3">
        {children}
      </div>
    </section>
  );
}

export function PainelContato({ contato: c, pedidos }: { contato: ContatoDoPainel; pedidos: ReactNode }) {
  return (
    <aside aria-label="Painel do contato" className="flex h-full flex-col overflow-y-auto bg-card">
      <div className="flex flex-col gap-1 border-b border-border p-4">
        <p className="text-titulo-secao font-semibold">{c.nome ?? "Contato sem nome"}</p>
        {c.telefone ? (
          <p className="flex items-center gap-1 text-denso">
            <span className="tabular-nums">{formatarTelefone(c.telefone)}</span>
            <Copiar valor={c.telefone} rotulo="Copiar telefone" />
          </p>
        ) : null}
        {c.email ? <p className="truncate text-denso text-muted-foreground">{c.email}</p> : null}
        <p className="text-legenda text-muted-foreground">Loja {c.lojaNome}</p>
        <Button asChild variant="outline" size="xs" className="mt-2 self-start">
          <Link href={`/contatos/${c.id}`}>Editar</Link>
        </Button>
      </div>

      <Secao nome="pedidos" titulo="Pedidos" padrao>
        {pedidos}
      </Secao>

      <Secao nome="etiquetas" titulo="Etiquetas" padrao>
        {c.etiquetas.length === 0 ? (
          <p className="text-denso text-muted-foreground">Sem etiquetas.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {c.etiquetas.map((e) => (
              <li key={e.id} className="rounded-full border border-border px-2 py-0.5 text-legenda">
                {e.nome}
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao nome="outras" titulo="Outras conversas" padrao={false}>
        {c.outrasConversas.length === 0 ? (
          <p className="text-denso text-muted-foreground">Nenhuma outra conversa nesta loja.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {c.outrasConversas.map((o) => (
              <li key={o.id}>
                <Link href={`/conversas/${o.id}`} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-denso hover:bg-muted">
                  <span className="truncate">{o.contaRotulo}</span>
                  <SeloStatus dominio="status_conversa" valor={o.status} />
                  {o.ultimaMensagemEm ? <Tempo valor={o.ultimaMensagemEm} formato="lista" className="text-legenda text-muted-foreground" /> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao nome="lgpd" titulo="Consentimento e LGPD" padrao={false}>
        {c.optOut ? (
          <p className="mb-2 rounded-md border border-aviso-borda bg-aviso-fundo px-2 py-1 text-denso text-aviso">
            Não quer receber promoções (opt-out). Responder a ela continua liberado.
          </p>
        ) : (
          <p className="mb-2 text-denso text-muted-foreground">Sem opt-out registrado.</p>
        )}
        <p className="text-legenda text-muted-foreground">
          Exportar ou eliminar os dados da titular fica na{" "}
          <Link href={`/contatos/${c.id}`} className="text-marca-texto underline underline-offset-2">
            ficha do contato
          </Link>
          . Vale só para a loja atual.
        </p>
      </Secao>
    </aside>
  );
}
