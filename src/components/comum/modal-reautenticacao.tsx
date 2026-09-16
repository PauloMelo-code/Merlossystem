"use client";

import { useState } from "react";
import { Fingerprint, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Resultado } from "@/lib/erros";
import { Campo, idsDeApoio } from "./campo";

/**
 * Reautenticação de frescor (04-ui.md §7.3). A action devolveu
 * `SESSAO_NAO_FRESCA`; a pessoa confirma a identidade SEM sair da página, e a
 * ação pendente é reenviada com os mesmos dados por `onConfirmado`.
 *
 * Sem este componente, qualquer sessão com mais de 15 minutos receberia 403
 * sem saída — é por isso que ele é obrigatório no R1.
 *
 * As duas provas chegam por prop porque as actions são de área
 * (`/perfil/seguranca`, `/configuracoes/usuarios`) e este componente é
 * compartilhado: ele não escolhe qual action chamar, só conduz a conversa.
 * `reautenticarComPasskey` é opcional — o botão só aparece para quem tem o
 * caminho ligado, em vez de oferecer uma opção que falharia.
 */
export function ModalReautenticacao({
  aberto,
  reautenticarComSenha,
  reautenticarComPasskey,
  onConfirmado,
  onCancelar,
}: {
  aberto: boolean;
  reautenticarComSenha: (senha: string) => Promise<Resultado<null>>;
  reautenticarComPasskey?: () => Promise<Resultado<null>>;
  onConfirmado: () => void;
  onCancelar: () => void;
}) {
  const [senha, setSenha] = useState("");
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | undefined>(undefined);

  async function tentar(prova: () => Promise<Resultado<null>>) {
    setPendente(true);
    setErro(undefined);
    try {
      const resultado = await prova();
      if (resultado.ok) {
        setSenha("");
        onConfirmado();
        return;
      }
      setErro(resultado.mensagem);
    } finally {
      setPendente(false);
    }
  }

  function fechar() {
    if (pendente) return;
    setSenha("");
    setErro(undefined);
    onCancelar();
  }

  return (
    <Dialog open={aberto} onOpenChange={(proximo) => !proximo && fechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirme que é você</DialogTitle>
          <DialogDescription>
            Faz mais de 15 minutos que você entrou. Confirme a identidade para continuar de
            onde parou.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(evento) => {
            evento.preventDefault();
            void tentar(() => reautenticarComSenha(senha));
          }}
          className="flex flex-col gap-4"
        >
          <Campo nome="senha-atual" rotulo="Sua senha" {...(erro ? { erro } : {})}>
            <Input
              id="senha-atual"
              name="senha-atual"
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(evento) => setSenha(evento.target.value)}
              aria-invalid={Boolean(erro)}
              aria-describedby={idsDeApoio("senha-atual", { erro })}
              autoFocus
            />
          </Campo>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={fechar} aria-disabled={pendente}>
              Cancelar
            </Button>
            {reautenticarComPasskey ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void tentar(reautenticarComPasskey)}
                aria-disabled={pendente}
              >
                <Fingerprint aria-hidden="true" strokeWidth={2} />
                Usar passkey
              </Button>
            ) : null}
            <Button type="submit" aria-disabled={pendente} aria-busy={pendente}>
              {pendente ? (
                <Loader2
                  aria-hidden="true"
                  strokeWidth={2}
                  className="movimento-essencial animate-spin"
                />
              ) : null}
              Confirmar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
