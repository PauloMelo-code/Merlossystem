import { Badge } from "@/components/ui/badge";
import { tomDe, type Dominio, type Tom } from "@/lib/ui/tons";

/**
 * O ÚNICO lugar que traduz enum -> rótulo PT-BR + tom (04-ui.md §2.4). Nenhuma
 * tela escreve `className` de cor num selo: passa `dominio` e `valor`.
 *
 * Valor fora da lista não renderiza nada — melhor um espaço vazio do que o
 * valor cru em inglês na tela da vendedora.
 */

/** Tom -> trio de classes de token. Consumido também por `faixa-aviso.tsx`. */
export const CLASSES_DE_TOM: Readonly<Record<Tom, { fundo: string; texto: string; borda: string }>> = {
  sucesso: { fundo: "bg-sucesso-fundo", texto: "text-sucesso", borda: "border-sucesso-borda" },
  aviso: { fundo: "bg-aviso-fundo", texto: "text-aviso", borda: "border-aviso-borda" },
  perigo: { fundo: "bg-perigo-fundo", texto: "text-perigo", borda: "border-perigo-borda" },
  info: { fundo: "bg-info-fundo", texto: "text-info", borda: "border-info-borda" },
  neutro: { fundo: "bg-neutro-fundo", texto: "text-neutro", borda: "border-neutro-borda" },
  // O tom `marca` usa `--accent` como fundo: é o mesmo valor de §2.3 nos dois
  // temas, e evita um segundo par de tokens que diria a mesma coisa.
  marca: { fundo: "bg-accent", texto: "text-marca-texto", borda: "border-border" },
};

export function SeloStatus({
  dominio,
  valor,
  className,
}: {
  dominio: Dominio;
  valor: string;
  className?: string;
}) {
  const entrada = tomDe(dominio, valor);
  if (!entrada) return null;

  const cores = CLASSES_DE_TOM[entrada.tom];
  return (
    <Badge
      variant="outline"
      className={`${cores.fundo} ${cores.texto} ${cores.borda} ${className ?? ""}`}
    >
      {entrada.rotulo}
    </Badge>
  );
}
