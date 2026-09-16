"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { ModalConfirmacaoBlock } from "@/components/comum/modal-confirmacao-block";
import { ModalReautenticacao } from "@/components/comum/modal-reautenticacao";
import { Tempo } from "@/components/comum/tempo";
import { reautenticar, removerChave, renomearChave } from "@/lib/actions/seguranca";
import { pediuProva, useReautenticacao } from "./usar-reautenticacao";

export type PasskeyNaTela = {
  id: string;
  nome: string | null;
  criadaEm: string;
  sincronizada: boolean;
  fabricante: string;
};

/**
 * Passkeys cadastradas (02-seguranca.md §11.1).
 *
 * REMOVER passa pelo bloqueio de 3 s (§9.1, item 18) e é recusado pelo servidor
 * quando for a última prova de identidade da conta — "remover o último fator"
 * não existe, por construção (§9.3).
 *
 * `podeRemover` só governa o que a tela OFERECE. Quem decide é a action: uma
 * aba antiga com o botão ligado ainda recebe a recusa.
 */
export function ListaPasskeys({
  passkeys,
  podeRemover,
}: {
  passkeys: readonly PasskeyNaTela[];
  podeRemover: boolean;
}) {
  const router = useRouter();
  const [alvo, setAlvo] = useState<PasskeyNaTela | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [apelido, setApelido] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const { aberto, exigirProva, confirmado, cancelar } = useReautenticacao();

  async function remover(chave: PasskeyNaTela) {
    setOcupado(true);
    setErro("");
    const resultado = await removerChave(chave.id);
    setOcupado(false);
    if (pediuProva(resultado)) {
      exigirProva(() => void remover(chave));
      return;
    }
    setAlvo(null);
    if (!resultado.ok) {
      setErro(resultado.mensagem);
      return;
    }
    router.refresh();
  }

  async function renomear(chaveId: string, nome: string) {
    setErro("");
    const resultado = await renomearChave({ passkeyId: chaveId, apelido: nome });
    if (pediuProva(resultado)) {
      exigirProva(() => void renomear(chaveId, nome));
      return;
    }
    setEditando(null);
    if (!resultado.ok) {
      setErro(resultado.mensagem);
      return;
    }
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-titulo-secao font-medium">Passkeys</h2>
        <p className="text-denso text-muted-foreground">
          Aparelhos que entram com digital, rosto ou PIN.
        </p>
      </div>

      {erro ? (
        <p role="alert" className="text-corpo text-perigo">
          {erro}
        </p>
      ) : null}

      {passkeys.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma passkey cadastrada."
          descricao="Cadastre uma acima para entrar sem digitar senha."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {passkeys.map((chave) => (
            <li
              key={chave.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
            >
              <KeyRound aria-hidden="true" strokeWidth={2} className="size-4 shrink-0" />

              {editando === chave.id ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-2"
                  onSubmit={(evento) => {
                    evento.preventDefault();
                    void renomear(chave.id, apelido);
                  }}
                >
                  <Input
                    value={apelido}
                    onChange={(evento) => setApelido(evento.target.value)}
                    maxLength={60}
                    aria-label="Nome da passkey"
                    autoFocus
                  />
                  <Button type="submit" size="sm">
                    Salvar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditando(null)}
                  >
                    Cancelar
                  </Button>
                </form>
              ) : (
                <div className="min-w-0 flex-1">
                  <p className="text-corpo">{chave.nome ?? "Aparelho sem nome"}</p>
                  <p className="text-legenda text-muted-foreground">
                    {chave.fabricante} · cadastrada em{" "}
                    <Tempo valor={chave.criadaEm} formato="data" />
                    {chave.sincronizada ? " · sincronizada na nuvem" : " · só neste aparelho"}
                  </p>
                </div>
              )}

              {editando === chave.id ? null : (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setApelido(chave.nome ?? "");
                      setEditando(chave.id);
                    }}
                  >
                    <Pencil aria-hidden="true" strokeWidth={2} />
                    Renomear
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={!podeRemover}
                    onClick={() => setAlvo(chave)}
                  >
                    <Trash2 aria-hidden="true" strokeWidth={2} />
                    Remover
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ModalConfirmacaoBlock
        aberto={alvo !== null}
        titulo="Remover a passkey"
        resumo={`Este aparelho (${alvo?.nome ?? "sem nome"}) deixa de entrar na sua conta. Você continua com os outros fatores cadastrados.`}
        textoConfirmar="Remover"
        variante="destrutiva"
        carregando={ocupado}
        onConfirmar={() => {
          if (alvo) void remover(alvo);
        }}
        onCancelar={() => setAlvo(null)}
      />

      <ModalReautenticacao
        aberto={aberto}
        reautenticarComSenha={reautenticar}
        onConfirmado={confirmado}
        onCancelar={cancelar}
      />
    </section>
  );
}
