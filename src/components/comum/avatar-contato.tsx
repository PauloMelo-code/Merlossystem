import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { IconeCanal, rotuloDoCanal } from "./icone-canal";

/**
 * Avatar redondo + selo de canal (04-ui.md §6.1). "Pessoa é redonda, coisa é
 * quadrada" (§2.7): este é o componente de pessoa.
 *
 * O selo tem rótulo textual ao lado — canal nunca é informado só por cor (§11).
 */

const TAMANHOS = { pequeno: "size-8", medio: "size-10", grande: "size-12" } as const;

/** "Maria Aparecida Silva" -> "MA". Duas letras bastam e nunca estouram. */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? "") : "";
  return (primeira + ultima).toUpperCase();
}

export function AvatarContato({
  nome,
  url,
  canal,
  tamanho = "medio",
}: {
  nome: string;
  url?: string | null;
  canal?: string | null;
  tamanho?: keyof typeof TAMANHOS;
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <Avatar className={TAMANHOS[tamanho]}>
        {url ? <AvatarImage src={url} alt="" /> : null}
        <AvatarFallback className="bg-secondary text-secondary-foreground text-legenda font-medium">
          {iniciais(nome)}
        </AvatarFallback>
      </Avatar>
      {canal ? (
        <span className="absolute -right-0.5 -bottom-0.5 inline-flex">
          <IconeCanal canal={canal} tamanho="pequeno" comSelo />
          <span className="sr-only">{rotuloDoCanal(canal)}</span>
        </span>
      ) : null}
    </span>
  );
}
