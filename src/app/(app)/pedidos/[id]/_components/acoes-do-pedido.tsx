"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Campo } from "@/components/comum/campo";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { ModalConfirmacaoBlock } from "@/components/comum/modal-confirmacao-block";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelarPedido,
  dispensarDoMasc,
  lancarNoMasc,
  mudarStatusDoPedido,
  salvarRastreio,
  voltarParaFilaMasc,
  type PermissoesDoPedido,
} from "@/lib/actions/pedidos";
import type { Resultado } from "@/lib/erros";
import { STATUS_OPERACIONAIS } from "@/lib/validadores/pedidos";
import { tomDe } from "@/lib/ui/tons";

type Versao = { id: string; atualizadoEm: Date };
type Critica = "lancar" | "dispensar" | "cancelar";

export type PedidoParaAcoes = {
  id: string;
  lojaId: string;
  numero: string;
  total: string;
  status: string;
  mascStatus: string;
  rastreioCodigo: string | null;
  rastreioUrl: string | null;
  entregaMetodo: string | null;
  atualizadoEm: string;
};

const ENCERRADOS = new Set(["cancelado", "devolvido"]);

/**
 * Operação do pedido (04-ui.md §5.3). Masc e cancelamento são ações críticas:
 * o formulário junta o dado obrigatório e o `ModalConfirmacaoBlock` (3 s)
 * mostra o resumo antes de gravar. Nada aqui é otimista (§10).
 */
export function AcoesDoPedido({ pedido, pode }: { pedido: PedidoParaAcoes; pode: PermissoesDoPedido }) {
  const router = useRouter();
  const [versao, setVersao] = useState(pedido.atualizadoEm);
  const [erros, setErros] = useState<Record<string, string[]>>({});
  const [faixa, setFaixa] = useState<string | null>(null);
  const [critica, setCritica] = useState<Critica | null>(null);
  const [erroModal, setErroModal] = useState<string | undefined>();
  const [pendente, iniciar] = useTransition();

  const [status, setStatus] = useState(pedido.status);
  const [rastreio, setRastreio] = useState(pedido.rastreioCodigo ?? "");
  const [rastreioUrl, setRastreioUrl] = useState(pedido.rastreioUrl ?? "");
  const [vendaMasc, setVendaMasc] = useState("");
  const [observacao, setObservacao] = useState("");
  const [motivo, setMotivo] = useState("");

  const encerrado = ENCERRADOS.has(pedido.status);
  const alvo = { id: pedido.id, updatedAt: versao, loja: pedido.lojaId };

  function tratar(r: Resultado<Versao>, sucesso: string): boolean {
    if (r.ok) {
      setVersao(new Date(r.dados.atualizadoEm).toISOString());
      setErros({});
      setFaixa(null);
      toast.success(sucesso);
      router.refresh();
      return true;
    }
    setErros(r.erros ?? {});
    if (r.codigo === "COLISAO") setFaixa(r.mensagem);
    else if (r.codigo !== "VALIDACAO") toast.error(r.mensagem);
    return false;
  }

  function executar(acao: () => Promise<Resultado<Versao>>, sucesso: string) {
    iniciar(async () => {
      tratar(await acao(), sucesso);
    });
  }

  function confirmarCritica() {
    iniciar(async () => {
      const r =
        critica === "lancar"
          ? await lancarNoMasc({ ...alvo, mascVendaId: vendaMasc })
          : critica === "dispensar"
            ? await dispensarDoMasc({ ...alvo, observacao })
            : await cancelarPedido({ ...alvo, motivo });
      if (r.ok) {
        tratar(r, "Pedido atualizado.");
        setCritica(null);
      } else {
        // Erro mantém o modal aberto, com o motivo por extenso.
        setErroModal(r.erros ? Object.values(r.erros).flat().join(" ") || r.mensagem : r.mensagem);
        if (r.codigo === "COLISAO") setFaixa(r.mensagem);
      }
    });
  }

  function abrir(tipo: Critica) {
    setErroModal(undefined);
    setCritica(tipo);
  }

  const erro = (campo: string) => (erros[campo]?.[0] ? { erro: erros[campo][0] } : {});

  const resumos: Record<Critica, { titulo: string; resumo: string; botao: string }> = {
    lancar: {
      titulo: "Marcar como lançado no Masc",
      resumo: `O pedido ${pedido.numero} sai da fila "falta lançar" com a venda nº ${vendaMasc} do Masc e deixa de reservar estoque.`,
      botao: "Marcar como lançado",
    },
    dispensar: {
      titulo: "Dispensar do Masc",
      resumo: `O pedido ${pedido.numero} sai da fila sem venda no Masc. Observação: ${observacao}`,
      botao: "Dispensar",
    },
    cancelar: {
      titulo: "Cancelar pedido",
      resumo: `O pedido ${pedido.numero} será cancelado, sai da fila do Masc e libera o estoque reservado. Motivo: ${motivo}`,
      botao: "Cancelar pedido",
    },
  };

  return (
    <div className="flex flex-col gap-6">
      {faixa ? (
        <FaixaAviso
          tom="perigo"
          titulo={faixa}
          acao={
            <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()}>
              Ver versão atual
            </Button>
          }
        />
      ) : null}

      {pode.lancarMasc && !encerrado && pedido.mascStatus === "pendente" ? (
        <section aria-labelledby="masc-lancar" className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <h2 id="masc-lancar" className="text-titulo-secao font-semibold">Lançar no Masc</h2>
          <Campo nome="mascVendaId" rotulo="Número da venda no Masc" {...erro("mascVendaId")}>
            <Input
              id="mascVendaId"
              value={vendaMasc}
              maxLength={40}
              className="w-56 font-mono"
              onChange={(e) => setVendaMasc(e.target.value)}
              aria-invalid={Boolean(erros["mascVendaId"])}
            />
          </Campo>
          <div>
            <Button type="button" disabled={pendente || vendaMasc.trim() === ""} onClick={() => abrir("lancar")}>
              Marcar como lançado
            </Button>
          </div>
        </section>
      ) : null}

      {pode.dispensarMasc && !encerrado && pedido.mascStatus === "pendente" ? (
        <section aria-labelledby="masc-dispensar" className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <h2 id="masc-dispensar" className="text-titulo-secao font-semibold">Dispensar do Masc</h2>
          <Campo nome="observacao" rotulo="Por que este pedido não vai para o Masc?" {...erro("observacao")}>
            <Textarea
              id="observacao"
              value={observacao}
              maxLength={255}
              onChange={(e) => setObservacao(e.target.value)}
              aria-invalid={Boolean(erros["observacao"])}
            />
          </Campo>
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={pendente || observacao.trim().length < 8}
              onClick={() => abrir("dispensar")}
            >
              Dispensar
            </Button>
          </div>
        </section>
      ) : null}

      {pode.lancarMasc && !encerrado && pedido.mascStatus !== "pendente" ? (
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={pendente}
            onClick={() => executar(() => voltarParaFilaMasc(alvo), "Pedido voltou para a fila do Masc.")}
          >
            Voltar para a fila do Masc
          </Button>
          <p className="mt-1 text-legenda text-muted-foreground">O número da venda anterior fica guardado.</p>
        </div>
      ) : null}

      {pode.editar && !encerrado ? (
        <section aria-labelledby="operacao" className="flex flex-col gap-4 rounded-lg border border-border p-4">
          <h2 id="operacao" className="text-titulo-secao font-semibold">Andamento</h2>
          <div className="flex flex-wrap items-end gap-3">
            <Campo nome="status" rotulo="Status" {...erro("status")}>
              <select
                id="status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-denso"
              >
                {STATUS_OPERACIONAIS.map((s) => (
                  <option key={s} value={s}>
                    {tomDe("status_pedido", s)?.rotulo ?? s}
                  </option>
                ))}
              </select>
            </Campo>
            <Button
              type="button"
              variant="outline"
              disabled={pendente || status === pedido.status}
              onClick={() => executar(() => mudarStatusDoPedido({ ...alvo, status }), "Status atualizado.")}
            >
              Salvar status
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Campo nome="rastreioCodigo" rotulo="Código de rastreio" {...erro("rastreioCodigo")}>
              <Input
                id="rastreioCodigo"
                value={rastreio}
                maxLength={60}
                className="w-56 font-mono"
                onChange={(e) => setRastreio(e.target.value)}
              />
            </Campo>
            <Campo nome="rastreioUrl" rotulo="Link de rastreio" opcional {...erro("rastreioUrl")}>
              <Input
                id="rastreioUrl"
                type="url"
                inputMode="url"
                value={rastreioUrl}
                placeholder="https://"
                className="w-72"
                onChange={(e) => setRastreioUrl(e.target.value)}
              />
            </Campo>
            <Button
              type="button"
              variant="outline"
              disabled={pendente || rastreio.trim() === ""}
              onClick={() =>
                executar(
                  () =>
                    salvarRastreio({
                      ...alvo,
                      rastreioCodigo: rastreio,
                      rastreioUrl,
                      entregaMetodo: pedido.entregaMetodo ?? "",
                    }),
                  "Rastreio salvo.",
                )
              }
            >
              Salvar rastreio
            </Button>
          </div>
        </section>
      ) : null}

      {pode.cancelar && !encerrado ? (
        <section aria-labelledby="cancelar" className="flex flex-col gap-3 rounded-lg border border-perigo-borda p-4">
          <h2 id="cancelar" className="text-titulo-secao font-semibold">Cancelar pedido</h2>
          <Campo nome="motivo" rotulo="Motivo do cancelamento" {...erro("motivo")}>
            <Textarea
              id="motivo"
              value={motivo}
              maxLength={255}
              onChange={(e) => setMotivo(e.target.value)}
              aria-invalid={Boolean(erros["motivo"])}
            />
          </Campo>
          <div>
            <Button
              type="button"
              variant="destructive"
              disabled={pendente || motivo.trim().length < 8}
              onClick={() => abrir("cancelar")}
            >
              Cancelar pedido
            </Button>
          </div>
        </section>
      ) : null}

      {critica ? (
        <ModalConfirmacaoBlock
          aberto
          titulo={resumos[critica].titulo}
          resumo={resumos[critica].resumo}
          textoConfirmar={resumos[critica].botao}
          variante={critica === "cancelar" ? "destrutiva" : "padrao"}
          carregando={pendente}
          {...(erroModal ? { erro: erroModal } : {})}
          onConfirmar={confirmarCritica}
          onCancelar={() => setCritica(null)}
        />
      ) : null}
    </div>
  );
}
