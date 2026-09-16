"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Campo } from "@/components/comum/campo";
import { ConfirmarExclusao } from "@/components/comum/confirmar-exclusao";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { ResumoDeErros } from "@/components/comum/resumo-de-erros";
import { SeloStatus } from "@/components/comum/selo-status";
import { criarModeloWhatsapp, editarModeloWhatsapp, excluirModeloWhatsapp } from "@/lib/actions/conteudo";
import { contarVariaveis } from "@/lib/conteudo/variaveis";
import { CATEGORIAS_TEMPLATE } from "@/lib/db/schema/_enums/plataforma";
import type { Resultado } from "@/lib/erros";

export type Modelo = {
  id: string;
  nome: string;
  categoria: string;
  cabecalho: string | null;
  corpo: string;
  rodape: string | null;
  variaveisContagem: number;
  status: string;
  motivoRejeicao: string | null;
  atualizadoEm: string;
  conta: string;
};

type Falha = Extract<Resultado<unknown>, { ok: false }>;

const ROTULO_CATEGORIA: Record<(typeof CATEGORIAS_TEMPLATE)[number], string> = {
  marketing: "Marketing",
  utility: "Utilidade",
  authentication: "Autenticação",
};

const EDITAVEIS = ["rascunho", "rejeitado"];

/** Contagem ao vivo de `{{n}}` — a mesma função que o servidor usa. */
export function ContadorDeVariaveis({ corpo }: { corpo: string }) {
  const n = contarVariaveis(corpo);
  if (n === null) {
    return (
      <p role="status" className="text-legenda text-perigo">
        Numere as variáveis de {"{{1}}"} em diante, sem pular número.
      </p>
    );
  }
  return (
    <p role="status" className="text-legenda text-muted-foreground">
      {n === 0 ? "Sem variáveis." : `${n} ${n === 1 ? "variável" : "variáveis"}: a campanha terá de preencher ${n === 1 ? "uma" : n}.`}
    </p>
  );
}

export function ListaModelos({
  modelos,
  contas,
  podeCriar,
  podeEditar,
  podeExcluir,
}: {
  modelos: Modelo[];
  contas: { id: string; rotulo: string }[];
  podeCriar: boolean;
  podeEditar: boolean;
  podeExcluir: boolean;
}) {
  const [editando, setEditando] = useState<Modelo | "novo" | null>(null);
  const [excluindo, setExcluindo] = useState<Modelo | null>(null);
  const [falha, setFalha] = useState<Falha | null>(null);
  const [pendente, iniciar] = useTransition();

  function excluir() {
    if (!excluindo) return;
    iniciar(async () => {
      const r = await excluirModeloWhatsapp({ id: excluindo.id, updated_at: excluindo.atualizadoEm });
      if (r.ok) {
        setExcluindo(null);
        setFalha(null);
      } else setFalha(r);
    });
  }

  return (
    <section className="flex flex-col gap-4">
      {podeCriar ? (
        <div>
          <Button type="button" onClick={() => setEditando("novo")}>
            <Plus aria-hidden="true" strokeWidth={2} />
            Novo modelo
          </Button>
        </div>
      ) : null}

      {modelos.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum modelo cadastrado"
          descricao="Crie o modelo aqui; o status muda quando a Meta responder."
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {modelos.map((m) => (
            <li key={m.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
              <header className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-mono text-titulo-secao font-medium break-all">{m.nome}</h2>
                  <p className="text-legenda text-muted-foreground">
                    {m.conta} · {ROTULO_CATEGORIA[m.categoria as keyof typeof ROTULO_CATEGORIA] ?? m.categoria} ·{" "}
                    {m.variaveisContagem} {m.variaveisContagem === 1 ? "variável" : "variáveis"}
                  </p>
                </div>
                <SeloStatus dominio="status_template" valor={m.status} />
              </header>
              {m.status === "rejeitado" && m.motivoRejeicao ? (
                <FaixaAviso tom="perigo" titulo="Recusado pela Meta" descricao={m.motivoRejeicao} />
              ) : null}
              <div className="rounded-lg bg-muted p-3 text-corpo whitespace-pre-wrap">
                {m.cabecalho ? <p className="font-medium">{m.cabecalho}</p> : null}
                <p>{m.corpo}</p>
                {m.rodape ? <p className="text-legenda text-muted-foreground">{m.rodape}</p> : null}
              </div>
              <footer className="flex gap-2">
                {podeEditar && EDITAVEIS.includes(m.status) ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditando(m)}>
                    <Pencil aria-hidden="true" strokeWidth={2} />
                    Editar
                  </Button>
                ) : null}
                {podeExcluir ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setExcluindo(m)}>
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
        <FormularioModelo
          modelo={editando === "novo" ? null : editando}
          contas={contas}
          aoFechar={() => setEditando(null)}
        />
      ) : null}

      <ConfirmarExclusao
        aberto={excluindo !== null}
        entidade={`o modelo "${excluindo?.nome ?? ""}"`}
        descricao="Modelo em uso por campanha ou mensagem agendada não pode ser excluído."
        carregando={pendente}
        {...(falha ? { erro: falha.mensagem } : {})}
        onConfirmar={excluir}
        onCancelar={() => {
          setExcluindo(null);
          setFalha(null);
        }}
      />
    </section>
  );
}

function FormularioModelo({
  modelo,
  contas,
  aoFechar,
}: {
  modelo: Modelo | null;
  contas: { id: string; rotulo: string }[];
  aoFechar: () => void;
}) {
  const [falha, setFalha] = useState<Falha | null>(null);
  const [corpo, setCorpo] = useState(modelo?.corpo ?? "");
  const [pendente, iniciar] = useTransition();
  const erros = falha?.erros ?? {};
  const erro = (campo: string) => (erros[campo]?.[0] ? { erro: erros[campo][0] } : {});

  // `onSubmit`, não `action`: a action de formulário do React limpa os campos
  // ao terminar, e o que a pessoa digitou precisa sobreviver ao erro (§7.1).
  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    iniciar(async () => {
      const r = modelo ? await editarModeloWhatsapp(dados) : await criarModeloWhatsapp(dados);
      if (r.ok) aoFechar();
      else setFalha(r);
    });
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && !pendente && aoFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{modelo ? "Editar modelo" : "Novo modelo"}</DialogTitle>
          <DialogDescription>Use {"{{1}}"}, {"{{2}}"}… onde entra o dado de cada cliente.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="flex flex-col gap-4">
          {modelo ? (
            <>
              <input type="hidden" name="id" value={modelo.id} />
              <input type="hidden" name="updated_at" value={modelo.atualizadoEm} />
            </>
          ) : (
            <Campo nome="integracao_id" rotulo="Número oficial" {...erro("integracao_id")}>
              <select
                id="integracao_id"
                name="integracao_id"
                required
                defaultValue={contas[0]?.id ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-corpo"
              >
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.rotulo}
                  </option>
                ))}
              </select>
            </Campo>
          )}
          {falha?.codigo === "COLISAO" ? <FaixaAviso tom="perigo" titulo={falha.mensagem} /> : null}
          <ResumoDeErros erros={erros} />
          <Campo nome="nome" rotulo="Nome" ajuda="Letras minúsculas, números e _ (ex.: promocao_inverno)." {...erro("nome")}>
            <Input id="nome" name="nome" required pattern="^[a-z0-9_]+$" defaultValue={modelo?.nome ?? ""} />
          </Campo>
          <Campo nome="categoria" rotulo="Categoria" {...erro("categoria")}>
            <select
              id="categoria"
              name="categoria"
              defaultValue={modelo?.categoria ?? "marketing"}
              className="h-9 rounded-md border border-input bg-background px-3 text-corpo"
            >
              {CATEGORIAS_TEMPLATE.map((c) => (
                <option key={c} value={c}>
                  {ROTULO_CATEGORIA[c]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo nome="cabecalho_conteudo" rotulo="Cabeçalho" opcional {...erro("cabecalho_conteudo")}>
            <Input id="cabecalho_conteudo" name="cabecalho_conteudo" maxLength={60} defaultValue={modelo?.cabecalho ?? ""} />
          </Campo>
          <Campo nome="corpo" rotulo="Corpo" {...erro("corpo")}>
            <Textarea
              id="corpo"
              name="corpo"
              rows={5}
              maxLength={1024}
              required
              defaultValue={corpo}
              onChange={(e) => setCorpo(e.target.value)}
            />
          </Campo>
          <ContadorDeVariaveis corpo={corpo} />
          <Campo nome="rodape" rotulo="Rodapé" opcional {...erro("rodape")}>
            <Input id="rodape" name="rodape" maxLength={60} defaultValue={modelo?.rodape ?? ""} />
          </Campo>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={aoFechar} disabled={pendente}>
              Cancelar
            </Button>
            <Button type="submit" aria-busy={pendente} disabled={pendente}>
              {pendente ? "Salvando…" : "Salvar rascunho"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
