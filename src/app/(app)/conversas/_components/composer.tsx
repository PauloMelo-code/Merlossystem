"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MessageSquareQuote, Send, StickyNote } from "lucide-react";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { hora } from "@/lib/formato";
import { cn } from "cn";
import type { ModeloDto, RespostaRapidaDto } from "@/lib/conversas/dto";
import type { BloqueioDoComposer } from "@/lib/conversas/regras";
import { BotaoAnexar, motivoDeRecusa, PreviaDoAnexo, subirAnexo } from "./anexos";
import { EscolherModelo } from "./escolher-modelo";
import { MenuRespostasRapidas } from "./menu-respostas-rapidas";

/**
 * Composer (04-ui.md §5.2). Segmentado Responder | Nota interna; Enter envia
 * no desktop e quebra linha no celular; rascunho por conversa em
 * `sessionStorage` (com try/catch); contador a partir de 90% do limite.
 * Anexo por botão, colar ou arrastar, com prévia e legenda antes de enviar
 * (só na resposta à cliente, e só em número que sobe anexo).
 *
 * Bloqueado em EXATAMENTE quatro casos, sempre com explicação e saída:
 * janela de 24 h, número desconectado, papel sem escrita e sem conexão.
 * Opt-out NÃO bloqueia (é de marketing).
 */

export type PedidoDeEnvio = {
  conteudo: string;
  nota: boolean;
  modeloId?: string;
  variaveis?: string[];
  /** Mídia já guardada pela rota de upload; `conteudo` é a legenda. */
  midiaId?: string;
};

function lerRascunho(chave: string): string {
  try {
    return sessionStorage.getItem(chave) ?? "";
  } catch {
    return "";
  }
}

function gravarRascunho(chave: string, valor: string): void {
  try {
    if (valor) sessionStorage.setItem(chave, valor);
    else sessionStorage.removeItem(chave);
  } catch {
    // modo privado ou cota cheia: o rascunho só não sobrevive ao recarregar
  }
}

export function Composer({
  conversaId,
  lojaId,
  aceitaAnexo,
  bloqueio,
  aviso,
  limite,
  modelos,
  respostas,
  aoEnviar,
}: {
  conversaId: string;
  lojaId: string;
  aceitaAnexo: boolean;
  bloqueio: BloqueioDoComposer | null;
  aviso: string | null;
  limite: number;
  modelos: readonly ModeloDto[];
  respostas: readonly RespostaRapidaDto[];
  aoEnviar: (p: PedidoDeEnvio) => Promise<string | null>;
}) {
  const chave = `rascunho:${conversaId}`;
  const [texto, setTexto] = useState("");
  const [nota, setNota] = useState(false);
  const [erro, setErro] = useState("");
  const [menu, setMenu] = useState(false);
  const [modelo, setModelo] = useState(false);
  const [anexo, setAnexo] = useState<File | null>(null);
  const [progresso, setProgresso] = useState<number | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  // O rascunho mora no navegador: lido depois da hidratação, fora do render.
  useEffect(() => {
    const quadro = requestAnimationFrame(() => {
      const salvo = lerRascunho(chave);
      if (salvo) setTexto(salvo);
    });
    return () => cancelAnimationFrame(quadro);
  }, [chave]);

  if (bloqueio?.caso === "somente_leitura") {
    return (
      <div className="border-t border-border p-3">
        <FaixaAviso tom="neutro" titulo="Você tem acesso só de leitura nesta loja." />
      </div>
    );
  }

  const desconectado = bloqueio?.caso === "desconectado";
  const janela = bloqueio?.caso === "janela_24h";
  const semConexao = bloqueio?.caso === "sem_conexao";
  // Número caído ou janela fechada: a nota interna continua (não sai do sistema).
  const soNota = desconectado || janela;
  const emNota = nota || soNota;
  const perto = texto.length >= limite * 0.9;
  const podeAnexar = aceitaAnexo && !emNota && !semConexao;
  const comAnexo = anexo !== null && podeAnexar;
  const subindo = progresso !== null;

  function mudar(valor: string) {
    setTexto(valor);
    gravarRascunho(chave, valor);
    setMenu(valor.startsWith("/") && !emNota && !valor.includes("\n"));
  }

  function escolher(arquivo: File) {
    if (!podeAnexar) return;
    const recusa = motivoDeRecusa(arquivo);
    setErro(recusa ?? "");
    setAnexo(recusa ? null : arquivo);
  }

  /** Sobe o arquivo e só então registra a mensagem; falha mantém anexo e legenda. */
  async function enviarAnexo(arquivo: File, legenda: string) {
    setErro("");
    setProgresso(0);
    const subida = await subirAnexo(arquivo, lojaId, (f) => setProgresso(Math.round(f * 100)));
    const falha = subida.ok ? await aoEnviar({ conteudo: legenda, nota: false, midiaId: subida.id }) : subida.motivo;
    setProgresso(null);
    if (falha) {
      setErro(falha);
      return;
    }
    setAnexo(null);
    mudar("");
    campo.current?.focus();
  }

  async function enviar() {
    const conteudo = texto.trim();
    if (semConexao || subindo || conteudo.length > limite) return;
    if (comAnexo) return enviarAnexo(anexo, conteudo);
    if (!conteudo) return;
    setErro("");
    setTexto("");
    gravarRascunho(chave, "");
    const falha = await aoEnviar({ conteudo, nota: emNota });
    if (falha) {
      setErro(falha);
      setTexto(conteudo);
      gravarRascunho(chave, conteudo);
    }
    campo.current?.focus();
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menu) return;
    const celular = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !celular) {
      e.preventDefault();
      void enviar();
    }
  }

  // Arrastar um arquivo sobre o composer: o primeiro vira o anexo.
  function soltar(e: React.DragEvent<HTMLDivElement>) {
    const arquivo = e.dataTransfer.files[0];
    if (!arquivo || !podeAnexar) return;
    e.preventDefault();
    escolher(arquivo);
  }

  return (
    <div
      className={cn("border-t border-border p-3", emNota && "bg-nota-interna-fundo")}
      onDragOver={(e) => {
        if (podeAnexar) e.preventDefault();
      }}
      onDrop={soltar}
    >
      {desconectado && bloqueio.caso === "desconectado" ? (
        <FaixaAviso
          tom="perigo"
          titulo={`O número ${bloqueio.conta} está desconectado${bloqueio.desde ? ` desde ${hora(new Date(bloqueio.desde))}` : ""}. Mensagens não serão enviadas.`}
          acao={
            bloqueio.podeReconectar ? (
              <Button asChild size="xs" variant="outline">
                <Link href="/configuracoes/integracoes">Reconectar</Link>
              </Button>
            ) : (
              <span className="text-denso">Avise o administrador.</span>
            )
          }
        />
      ) : null}
      {janela ? (
        <FaixaAviso
          tom="aviso"
          titulo="Passaram 24h desde a última mensagem da cliente. Só dá para enviar um modelo aprovado."
          acao={
            <Button type="button" size="xs" variant="outline" onClick={() => setModelo(true)}>
              Escolher modelo
            </Button>
          }
        />
      ) : null}
      {semConexao ? (
        <FaixaAviso tom="perigo" titulo="Sem conexão. Não é possível enviar agora." descricao="O rascunho fica guardado." />
      ) : null}
      {aviso && !soNota ? <p className="mb-2 text-legenda text-muted-foreground">{aviso}</p> : null}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div role="group" aria-label="Tipo de mensagem" className="inline-flex rounded-md border border-border p-0.5">
          <button
            type="button"
            aria-pressed={!emNota}
            disabled={soNota}
            onClick={() => setNota(false)}
            className={cn("rounded px-2.5 py-1 text-denso disabled:opacity-50", !emNota && "bg-accent font-medium text-marca-texto")}
          >
            Responder
          </button>
          <button
            type="button"
            aria-pressed={emNota}
            disabled={subindo}
            onClick={() => {
              setNota(true);
              setAnexo(null);
            }}
            className={cn("inline-flex items-center gap-1 rounded px-2.5 py-1 text-denso", emNota && "bg-card font-medium")}
          >
            <StickyNote aria-hidden="true" className="size-3.5" />
            Nota interna
          </button>
        </div>
        {perto ? (
          <span className={cn("text-legenda tabular-nums", texto.length > limite ? "text-perigo" : "text-muted-foreground")}>
            {texto.length}/{limite}
          </span>
        ) : null}
      </div>

      <div className="relative mt-2">
        {menu ? (
          <MenuRespostasRapidas
            respostas={respostas}
            termo={texto.slice(1)}
            aoEscolher={(conteudo) => {
              mudar(conteudo);
              setMenu(false);
              campo.current?.focus();
            }}
            aoFechar={() => setMenu(false)}
          />
        ) : null}
        <label htmlFor={`composer-${conversaId}`} className="sr-only">
          {emNota ? "Nota interna" : "Mensagem"}
        </label>
        <Textarea
          id={`composer-${conversaId}`}
          ref={campo}
          rows={1}
          value={texto}
          onChange={(e) => mudar(e.target.value)}
          onKeyDown={aoTeclar}
          onPaste={(e) => {
            const arquivo = e.clipboardData.files[0];
            if (!arquivo || !podeAnexar) return;
            e.preventDefault();
            escolher(arquivo);
          }}
          placeholder={
            emNota
              ? "Escreva uma nota para a equipe (a cliente não vê)"
              : comAnexo
                ? "Legenda (opcional)"
                : "Escreva a mensagem ( / para respostas rápidas)"
          }
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? `composer-erro-${conversaId}` : undefined}
          className={cn("max-h-48 min-h-10 resize-none field-sizing-content", emNota && "bg-card")}
        />
      </div>
      {comAnexo ? <PreviaDoAnexo arquivo={anexo} progresso={progresso} aoRemover={() => setAnexo(null)} /> : null}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {aceitaAnexo ? <BotaoAnexar desabilitado={!podeAnexar || subindo} aoEscolher={escolher} /> : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={emNota}
            onClick={() => {
              mudar("/");
              campo.current?.focus();
            }}
          >
            <MessageSquareQuote aria-hidden="true" />
            Resposta rápida
          </Button>
        </div>
        <Button
          type="button"
          variant={emNota ? "outline" : "default"}
          disabled={(!texto.trim() && !comAnexo) || semConexao || subindo || texto.length > limite}
          onClick={() => void enviar()}
          className="min-w-28"
        >
          {emNota ? null : <Send aria-hidden="true" />}
          {emNota ? "Salvar nota" : "Enviar"}
        </Button>
      </div>
      {erro ? (
        <p id={`composer-erro-${conversaId}`} role="alert" className="mt-1 text-denso text-perigo">
          {erro}
        </p>
      ) : null}

      <EscolherModelo
        aberto={modelo}
        modelos={modelos}
        aoFechar={() => setModelo(false)}
        aoEnviar={(modeloId, variaveis) => aoEnviar({ conteudo: "", nota: false, modeloId, variaveis })}
      />
    </div>
  );
}
