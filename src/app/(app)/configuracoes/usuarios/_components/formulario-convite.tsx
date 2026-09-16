"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Campo, idsDeApoio } from "@/components/comum/campo";
import { Copiar } from "@/components/comum/copiar";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { ModalConfirmacaoBlock } from "@/components/comum/modal-confirmacao-block";
import { ModalReautenticacao } from "@/components/comum/modal-reautenticacao";
import { reautenticar } from "@/lib/actions/seguranca";
import { convidarUsuario } from "@/lib/actions/convites";
import type { Papel } from "@/lib/db/schema/_enums/auth";
import { dataHora } from "@/lib/formato";
import { rotuloDePapel } from "@/lib/ui/tons";
import { convidarSchema } from "@/lib/validadores/usuarios";
import { CampoCienciaAdmin } from "./dialogo-ciencia-admin";
import {
  CampoLoja,
  CampoMotivo,
  CampoPapel,
  PAPEIS_COM_LOJA,
  errosDe,
  type LojaNaTela,
} from "./campos-comuns";
import { useCerimonia } from "./usar-cerimonia";

type Emitido = { link: string; expiraEm: Date };

/**
 * Convidar (02-seguranca.md §9.2; 04-ui.md §5.6 e §9.1 item 10).
 *
 * Quem convida NUNCA escolhe a senha: o convidado define a própria no primeiro
 * acesso. `dono` não aparece no seletor; `admin` só aparece para o dono, e só
 * sai com a ciência digitada.
 *
 * O link aparece UMA vez, para quem emitiu: enquanto não há provedor de
 * e-mail, é o caminho de entrega (README). Ele não fica guardado em lugar
 * nenhum — o banco só tem o hash.
 */
export function FormularioConvite({
  papeis,
  lojas,
}: {
  papeis: readonly Papel[];
  lojas: readonly LojaNaTela[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<Papel>(papeis.includes("vendedor") ? "vendedor" : papeis[0]!);
  const [loja, setLoja] = useState(lojas.length === 1 ? lojas[0]!.id : "");
  const [ciencia, setCiencia] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});
  const [emitido, setEmitido] = useState<Emitido | null>(null);

  const cerimonia = useCerimonia<Emitido>((dados) => {
    setEmitido(dados);
    setEmail("");
    setCiencia("");
    setMotivo("");
    router.refresh();
  });

  const comLoja = PAPEIS_COM_LOJA.includes(papel);
  const entrada = {
    email,
    papel: papel as z.input<typeof convidarSchema>["papel"],
    lojaId: comLoja ? loja : "",
    motivo,
    ...(papel === "admin" ? { ciencia } : {}),
  };

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    const encontrados = errosDe(convidarSchema, entrada);
    setErros(encontrados);
    if (Object.keys(encontrados).length > 0) return;
    setEmitido(null);
    cerimonia.iniciar(() => convidarUsuario(entrada), true);
  }

  const nomeDaLoja = lojas.find((l) => l.id === loja)?.nome;
  const resumo = `Convite para ${email.trim()} como ${rotuloDePapel(papel)}${
    comLoja && nomeDaLoja ? ` na loja ${nomeDaLoja}` : " com acesso às duas lojas"
  }. O link vale 24 horas e só pode ser usado uma vez. Motivo: “${motivo.trim()}”.`;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div>
        <h2 className="text-titulo-secao font-medium">Convidar pessoa</h2>
        <p className="text-denso text-muted-foreground">
          A pessoa recebe um link, cria a própria senha e cadastra o segundo fator.
        </p>
      </div>

      {emitido ? (
        <FaixaAviso
          tom="sucesso"
          titulo="Convite emitido"
          descricao={`Válido até ${dataHora(new Date(emitido.expiraEm))}. Este link aparece só agora: envie por um canal seguro.`}
          acao={
            <span className="flex flex-wrap items-center gap-2">
              <code className="break-all text-legenda">{emitido.link}</code>
              <Copiar valor={emitido.link} rotulo="Copiar link do convite" />
            </span>
          }
        />
      ) : null}

      <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <Campo nome="email" rotulo="E-mail" {...(erros.email ? { erro: erros.email } : {})}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(erros.email)}
            aria-describedby={idsDeApoio("email", { erro: erros.email })}
          />
        </Campo>
        <CampoPapel opcoes={papeis} valor={papel} onMudar={setPapel} erro={erros.papel} />
        {comLoja ? (
          <CampoLoja lojas={lojas} valor={loja} onMudar={setLoja} erro={erros.lojaId} />
        ) : null}
        {papel === "admin" ? (
          <CampoCienciaAdmin valor={ciencia} onMudar={setCiencia} erro={erros.ciencia} />
        ) : null}
        <CampoMotivo valor={motivo} onMudar={setMotivo} erro={erros.motivo} />
        <Button type="submit" className="self-end max-md:w-full">
          Convidar
        </Button>
      </form>

      <ModalConfirmacaoBlock
        aberto={cerimonia.confirmando}
        titulo="Convidar pessoa"
        resumo={resumo}
        textoConfirmar="Emitir convite"
        carregando={cerimonia.ocupado}
        {...(cerimonia.erro ? { erro: cerimonia.erro } : {})}
        onConfirmar={() => void cerimonia.executar()}
        onCancelar={cerimonia.cancelar}
      />
      <ModalReautenticacao
        aberto={cerimonia.reautenticando}
        reautenticarComSenha={reautenticar}
        onConfirmado={cerimonia.reautenticado}
        onCancelar={cerimonia.desistirDaProva}
      />
    </section>
  );
}
