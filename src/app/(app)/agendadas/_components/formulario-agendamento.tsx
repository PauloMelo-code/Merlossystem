"use client";

import { useState, useTransition, type FormEvent } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Campo } from "@/components/comum/campo";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { ResumoDeErros } from "@/components/comum/resumo-de-erros";
import { localParaIso, respeitaOptOut, ROTULO_GATILHO } from "@/lib/agendamentos/rotulos";
import { conferirVariaveis, MARCADOR_NOME } from "@/lib/conteudo/variaveis";
import { GATILHOS_AGENDAMENTO } from "@/lib/db/schema/_enums/conversas";
import { telefone } from "@/lib/formato";
import { agendarMensagem } from "../_acoes";

type Conta = { id: string; rotulo: string; provedor: string };
type Modelo = { id: string; integracaoId: string; nome: string; variaveisContagem: number };
type Contato = { id: string; nome: string | null; telefone: string | null };

const CLASSE_SELECT = "h-9 rounded-md border border-input bg-background px-3 text-corpo";

/** Novo agendamento: contato, número, conteúdo (texto ou modelo), horário e motivo. */
export function FormularioAgendamento({
  contatos,
  contas,
  modelos,
}: {
  contatos: Contato[];
  contas: Conta[];
  modelos: Modelo[];
}) {
  const [aberto, setAberto] = useState(false);
  const [contaId, setContaId] = useState(contas[0]?.id ?? "");
  const [tipo, setTipo] = useState<"texto" | "template">("texto");
  const [modeloId, setModeloId] = useState("");
  const [valores, setValores] = useState<string[]>([]);
  const [gatilho, setGatilho] = useState<string>("manual");
  const [erros, setErros] = useState<Record<string, string[]>>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [pendente, iniciar] = useTransition();

  if (contas.length === 0 || contatos.length === 0) {
    return (
      <FaixaAviso
        tom="info"
        titulo={contas.length === 0 ? "Esta loja não tem número de WhatsApp conectado." : "Esta loja ainda não tem contatos."}
      />
    );
  }

  const modelosDaConta = modelos.filter((m) => m.integracaoId === contaId);
  const modelo = modelosDaConta.find((m) => m.id === modeloId);
  const variaveis = Array.from({ length: modelo?.variaveisContagem ?? 0 }, (_, i) => ({
    indice: i + 1,
    valor: valores[i] ?? "",
  }));
  const erro = (campo: string) => (erros[campo]?.[0] ? { erro: erros[campo][0] } : {});

  // `onSubmit`, não `action`: a action de formulário do React limpa os campos
  // ao terminar, e o que a pessoa digitou precisa sobreviver ao erro (§7.1).
  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    if (tipo === "template" && modelo) {
      const problema = conferirVariaveis(variaveis, modelo.variaveisContagem);
      if (problema) {
        setErros({ variaveis: [problema] });
        return;
      }
    }
    iniciar(async () => {
      const r = await agendarMensagem({
        contato_id: dados.get("contato_id"),
        integracao_id: contaId,
        tipo_conteudo: tipo,
        conteudo: tipo === "texto" ? dados.get("conteudo") : null,
        template_id: tipo === "template" ? modeloId : null,
        variaveis: tipo === "template" ? variaveis : [],
        agendada_para: localParaIso(String(dados.get("agendada_para") ?? "")),
        gatilho,
      });
      if (r.ok) {
        setErros({});
        setMensagem(null);
        setSucesso(true);
        setAberto(false);
      } else {
        setErros(r.erros ?? {});
        setMensagem(r.mensagem);
      }
    });
  }

  if (!aberto) {
    return (
      <div className="flex flex-col gap-2">
        {sucesso ? <FaixaAviso tom="sucesso" titulo="Mensagem agendada." /> : null}
        <div>
          <Button type="button" onClick={() => { setAberto(true); setSucesso(false); }}>
            <CalendarClock aria-hidden="true" strokeWidth={2} />
            Agendar mensagem
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <h2 className="text-titulo-secao font-medium">Nova mensagem agendada</h2>
      {mensagem ? <FaixaAviso tom="perigo" titulo={mensagem} /> : null}
      <ResumoDeErros erros={erros} />
      <div className="grid gap-4 md:grid-cols-2">
        <Campo nome="contato_id" rotulo="Cliente" {...erro("contato_id")}>
          <select id="contato_id" name="contato_id" required className={CLASSE_SELECT}>
            {contatos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome ?? "Sem nome"}
                {c.telefone ? ` · ${telefone(c.telefone)}` : ""}
              </option>
            ))}
          </select>
        </Campo>
        <Campo nome="integracao_id" rotulo="Número de saída" {...erro("integracao_id")}>
          <select
            id="integracao_id"
            value={contaId}
            onChange={(e) => { setContaId(e.target.value); setModeloId(""); setValores([]); }}
            className={CLASSE_SELECT}
          >
            {contas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.rotulo}
              </option>
            ))}
          </select>
        </Campo>
        <Campo nome="agendada_para" rotulo="Quando" {...erro("agendada_para")}>
          <Input id="agendada_para" name="agendada_para" type="datetime-local" required />
        </Campo>
        <Campo
          nome="gatilho"
          rotulo="Motivo"
          ajuda={respeitaOptOut(gatilho) ? "Não sai para quem pediu para não receber promoções." : "Sai mesmo para quem pediu para não receber promoções."}
          {...erro("gatilho")}
        >
          <select id="gatilho" value={gatilho} onChange={(e) => setGatilho(e.target.value)} className={CLASSE_SELECT}>
            {GATILHOS_AGENDAMENTO.map((g) => (
              <option key={g} value={g}>
                {ROTULO_GATILHO[g]}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-2 text-denso font-medium">Conteúdo</legend>
        <label className="flex items-center gap-2 text-corpo">
          <input type="radio" name="tipo" checked={tipo === "texto"} onChange={() => setTipo("texto")} />
          Texto
        </label>
        <label className="flex items-center gap-2 text-corpo">
          <input
            type="radio"
            name="tipo"
            checked={tipo === "template"}
            disabled={modelosDaConta.length === 0}
            onChange={() => setTipo("template")}
          />
          Modelo aprovado{modelosDaConta.length === 0 ? " (este número não tem)" : ""}
        </label>
      </fieldset>

      {tipo === "texto" ? (
        <Campo nome="conteudo" rotulo="Mensagem" {...erro("conteudo")}>
          <Textarea id="conteudo" name="conteudo" rows={4} maxLength={4000} required />
        </Campo>
      ) : (
        <>
          <Campo nome="template_id" rotulo="Modelo" {...erro("template_id")}>
            <select
              id="template_id"
              value={modeloId}
              onChange={(e) => { setModeloId(e.target.value); setValores([]); }}
              required
              className={CLASSE_SELECT}
            >
              <option value="">Escolha</option>
              {modelosDaConta.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </Campo>
          {variaveis.map((v, i) => (
            <Campo key={v.indice} nome={`var-${v.indice}`} rotulo={`Variável {{${v.indice}}}`}>
              <div className="flex gap-2">
                <Input
                  id={`var-${v.indice}`}
                  value={v.valor}
                  required
                  onChange={(e) => setValores((atual) => Object.assign([...atual], { [i]: e.target.value }))}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setValores((atual) => Object.assign([...atual], { [i]: MARCADOR_NOME }))}
                >
                  Nome da cliente
                </Button>
              </div>
            </Campo>
          ))}
        </>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setAberto(false)} disabled={pendente}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pendente} aria-busy={pendente}>
          {pendente ? "Agendando…" : "Agendar"}
        </Button>
      </div>
    </form>
  );
}
