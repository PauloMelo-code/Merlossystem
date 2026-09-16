"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { ModalConfirmacaoBlock } from "@/components/comum/modal-confirmacao-block";
import { TabelaDados, type Coluna } from "@/components/comum/tabela-dados";
import { desativarLoja } from "@/lib/actions/lojas";
import { FormularioLoja, type LojaEditavel } from "./formulario-loja";

export type Permissoes = { criar: boolean; editar: boolean; excluir: boolean };

function AcoesDaLoja({
  loja,
  pode,
  onEditar,
  onDesativar,
}: {
  loja: LojaEditavel;
  pode: Permissoes;
  onEditar: (l: LojaEditavel) => void;
  onDesativar: (l: LojaEditavel) => void;
}) {
  return (
    <div className="flex gap-2">
      {pode.editar ? (
        <Button variant="outline" size="sm" onClick={() => onEditar(loja)}>
          Editar
        </Button>
      ) : null}
      {pode.excluir ? (
        <Button variant="outline" size="sm" onClick={() => onDesativar(loja)}>
          Desativar
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Lista de lojas com criar, editar e desativar (04-ui.md §5.6). Os botões só
 * aparecem para quem a matriz deixa — e o servidor confere de novo.
 */
export function PainelLojas({ lojas, pode }: { lojas: readonly LojaEditavel[]; pode: Permissoes }) {
  const router = useRouter();
  const [editando, setEditando] = useState<LojaEditavel | "nova" | null>(null);
  const [desativando, setDesativando] = useState<LojaEditavel | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const fechar = useCallback(() => setEditando(null), []);
  const concluido = useCallback(() => {
    setEditando(null);
    setAviso("Loja salva.");
    router.refresh();
  }, [router]);

  async function confirmarDesativacao() {
    if (!desativando) return;
    setOcupado(true);
    setErro("");
    const r = await desativarLoja({ id: desativando.id, updatedAt: desativando.updatedAt });
    setOcupado(false);
    if (!r.ok) {
      setErro(r.erros?._?.join(" · ") ?? r.mensagem);
      return;
    }
    setDesativando(null);
    setAviso("Loja desativada.");
    router.refresh();
  }

  const acoes = (loja: LojaEditavel) => (
    <AcoesDaLoja
      loja={loja}
      pode={pode}
      onEditar={setEditando}
      onDesativar={(l) => {
        setErro("");
        setDesativando(l);
      }}
    />
  );

  const colunas: Coluna<LojaEditavel>[] = [
    { chave: "nome", rotulo: "Loja", render: (l) => <span className="font-medium">{l.nome}</span> },
    { chave: "sigla", rotulo: "Sigla", render: (l) => <span className="font-mono">{l.sigla}</span> },
    { chave: "slug", rotulo: "Endereço", render: (l) => l.slug },
    {
      chave: "deposito",
      rotulo: "Depósito do Bling",
      render: (l) => l.blingDepositoId ?? <span className="text-muted-foreground">sem depósito</span>,
    },
    { chave: "acoes", rotulo: "Ações", render: acoes },
  ];

  return (
    <div className="flex flex-col gap-4">
      {aviso ? (
        <p role="status" className="text-denso text-sucesso">
          {aviso}
        </p>
      ) : null}
      {pode.criar ? (
        <div>
          <Button onClick={() => { setAviso(""); setEditando("nova"); }}>
            <Plus aria-hidden="true" strokeWidth={2} />
            Nova loja
          </Button>
        </div>
      ) : null}

      <TabelaDados
        colunas={colunas}
        itens={lojas}
        chave={(l) => l.id}
        vazio={
          <EstadoVazio
            titulo="Nenhuma loja cadastrada."
            descricao={pode.criar ? "Cadastre a primeira loja para começar." : "Fale com o administrador."}
          />
        }
        cartaoMobile={(l) => (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Store aria-hidden="true" strokeWidth={2} className="size-4" />
              <span className="font-medium">{l.nome}</span>
              <span className="font-mono text-legenda">{l.sigla}</span>
            </div>
            <span className="text-legenda text-muted-foreground">
              {l.slug} · {l.blingDepositoId ? `depósito ${l.blingDepositoId}` : "sem depósito do Bling"}
            </span>
            {acoes(l)}
          </div>
        )}
      />

      <Dialog open={editando !== null} onOpenChange={(aberto) => (aberto ? null : fechar())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editando === "nova" ? "Nova loja" : "Editar loja"}</DialogTitle>
            <DialogDescription>Nome, endereço, sigla e depósito do Bling.</DialogDescription>
          </DialogHeader>
          {editando !== null ? (
            <FormularioLoja
              key={editando === "nova" ? "nova" : editando.id}
              loja={editando === "nova" ? null : editando}
              onConcluido={concluido}
              onCancelar={fechar}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ModalConfirmacaoBlock
        aberto={desativando !== null}
        titulo="Desativar loja"
        resumo={
          desativando
            ? `A loja "${desativando.nome}" (${desativando.sigla}) sai do seletor e deixa de receber cadastro novo. O histórico continua.`
            : ""
        }
        descricao="Só é possível desativar loja sem pessoa ativa e sem conta conectada."
        textoConfirmar="Desativar loja"
        variante="destrutiva"
        carregando={ocupado}
        {...(erro ? { erro } : {})}
        onConfirmar={() => void confirmarDesativacao()}
        onCancelar={() => setDesativando(null)}
      />

      {!pode.criar && !pode.editar ? (
        <FaixaAviso tom="info" titulo="Você vê as lojas, mas só dono e administrador alteram o cadastro." />
      ) : null}
    </div>
  );
}
