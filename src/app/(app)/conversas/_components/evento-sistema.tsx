import { Tempo } from "@/components/comum/tempo";

/**
 * Evento de sistema centralizado na linha do tempo (04-ui.md §5.2):
 * "Ana transferiu para Bia · 14:32". Sai da trilha de negócio.
 */
export function EventoSistema({ texto, quando }: { texto: string; quando: string }) {
  return (
    <li className="my-2 flex justify-center">
      <span className="rounded-full bg-muted px-3 py-1 text-legenda text-muted-foreground">
        {texto} · <Tempo valor={quando} formato="hora" />
      </span>
    </li>
  );
}
