"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Campo, idsDeApoio } from "@/components/comum/campo";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { ModalConfirmacaoBlock } from "@/components/comum/modal-confirmacao-block";
import { ResumoDeErros } from "@/components/comum/resumo-de-erros";
import type { Resultado } from "@/lib/erros";
import { criarLoja, editarLoja } from "@/lib/actions/lojas";

export type LojaEditavel = {
  id: string;
  nome: string;
  slug: string;
  sigla: string;
  blingDepositoId: string | null;
  updatedAt: string;
};

/** Depósito da conta Bling da rede (costura `listarDepositosBling`, do M4). */
export type DepositoDaOpcao = { id: string; descricao: string; padrao: boolean; ativo: boolean };

type Campos = { nome: string; slug: string; sigla: string; blingDepositoId: string };

const CLASSE_SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-corpo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-80";

const INICIAL: Resultado<never> = { ok: false, codigo: "", mensagem: "" };
const ROTULOS: Record<keyof Campos, string> = {
  nome: "Nome",
  slug: "Endereço",
  sigla: "Sigla",
  blingDepositoId: "Depósito do Bling",
};

/** Resumo do block (§9.1, item 9): o diff "de X para Y", sigla incluída. */
export function resumoDaLoja(antes: Campos | null, depois: Campos): string {
  if (!antes) {
    return `Criar a loja "${depois.nome}" com sigla ${depois.sigla}, endereço "${depois.slug}"` +
      (depois.blingDepositoId ? ` e depósito do Bling ${depois.blingDepositoId}.` : ", sem depósito do Bling.");
  }
  const mudancas = (Object.keys(ROTULOS) as (keyof Campos)[])
    .filter((k) => antes[k] !== depois[k])
    .map((k) => `${ROTULOS[k]}: de "${antes[k] || "vazio"}" para "${depois[k] || "vazio"}"`);
  return mudancas.length > 0 ? `${mudancas.join("; ")}.` : "Nenhum campo mudou.";
}

function lerCampos(form: FormData): Campos {
  const v = (k: string) => String(form.get(k) ?? "").trim();
  return { nome: v("nome"), slug: v("slug").toLowerCase(), sigla: v("sigla").toUpperCase(), blingDepositoId: v("blingDepositoId") };
}

/**
 * Depósito do Bling: com a lista da conta da rede, escolhe; sem ela (Bling
 * desconectado ou fora do ar), digita o número. O depósito atual que sumiu do
 * Bling continua na lista, marcado, para a edição não apagá-lo em silêncio.
 */
function CampoDeposito({
  depositos,
  valor,
  erro,
}: {
  depositos: readonly DepositoDaOpcao[] | null;
  valor: string;
  erro?: string;
}) {
  const comLista = depositos !== null && depositos.length > 0;
  const ajuda = comLista
    ? "Depósito desta loja no Bling. Sem ele, a loja não mostra estoque."
    : "Número do depósito desta loja no Bling. Sem ele, a loja não mostra estoque." +
      (depositos === null ? " A lista do Bling não está disponível agora." : "");
  const apoio = { "aria-invalid": Boolean(erro), "aria-describedby": idsDeApoio("blingDepositoId", { ajuda, erro }) };

  let controle: ReactNode;
  if (comLista) {
    const opcoes = depositos.filter((d) => d.ativo || d.id === valor);
    if (valor && !opcoes.some((d) => d.id === valor)) {
      opcoes.push({ id: valor, descricao: "não encontrado no Bling", padrao: false, ativo: false });
    }
    controle = (
      <select id="blingDepositoId" name="blingDepositoId" defaultValue={valor} className={CLASSE_SELECT} {...apoio}>
        <option value="">Sem depósito</option>
        {opcoes.map((d) => (
          <option key={d.id} value={d.id}>
            {`${d.descricao} (nº ${d.id})${d.padrao ? " · padrão" : ""}${d.ativo ? "" : " · inativo"}`}
          </option>
        ))}
      </select>
    );
  } else {
    controle = (
      <Input id="blingDepositoId" name="blingDepositoId" defaultValue={valor}
        inputMode="numeric" maxLength={20} className="w-48" {...apoio} />
    );
  }

  return (
    <Campo nome="blingDepositoId" rotulo="Depósito do Bling" opcional ajuda={ajuda} {...(erro ? { erro } : {})}>
      {controle}
    </Campo>
  );
}

/**
 * Criar/editar loja (04-ui.md §5.6). O envio passa pelo block de 3 s com o
 * diff; o formulário nunca é limpo em erro, e `updatedAt` vai oculto (§7.4).
 */
export function FormularioLoja({
  loja,
  depositos = null,
  onConcluido,
  onCancelar,
}: {
  loja: LojaEditavel | null;
  /** `null` = lista do Bling indisponível: o número é digitado. */
  depositos?: readonly DepositoDaOpcao[] | null;
  onConcluido: () => void;
  onCancelar: () => void;
}) {
  const [estado, setEstado] = useState<Resultado<unknown>>(INICIAL);
  const [pendente, setPendente] = useState(false);
  const [pedido, setPedido] = useState<{ dados: FormData; resumo: string } | null>(null);
  const [erroDoModal, setErroDoModal] = useState("");

  const antes: Campos | null = loja
    ? { nome: loja.nome, slug: loja.slug, sigla: loja.sigla, blingDepositoId: loja.blingDepositoId ?? "" }
    : null;
  const valores = !estado.ok && estado.valores ? estado.valores : null;
  const erros = !estado.ok ? (estado.erros ?? {}) : {};

  function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    setErroDoModal("");
    setPedido({ dados, resumo: resumoDaLoja(antes, lerCampos(dados)) });
  }

  async function confirmar() {
    if (!pedido) return;
    setPendente(true);
    const r = loja ? await editarLoja(INICIAL, pedido.dados) : await criarLoja(INICIAL, pedido.dados);
    setPendente(false);
    setEstado(r);
    if (r.ok) return onConcluido();
    // Erro de campo: o modal fecha para a pessoa corrigir. Os demais erros
    // ficam DENTRO do modal (§9.1), com o que foi digitado preservado atrás.
    if (r.codigo === "VALIDACAO") setPedido(null);
    else setErroDoModal(r.mensagem);
  }

  const erroDe = (k: string) => erros[k]?.[0];
  const valorDe = (k: keyof Campos) => valores?.[k] ?? (antes ? antes[k] : "");

  return (
    <form onSubmit={aoEnviar} className="flex flex-col gap-5" noValidate>
      {loja ? (
        <>
          <input type="hidden" name="id" value={loja.id} />
          <input type="hidden" name="updatedAt" value={loja.updatedAt} />
        </>
      ) : null}

      {!estado.ok && estado.codigo === "COLISAO" ? (
        <FaixaAviso
          tom="perigo"
          titulo={estado.mensagem}
          descricao="Feche e abra de novo para ver a versão atual."
        />
      ) : null}
      <ResumoDeErros erros={erros} />

      <Campo nome="nome" rotulo="Nome da loja" {...(erroDe("nome") ? { erro: erroDe("nome")! } : {})}>
        <Input id="nome" name="nome" defaultValue={valorDe("nome")} required maxLength={80}
          aria-invalid={Boolean(erroDe("nome"))} aria-describedby={idsDeApoio("nome", { erro: erroDe("nome") })} />
      </Campo>

      <Campo nome="slug" rotulo="Endereço (slug)" ajuda="Minúsculas, números e hífen. Ex.: cerro-azul."
        {...(erroDe("slug") ? { erro: erroDe("slug")! } : {})}>
        <Input id="slug" name="slug" defaultValue={valorDe("slug")} required maxLength={60} autoCapitalize="none"
          aria-invalid={Boolean(erroDe("slug"))}
          aria-describedby={idsDeApoio("slug", { ajuda: "sim", erro: erroDe("slug") })} />
      </Campo>

      <Campo nome="sigla" rotulo="Sigla (3 letras)"
        ajuda="A sigla entra no número do pedido (MS2609-CEN-0042). Não mude depois que a loja tiver pedido."
        {...(erroDe("sigla") ? { erro: erroDe("sigla")! } : {})}>
        <Input id="sigla" name="sigla" defaultValue={valorDe("sigla")} required maxLength={3}
          pattern="[A-Za-z]{3}" className="w-24 uppercase" autoCapitalize="characters"
          aria-invalid={Boolean(erroDe("sigla"))}
          aria-describedby={idsDeApoio("sigla", { ajuda: "sim", erro: erroDe("sigla") })} />
      </Campo>

      <CampoDeposito
        depositos={depositos}
        valor={valorDe("blingDepositoId")}
        {...(erroDe("blingDepositoId") ? { erro: erroDe("blingDepositoId")! } : {})}
      />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancelar}>Cancelar</Button>
        <Button type="submit">{loja ? "Salvar alterações" : "Criar loja"}</Button>
      </div>

      <ModalConfirmacaoBlock
        aberto={pedido !== null}
        titulo={loja ? "Confirmar alterações da loja" : "Confirmar nova loja"}
        resumo={pedido?.resumo ?? ""}
        descricao="A loja é o escopo de tudo: conversas, pedidos e acessos."
        textoConfirmar={loja ? "Salvar alterações" : "Criar loja"}
        carregando={pendente}
        {...(erroDoModal ? { erro: erroDoModal } : {})}
        onConfirmar={() => void confirmar()}
        onCancelar={() => setPedido(null)}
      />
    </form>
  );
}
