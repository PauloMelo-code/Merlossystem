import Link from "next/link";
import { NovaVenda } from "@/app/(app)/pedidos/_components/nova-venda";
import { Dinheiro } from "@/components/comum/dinheiro";
import { SeloStatus } from "@/components/comum/selo-status";
import { Tempo } from "@/components/comum/tempo";
import { listarPedidosDoContato } from "@/lib/actions/pedidos";

/**
 * COSTURA — dono: M4, dentro da pasta de M1 (05-plano-construcao.md §5).
 *
 * Seção "Pedidos" do painel do contato (04-ui.md §5.2): os pedidos da
 * cliente com `masc_status` em destaque e o botão "Nova venda". Componente de
 * SERVIDOR: os dados vêm pela action, que reaplica o portão; quem renderiza é
 * a página da conversa (M1), dentro de um `Suspense` próprio.
 */

export type PainelVendaProps = {
  conversaId: string;
  lojaId: string;
  contatoId: string;
};

export async function PainelVenda({ conversaId, lojaId, contatoId }: PainelVendaProps) {
  const resultado = await listarPedidosDoContato({ contatoId, loja: lojaId });

  if (!resultado.ok) {
    return (
      <section aria-labelledby="painel-pedidos" className="flex flex-col gap-2">
        <h3 id="painel-pedidos" className="text-denso font-semibold">Pedidos</h3>
        <p role="alert" className="text-denso text-perigo">{resultado.mensagem}</p>
      </section>
    );
  }

  const { pedidos, lojaNome, podeCriar } = resultado.dados;

  return (
    <section aria-labelledby="painel-pedidos" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id="painel-pedidos" className="text-denso font-semibold">Pedidos</h3>
        {podeCriar ? (
          <NovaVenda lojaId={lojaId} lojaNome={lojaNome} contatoId={contatoId} conversaId={conversaId} />
        ) : null}
      </div>
      {pedidos.length === 0 ? (
        <p className="text-denso text-muted-foreground">Nenhum pedido deste contato.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pedidos.map((p) => (
            <li key={p.id} className="flex flex-col gap-1 rounded-md border border-border p-2">
              <div className="flex items-center justify-between gap-2">
                <Link href={`/pedidos/${p.id}`} className="font-mono text-denso underline-offset-4 hover:underline">
                  {p.numero}
                </Link>
                <Dinheiro valor={p.total} className="text-denso" />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <SeloStatus dominio="masc_status" valor={p.mascStatus} />
                <SeloStatus dominio="status_pedido" valor={p.status} />
                <Tempo valor={p.criadoEm} formato="data" className="text-legenda text-muted-foreground" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
