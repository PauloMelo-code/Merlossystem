"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { SeletorProduto } from "@/app/(app)/conversas/_components/seletor-produto";
import { SeloDisponibilidade } from "@/app/(app)/produtos/_components/selo-disponibilidade";
import { Campo } from "@/components/comum/campo";
import { Dinheiro } from "@/components/comum/dinheiro";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { ModalConfirmacaoBlock } from "@/components/comum/modal-confirmacao-block";
import { ResumoDeErros } from "@/components/comum/resumo-de-erros";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { produtoParaVenda, type ProdutoParaVenda } from "@/lib/actions/catalogo";
import { fecharVenda } from "@/lib/actions/pedidos";
import { FORMAS_PAGAMENTO } from "@/lib/db/schema/_enums/pedidos";
import { REGEX_DINHEIRO, deCentavos, moeda, multiplicar, paraCentavos } from "@/lib/formato";

type Item = {
  variacaoId: string;
  nome: string;
  tamanho: string;
  preco: string;
  quantidade: number;
  disponivel: number | null;
};

const ROTULO_PAGAMENTO: Record<string, string> = {
  pix: "Pix",
  cartao: "Cartão",
  boleto: "Boleto",
  link: "Link de pagamento",
  dinheiro: "Dinheiro",
};

/** "12,90" → centavos; valor ilegível conta como zero (o servidor valida de novo). */
function centavosDe(texto: string): number {
  const v = texto.trim().replace(",", ".");
  return v !== "" && REGEX_DINHEIRO.test(v) ? paraCentavos(v) : 0;
}

/**
 * "Nova venda" — ponte com o Masc (04-ui.md §5.2). Carrinho por (produto,
 * tamanho), aviso ao passar do disponível SEM bloquear, e block de 3 s no
 * "Fechar venda". O total da tela é prévia: preço e total finais vêm do
 * servidor, que relê o catálogo.
 */
export function NovaVenda({
  lojaId,
  lojaNome,
  contatoId,
  conversaId,
}: {
  lojaId: string;
  lojaNome: string | null;
  contatoId: string;
  conversaId: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [produto, setProduto] = useState<ProdutoParaVenda | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [frete, setFrete] = useState("");
  const [desconto, setDesconto] = useState("");
  const [forma, setForma] = useState("");
  const [erros, setErros] = useState<Record<string, string[]>>({});
  const [falha, setFalha] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [erroModal, setErroModal] = useState<string | undefined>();
  const [pendente, iniciar] = useTransition();

  function escolher(sku: string) {
    setFalha(null);
    iniciar(async () => {
      const r = await produtoParaVenda({ sku, loja: lojaId });
      if (r.ok) setProduto(r.dados);
      else setFalha(r.mensagem);
    });
  }

  function adicionar(p: ProdutoParaVenda, v: ProdutoParaVenda["variacoes"][number]) {
    setItens((atuais) => {
      const existente = atuais.find((i) => i.variacaoId === v.id);
      if (existente) {
        return atuais.map((i) => (i.variacaoId === v.id ? { ...i, quantidade: i.quantidade + 1 } : i));
      }
      return [
        ...atuais,
        {
          variacaoId: v.id,
          nome: p.nome,
          tamanho: v.tamanho,
          preco: p.preco,
          quantidade: 1,
          disponivel: v.disponivel?.disponivel ?? null,
        },
      ];
    });
  }

  const subtotal = itens.reduce((s, i) => s + paraCentavos(multiplicar(i.preco, i.quantidade)), 0);
  const total = subtotal + centavosDe(frete) - centavosDe(desconto);
  const qtd = itens.reduce((s, i) => s + i.quantidade, 0);

  function limpar() {
    setProduto(null);
    setItens([]);
    setFrete("");
    setDesconto("");
    setForma("");
    setErros({});
    setFalha(null);
  }

  function confirmar() {
    iniciar(async () => {
      const r = await fecharVenda({
        loja: lojaId,
        contatoId,
        conversaId,
        itens: itens.map((i) => ({ variacaoId: i.variacaoId, quantidade: i.quantidade })),
        frete,
        desconto,
        ...(forma ? { formaPagamento: forma } : {}),
      });
      if (r.ok) {
        setConfirmando(false);
        setAberto(false);
        limpar();
        toast.success(`Pedido ${r.dados.numero} criado. Ele entrou na fila "falta lançar no Masc".`, {
          action: { label: "Abrir", onClick: () => router.push(`/pedidos/${r.dados.id}`) },
        });
        router.refresh();
        return;
      }
      setErroModal(r.mensagem);
      setErros(r.erros ?? {});
    });
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(valor) => {
        setAberto(valor);
        if (!valor) limpar();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          Nova venda
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nova venda</DialogTitle>
          <DialogDescription>
            O pedido entra na fila &quot;falta lançar no Masc&quot;{lojaNome ? ` da loja ${lojaNome}` : ""}.
          </DialogDescription>
        </DialogHeader>

        <ResumoDeErros erros={erros} />
        {falha ? <FaixaAviso tom="perigo" titulo={falha} /> : null}

        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <SeletorProduto onEscolher={escolher} lojaId={lojaId} />
            {produto ? (
              <section aria-labelledby="tamanhos" className="flex flex-col gap-2">
                <h3 id="tamanhos" className="text-denso font-semibold">
                  {produto.nome} · <Dinheiro valor={produto.preco} />
                </h3>
                {produto.variacoes.length === 0 ? (
                  <p className="text-denso text-muted-foreground">Sem tamanhos cadastrados no Bling.</p>
                ) : (
                  <ul className="grid grid-cols-2 gap-2">
                    {produto.variacoes.map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          onClick={() => adicionar(produto, v)}
                          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 hover:bg-accent"
                          aria-label={`Adicionar tamanho ${v.tamanho}`}
                        >
                          <span className="font-medium">{v.tamanho}</span>
                          <SeloDisponibilidade valor={v.disponivel} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {produto.variacoes.some((v) => v.disponivel?.leituraAntiga) ? (
                  <FaixaAviso tom="aviso" titulo="A leitura do Bling está antiga ou indisponível." descricao="Confirme o estoque antes de prometer à cliente." />
                ) : null}
              </section>
            ) : null}
          </div>

          <section aria-labelledby="carrinho" className="flex flex-col gap-3">
            <h3 id="carrinho" className="text-denso font-semibold">Carrinho</h3>
            {itens.length === 0 ? (
              <p className="text-denso text-muted-foreground">Busque um produto e escolha o tamanho.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                {itens.map((item) => (
                  <li key={item.variacaoId} className="flex flex-col gap-1 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-denso font-medium">
                        {item.nome} · {item.tamanho}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remover ${item.nome} ${item.tamanho}`}
                        onClick={() => setItens((a) => a.filter((i) => i.variacaoId !== item.variacaoId))}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-denso">
                        Qtd.
                        <Input
                          type="number"
                          min={1}
                          max={999}
                          inputMode="numeric"
                          value={item.quantidade}
                          className="h-8 w-20"
                          onChange={(e) => {
                            const n = Math.max(1, Math.min(999, Math.trunc(Number(e.target.value) || 1)));
                            setItens((a) => a.map((i) => (i.variacaoId === item.variacaoId ? { ...i, quantidade: n } : i)));
                          }}
                        />
                      </label>
                      <Dinheiro valor={multiplicar(item.preco, item.quantidade)} />
                    </div>
                    {item.disponivel !== null && item.quantidade > item.disponivel ? (
                      <p className="text-legenda text-aviso">
                        Passa do disponível ({item.disponivel}). A venda segue, mas confirme o estoque.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Campo nome="frete" rotulo="Frete" opcional {...(erros["frete"]?.[0] ? { erro: erros["frete"][0] } : {})}>
                <Input id="frete" inputMode="decimal" placeholder="0,00" value={frete} onChange={(e) => setFrete(e.target.value)} />
              </Campo>
              <Campo nome="desconto" rotulo="Desconto" opcional {...(erros["desconto"]?.[0] ? { erro: erros["desconto"][0] } : {})}>
                <Input id="desconto" inputMode="decimal" placeholder="0,00" value={desconto} onChange={(e) => setDesconto(e.target.value)} />
              </Campo>
            </div>
            <Campo nome="formaPagamento" rotulo="Forma de pagamento" opcional>
              <select
                id="formaPagamento"
                value={forma}
                onChange={(e) => setForma(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-denso"
              >
                <option value="">Não informada</option>
                {FORMAS_PAGAMENTO.map((f) => (
                  <option key={f} value={f}>
                    {ROTULO_PAGAMENTO[f] ?? f}
                  </option>
                ))}
              </select>
            </Campo>

            <p className="flex items-center justify-between text-corpo font-semibold">
              <span>Total previsto</span>
              <span className="tabular-nums">{total >= 0 ? moeda(deCentavos(total)) : "Desconto maior que o valor"}</span>
            </p>

            <Button
              type="button"
              disabled={pendente || itens.length === 0 || total < 0}
              onClick={() => {
                setErroModal(undefined);
                setConfirmando(true);
              }}
            >
              Fechar venda
            </Button>
            <Link href="/pedidos" className="text-center text-legenda underline">
              Ver fila do Masc
            </Link>
          </section>
        </div>

        {confirmando ? (
          <ModalConfirmacaoBlock
            aberto
            titulo="Fechar venda"
            resumo={`${qtd} ${qtd === 1 ? "peça" : "peças"} · total previsto ${moeda(deCentavos(Math.max(0, total)))}${lojaNome ? ` · loja ${lojaNome}` : ""}. O pedido vai entrar na fila "falta lançar no Masc".`}
            descricao={itens.map((i) => `${i.quantidade}× ${i.nome} (${i.tamanho})`).join(", ")}
            textoConfirmar="Fechar venda"
            carregando={pendente}
            {...(erroModal ? { erro: erroModal } : {})}
            onConfirmar={confirmar}
            onCancelar={() => setConfirmando(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
