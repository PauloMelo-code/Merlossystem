"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Campo } from "@/components/comum/campo";
import { ConfirmarExclusao } from "@/components/comum/confirmar-exclusao";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { ResumoDeErros } from "@/components/comum/resumo-de-erros";
import {
  alternarRespostaRapida,
  criarRespostaRapida,
  editarRespostaRapida,
  excluirRespostaRapida,
} from "@/lib/actions/conteudo";
import { CATEGORIAS_RESPOSTA } from "@/lib/db/schema/_enums/catalogo";
import type { Resultado } from "@/lib/erros";

export type Resposta = {
  id: string;
  titulo: string;
  atalho: string | null;
  categoria: string | null;
  conteudo: string;
  ativa: boolean;
  atualizadoEm: string;
};

const ROTULO_CATEGORIA: Record<(typeof CATEGORIAS_RESPOSTA)[number], string> = {
  frete: "Frete",
  medidas: "Medidas",
  troca: "Troca",
  pagamento: "Pagamento",
  rastreio: "Rastreio",
  geral: "Geral",
};

type Falha = Extract<Resultado<unknown>, { ok: false }>;

/**
 * Lista, formulário e exclusão de respostas rápidas. A lista vem do servidor;
 * toda gravação passa pela action e o `revalidatePath` traz a versão nova.
 */
export function ListaRespostas({
  respostas,
  podeCriar,
  podeEditar,
  podeExcluir,
}: {
  respostas: Resposta[];
  podeCriar: boolean;
  podeEditar: boolean;
  podeExcluir: boolean;
}) {
  const [editando, setEditando] = useState<Resposta | "nova" | null>(null);
  const [excluindo, setExcluindo] = useState<Resposta | null>(null);
  const [falha, setFalha] = useState<Falha | null>(null);
  const [pendente, iniciar] = useTransition();

  function excluir() {
    if (!excluindo) return;
    iniciar(async () => {
      const r = await excluirRespostaRapida({ id: excluindo.id, updated_at: excluindo.atualizadoEm });
      if (r.ok) {
        setExcluindo(null);
        setFalha(null);
      } else setFalha(r);
    });
  }

  function alternar(r: Resposta, ativa: boolean) {
    iniciar(async () => {
      const res = await alternarRespostaRapida({ id: r.id, updated_at: r.atualizadoEm, ativa });
      setFalha(res.ok ? null : res);
    });
  }

  return (
    <section className="flex flex-col gap-4" aria-busy={pendente}>
      {podeCriar ? (
        <div>
          <Button type="button" onClick={() => setEditando("nova")}>
            <Plus aria-hidden="true" strokeWidth={2} />
            Nova resposta
          </Button>
        </div>
      ) : null}

      {falha && !excluindo ? <FaixaAviso tom="perigo" titulo={falha.mensagem} /> : null}

      {respostas.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma resposta rápida ainda"
          descricao="Cadastre os textos que a equipe repete todo dia: frete, medidas, troca."
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {respostas.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
              <header className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-titulo-secao font-medium">{r.titulo}</h2>
                  <p className="text-legenda text-muted-foreground">
                    {r.atalho ?? "sem atalho"}
                    {r.categoria ? ` · ${ROTULO_CATEGORIA[r.categoria as keyof typeof ROTULO_CATEGORIA] ?? ""}` : ""}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-legenda">
                  <Switch
                    checked={r.ativa}
                    disabled={!podeEditar || pendente}
                    onCheckedChange={(v) => alternar(r, v)}
                    aria-label={`Resposta ${r.titulo} ativa`}
                  />
                  {r.ativa ? "Ativa" : "Inativa"}
                </label>
              </header>
              <p className="rounded-lg bg-muted p-3 text-corpo whitespace-pre-wrap">{r.conteudo}</p>
              <footer className="flex gap-2">
                {podeEditar ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditando(r)}>
                    <Pencil aria-hidden="true" strokeWidth={2} />
                    Editar
                  </Button>
                ) : null}
                {podeExcluir ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setExcluindo(r)}>
                    <Trash2 aria-hidden="true" strokeWidth={2} />
                    Excluir
                  </Button>
                ) : null}
              </footer>
            </li>
          ))}
        </ul>
      )}

      {editando ? (
        <FormularioResposta
          resposta={editando === "nova" ? null : editando}
          aoFechar={() => setEditando(null)}
        />
      ) : null}

      <ConfirmarExclusao
        aberto={excluindo !== null}
        entidade={`a resposta "${excluindo?.titulo ?? ""}"`}
        descricao="O atalho fica livre para outra resposta."
        carregando={pendente}
        {...(falha && excluindo ? { erro: falha.mensagem } : {})}
        onConfirmar={excluir}
        onCancelar={() => {
          setExcluindo(null);
          setFalha(null);
        }}
      />
    </section>
  );
}

function FormularioResposta({ resposta, aoFechar }: { resposta: Resposta | null; aoFechar: () => void }) {
  const [falha, setFalha] = useState<Falha | null>(null);
  const [previa, setPrevia] = useState(resposta?.conteudo ?? "");
  const [pendente, iniciar] = useTransition();
  const erros = falha?.erros ?? {};

  // `onSubmit`, não `action`: a action de formulário do React limpa os campos
  // ao terminar, e o que a pessoa digitou precisa sobreviver ao erro (§7.1).
  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    iniciar(async () => {
      const r = resposta
        ? await editarRespostaRapida(dados)
        : await criarRespostaRapida(dados);
      if (r.ok) aoFechar();
      else setFalha(r);
    });
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && !pendente && aoFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{resposta ? "Editar resposta" : "Nova resposta"}</DialogTitle>
          <DialogDescription>A prévia mostra como o texto aparece no chat.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="flex flex-col gap-4">
          {resposta ? (
            <>
              <input type="hidden" name="id" value={resposta.id} />
              <input type="hidden" name="updated_at" value={resposta.atualizadoEm} />
            </>
          ) : null}
          {falha?.codigo === "COLISAO" ? (
            <FaixaAviso tom="perigo" titulo={falha.mensagem} descricao="Feche e abra de novo para ver a versão atual." />
          ) : null}
          <ResumoDeErros erros={erros} />
          <Campo nome="titulo" rotulo="Título" {...(erros["titulo"]?.[0] ? { erro: erros["titulo"][0] } : {})}>
            <Input id="titulo" name="titulo" defaultValue={resposta?.titulo ?? ""} required />
          </Campo>
          <Campo
            nome="atalho"
            rotulo="Atalho"
            opcional
            ajuda='Começa com "/": letras minúsculas, números e hífen.'
            {...(erros["atalho"]?.[0] ? { erro: erros["atalho"][0] } : {})}
          >
            <Input
              id="atalho"
              name="atalho"
              placeholder="/frete"
              pattern="^/[a-z0-9-]{1,30}$"
              defaultValue={resposta?.atalho ?? ""}
            />
          </Campo>
          <Campo nome="categoria" rotulo="Categoria" opcional>
            <select
              id="categoria"
              name="categoria"
              defaultValue={resposta?.categoria ?? ""}
              className="h-9 rounded-md border border-input bg-background px-3 text-corpo"
            >
              <option value="">Sem categoria</option>
              {CATEGORIAS_RESPOSTA.map((c) => (
                <option key={c} value={c}>
                  {ROTULO_CATEGORIA[c]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo nome="conteudo" rotulo="Texto" {...(erros["conteudo"]?.[0] ? { erro: erros["conteudo"][0] } : {})}>
            <Textarea
              id="conteudo"
              name="conteudo"
              rows={5}
              defaultValue={resposta?.conteudo ?? ""}
              onChange={(e) => setPrevia(e.target.value)}
              required
            />
          </Campo>
          <div aria-label="Prévia no chat" className="flex justify-end">
            <p className="max-w-md rounded-lg bg-primary p-3 text-corpo whitespace-pre-wrap text-primary-foreground">
              {previa || "Sua resposta aparece aqui."}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={aoFechar} disabled={pendente}>
              Cancelar
            </Button>
            <Button type="submit" aria-busy={pendente} disabled={pendente}>
              {pendente ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
