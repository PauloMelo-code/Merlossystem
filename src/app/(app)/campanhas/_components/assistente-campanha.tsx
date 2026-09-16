"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Campo } from "@/components/comum/campo";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { ResumoDeErros } from "@/components/comum/resumo-de-erros";
import { criarNovaCampanha } from "@/lib/actions/campanhas";
import { conferirVariaveis, MARCADOR_NOME, renderizarCorpo } from "@/lib/conteudo/variaveis";
import type { Segmento } from "@/lib/validadores/campanhas";
import { PreviaSegmento } from "./previa-segmento";

type Conta = { id: string; rotulo: string; provedor: string; status: string };
type Modelo = { id: string; integracaoId: string; nome: string; corpo: string; variaveisContagem: number };
type Tipo = "modelo" | "texto";

const PASSOS = ["Conteúdo", "Número de saída", "Quem recebe"] as const;

/**
 * Assistente em 3 passos (04-ui.md §5.4). O passo 1 escolhe o TIPO de
 * conteúdo, que decide quais números servem no passo 2: modelo é do número
 * oficial dono dele; texto é do uazapi. A conta de saída é obrigatória.
 *
 * Não deixa avançar com variáveis em número diferente do que o modelo pede —
 * o servidor confere de novo ao criar e ao disparar.
 */
export function AssistenteCampanha({
  contas,
  modelos,
  etiquetas,
}: {
  contas: Conta[];
  modelos: Modelo[];
  etiquetas: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const uazapi = contas.filter((c) => c.provedor === "uazapi");
  const [passo, setPasso] = useState(0);
  const [tipo, setTipo] = useState<Tipo>(modelos.length > 0 ? "modelo" : "texto");
  const [modeloId, setModeloId] = useState(modelos[0]?.id ?? "");
  const [valores, setValores] = useState<string[]>([]);
  const [texto, setTexto] = useState("");
  const [contaId, setContaId] = useState(uazapi[0]?.id ?? "");
  const [nome, setNome] = useState("");
  const [segmento, setSegmento] = useState<Segmento>({});
  const [erros, setErros] = useState<Record<string, string[]>>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const modelo = modelos.find((m) => m.id === modeloId);
  const contagem = modelo?.variaveisContagem ?? 0;
  const variaveis = Array.from({ length: contagem }, (_, i) => ({ indice: i + 1, valor: valores[i] ?? "" }));
  const conta = tipo === "modelo" ? contas.find((c) => c.id === modelo?.integracaoId) : contas.find((c) => c.id === contaId);

  const problemaPasso1 =
    tipo === "modelo"
      ? !modelo
        ? "Escolha um modelo aprovado."
        : conferirVariaveis(variaveis, contagem)
      : texto.trim() === ""
        ? "Escreva o texto da campanha."
        : null;
  const problemaPasso2 = !conta ? "Escolha o número de saída." : null;
  const problema = passo === 0 ? problemaPasso1 : passo === 1 ? problemaPasso2 : null;

  function trocarModelo(id: string) {
    setModeloId(id);
    setValores([]);
  }

  function salvar() {
    iniciar(async () => {
      const r = await criarNovaCampanha({
        nome,
        integracao_id: conta?.id ?? "",
        template_id: tipo === "modelo" ? modeloId : null,
        conteudo_texto: tipo === "texto" ? texto : null,
        variaveis: tipo === "modelo" ? variaveis : [],
        segmento,
      });
      if (r.ok) {
        router.push(`/campanhas/${r.dados.id}`);
        return;
      }
      setErros(r.erros ?? {});
      setMensagem(r.mensagem);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-wrap gap-2" aria-label="Passos">
        {PASSOS.map((rotulo, i) => (
          <li
            key={rotulo}
            aria-current={i === passo ? "step" : undefined}
            className={`rounded-full border px-3 py-1 text-legenda ${i === passo ? "border-primary bg-accent font-medium" : "border-border text-muted-foreground"}`}
          >
            {i + 1}. {rotulo}
          </li>
        ))}
      </ol>

      {mensagem ? <FaixaAviso tom="perigo" titulo={mensagem} /> : null}
      <ResumoDeErros erros={erros} />

      {passo === 0 ? (
        <section className="flex flex-col gap-4">
          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-2 text-denso font-medium">Tipo de conteúdo</legend>
            <label className="flex items-center gap-2 text-corpo">
              <input type="radio" name="tipo" checked={tipo === "modelo"} disabled={modelos.length === 0} onChange={() => setTipo("modelo")} />
              Modelo aprovado (número oficial)
            </label>
            <label className="flex items-center gap-2 text-corpo">
              <input type="radio" name="tipo" checked={tipo === "texto"} disabled={uazapi.length === 0} onChange={() => setTipo("texto")} />
              Texto livre (uazapi)
            </label>
          </fieldset>

          {tipo === "modelo" ? (
            <>
              <Campo nome="modelo" rotulo="Modelo">
                <select
                  id="modelo"
                  value={modeloId}
                  onChange={(e) => trocarModelo(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-corpo"
                >
                  {modelos.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome} ({contas.find((c) => c.id === m.integracaoId)?.rotulo ?? "número"})
                    </option>
                  ))}
                </select>
              </Campo>
              {variaveis.map((v, i) => (
                <Campo key={v.indice} nome={`variavel-${v.indice}`} rotulo={`Variável {{${v.indice}}}`}>
                  <div className="flex gap-2">
                    <Input
                      id={`variavel-${v.indice}`}
                      value={v.valor}
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
              {modelo ? (
                <p className="rounded-lg bg-muted p-3 text-corpo whitespace-pre-wrap" aria-label="Prévia da mensagem">
                  {renderizarCorpo(
                    modelo.corpo,
                    variaveis.map((v) => ({ ...v, valor: v.valor.split(MARCADOR_NOME).join("Maria") || `{{${v.indice}}}` })),
                  )}
                </p>
              ) : null}
            </>
          ) : (
            <Campo nome="texto" rotulo="Texto da campanha">
              <Textarea id="texto" rows={6} maxLength={4000} value={texto} onChange={(e) => setTexto(e.target.value)} />
            </Campo>
          )}
        </section>
      ) : null}

      {passo === 1 ? (
        <section className="flex flex-col gap-4">
          {tipo === "modelo" ? (
            <p className="text-corpo">
              O modelo pertence ao número <strong>{conta?.rotulo}</strong> — a campanha sai por ele.
            </p>
          ) : (
            <Campo nome="conta" rotulo="Número de saída">
              <select
                id="conta"
                value={contaId}
                onChange={(e) => setContaId(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-corpo"
              >
                {uazapi.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.rotulo}
                  </option>
                ))}
              </select>
            </Campo>
          )}
          {conta && conta.status !== "conectado" ? (
            <FaixaAviso tom="aviso" titulo="Este número não está conectado." descricao="Dá para salvar o rascunho; o disparo só sai com o número conectado." />
          ) : null}
          {tipo === "texto" ? (
            <FaixaAviso tom="aviso" titulo="Número não oficial pode ser banido por envio em massa." descricao="A campanha sai devagar (1 mensagem por segundo) para reduzir o risco." />
          ) : null}
        </section>
      ) : null}

      {passo === 2 ? (
        <section className="flex flex-col gap-4">
          <Campo nome="nome" rotulo="Nome da campanha" {...(erros["nome"]?.[0] ? { erro: erros["nome"][0] } : {})}>
            <Input id="nome" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} placeholder="Coleção de inverno" />
          </Campo>
          <PreviaSegmento etiquetas={etiquetas} segmento={segmento} aoMudar={setSegmento} />
        </section>
      ) : null}

      {problema ? (
        <p role="status" className="text-legenda text-aviso">
          {problema}
        </p>
      ) : null}

      <div className="flex justify-between gap-2">
        <Button type="button" variant="outline" disabled={passo === 0 || pendente} onClick={() => setPasso((p) => p - 1)}>
          Voltar
        </Button>
        {passo < 2 ? (
          <Button type="button" aria-disabled={problema !== null} onClick={() => problema === null && setPasso((p) => p + 1)}>
            Próximo
          </Button>
        ) : (
          <Button type="button" onClick={salvar} disabled={pendente || nome.trim().length < 3} aria-busy={pendente}>
            {pendente ? "Salvando…" : "Salvar rascunho"}
          </Button>
        )}
      </div>
    </div>
  );
}
