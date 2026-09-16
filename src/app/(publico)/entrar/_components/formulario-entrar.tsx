"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Campo, idsDeApoio } from "@/components/comum/campo";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { CampoSenha } from "../../_components/campo-senha";
import { entrarComPasskey, entrarComSenha } from "../../_components/porta-de-auth";

/**
 * `/entrar` (04-ui.md §5.1, 02-seguranca.md §8).
 *
 * A PASSKEY é a ação primária: é o fator resistente a phishing e resolve o
 * login inteiro (a verificação do usuário é o segundo fator, §9.1). E-mail e
 * senha ficam atrás de "Outras opções" — continuam a um clique, sem esconder
 * nada de quem precisa.
 *
 * A RECUSA É UMA FRASE SÓ, sem tempo e sem motivo (U14). Conta inexistente,
 * senha errada, conta desativada, bloqueada e excesso de tentativas chegam aqui
 * com o mesmo texto, os mesmos bytes e o mesmo tempo — a tela não tem como
 * diferenciá-las nem que quisesse, e é esse o ponto.
 */
export function FormularioEntrar({
  destino,
  sessaoExpirada,
}: {
  destino: string;
  sessaoExpirada: boolean;
}) {
  const router = useRouter();
  const [abrirSenha, setAbrirSenha] = useState(false);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const [ocupado, setOcupado] = useState(false);

  function seguir(situacao: "entrou" | "precisa-totp") {
    if (situacao === "precisa-totp") {
      router.push(`/entrar/verificar?volta=${encodeURIComponent(destino)}`);
      return;
    }
    // `refresh` antes do `replace`: o layout de `(app)` resolve a sessão no
    // servidor e precisa enxergar o cookie recém-gravado.
    router.replace(destino);
    router.refresh();
  }

  async function comSenha(evento: React.FormEvent) {
    evento.preventDefault();
    setOcupado(true);
    setErro("");
    const resultado = await entrarComSenha(email, senha);
    setOcupado(false);
    if (resultado.situacao === "recusado") {
      setErro(resultado.mensagem);
      return;
    }
    iniciar(() => seguir(resultado.situacao));
  }

  async function comPasskey() {
    setOcupado(true);
    setErro("");
    const resultado = await entrarComPasskey();
    setOcupado(false);
    if (resultado.situacao === "recusado") {
      setErro(resultado.mensagem);
      return;
    }
    iniciar(() => seguir(resultado.situacao));
  }

  const trabalhando = ocupado || pendente;

  return (
    <div className="flex flex-col gap-6">
      {sessaoExpirada ? (
        <FaixaAviso
          tom="info"
          titulo="Sua sessão expirou por segurança."
          descricao="Entre de novo para continuar de onde parou."
        />
      ) : null}

      <div className="flex flex-col gap-2">
        <Button type="button" onClick={() => void comPasskey()} disabled={trabalhando}>
          {trabalhando ? (
            <Loader2
              aria-hidden="true"
              strokeWidth={2}
              className="movimento-essencial animate-spin"
            />
          ) : (
            <Fingerprint aria-hidden="true" strokeWidth={2} />
          )}
          Entrar com passkey
        </Button>
        <p className="text-legenda text-muted-foreground">
          Usa a digital, o rosto ou o PIN do seu aparelho. Nada é digitado.
        </p>
      </div>

      {erro ? (
        <p role="alert" className="text-corpo text-perigo">
          {erro}
        </p>
      ) : null}

      {abrirSenha ? (
        <form onSubmit={(evento) => void comSenha(evento)} className="flex flex-col gap-4">
          <Campo nome="email" rotulo="E-mail">
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              value={email}
              onChange={(evento) => setEmail(evento.target.value)}
              aria-describedby={idsDeApoio("email", {})}
              required
            />
          </Campo>

          <CampoSenha
            nome="senha"
            rotulo="Senha"
            valor={senha}
            aoMudar={setSenha}
            autoComplete="current-password"
            comRequisitos={false}
          />

          <Button type="submit" variant="secondary" disabled={trabalhando} aria-busy={trabalhando}>
            {trabalhando ? (
              <Loader2
                aria-hidden="true"
                strokeWidth={2}
                className="movimento-essencial animate-spin"
              />
            ) : null}
            Entrar
          </Button>
          {/*
           * Conta só-passkey (ADR 0029): não tem senha, e a recusa única não pode
           * dizer isso conta a conta (enumeração). O aviso é fixo, para todos.
           */}
          <p className="text-legenda text-muted-foreground">
            Sua conta foi criada só com passkey? Ela não tem senha: entre pelo botão
            “Entrar com passkey”.
          </p>
        </form>
      ) : (
        <Button type="button" variant="ghost" onClick={() => setAbrirSenha(true)}>
          Outras opções: e-mail e senha
        </Button>
      )}
    </div>
  );
}
