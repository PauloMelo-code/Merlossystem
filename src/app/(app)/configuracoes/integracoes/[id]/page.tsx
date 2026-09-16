import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { exigirSessao, pode } from "@/lib/auth/guard";
import { detalharIntegracao } from "@/lib/actions/integracoes";
import { ehProvedorDeCanal, PROVEDORES, type ProvedorConectavel } from "@/lib/integracoes/catalogo-provedores";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { Copiar } from "@/components/comum/copiar";
import { EstadoErro } from "@/components/comum/estado-erro";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { SeloStatus } from "@/components/comum/selo-status";
import { Tempo } from "@/components/comum/tempo";
import { textoDaCredencial } from "../_credencial";
import { AcoesDaConta } from "./_components/acoes-da-conta";
import { EditarConta, ReautenticarConta } from "./_components/editar-conta";

export const metadata: Metadata = { title: "Conta conectada" };

const TIPO_DO_EVENTO: Record<string, string> = {
  recebido: "Recebido, aguardando",
  recusado: "Recusado",
  descartado: "Descartado",
  processado: "Processado",
  falhou: "Falhou",
};

/**
 * `/configuracoes/integracoes/[id]` — rótulo, loja, histórico de erro e
 * reautenticação (04-ui.md §5.6). Conta de outra loja responde como
 * inexistente (404), nunca 403. O segredo NUNCA aparece; o corpo dos eventos
 * também não (é dado de cliente).
 */
export default async function PaginaDaConta({ params }: { params: Promise<{ id: string }> }) {
  const sessao = await exigirSessao();
  if (!pode(sessao.papel, "integracoes", "ler")) {
    return <EstadoErro titulo="Você não tem acesso a esta área." descricao="Fale com o administrador." />;
  }
  const { id } = await params;
  const resultado = await detalharIntegracao(id);
  if (!resultado.ok) {
    if (resultado.codigo === "NAO_ENCONTRADO" || resultado.codigo === "VALIDACAO") notFound();
    return <EstadoErro titulo="Não foi possível abrir a conta." descricao={resultado.mensagem} />;
  }

  const { conta, eventos, lojas, urlDoWebhook } = resultado.dados;
  const provedor = conta.provedor in PROVEDORES ? PROVEDORES[conta.provedor as ProvedorConectavel] : null;
  const updatedAt = conta.updatedAt.toISOString();
  const podeEditar = pode(sessao.papel, "integracoes", "editar");
  const ilegivel = "erro" in conta.credencial && Object.keys(conta.credencial).length === 1;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-4 md:p-6">
      <CabecalhoPagina
        titulo={conta.rotulo}
        descricao={`${provedor?.rotulo ?? conta.provedor} · ${conta.lojaNome ?? "Rede"}`}
        breadcrumb={[
          { rotulo: "Configurações", rota: "/configuracoes" },
          { rotulo: "Integrações", rota: "/configuracoes/integracoes" },
          { rotulo: conta.rotulo },
        ]}
        acoes={
          <AcoesDaConta
            id={conta.id}
            rotulo={conta.rotulo}
            lojaNome={conta.lojaNome ?? "Rede"}
            provedor={conta.provedor}
            updatedAt={updatedAt}
            podeDesconectar={pode(sessao.papel, "integracoes", "desconectar")}
            podeParear={pode(sessao.papel, "integracoes", "conectar")}
          />
        }
      />

      {ilegivel ? (
        <FaixaAviso tom="perigo" titulo="Não foi possível ler esta credencial." descricao="Substitua a credencial abaixo." />
      ) : null}
      {conta.ultimoErro ? <FaixaAviso tom="aviso" titulo="Último erro" descricao={conta.ultimoErro} /> : null}

      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-legenda text-muted-foreground">Status</dt>
          <dd>
            <SeloStatus dominio="status_integracao" valor={conta.status} />
          </dd>
        </div>
        <div>
          <dt className="text-legenda text-muted-foreground">Credencial</dt>
          <dd className="font-mono text-denso">{textoDaCredencial(conta.credencial)}</dd>
        </div>
        <div>
          <dt className="text-legenda text-muted-foreground">{provedor?.referencia?.rotulo ?? "Identificador"}</dt>
          <dd className="font-mono text-denso">{conta.referencia ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-legenda text-muted-foreground">Validade do token</dt>
          <dd>{conta.expiraEm ? <Tempo valor={conta.expiraEm} formato="dataHora" /> : "—"}</dd>
        </div>
        <div>
          <dt className="text-legenda text-muted-foreground">Última sincronização</dt>
          <dd>{conta.ultimaSincronizacao ? <Tempo valor={conta.ultimaSincronizacao} formato="dataHora" /> : "—"}</dd>
        </div>
        {urlDoWebhook ? (
          <div>
            <dt className="text-legenda text-muted-foreground">Webhook (cabeçalho x-uazapi-secret)</dt>
            <dd className="flex items-center gap-2 break-all font-mono text-denso">
              {urlDoWebhook}
              <Copiar valor={urlDoWebhook} rotulo="Copiar endereço" />
            </dd>
          </div>
        ) : null}
      </dl>

      {podeEditar ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-titulo-secao font-medium">Nome e loja</h2>
          <EditarConta
            id={conta.id}
            rotulo={conta.rotulo}
            lojaId={conta.lojaId}
            ehDaRede={conta.lojaId === null}
            lojas={lojas.map((l) => ({ id: l.id, nome: l.nome }))}
            updatedAt={updatedAt}
          />
        </section>
      ) : null}

      {podeEditar && ehProvedorDeCanal(conta.provedor) ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-titulo-secao font-medium">Reautenticar</h2>
          <p className="text-denso text-muted-foreground">
            Cole a credencial nova. A antiga é substituída; o histórico da conta continua.
          </p>
          <ReautenticarConta id={conta.id} provedor={conta.provedor} updatedAt={updatedAt} />
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-titulo-secao font-medium">Últimos eventos recebidos</h2>
        {eventos.length === 0 ? (
          <EstadoVazio titulo="Nenhum evento recebido por esta conta ainda." />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {eventos.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 p-3 sm:flex-row sm:items-center sm:gap-4">
                <Tempo valor={e.recebidoEm} formato="dataHora" className="text-denso tabular-nums" />
                <span className="text-denso font-medium">{TIPO_DO_EVENTO[e.tipo] ?? e.tipo}</span>
                {e.erro ? <span className="text-denso text-muted-foreground">{e.erro}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
