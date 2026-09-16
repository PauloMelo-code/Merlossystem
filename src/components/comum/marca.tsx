import { NOME_COMPLETO } from "@/lib/marca";

/**
 * Wordmark tipográfico (04-ui.md §2.1): Inter 600, barra vertical entre as
 * duas palavras. Não há SVG do cliente ainda (pendência P-02) — quando
 * chegar, troca-se o conteúdo DESTE componente e nada mais muda.
 *
 * As palavras saem de `NOME_COMPLETO`: a grafia mora num módulo só (P-01).
 */
export function Marca({ className }: { className?: string }) {
  const [primeira = NOME_COMPLETO, ...resto] = NOME_COMPLETO.split(" ");
  const segunda = resto.join(" ");

  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold lowercase tracking-tight text-marca-texto ${className ?? ""}`}
    >
      <span>{primeira}</span>
      {segunda ? (
        <>
          <span aria-hidden="true" className="font-normal text-texto-terciario">
            |
          </span>
          <span className="text-foreground">{segunda}</span>
        </>
      ) : null}
    </span>
  );
}
