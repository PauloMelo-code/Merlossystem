"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileDown, FilePen, ShieldX } from "lucide-react";
import { toast } from "sonner";
import { Campo, idsDeApoio } from "@/components/comum/campo";
import { ModalConfirmacaoBlock } from "@/components/comum/modal-confirmacao-block";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  eliminarDadosDoTitular,
  iniciarExportacaoDoDossie,
  registrarPedidoDeCorrecao,
} from "@/lib/actions/lgpd";
import type { Resultado } from "@/lib/erros";
import { motivoLgpdSchema, protocoloSchema } from "@/lib/validadores/lgpd";
import { baixarArquivo, hojeParaArquivo } from "./baixar";
import { montarDossie } from "./montar-dossie";

/**
 * Direitos do titular na ficha (04-ui.md §5.3 e §9.1; 02-seguranca.md §16).
 *
 *   Exportar dossiê  (item 19 do block) — `lgpd:exportar`
 *   Eliminar dados   (item 20 do block) — `lgpd:anonimizar`
 *   Pedido de correção (sem block: só registra o protocolo) — `lgpd:registrar_solicitacao`
 *
 * Todos pedem protocolo e motivo ANTES do modal, e o modal repete o que vai
 * acontecer. Eliminar avisa que vale SÓ nesta loja e que pedidos permanecem
 * (registro fiscal). Nada aqui é otimista.
 */

type Fluxo = "exportar" | "eliminar" | "corrigir";

const TEXTOS: Readonly<Record<Fluxo, { titulo: string; descricao: string; botao: string }>> = {
  exportar: {
    titulo: "Exportar dados do titular",
    descricao: "Gera um arquivo com tudo o que esta loja guarda sobre a pessoa. O download fica registrado.",
    botao: "Continuar",
  },
  eliminar: {
    titulo: "Eliminar dados do titular",
    descricao:
      "Nome, telefone, e-mail, endereço, mensagens, legendas e mídias recebidas são apagados de forma irreversível. " +
      "Vale só nesta loja: se a pessoa também é cliente da outra loja, lá é outro pedido. " +
      "Os pedidos permanecem, com valores e número, porque são registro fiscal.",
    botao: "Continuar",
  },
  corrigir: {
    titulo: "Registrar pedido de correção",
    descricao: "Registra o protocolo. A correção em si é feita em Editar, e fica na trilha.",
    botao: "Registrar pedido",
  },
};

export interface AcoesLgpdProps {
  contatoId: string;
  lojaId: string;
  lojaNome: string;
  nome: string;
  atualizadoEm: string;
  anonimizado: boolean;
  permissoes: { exportar: boolean; anonimizar: boolean; registrarSolicitacao: boolean };
}

type Erros = { protocolo?: string; motivo?: string };

function primeiroErro(r: Resultado<unknown>): string {
  if (r.ok) return "";
  return r.erros?.protocolo?.[0] ?? r.erros?.motivo?.[0] ?? r.mensagem;
}

export function AcoesLgpd(props: AcoesLgpdProps) {
  const { contatoId, lojaId, lojaNome, nome, atualizadoEm, anonimizado, permissoes } = props;
  const router = useRouter();
  const [fluxo, setFluxo] = useState<Fluxo | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [protocolo, setProtocolo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erros, setErros] = useState<Erros>({});
  const [erroDoBlock, setErroDoBlock] = useState<string | undefined>();
  const [progresso, setProgresso] = useState("");
  const [processando, iniciar] = useTransition();

  function abrir(novo: Fluxo) {
    setFluxo(novo);
    setConfirmando(false);
    setErros({});
    setErroDoBlock(undefined);
    setProgresso("");
  }

  function fechar() {
    setFluxo(null);
    setConfirmando(false);
  }

  function continuar() {
    const p = protocoloSchema.safeParse(protocolo);
    const m = motivoLgpdSchema.safeParse(motivo);
    const novos: Erros = {
      ...(p.success ? {} : { protocolo: p.error.issues[0]?.message ?? "Protocolo inválido." }),
      ...(m.success ? {} : { motivo: m.error.issues[0]?.message ?? "Motivo inválido." }),
    };
    setErros(novos);
    if (novos.protocolo || novos.motivo) return;
    if (fluxo === "corrigir") {
      iniciar(async () => {
        const r = await registrarPedidoDeCorrecao({ contatoId, loja: lojaId, tipo: "correcao", protocolo, motivo });
        if (!r.ok) {
          setErros({ protocolo: primeiroErro(r) });
          return;
        }
        fechar();
        toast.success("Pedido de correção registrado. Corrija os dados em Editar.");
        router.refresh();
      });
      return;
    }
    setErroDoBlock(undefined);
    setConfirmando(true);
  }

  function exportar() {
    iniciar(async () => {
      const aberta = await iniciarExportacaoDoDossie({ contatoId, loja: lojaId, protocolo, motivo });
      if (!aberta.ok) {
        setErroDoBlock(primeiroErro(aberta));
        return;
      }
      const montado = await montarDossie(aberta.dados.solicitacaoId, lojaId, aberta.dados.secoes, (p) =>
        setProgresso(`Reunindo ${p.secao}: ${p.linhas} registros…`),
      );
      if (!montado.ok) {
        setErroDoBlock(montado.mensagem);
        return;
      }
      const arquivo = {
        protocolo,
        loja: lojaNome,
        geradoEm: new Date().toISOString(),
        aviso: "Dados que esta loja guarda sobre o titular. Documento pessoal: não compartilhe.",
        ...montado.dados,
      };
      baixarArquivo(
        `dossie-${protocolo}-${hojeParaArquivo()}.json`,
        JSON.stringify(arquivo, null, 2),
        "application/json;charset=utf-8",
      );
      fechar();
      toast.success("Dossiê exportado.");
    });
  }

  function eliminar() {
    iniciar(async () => {
      const r = await eliminarDadosDoTitular({ contatoId, loja: lojaId, updatedAt: atualizadoEm, protocolo, motivo });
      if (!r.ok) {
        setErroDoBlock(primeiroErro(r));
        return;
      }
      fechar();
      toast.success("Dados do titular eliminados nesta loja.");
      router.refresh();
    });
  }

  const nenhuma = !permissoes.exportar && !(permissoes.anonimizar && !anonimizado) && !permissoes.registrarSolicitacao;
  if (nenhuma) return null;

  const texto = fluxo ? TEXTOS[fluxo] : null;

  return (
    <section aria-labelledby="titulo-lgpd" className="flex flex-col gap-3">
      <h2 id="titulo-lgpd" className="text-titulo-secao font-medium">
        Direitos do titular (LGPD)
      </h2>
      <p className="text-denso text-muted-foreground">Vale só para a loja {lojaNome}.</p>
      <div className="flex flex-wrap gap-2">
        {permissoes.exportar ? (
          <Button type="button" variant="outline" onClick={() => abrir("exportar")}>
            <FileDown aria-hidden="true" strokeWidth={2} />
            Exportar dossiê
          </Button>
        ) : null}
        {permissoes.registrarSolicitacao && !anonimizado ? (
          <Button type="button" variant="outline" onClick={() => abrir("corrigir")}>
            <FilePen aria-hidden="true" strokeWidth={2} />
            Pedido de correção
          </Button>
        ) : null}
        {permissoes.anonimizar && !anonimizado ? (
          <Button type="button" variant="destructive" onClick={() => abrir("eliminar")}>
            <ShieldX aria-hidden="true" strokeWidth={2} />
            Eliminar dados
          </Button>
        ) : null}
      </div>

      <Dialog open={Boolean(fluxo) && !confirmando} onOpenChange={(aberto) => (aberto ? null : fechar())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{texto?.titulo}</DialogTitle>
            <DialogDescription>{texto?.descricao}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Campo nome="protocolo" rotulo="Protocolo do pedido" ajuda="O número que a pessoa recebeu." {...(erros.protocolo ? { erro: erros.protocolo } : {})}>
              <Input
                id="protocolo"
                value={protocolo}
                onChange={(e) => setProtocolo(e.target.value)}
                autoComplete="off"
                aria-invalid={Boolean(erros.protocolo)}
                aria-describedby={idsDeApoio("protocolo", { ajuda: "sim", erro: erros.protocolo })}
              />
            </Campo>
            <Campo nome="motivo" rotulo="Motivo" ajuda="Não escreva dados pessoais aqui." {...(erros.motivo ? { erro: erros.motivo } : {})}>
              <Textarea
                id="motivo"
                rows={2}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                aria-invalid={Boolean(erros.motivo)}
                aria-describedby={idsDeApoio("motivo", { ajuda: "sim", erro: erros.motivo })}
              />
            </Campo>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={fechar}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant={fluxo === "eliminar" ? "destructive" : "default"}
              onClick={continuar}
              disabled={processando}
              aria-busy={processando}
            >
              {texto?.botao}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ModalConfirmacaoBlock
        aberto={confirmando && fluxo === "exportar"}
        titulo="Exportar dossiê do titular"
        resumo={`Você vai exportar todos os dados de ${nome} guardados na loja ${lojaNome} (protocolo ${protocolo}).`}
        descricao={progresso || "O arquivo contém dados pessoais. Entregue somente ao titular."}
        textoConfirmar="Exportar"
        carregando={processando}
        {...(erroDoBlock ? { erro: erroDoBlock } : {})}
        onConfirmar={exportar}
        onCancelar={fechar}
      />

      <ModalConfirmacaoBlock
        aberto={confirmando && fluxo === "eliminar"}
        titulo="Eliminar dados do titular"
        resumo={`Você vai eliminar, sem volta, os dados pessoais de ${nome} na loja ${lojaNome} (protocolo ${protocolo}).`}
        descricao="Mensagens viram “[removido a pedido do titular]”. Os pedidos permanecem, sem identificação. A outra loja não é afetada."
        textoConfirmar="Eliminar dados"
        variante="destrutiva"
        carregando={processando}
        {...(erroDoBlock ? { erro: erroDoBlock } : {})}
        onConfirmar={eliminar}
        onCancelar={fechar}
      />
    </section>
  );
}
