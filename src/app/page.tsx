import { redirect } from "next/navigation";

/**
 * `/` não tem tela própria: a entrada do sistema é o inbox (04-ui.md §4).
 * Sem sessão, o layout de `(app)` manda para `/entrar`.
 */
export default function Inicio(): never {
  redirect("/conversas");
}
