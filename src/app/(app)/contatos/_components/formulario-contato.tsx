"use client";

import { useActionState, useEffect, useState } from "react";
import { BotaoEnviar } from "@/components/comum/botao-enviar";
import { Campo, idsDeApoio } from "@/components/comum/campo";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { ResumoDeErros } from "@/components/comum/resumo-de-erros";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { criarContato, salvarContato } from "@/lib/actions/contatos";
import type { Endereco } from "@/lib/db/schema/contatos";
import type { Resultado } from "@/lib/erros";
import { telefone as formatarTelefone } from "@/lib/formato";

/**
 * Cadastro e edição do contato (04-ui.md §5.3 e §7.1). Server Action +
 * `useActionState`; o servidor valida de novo e é a fonte da verdade.
 *
 * - telefone `type="tel"`: a pessoa digita como quiser, o servidor grava o
 *   canônico E.164 só dígitos;
 * - `updatedAt` em campo oculto: colisão vira faixa `perigo`, nunca
 *   sobrescrita silenciosa (§7.4);
 * - `loja` oculta = a loja DO contato (para quem é gestão);
 * - o formulário nunca é limpo no erro, e avisa antes de sair com alteração.
 */

export type ContatoEditavel = {
  id: string;
  lojaId: string;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  tamanhoPreferido: string | null;
  observacoes: string | null;
  aniversario: string | null;
  endereco: Endereco | null;
  atualizadoEm: string;
};

type Saida = { id: string; existeExcluido?: boolean; atualizadoEm?: Date };

const INICIAL: Resultado<Saida> = { ok: false, codigo: "", mensagem: "" };

const TAMANHOS = [
  { valor: "slim", rotulo: "Slim (PP a GG)" },
  { valor: "plussize", rotulo: "Plus size (46 a 58)" },
  { valor: "ambos", rotulo: "Os dois" },
] as const;

export interface FormularioContatoProps {
  contato?: ContatoEditavel;
  onConcluido?: (saida: Saida) => void;
}

export function FormularioContato({ contato, onConcluido }: FormularioContatoProps) {
  const acao = contato ? salvarContato : criarContato;
  const [estado, enviar] = useActionState(
    async (anterior: Resultado<Saida>, form: FormData) => {
      const r = (await acao(anterior as never, form)) as Resultado<Saida>;
      if (r.ok) onConcluido?.(r.dados);
      return r;
    },
    INICIAL,
  );
  const [sujo, setSujo] = useState(false);

  useEffect(() => {
    if (!sujo || estado.ok) return;
    const aviso = (evento: BeforeUnloadEvent) => evento.preventDefault();
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sujo, estado.ok]);

  const erros = estado.ok ? {} : (estado.erros ?? {});
  const valores = estado.ok ? {} : (estado.valores ?? {});
  const versao =
    estado.ok && estado.dados.atualizadoEm
      ? new Date(estado.dados.atualizadoEm).toISOString()
      : (contato?.atualizadoEm ?? "");
  const inicial = (campo: string, padrao: string | null | undefined) => valores[campo] ?? padrao ?? "";
  const erro = (campo: string) => erros[campo]?.[0];
  const apoio = (campo: string, ajuda?: string) => ({
    id: campo,
    name: campo,
    "aria-invalid": Boolean(erro(campo)),
    "aria-describedby": idsDeApoio(campo, { ajuda, erro: erro(campo) }),
  });
  const comErro = (campo: string) => (erro(campo) ? { erro: erro(campo) as string } : {});
  // Contato novo: a action resolve a loja (cookie da gestão ou cadastro).
  const loja = contato?.lojaId ?? "";
  const e = contato?.endereco;

  return (
    <form action={enviar} onChange={() => setSujo(true)} className="flex flex-col gap-5">
      {contato ? <input type="hidden" name="id" value={contato.id} /> : null}
      {contato ? <input type="hidden" name="updatedAt" value={versao} /> : null}
      {loja ? <input type="hidden" name="loja" value={loja} /> : null}

      {!estado.ok && estado.codigo === "COLISAO" ? (
        <FaixaAviso tom="perigo" titulo={estado.mensagem} descricao="Feche e abra a ficha de novo para ver a versão atual." />
      ) : null}
      {!estado.ok && estado.codigo && !["COLISAO", "VALIDACAO"].includes(estado.codigo) ? (
        <FaixaAviso tom="perigo" titulo={estado.mensagem} />
      ) : null}
      {estado.ok && estado.dados.existeExcluido ? (
        <FaixaAviso
          tom="aviso"
          titulo="Existe um contato excluído com este número."
          descricao="O novo contato foi criado. O antigo continua excluído, com o histórico dele."
        />
      ) : null}

      <ResumoDeErros erros={erros} />

      <Campo nome="nome" rotulo="Nome" opcional {...comErro("nome")}>
        <Input {...apoio("nome")} autoComplete="off" defaultValue={inicial("nome", contato?.nome)} />
      </Campo>

      <Campo
        nome="telefone"
        rotulo="Telefone"
        opcional
        ajuda="Com DDD. Número de fora do Brasil começa com +."
        {...comErro("telefone")}
      >
        <Input
          {...apoio("telefone", "ajuda")}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          defaultValue={inicial("telefone", contato?.telefone ? formatarTelefone(contato.telefone) : "")}
        />
      </Campo>

      <Campo nome="email" rotulo="E-mail" opcional {...comErro("email")}>
        <Input {...apoio("email")} type="email" autoComplete="off" defaultValue={inicial("email", contato?.email)} />
      </Campo>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-denso font-medium">
          Tamanho que costuma usar <span className="font-normal text-texto-terciario">(opcional)</span>
        </legend>
        <div className="flex flex-wrap gap-4">
          {TAMANHOS.map((t) => (
            <label key={t.valor} className="flex items-center gap-2 text-corpo">
              <input
                type="radio"
                name="tamanhoPreferido"
                value={t.valor}
                defaultChecked={inicial("tamanhoPreferido", contato?.tamanhoPreferido) === t.valor}
              />
              {t.rotulo}
            </label>
          ))}
        </div>
      </fieldset>

      <Campo nome="aniversario" rotulo="Aniversário" opcional {...comErro("aniversario")}>
        <Input {...apoio("aniversario")} type="date" className="w-44" defaultValue={inicial("aniversario", contato?.aniversario)} />
      </Campo>

      <fieldset className="grid gap-3 sm:grid-cols-6">
        <legend className="mb-2 text-denso font-medium sm:col-span-6">
          Endereço <span className="font-normal text-texto-terciario">(opcional — preencha tudo ou nada)</span>
        </legend>
        {(
          [
            ["cep", "CEP", "sm:col-span-2", e?.cep],
            ["logradouro", "Rua", "sm:col-span-4", e?.logradouro],
            ["numero", "Número", "sm:col-span-2", e?.numero],
            ["complemento", "Complemento", "sm:col-span-4", e?.complemento],
            ["bairro", "Bairro", "sm:col-span-2", e?.bairro],
            ["cidade", "Cidade", "sm:col-span-3", e?.cidade],
            ["uf", "UF", "sm:col-span-1", e?.uf],
          ] as const
        ).map(([campo, rotulo, largura, valor]) => (
          <div key={campo} className={largura}>
            <Campo nome={`endereco.${campo}`} rotulo={rotulo} {...comErro(`endereco.${campo}`)}>
              <Input
                {...apoio(`endereco.${campo}`)}
                autoComplete="off"
                {...(campo === "cep" ? { inputMode: "numeric" as const } : {})}
                defaultValue={inicial(`endereco.${campo}`, valor)}
              />
            </Campo>
          </div>
        ))}
      </fieldset>

      <Campo nome="observacoes" rotulo="Observações" opcional {...comErro("observacoes")}>
        <Textarea {...apoio("observacoes")} rows={3} defaultValue={inicial("observacoes", contato?.observacoes)} />
      </Campo>

      <div className="flex justify-end">
        <BotaoEnviar className="w-full sm:w-auto">{contato ? "Salvar alterações" : "Cadastrar contato"}</BotaoEnviar>
      </div>
    </form>
  );
}
