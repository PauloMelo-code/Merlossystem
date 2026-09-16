import type { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * Moldura única das seis telas de acesso (04-ui.md §5.1).
 *
 * O título é `h1` de verdade — cada uma dessas rotas é uma página inteira e
 * quem usa leitor de tela precisa de um começo. `CardTitle`/`CardDescription`
 * do shadcn renderizam `div` e não aceitam `asChild`; a regra da casa proíbe
 * editar o primitivo, então a semântica vem de fora (04-ui.md §3).
 */
export function CartaoAcesso({
  titulo,
  descricao,
  children,
  rodape,
}: {
  titulo: string;
  descricao?: string;
  children: ReactNode;
  rodape?: ReactNode;
}) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <h1 className="text-titulo-pagina font-semibold">{titulo}</h1>
        {descricao ? <p className="text-corpo text-muted-foreground">{descricao}</p> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {children}
        {rodape ? <div className="text-denso text-muted-foreground">{rodape}</div> : null}
      </CardContent>
    </Card>
  );
}
