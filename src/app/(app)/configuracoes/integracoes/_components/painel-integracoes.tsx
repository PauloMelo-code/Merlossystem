"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { IconeCanal } from "@/components/comum/icone-canal";
import { SeloStatus } from "@/components/comum/selo-status";
import { TabelaDados, type Coluna } from "@/components/comum/tabela-dados";
import { Tempo } from "@/components/comum/tempo";
import { iniciarConexaoBling } from "@/lib/actions/integracoes";
import { PROVEDORES, type ProvedorConectavel } from "@/lib/integracoes/catalogo-provedores";
import { FormularioConexao, type LojaDaOpcao } from "./formulario-conexao";

export type ContaNaLista = {
  id: string;
  provedor: string;
  rotulo: string;
  lojaNome: string | null;
  status: string;
  expiraEm: string | null;
  ultimoErro: string | null;
  ultimaSincronizacao: string | null;
  finalDaCredencial: string;
};

/** Resultado do retorno do OAuth, em texto que diz o que fazer. */
const RETORNO_BLING: Record<string, { tom: "sucesso" | "perigo" | "aviso"; texto: string }> = {
  conectado: { tom: "sucesso", texto: "Bling conectado. O catálogo começa a sincronizar em instantes." },
  negado: { tom: "aviso", texto: "A autorização foi cancelada no Bling. Nada mudou." },
  expirado: { tom: "perigo", texto: "A autorização expirou ou já foi usada. Clique em Conectar Bling de novo." },
  invalido: { tom: "perigo", texto: "O Bling devolveu uma resposta incompleta. Tente conectar de novo." },
  "sem-permissao": { tom: "perigo", texto: "Você não tem acesso a esta ação. Fale com o administrador." },
  falhou: { tom: "perigo", texto: "Não foi possível falar com o Bling agora. Tente de novo em instantes." },
};

function rotuloDoProvedor(p: string): string {
  return p in PROVEDORES ? PROVEDORES[p as ProvedorConectavel].rotulo : p;
}

/**
 * Contas conectadas por loja (04-ui.md §5.6): status, validade e último erro
 * em texto. A credencial aparece só pelos 4 últimos caracteres.
 */
export function PainelIntegracoes({
  contas,
  lojas,
  podeConectar,
  blingConfigurado,
  retornoBling,
}: {
  contas: readonly ContaNaLista[];
  lojas: readonly LojaDaOpcao[];
  podeConectar: boolean;
  blingConfigurado: boolean;
  retornoBling: string | null;
}) {
  const router = useRouter();
  const [conectando, setConectando] = useState(false);
  const [indoAoBling, setIndoAoBling] = useState(false);
  const [erroBling, setErroBling] = useState("");
  const retorno = retornoBling ? RETORNO_BLING[retornoBling] : undefined;
  const temBling = contas.some((c) => c.provedor === "bling");

  async function conectarBling() {
    setIndoAoBling(true);
    setErroBling("");
    const r = await iniciarConexaoBling();
    if (!r.ok) {
      setIndoAoBling(false);
      setErroBling(r.mensagem);
      return;
    }
    window.location.assign(r.dados.url);
  }

  const colunas: Coluna<ContaNaLista>[] = [
    {
      chave: "conta",
      rotulo: "Conta",
      render: (c) => (
        <Link href={`/configuracoes/integracoes/${c.id}`} className="flex items-center gap-2 font-medium underline-offset-2 hover:underline">
          <IconeCanal canal={c.provedor} tamanho="pequeno" />
          {c.rotulo}
        </Link>
      ),
    },
    { chave: "provedor", rotulo: "Provedor", render: (c) => rotuloDoProvedor(c.provedor) },
    { chave: "loja", rotulo: "Loja", render: (c) => c.lojaNome ?? "Rede" },
    { chave: "status", rotulo: "Status", render: (c) => <SeloStatus dominio="status_integracao" valor={c.status} /> },
    { chave: "credencial", rotulo: "Credencial", render: (c) => <span className="font-mono">{c.finalDaCredencial}</span> },
    {
      chave: "erro",
      rotulo: "Último erro",
      render: (c) => c.ultimoErro ?? <span className="text-muted-foreground">nenhum</span>,
    },
    {
      chave: "validade",
      rotulo: "Validade",
      render: (c) => (c.expiraEm ? <Tempo valor={c.expiraEm} formato="dataHora" /> : "—"),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {retorno ? <FaixaAviso tom={retorno.tom} titulo={retorno.texto} /> : null}
      {erroBling ? <FaixaAviso tom="perigo" titulo={erroBling} /> : null}

      {podeConectar ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setConectando(true)} disabled={lojas.length === 0}>
            <Plus aria-hidden="true" strokeWidth={2} />
            Conectar número ou conta
          </Button>
          {blingConfigurado ? (
            <Button variant="outline" onClick={() => void conectarBling()} disabled={indoAoBling} aria-busy={indoAoBling}>
              <RefreshCw aria-hidden="true" strokeWidth={2} />
              {temBling ? "Reconectar Bling" : "Conectar Bling"}
            </Button>
          ) : (
            <p className="self-center text-denso text-muted-foreground">
              O Bling não está configurado neste ambiente.
            </p>
          )}
        </div>
      ) : null}

      <TabelaDados
        colunas={colunas}
        itens={contas}
        chave={(c) => c.id}
        vazio={
          <EstadoVazio
            titulo="Nenhum número conectado nesta loja."
            descricao={podeConectar ? "Conecte o primeiro número para começar a atender." : "Fale com o administrador."}
            {...(podeConectar && lojas.length > 0
              ? { acao: <Button onClick={() => setConectando(true)}>Conectar número</Button> }
              : {})}
          />
        }
        cartaoMobile={(c) => (
          <Link href={`/configuracoes/integracoes/${c.id}`} className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2 font-medium">
              <IconeCanal canal={c.provedor} tamanho="pequeno" />
              {c.rotulo}
            </span>
            <span className="text-legenda text-muted-foreground">
              {rotuloDoProvedor(c.provedor)} · {c.lojaNome ?? "Rede"}
            </span>
            <SeloStatus dominio="status_integracao" valor={c.status} />
            {c.ultimoErro ? <span className="text-legenda text-perigo">{c.ultimoErro}</span> : null}
          </Link>
        )}
      />

      <Dialog open={conectando} onOpenChange={setConectando}>
        <DialogContent className="max-h-dvh overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conectar número ou conta</DialogTitle>
            <DialogDescription>Escolha o canal, a loja e cole as credenciais.</DialogDescription>
          </DialogHeader>
          {conectando ? (
            <FormularioConexao
              lojas={lojas}
              onConcluido={() => {
                setConectando(false);
                router.refresh();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
