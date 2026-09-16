import type { Metadata } from "next";
import { eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { vivosE } from "@/lib/db/consultas";
import { usuarios } from "@/lib/db/schema/auth/usuarios";
import { usuarios_trocas_email } from "@/lib/db/schema/auth/trocas-email";
import { lojas } from "@/lib/db/schema/lojas";
import { exigirSessao } from "@/lib/auth/guard";
import { rotuloDePapel } from "@/lib/ui/tons";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { EstadoErro } from "@/components/comum/estado-erro";
import { ConfirmarNovoEmail } from "./_components/confirmar-novo-email";
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

  // Troca de e-mail aberta pelo admin: só a PRÓPRIA pessoa confirma (§11.2).
  const [troca] = await db
    .select({ emailNovo: usuarios_trocas_email.email_novo, expiraEm: usuarios_trocas_email.expira_em })
    .from(usuarios_trocas_email)
    .where(
      vivosE(
        usuarios_trocas_email,
        eq(usuarios_trocas_email.usuario_id, sessao.usuarioId),
        isNull(usuarios_trocas_email.confirmado_em),
        isNull(usuarios_trocas_email.cancelado_em),
        gt(usuarios_trocas_email.expira_em, new Date()),
      ),
    )
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

      {troca ? (
        <ConfirmarNovoEmail emailNovo={troca.emailNovo} expiraEm={troca.expiraEm.toISOString()} />
      ) : null}

      <PreferenciasDoDispositivo />
    </div>
  );
}
