import Link from "next/link";
import { X } from "lucide-react";
import { Tempo } from "@/components/comum/tempo";
import { Button } from "@/components/ui/button";

type Valor = string | number | boolean | null | undefined;

export type LinhaDetalhe = { rotulo: string; valor: string | null };
export type LinhaDiff = { campo: string; antes: Valor; depois: Valor };

/** `undefined` = o campo não estava nesse lado do diff. */
function mostrar(valor: Valor): string {
  if (valor === undefined) return "—";
  if (valor === null) return "vazio";
  if (typeof valor === "boolean") return valor ? "sim" : "não";
  return String(valor);
}

/**
 * Detalhe de um evento, aberto por `?evento=` na própria URL (servidor, sem
 * estado de cliente). Campo PII chega como "(alterado)" — a trilha não guarda
 * o valor — e segredo nem chega.
 */
export function DetalheEvento({
  titulo,
  quando,
  linhas,
  diff,
  hrefFechar,
}: {
  titulo: string;
  quando: string;
  linhas: readonly LinhaDetalhe[];
  diff?: readonly LinhaDiff[];
  hrefFechar: string;
}) {
  return (
    <section
      aria-labelledby="detalhe-evento-titulo"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="detalhe-evento-titulo" className="text-titulo-secao font-medium">
            {titulo}
          </h2>
          <p className="text-legenda text-muted-foreground">
            <Tempo valor={quando} />
          </p>
        </div>
        <Button asChild variant="ghost" size="icon-sm">
          <Link href={hrefFechar} scroll={false} aria-label="Fechar detalhe">
            <X aria-hidden="true" strokeWidth={2} />
          </Link>
        </Button>
      </div>

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
        {linhas.map((l) => (
          <div key={l.rotulo} className="contents">
            <dt className="text-denso text-muted-foreground">{l.rotulo}</dt>
            <dd className="text-corpo break-all">{l.valor ?? "—"}</dd>
          </div>
        ))}
      </dl>

      {diff ? (
        diff.length === 0 ? (
          <p className="text-denso text-muted-foreground">Nenhum campo registrado para este evento.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-denso">
              <caption className="sr-only">Campos alterados</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="py-2 pr-4 font-medium">Campo</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Antes</th>
                  <th scope="col" className="py-2 font-medium">Depois</th>
                </tr>
              </thead>
              <tbody>
                {diff.map((d) => (
                  <tr key={d.campo} className="border-b border-border">
                    <th scope="row" className="py-2 pr-4 text-left font-mono font-normal">{d.campo}</th>
                    <td className="py-2 pr-4 break-all">{mostrar(d.antes)}</td>
                    <td className="py-2 break-all">{mostrar(d.depois)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </section>
  );
}
