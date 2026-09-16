"use client";

import { useActionState, useState } from "react";
import { CircleCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Campo } from "@/components/comum/campo";
import { BotaoEnviar } from "@/components/comum/botao-enviar";
import { ResumoDeErros } from "@/components/comum/resumo-de-erros";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import type { Resultado } from "@/lib/erros";
import { salvarPerfil } from "@/lib/actions/seguranca";

const INICIAL: Resultado<{ atualizadoEm: Date }> = { ok: false, codigo: "", mensagem: "" };

/**
 * Dados da própria conta (04-ui.md §5.1 e §7.1).
 *
 * `updatedAt` vai em campo oculto e volta atualizado no sucesso: é o controle
 * de colisão de §7.4. Sem ele, duas abas abertas sobrescrevem uma à outra em
 * silêncio.
 *
 * E-mail, papel e loja são LEITURA. Trocar e-mail é fluxo próprio, com
 * confirmação no endereço novo e aviso ao antigo (§11.2); papel e loja mudam só
 * pela administração, com motivo e trilha.
 */
export function FormularioPerfil({
  nome,
  email,
  atualizadoEm,
  papelRotulo,
  lojaNome,
}: {
  nome: string;
  email: string;
  atualizadoEm: string;
  papelRotulo: string;
  lojaNome: string;
}) {
  const [valor, setValor] = useState(nome);
  const [estado, acao] = useActionState(salvarPerfil, INICIAL);

  const erros = estado.ok ? {} : (estado.erros ?? {});
  const versao = estado.ok ? new Date(estado.dados.atualizadoEm).toISOString() : atualizadoEm;

  return (
    <form action={acao} className="flex flex-col gap-6">
      <input type="hidden" name="updatedAt" value={versao} />

      {!estado.ok && estado.codigo === "COLISAO" ? (
        <FaixaAviso tom="perigo" titulo={estado.mensagem} descricao="Recarregue a página para ver a versão atual." />
      ) : null}

      <ResumoDeErros erros={erros} />

      <Campo
        nome="nome"
        rotulo="Seu nome"
        ajuda="É o nome que a equipe vê nas conversas e nos pedidos."
        {...(erros["nome"]?.[0] ? { erro: erros["nome"][0] } : {})}
      >
        <Input
          id="nome"
          name="nome"
          autoComplete="name"
          value={valor}
          onChange={(evento) => setValor(evento.target.value)}
          aria-invalid={Boolean(erros["nome"])}
          required
        />
      </Campo>

      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-legenda text-muted-foreground">E-mail</dt>
          <dd className="text-corpo">{email}</dd>
        </div>
        <div>
          <dt className="text-legenda text-muted-foreground">Papel</dt>
          <dd className="text-corpo">{papelRotulo}</dd>
        </div>
        <div>
          <dt className="text-legenda text-muted-foreground">Loja</dt>
          <dd className="text-corpo">{lojaNome}</dd>
        </div>
      </dl>

      <div className="flex items-center gap-4">
        <BotaoEnviar>Salvar alterações</BotaoEnviar>
        {estado.ok ? (
          <p role="status" className="flex items-center gap-1.5 text-denso text-sucesso">
            <CircleCheck aria-hidden="true" strokeWidth={2} className="size-4 shrink-0" />
            Alterações salvas.
          </p>
        ) : null}
      </div>
    </form>
  );
}
