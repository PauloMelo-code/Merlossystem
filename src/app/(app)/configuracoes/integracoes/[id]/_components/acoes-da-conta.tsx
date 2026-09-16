"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QrCode, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { ModalConfirmacaoBlock } from "@/components/comum/modal-confirmacao-block";
import {
  consultarSessaoDoAparelho,
  desconectarIntegracao,
  parearAparelho,
} from "@/lib/actions/integracoes";

type Pareamento = { qr: string | null; validadeS: number; estado: string };

const INTERVALO_CONSULTA_MS = 5_000;

/** Contagem até o QR expirar e consulta do estado enquanto a pessoa lê. */
function QrDoUazapi({
  id,
  pareamento,
  onNovoQr,
  onConectado,
}: {
  id: string;
  pareamento: Pareamento;
  onNovoQr: () => void;
  onConectado: () => void;
}) {
  const [restante, setRestante] = useState(pareamento.validadeS);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const relogio = window.setInterval(() => setRestante((s) => Math.max(0, s - 1)), 1_000);
    return () => window.clearInterval(relogio);
  }, []);

  useEffect(() => {
    const consulta = window.setInterval(async () => {
      const r = await consultarSessaoDoAparelho(id);
      if (!r.ok) setErro(r.mensagem);
      else if (r.dados.estado === "conectada") onConectado();
    }, INTERVALO_CONSULTA_MS);
    return () => window.clearInterval(consulta);
  }, [id, onConectado]);

  const expirado = restante === 0;
  return (
    <div className="flex flex-col items-center gap-3">
      {pareamento.qr && !expirado ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL gerada no servidor; next/image não se aplica
        <img src={pareamento.qr} alt="QR code para parear o aparelho no WhatsApp" className="size-64 bg-white p-2" />
      ) : (
        <p className="text-corpo text-muted-foreground">
          {pareamento.qr ? "O QR expirou." : "O uazapi não devolveu QR: a sessão pode já estar conectada."}
        </p>
      )}
      <p role="status" aria-live="polite" className="text-denso">
        {expirado ? "Gere um QR novo para continuar." : `Este QR vale por mais ${restante} s.`}
      </p>
      {erro ? <FaixaAviso tom="perigo" titulo={erro} /> : null}
      <Button variant="outline" onClick={onNovoQr}>
        Gerar novo QR
      </Button>
    </div>
  );
}

/**
 * Desconectar (block 3 s, §9.1 item 7) e parear novo aparelho no uazapi
 * (block 3 s, item 8). Nenhuma das duas é otimista: espera o servidor (§10).
 */
export function AcoesDaConta({
  id,
  rotulo,
  lojaNome,
  provedor,
  updatedAt,
  podeDesconectar,
  podeParear,
}: {
  id: string;
  rotulo: string;
  lojaNome: string;
  provedor: string;
  updatedAt: string;
  podeDesconectar: boolean;
  podeParear: boolean;
}) {
  const router = useRouter();
  const [confirmar, setConfirmar] = useState<"desconectar" | "parear" | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [versao, setVersao] = useState(updatedAt);
  const [pareamento, setPareamento] = useState<Pareamento | null>(null);
  const aoConectar = useCallback(() => {
    setPareamento(null);
    router.refresh();
  }, [router]);

  async function desconectar() {
    setOcupado(true);
    setErro("");
    const r = await desconectarIntegracao({ id, updatedAt: versao });
    setOcupado(false);
    if (!r.ok) return setErro(r.mensagem);
    router.replace("/configuracoes/integracoes");
    router.refresh();
  }

  async function parear() {
    setOcupado(true);
    setErro("");
    const r = await parearAparelho({ id, updatedAt: versao });
    setOcupado(false);
    if (!r.ok) return setErro(r.mensagem);
    setVersao(new Date(r.dados.updatedAt).toISOString());
    setConfirmar(null);
    setPareamento({ qr: r.dados.qr, validadeS: r.dados.validadeS, estado: r.dados.estado });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {erro && confirmar === null ? <FaixaAviso tom="perigo" titulo={erro} /> : null}
      {podeParear && provedor === "uazapi" ? (
        <Button variant="outline" onClick={() => { setErro(""); setConfirmar("parear"); }}>
          <QrCode aria-hidden="true" strokeWidth={2} />
          Parear novo aparelho
        </Button>
      ) : null}
      {podeDesconectar ? (
        <Button variant="destructive" onClick={() => { setErro(""); setConfirmar("desconectar"); }}>
          <Unplug aria-hidden="true" strokeWidth={2} />
          Desconectar
        </Button>
      ) : null}

      <ModalConfirmacaoBlock
        aberto={confirmar === "desconectar"}
        titulo="Desconectar conta"
        resumo={`A conta "${rotulo}" (${lojaNome}) para de receber e de enviar mensagens. A credencial guardada é apagada e a conta sai da lista.`}
        descricao="Para voltar, será preciso conectar de novo com as credenciais."
        textoConfirmar="Desconectar"
        variante="destrutiva"
        carregando={ocupado}
        {...(erro ? { erro } : {})}
        onConfirmar={() => void desconectar()}
        onCancelar={() => setConfirmar(null)}
      />

      <ModalConfirmacaoBlock
        aberto={confirmar === "parear"}
        titulo="Parear novo aparelho"
        resumo={`O aparelho atual de "${rotulo}" (${lojaNome}) é desconectado e um QR novo é gerado. Até a leitura, o número não recebe mensagens.`}
        descricao="Número não oficial pode ser banido pelo WhatsApp."
        textoConfirmar="Gerar QR"
        carregando={ocupado}
        {...(erro ? { erro } : {})}
        onConfirmar={() => void parear()}
        onCancelar={() => setConfirmar(null)}
      />

      <Dialog open={pareamento !== null} onOpenChange={(aberto) => (aberto ? null : setPareamento(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leia o QR no WhatsApp do aparelho</DialogTitle>
            <DialogDescription>WhatsApp › Aparelhos conectados › Conectar um aparelho.</DialogDescription>
          </DialogHeader>
          {pareamento ? (
            <QrDoUazapi
              key={pareamento.qr ?? "sem-qr"}
              id={id}
              pareamento={pareamento}
              onNovoQr={() => void parear()}
              onConectado={aoConectar}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
