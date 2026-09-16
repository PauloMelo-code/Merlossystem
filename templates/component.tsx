// TEMPLATE — copie para `src/app/(app)/<rota>/_components/<nome>.tsx`.
// So suba para `src/components/comum/` quando a SEGUNDA tela precisar.
//
// Nasce SERVIDOR. Vire "use client" apenas quando precisar de estado, efeito,
// ouvinte de evento do navegador ou API do navegador — e empurre a marca para
// a folha, nao para a pagina inteira.

import { Campo } from "@/components/comum/campo";
import { BotaoEnviar } from "@/components/comum/botao-enviar";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { SeloStatus } from "@/components/comum/selo-status";
import { Dinheiro } from "@/components/comum/dinheiro";

/**
 * Props com tipo explicito, no proprio arquivo. O que chega e PROJECAO, nunca
 * a linha crua do banco: `$inferSelect` serve como tipo, nao como contrato de
 * transporte.
 */
export type CartaoExemploProps = {
  id: string;
  nome: string;
  status: string;
  /** String "1234.56", igual ao banco. Centavos so existem em formato.ts. */
  valor: string;
  aoSalvar: (entrada: FormData) => Promise<void>;
};

export function CartaoExemplo({ nome, status, valor, aoSalvar }: CartaoExemploProps) {
  // Os QUATRO estados sao obrigatorios. Este exemplo mostra o vazio; o
  // carregando vive no `loading.tsx` da rota (esqueleto com a FORMA real), e o
  // erro no `error.tsx`.
  if (!nome) {
    return (
      <EstadoVazio
        titulo="Nada por aqui ainda"
        descricao="Cadastre o primeiro registro para ver a lista."
      />
    );
  }

  return (
    <article className="rounded-lg border border-borda bg-superficie p-4">
      <header className="flex items-center justify-between gap-2">
        {/* Tamanho de texto SO pelos sete tokens. `text-sm` reprova na trava. */}
        <h2 className="text-titulo-secao font-medium">{nome}</h2>

        {/* Enum vira rotulo e tom em UM lugar so: src/lib/ui/tons.ts. */}
        <SeloStatus dominio="exemplo" valor={status} />
      </header>

      <p className="mt-2 text-corpo text-texto-fraco">
        Valor: <Dinheiro valor={valor} />
      </p>

      <form action={aoSalvar} className="mt-4 flex flex-col gap-4">
        {/* `Campo` associa label, aria-describedby e aria-invalid. Rotulo
            solto foi o defeito mais repetido do sistema antigo. */}
        <Campo nome="nome" rotulo="Nome" ajuda="Como a equipe vai encontrar este registro.">
          <input
            id="nome"
            name="nome"
            defaultValue={nome}
            className="h-9 rounded-md border border-borda bg-fundo px-3 text-corpo"
          />
        </Campo>

        {/* `BotaoEnviar` usa useFormStatus: largura fixa, "Salvando...", e
            impede o duplo envio. */}
        <BotaoEnviar>Salvar</BotaoEnviar>
      </form>
    </article>
  );
}
