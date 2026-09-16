"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { BotaoEnviar } from "@/components/comum/botao-enviar";
import { Campo, idsDeApoio } from "@/components/comum/campo";
import { Copiar } from "@/components/comum/copiar";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { ResumoDeErros } from "@/components/comum/resumo-de-erros";
import type { Resultado } from "@/lib/erros";
import { conectarContaPorToken, type Conectada } from "@/lib/actions/integracoes";
import {
  AJUDA_DA_CHAVE,
  PROVEDORES,
  PROVEDORES_DE_CANAL,
  type ProvedorDeCanal,
} from "@/lib/integracoes/catalogo-provedores";

export type LojaDaOpcao = { id: string; nome: string };

const INICIAL: Resultado<Conectada> = { ok: false, codigo: "", mensagem: "" };

/** Campos de credencial: um por chave, gerados do catálogo (INV-58). */
export function CamposDeCredencial({
  provedor,
  erros,
}: {
  provedor: ProvedorDeCanal;
  erros: Record<string, string[]>;
}) {
  return (
    <>
      {PROVEDORES[provedor].chaves.map((chave) => {
        const nome = `chave_${chave}`;
        const erro = erros[nome]?.[0];
        return (
          <Campo key={nome} nome={nome} rotulo={chave} ajuda={AJUDA_DA_CHAVE[chave] ?? ""} {...(erro ? { erro } : {})}>
            <Input
              id={nome}
              name={nome}
              type="password"
              autoComplete="off"
              spellCheck={false}
              required
              aria-invalid={Boolean(erro)}
              aria-describedby={idsDeApoio(nome, { ajuda: "sim", erro })}
            />
          </Campo>
        );
      })}
    </>
  );
}

/**
 * Conectar conta de canal por token (04-ui.md §5.6): campo por chave, com a
 * LOJA escrita e escolhível — nunca implícita pelo cookie. No uazapi, o
 * segredo do webhook aparece UMA vez, agora; depois só existe o hash.
 */
export function FormularioConexao({ lojas, onConcluido }: { lojas: readonly LojaDaOpcao[]; onConcluido: () => void }) {
  const [estado, acao] = useActionState(conectarContaPorToken, INICIAL);
  const [provedor, setProvedor] = useState<ProvedorDeCanal>("whatsapp_oficial");
  const [loja, setLoja] = useState(lojas.length === 1 ? lojas[0]!.id : "");

  if (estado.ok) {
    return (
      <div className="flex flex-col gap-4">
        <FaixaAviso tom="sucesso" titulo="Conta conectada." />
        {estado.dados.segredoWebhook && estado.dados.urlDoWebhook ? (
          <div className="flex flex-col gap-3">
            <p className="text-corpo">
              Configure o webhook desta instância no painel do uazapi. <strong>O segredo aparece só agora</strong>:
              copie antes de fechar. Depois, só é possível gerar outro desconectando e conectando de novo.
            </p>
            <dl className="flex flex-col gap-2">
              <dt className="text-legenda text-muted-foreground">Endereço do webhook</dt>
              <dd className="flex items-center gap-2 break-all font-mono text-denso">
                {estado.dados.urlDoWebhook}
                <Copiar valor={estado.dados.urlDoWebhook} rotulo="Copiar endereço" />
              </dd>
              <dt className="text-legenda text-muted-foreground">Cabeçalho x-uazapi-secret</dt>
              <dd className="flex items-center gap-2 break-all font-mono text-denso">
                {estado.dados.segredoWebhook}
                <Copiar valor={estado.dados.segredoWebhook} rotulo="Copiar segredo" />
              </dd>
            </dl>
          </div>
        ) : null}
        <div className="flex justify-end">
          <button type="button" className="text-denso underline" onClick={onConcluido}>
            Concluir
          </button>
        </div>
      </div>
    );
  }

  const erros = estado.erros ?? {};
  const descricao = PROVEDORES[provedor];

  return (
    <form action={acao} className="flex flex-col gap-5">
      {estado.codigo && estado.codigo !== "VALIDACAO" ? <FaixaAviso tom="perigo" titulo={estado.mensagem} /> : null}
      <ResumoDeErros erros={erros} />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-denso font-medium">Canal</legend>
        <RadioGroup name="provedor" value={provedor} onValueChange={(v) => setProvedor(v as ProvedorDeCanal)}>
          {PROVEDORES_DE_CANAL.map((p) => (
            <div key={p} className="flex items-center gap-2">
              <RadioGroupItem id={`provedor-${p}`} value={p} />
              <Label htmlFor={`provedor-${p}`}>{PROVEDORES[p].rotulo}</Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>
      {descricao.aviso ? <FaixaAviso tom="aviso" titulo={descricao.aviso} /> : null}

      <fieldset className="flex flex-col gap-2" aria-describedby={erros.lojaId ? "erro-lojaId" : undefined}>
        <legend className="text-denso font-medium">Loja desta conta</legend>
        {lojas.length === 0 ? (
          <p className="text-denso text-muted-foreground">Cadastre uma loja antes de conectar um número.</p>
        ) : (
          <RadioGroup name="lojaId" value={loja} onValueChange={setLoja}>
            {lojas.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <RadioGroupItem id={`loja-${l.id}`} value={l.id} />
                <Label htmlFor={`loja-${l.id}`}>{l.nome}</Label>
              </div>
            ))}
          </RadioGroup>
        )}
        {erros.lojaId ? (
          <p id="erro-lojaId" className="text-denso text-perigo">
            {erros.lojaId[0]}
          </p>
        ) : null}
      </fieldset>

      <Campo nome="rotulo" rotulo="Nome da conta" ajuda="Aparece na caixa de entrada. Ex.: WhatsApp Vendas Centro."
        {...(erros.rotulo?.[0] ? { erro: erros.rotulo[0] } : {})}>
        <Input id="rotulo" name="rotulo" defaultValue={estado.valores?.rotulo ?? ""} required maxLength={80}
          aria-invalid={Boolean(erros.rotulo)}
          aria-describedby={idsDeApoio("rotulo", { ajuda: "sim", erro: erros.rotulo?.[0] })} />
      </Campo>

      {descricao.referencia ? (
        <Campo nome="referencia" rotulo={descricao.referencia.rotulo} ajuda={descricao.referencia.ajuda}
          {...(erros.referencia?.[0] ? { erro: erros.referencia[0] } : {})}>
          <Input id="referencia" name="referencia" defaultValue={estado.valores?.referencia ?? ""} required
            maxLength={128} spellCheck={false} aria-invalid={Boolean(erros.referencia)}
            aria-describedby={idsDeApoio("referencia", { ajuda: "sim", erro: erros.referencia?.[0] })} />
        </Campo>
      ) : null}

      <CamposDeCredencial provedor={provedor} erros={erros} />

      <div className="flex justify-end">
        <BotaoEnviar>Conectar conta</BotaoEnviar>
      </div>
    </form>
  );
}
