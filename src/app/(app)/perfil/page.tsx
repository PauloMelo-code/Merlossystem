import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { vivosE } from "@/lib/db/consultas";
import { usuarios } from "@/lib/db/schema/auth/usuarios";
import { lojas } from "@/lib/db/schema/lojas";
import { exigirSessao } from "@/lib/auth/guard";
import { rotuloDePapel } from "@/lib/ui/tons";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { EstadoErro } from "@/components/comum/estado-erro";
import { FormularioPerfil } from "./_components/formulario-perfil";
import { PreferenciasDoDispositivo } from "./_components/preferencias-do-dispositivo";

export const metadata: Metadata = { title: "Meu perfil" };

/**
 * `/perfil` — nome, papel, loja e preferências do aparelho (04-ui.md §5.1).
 *
 * SEM chave na matriz: qualquer sessão ativa alcança a própria conta (REQ-G1).
 * O portão roda aqui de novo porque o layout de `(app)` não cobre Server Action
 * nenhuma (N1/N5).
 *
 * Papel e loja aparecem como LEITURA: quem muda papel é a administração, com
 * cerimônia (§11.2). Botão que não faz nada aqui seria fachada (U8).
 */
export default async function PaginaPerfil() {
  const sessao = await exigirSessao();

  const [linha] = await db
    .select({
      nome: usuarios.nome,
      email: usuarios.email,
      atualizadoEm: usuarios.updated_at,
      lojaNome: lojas.nome,
    })
    .from(usuarios)
    .leftJoin(lojas, eq(lojas.id, usuarios.loja_id))
    // `usuarios` nunca é soft-deletado (INV-33), mas o filtro entra: o dia em
    // que alguém marcar uma linha, esta tela não mostra dado de conta morta.
    .where(vivosE(usuarios, eq(usuarios.id, sessao.usuarioId)))
    .limit(1);

  if (!linha) {
    return (
      <EstadoErro
        titulo="Não foi possível abrir o seu perfil."
        descricao="Entre de novo e tente outra vez."
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 md:p-6">
      <CabecalhoPagina
        titulo="Meu perfil"
        descricao="Seus dados e as preferências deste aparelho."
      />

      <FormularioPerfil
        nome={linha.nome}
        email={linha.email}
        atualizadoEm={linha.atualizadoEm.toISOString()}
        papelRotulo={rotuloDePapel(sessao.papel)}
        lojaNome={linha.lojaNome ?? "Todas as lojas"}
      />

      <PreferenciasDoDispositivo />
    </div>
  );
}
