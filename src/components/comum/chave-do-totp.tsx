"use client";

import { useEffect, useRef } from "react";
import { Copiar } from "@/components/comum/copiar";

/**
 * A chave do aplicativo autenticador, nas DUAS formas (04-ui.md §5.1).
 *
 * O QR vem PRONTO do servidor (`src/lib/qr.ts`): a `otpauth://` carrega o
 * segredo, e quem desenha a imagem é o mesmo processo que já o conhece. Aqui
 * não há geração nenhuma — só a exibição.
 *
 * A CHAVE EM TEXTO não é plano B de layout: é a única forma que funciona quando
 * o autenticador está no MESMO aparelho que a tela (não dá para fotografar a
 * própria tela), quando a câmera está quebrada e quando a pessoa usa leitor de
 * tela. Por isso as duas aparecem juntas, sempre, e nenhuma esconde a outra.
 *
 * Estados: com QR e com chave (o normal), só chave (QR não veio) e sem nada
 * (`uri` malformada) — este último precisa DIZER o que aconteceu, porque uma
 * caixa vazia faria a pessoa esperar por algo que não vai chegar.
 */
export function ChaveDoTotp({ uri, qr }: { uri: string; qr?: string }) {
  const titulo = useRef<HTMLParagraphElement>(null);

  // O passo troca de conteúdo sem trocar de página: sem mover o foco, quem usa
  // leitor de tela continua ouvindo o formulário anterior e nunca fica sabendo
  // que a chave apareceu.
  useEffect(() => {
    titulo.current?.focus();
  }, []);

  let chave = "";
  try {
    chave = new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    chave = "";
  }

  if (!chave) {
    return (
      <div className="rounded-lg border border-border bg-muted p-4">
        <p role="alert" className="text-corpo text-perigo">
          Não foi possível montar a chave. Recarregue a página e gere uma nova.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted p-4">
      <p
        ref={titulo}
        tabIndex={-1}
        className="text-denso font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Cadastre esta chave no aplicativo
      </p>

      {qr ? (
        <>
          {/* Sem fundo de tema: o próprio SVG pinta a moldura branca (zona de
              silêncio), então o QR fica preto sobre branco em qualquer tema. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- `data:` URL gerado no servidor: não há o que o otimizador do next/image fazer, e passar por ele exigiria liberar o segredo para o cache de imagens. */}
          <img
            src={qr}
            alt="Código QR com a chave deste acesso. Se você não puder usar a câmera, a mesma chave está escrita logo abaixo."
            width={200}
            height={200}
            className="self-start rounded-md"
          />
          <p className="text-legenda text-muted-foreground">
            No aplicativo, escolha ler o código com a câmera. Sem câmera, use a chave
            abaixo.
          </p>
        </>
      ) : null}

      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-denso">{chave}</code>
        <Copiar valor={chave} rotulo="a chave" />
      </div>

      <p className="text-legenda text-muted-foreground">
        {qr ? "" : "No aplicativo, escolha inserir a chave manualmente. "}
        Ela aparece uma vez só: depois de confirmar, não é mostrada de novo.
      </p>
    </div>
  );
}
