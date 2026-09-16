"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CLASSES_DE_TOM } from "@/components/comum/selo-status";
import { Tempo } from "@/components/comum/tempo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { registrarConsentimentoDoContato } from "@/lib/actions/lgpd";

/**
 * Selo de opt-out e histórico de consentimento na ficha (01-dados-dominio.md
 * §7.2). Opt-out é de MARKETING: a tela diz com todas as letras que ele não
 * impede o atendimento.
 *
 * Registrar não é otimista (04-ui.md §10): espera o servidor, que grava a
 * prova (com o IP resolvido lá) e o espelho na mesma transação.
 */

export type LinhaConsentimento = {
  id: string;
  tipo: string;
  concedido: boolean;
  origem: string;
  termoVersao: string;
  criadoEm: string;
};

const ORIGENS: Readonly<Record<string, string>> = {
  mensagem: "pela conversa",
  tela: "registrado pela equipe",
  importacao: "importação",
  contato_direto: "contato direto",
};

function descrever(l: LinhaConsentimento): string {
  if (l.tipo === "tratamento_dados") {
    return l.concedido ? "Aceitou o tratamento de dados" : "Recusou o tratamento de dados";
  }
  const saiu = l.tipo === "opt_out" ? l.concedido : !l.concedido;
  return saiu ? "Pediu para não receber promoções" : "Aceitou receber promoções";
}

export interface ConsentimentoContatoProps {
  contatoId: string;
  lojaId: string;
  optOut: boolean;
  optOutEm: string | null;
  historico: readonly LinhaConsentimento[];
  podeRegistrar: boolean;
}

export function ConsentimentoContato({
  contatoId,
  lojaId,
  optOut,
  optOutEm,
  historico,
  podeRegistrar,
}: ConsentimentoContatoProps) {
  const router = useRouter();
  const [registrando, iniciar] = useTransition();
  const tom = CLASSES_DE_TOM[optOut ? "aviso" : "sucesso"];

  function registrar() {
    iniciar(async () => {
      const r = await registrarConsentimentoDoContato({
        contatoId,
        loja: lojaId,
        tipo: "marketing",
        concedido: optOut ? "true" : "false",
      });
      if (!r.ok) {
        toast.error(r.mensagem);
        return;
      }
      toast.success(r.dados.optOut ? "Registrado: não quer promoções." : "Registrado: aceita promoções.");
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="titulo-consentimento" className="flex flex-col gap-3">
      <h2 id="titulo-consentimento" className="text-titulo-secao font-medium">
        Promoções e consentimento
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={`${tom.fundo} ${tom.texto} ${tom.borda}`}>
          {optOut ? "Não quer promoções" : "Aceita promoções"}
        </Badge>
        {optOut && optOutEm ? (
          <span className="text-legenda text-muted-foreground">
            desde <Tempo valor={optOutEm} formato="data" />
          </span>
        ) : null}
      </div>
      <p className="text-denso text-muted-foreground">
        Vale só para campanhas e mensagens promocionais. Quando ela escrever, a equipe responde normalmente.
      </p>

      {podeRegistrar ? (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={registrar} disabled={registrando} aria-busy={registrando}>
            {optOut ? "Registrar que voltou a aceitar promoções" : "Registrar que não quer promoções"}
          </Button>
        </div>
      ) : null}

      {historico.length > 0 ? (
        <ul className="flex flex-col gap-1.5 text-denso">
          {historico.map((l) => (
            <li key={l.id} className="flex flex-wrap items-baseline gap-x-2">
              <Tempo valor={l.criadoEm} className="text-legenda text-texto-terciario tabular-nums" />
              <span>{descrever(l)}</span>
              <span className="text-legenda text-muted-foreground">
                ({ORIGENS[l.origem] ?? l.origem}, termo {l.termoVersao})
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-denso text-muted-foreground">Nenhum registro de consentimento ainda.</p>
      )}
    </section>
  );
}
