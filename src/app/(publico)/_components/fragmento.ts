"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Token de uso único lido do FRAGMENTO da URL (04-ui.md U12,
 * 02-seguranca.md §9.2 item 3).
 *
 * O link do e-mail é `.../primeiro-acesso#t=<token>`. O que está depois do `#`
 * NÃO sai do navegador: não vai no `Referer`, não entra no log do Traefik e o
 * scanner de e-mail corporativo, que abre o link com um GET, não consome nada.
 * A página não lê o token no servidor — ela nem o recebe.
 *
 * `history.replaceState` apaga o fragmento na primeira pintura, para o token
 * não ficar na barra de endereço nem no histórico do aparelho. Daí em diante
 * ele vive só na memória desta aba e vai no CORPO do POST.
 */
export function useTokenDoFragmento(): { token: string | null; lido: boolean } {
  const [estado, setEstado] = useState<{ token: string | null; lido: boolean }>({
    token: null,
    lido: false,
  });

  const jaLeu = useRef(false);

  useEffect(() => {
    /*
     * A LEITURA É DESTRUTIVA e por isso acontece UMA vez só.
     *
     * O `StrictMode` do desenvolvimento executa o efeito duas vezes: na
     * primeira o fragmento é lido e apagado; na segunda ele já não existe, e
     * sem esta guarda o token recém-lido seria substituído por `null` — a tela
     * diria "este convite não vale mais" com o convite na mão. Foi exatamente
     * o que aconteceu na prova manual de F8.
     */
    if (jaLeu.current) return;
    jaLeu.current = true;

    const bruto = window.location.hash.replace(/^#/, "");
    const valor = new URLSearchParams(bruto).get("t");
    if (valor) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
    /*
     * `location.hash` só existe depois da montagem — o servidor nunca o recebe
     * — e tem de ser lido e APAGADO na mesma passada. Não há fonte externa para
     * assinar com `useSyncExternalStore`, e ler no inicializador do estado
     * quebraria a hidratação (o HTML do servidor não tem o token). É UMA
     * gravação só, justamente para não encadear render.
     */
    setEstado({ token: valor, lido: true });
  }, []);

  return estado;
}
