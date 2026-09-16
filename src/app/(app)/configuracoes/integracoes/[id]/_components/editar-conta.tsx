"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { BotaoEnviar } from "@/components/comum/botao-enviar";
import { Campo, idsDeApoio } from "@/components/comum/campo";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { ResumoDeErros } from "@/components/comum/resumo-de-erros";
import type { Resultado } from "@/lib/erros";
import { editarIntegracao, reautenticarIntegracao } from "@/lib/actions/integracoes";
import type { ProvedorDeCanal } from "@/lib/integracoes/catalogo-provedores";
import { CamposDeCredencial, type LojaDaOpcao } from "../../_components/formulario-conexao";

const INICIAL: Resultado<{ updatedAt: Date }> = { ok: false, codigo: "", mensagem: "" };

function Retorno({ estado, sucesso }: { estado: Resultado<{ updatedAt: Date }>; sucesso: string }) {
  if (estado.ok) {
    return (
      <p role="status" className="text-denso text-sucesso">
        {sucesso}
      </p>
    );
  }
  if (!estado.codigo || estado.codigo === "VALIDACAO") return null;
  return (
    <FaixaAviso
      tom="perigo"
      titulo={estado.mensagem}
      {...(estado.codigo === "COLISAO" ? { descricao: "Recarregue a página para ver a versão atual." } : {})}
    />
  );
}

/**
 * Renomear e atribuir loja (04-ui.md §5.6). Conta de rede (Bling) não tem
 * loja. `updatedAt` volta do servidor e segue para o próximo envio (§7.4).
 */
export function EditarConta({
  id,
  rotulo,
  lojaId,
  ehDaRede,
  lojas,
  updatedAt,
}: {
  id: string;
  rotulo: string;
  lojaId: string | null;
  ehDaRede: boolean;
  lojas: readonly LojaDaOpcao[];
  updatedAt: string;
}) {
  const router = useRouter();
  const [estado, acao] = useActionState(async (anterior: Resultado<{ updatedAt: Date }>, form: FormData) => {
    const r = await editarIntegracao(anterior, form);
    if (r.ok) router.refresh();
    return r;
  }, INICIAL);
  const [loja, setLoja] = useState(lojaId ?? "");
  const versao = estado.ok ? new Date(estado.dados.updatedAt).toISOString() : updatedAt;
  const erros = estado.ok ? {} : (estado.erros ?? {});

  return (
    <form action={acao} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="updatedAt" value={versao} />
      <Retorno estado={estado} sucesso="Alterações salvas." />
      <ResumoDeErros erros={erros} />
      <Campo nome="rotulo" rotulo="Nome da conta" {...(erros.rotulo?.[0] ? { erro: erros.rotulo[0] } : {})}>
        <Input id="rotulo" name="rotulo" defaultValue={estado.ok ? undefined : (estado.valores?.rotulo ?? rotulo)}
          required maxLength={80} aria-invalid={Boolean(erros.rotulo)}
          aria-describedby={idsDeApoio("rotulo", { erro: erros.rotulo?.[0] })} />
      </Campo>
      {ehDaRede ? null : (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-denso font-medium">Loja</legend>
          <RadioGroup name="lojaId" value={loja} onValueChange={setLoja}>
            {lojas.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <RadioGroupItem id={`loja-${l.id}`} value={l.id} />
                <Label htmlFor={`loja-${l.id}`}>{l.nome}</Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
      )}
      <div>
        <BotaoEnviar>Salvar alterações</BotaoEnviar>
      </div>
    </form>
  );
}

/** Reautenticar: nova credencial para a MESMA conta. */
export function ReautenticarConta({
  id,
  provedor,
  updatedAt,
}: {
  id: string;
  provedor: ProvedorDeCanal;
  updatedAt: string;
}) {
  const router = useRouter();
  const [estado, acao] = useActionState(async (anterior: Resultado<{ updatedAt: Date }>, form: FormData) => {
    const r = await reautenticarIntegracao(anterior, form);
    if (r.ok) router.refresh();
    return r;
  }, INICIAL);
  const erros = estado.ok ? {} : (estado.erros ?? {});

  return (
    <form action={acao} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="provedor" value={provedor} />
      <input type="hidden" name="updatedAt" value={estado.ok ? new Date(estado.dados.updatedAt).toISOString() : updatedAt} />
      <Retorno estado={estado} sucesso="Credencial substituída." />
      <ResumoDeErros erros={erros} />
      <CamposDeCredencial provedor={provedor} erros={erros} />
      <div>
        <BotaoEnviar variante="outline">Substituir credencial</BotaoEnviar>
      </div>
    </form>
  );
}
