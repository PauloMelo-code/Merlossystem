"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  abrirConversa,
  arquivarConversa,
  carregarMensagensAnteriores,
  enviarMensagem,
  marcarConversaComoLida,
  mudarPrioridadeDaConversa,
  reabrirConversa,
  reenviarMensagemFalha,
  resolverConversa,
  transferirConversa,
} from "@/lib/actions/conversas";
import type { Resultado } from "@/lib/erros";
import type { AtendimentoAberto, ConversaDto, MensagemDto, ResultadoDeGestao } from "@/lib/conversas/dto";
import { cn } from "cn";
import type { MensagemNaTela } from "./balao-mensagem";
import { CabecalhoConversa } from "./cabecalho-conversa";
import { Composer, type PedidoDeEnvio } from "./composer";
import { DialogoTransferir } from "./dialogo-transferir";
import { LinhaDoTempo } from "./linha-do-tempo";
import { PainelContato } from "./painel-contato";
import { useTempoReal } from "./tempo-real";

/**
 * Coluna 2 + coluna 3 (04-ui.md §5.2). Estado local rico, action só no envio
 * (exceção consciente do §7.1): envio OTIMISTA com chave de idempotência gerada
 * aqui, rollback visível (a bolha fica "Não entregue" com o motivo) e
 * reconciliação completa a cada evento do tempo real.
 */

function unir(atuais: MensagemNaTela[], novas: MensagemDto[]): MensagemNaTela[] {
  const mapa = new Map<string, MensagemNaTela>();
  // Otimistas ficam até a action responder: quem as remove é o próprio envio.
  for (const m of atuais) mapa.set(m.id, m);
  for (const m of novas) mapa.set(m.id, m);
  return [...mapa.values()].sort((a, b) => a.ocorridaEm.localeCompare(b.ocorridaEm));
}

const ACOES_INVERSAS = {
  resolver: { nome: "Conversa resolvida", inversa: reabrirConversa },
  reabrir: { nome: "Conversa reaberta", inversa: resolverConversa },
  arquivar: { nome: "Conversa arquivada", inversa: reabrirConversa },
} as const;

export function Chat({
  inicial,
  voltarPara,
  pedidos,
}: {
  inicial: AtendimentoAberto;
  voltarPara: string;
  pedidos: ReactNode;
}) {
  const router = useRouter();
  const [conversa, setConversa] = useState<ConversaDto>(inicial.conversa);
  const [mensagens, setMensagens] = useState<MensagemNaTela[]>(inicial.mensagens.itens);
  const [anterior, setAnterior] = useState(inicial.mensagens.anterior);
  const [carregandoAnteriores, setCarregandoAnteriores] = useState(false);
  const [painel, setPainel] = useState(true);
  const [transferindo, setTransferindo] = useState(false);
  const [anuncio, setAnuncio] = useState("");
  // O divisor "Novas mensagens" fica preso à primeira não lida DA ABERTURA.
  const [primeiraNova] = useState(() =>
    inicial.conversa.naoLidas > 0
      ? (inicial.mensagens.itens.filter((m) => m.direcao === "entrada").slice(-inicial.conversa.naoLidas)[0]?.id ?? null)
      : null,
  );
  const podeEscrever = conversa.bloqueio?.caso !== "somente_leitura";

  useEffect(() => {
    if (inicial.conversa.naoLidas > 0 && podeEscrever) void marcarConversaComoLida({ conversaId: inicial.conversa.id });
  }, [inicial.conversa.id, inicial.conversa.naoLidas, podeEscrever]);

  function tratarFalha(r: Extract<Resultado<unknown>, { ok: false }>): string {
    if (r.codigo === "NAO_AUTENTICADO") router.replace("/entrar?motivo=sessao");
    return r.mensagem;
  }

  async function recarregar() {
    const r = await abrirConversa({ conversaId: conversa.id });
    if (!r.ok) return;
    const antes = new Set(mensagens.map((m) => m.id));
    const chegou = r.dados.mensagens.itens.filter((m) => !antes.has(m.id) && m.direcao === "entrada");
    const ultima = chegou.at(-1);
    if (ultima) {
      const corpo = (ultima.conteudo ?? "").replace(/\s+/g, " ").slice(0, 80);
      setAnuncio(`Nova mensagem de ${r.dados.conversa.contatoNome}${corpo ? `: ${corpo}` : ""}`);
      if (document.visibilityState === "visible" && podeEscrever) {
        void marcarConversaComoLida({ conversaId: conversa.id });
      }
    }
    setConversa(r.dados.conversa);
    setMensagens((atuais) => unir(atuais, r.dados.mensagens.itens));
  }

  const { estado } = useTempoReal((e) => {
    if (e.tipo === "reconciliar" || e.conversaId === conversa.id || e.tipo === "integracao-atualizada") {
      void recarregar();
    }
  });

  async function carregarAnteriores() {
    if (!anterior) return;
    setCarregandoAnteriores(true);
    const r = await carregarMensagensAnteriores({ conversaId: conversa.id, cursor: anterior });
    setCarregandoAnteriores(false);
    if (!r.ok) {
      toast.error(tratarFalha(r));
      return;
    }
    setMensagens((atuais) => unir(atuais, r.dados.itens));
    setAnterior(r.dados.anterior);
  }

  async function enviar(p: PedidoDeEnvio, chave = crypto.randomUUID()): Promise<string | null> {
    const comModelo = Boolean(p.modeloId);
    if (!comModelo) {
      const otimista: MensagemNaTela = {
        id: chave,
        direcao: "saida",
        autorTipo: "usuario",
        autorNome: "Você",
        doAparelho: false,
        conteudo: p.conteudo,
        tipo: "texto",
        status: p.nota ? null : "pendente",
        falhaMotivo: null,
        notaInterna: p.nota,
        ocorridaEm: new Date().toISOString(),
        cartao: null,
        midias: [],
        otimista: true,
      };
      setMensagens((atuais) => [...atuais.filter((m) => m.id !== chave), otimista]);
    }
    const r = await enviarMensagem({
      conversaId: conversa.id,
      conteudo: p.conteudo,
      chaveIdempotencia: chave,
      notaInterna: p.nota,
      modeloId: p.modeloId,
      variaveis: p.variaveis ?? [],
    });
    if (!r.ok) {
      const motivo = tratarFalha(r);
      if (comModelo) return motivo;
      setMensagens((atuais) =>
        atuais.map((m) => (m.id === chave ? { ...m, status: "falhou", falhaMotivo: motivo } : m)),
      );
      return null;
    }
    setMensagens((atuais) => atuais.filter((m) => m.id !== chave));
    if (r.dados.conversaId !== conversa.id) {
      router.push(`/conversas/${r.dados.conversaId}`);
      return null;
    }
    await recarregar();
    return null;
  }

  async function reenviar(id: string) {
    const alvo = mensagens.find((m) => m.id === id);
    if (!alvo) return;
    if (alvo.otimista) {
      await enviar({ conteudo: alvo.conteudo ?? "", nota: alvo.notaInterna }, alvo.id);
      return;
    }
    setMensagens((atuais) => atuais.map((m) => (m.id === id ? { ...m, status: "pendente", falhaMotivo: null } : m)));
    const r = await reenviarMensagemFalha({ mensagemId: id });
    if (!r.ok) toast.error(tratarFalha(r));
    await recarregar();
  }

  async function gerir(
    rotulo: string,
    acao: (d: unknown) => Promise<Resultado<ResultadoDeGestao>>,
    dados: Record<string, unknown>,
    desfazer?: (novo: ResultadoDeGestao) => Promise<Resultado<ResultadoDeGestao>>,
  ) {
    const r = await acao({ conversaId: conversa.id, updatedAt: conversa.updatedAt, ...dados });
    if (!r.ok) {
      toast.error(tratarFalha(r));
      if (r.codigo === "COLISAO") await recarregar();
      return;
    }
    await recarregar();
    toast(rotulo, {
      duration: 5000,
      ...(desfazer
        ? {
            action: {
              label: "Desfazer",
              onClick: () => {
                void desfazer(r.dados).then(async (volta) => {
                  if (!volta.ok) toast.error(tratarFalha(volta));
                  await recarregar();
                });
              },
            },
          }
        : {}),
    });
  }

  function mudarStatus(tipo: keyof typeof ACOES_INVERSAS) {
    const acao = tipo === "resolver" ? resolverConversa : tipo === "reabrir" ? reabrirConversa : arquivarConversa;
    const { nome, inversa } = ACOES_INVERSAS[tipo];
    void gerir(nome, acao, {}, (novo) => inversa({ conversaId: novo.conversaId, updatedAt: novo.updatedAt }));
  }

  const bloqueio = conversa.bloqueio ?? (estado === "offline" ? { caso: "sem_conexao" as const } : null);

  return (
    <div className="flex min-h-0 flex-1">
      <section aria-label={`Conversa com ${conversa.contatoNome}`} className="flex min-w-0 flex-1 flex-col">
        <CabecalhoConversa
          conversa={conversa}
          voltarPara={voltarPara}
          aoTransferir={() => setTransferindo(true)}
          aoResolver={() => mudarStatus("resolver")}
          aoReabrir={() => mudarStatus("reabrir")}
          aoArquivar={() => mudarStatus("arquivar")}
          aoPrioridade={(prioridade) => {
            const antes = conversa.prioridade;
            void gerir("Prioridade alterada", mudarPrioridadeDaConversa, { prioridade }, (novo) =>
              mudarPrioridadeDaConversa({ conversaId: novo.conversaId, updatedAt: novo.updatedAt, prioridade: antes }),
            );
          }}
          aoAlternarPainel={() => setPainel((v) => !v)}
        />
        <p aria-live="polite" className="sr-only">
          {anuncio}
        </p>
        <LinhaDoTempo
          mensagens={mensagens}
          primeiraNova={primeiraNova}
          temAnteriores={Boolean(anterior)}
          carregandoAnteriores={carregandoAnteriores}
          aoCarregarAnteriores={() => void carregarAnteriores()}
          podeReenviar={podeEscrever}
          aoReenviar={(id) => void reenviar(id)}
        />
        <Composer
          conversaId={conversa.id}
          bloqueio={bloqueio}
          aviso={conversa.aviso}
          limite={conversa.limiteTexto}
          modelos={inicial.modelos}
          respostas={inicial.respostas}
          aoEnviar={(p) => enviar(p)}
        />
      </section>
      <div className={cn("hidden w-80 shrink-0 border-l border-border", painel && "lg:block")}>
        <PainelContato contato={inicial.contato} pedidos={pedidos} />
      </div>
      <DialogoTransferir
        aberto={transferindo}
        colegas={inicial.colegas}
        responsavelAtual={conversa.responsavelId}
        aoFechar={() => setTransferindo(false)}
        aoConfirmar={async (responsavelId) => {
          const antes = conversa.responsavelId;
          setTransferindo(false);
          await gerir("Conversa transferida", transferirConversa, { responsavelId }, (novo) =>
            transferirConversa({ conversaId: novo.conversaId, updatedAt: novo.updatedAt, responsavelId: antes }),
          );
        }}
      />
    </div>
  );
}
