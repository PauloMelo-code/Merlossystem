import type { Metadata } from "next";
import { exigirPermissao, exigirSessao, pode } from "@/lib/auth/guard";
import { exigirPapelConvidavel } from "@/lib/auth/permissoes/alvo";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { EstadoErro } from "@/components/comum/estado-erro";
import {
  listarConvitesAbertos,
  listarLojasVivas,
  listarUsuarios,
} from "@/lib/usuarios/_consultas";
import { acoesDisponiveis, papeisConvidaveisPor } from "@/lib/usuarios/regras";
import { FormularioConvite } from "./_components/formulario-convite";
import { ListaConvites } from "./_components/lista-convites";
import { ListaUsuarios } from "./_components/lista-usuarios";

export const metadata: Metadata = { title: "Usuários" };

/**
 * `/configuracoes/usuarios` — acessos, papel e loja (04-ui.md §5.6;
 * 02-seguranca.md §11.2).
 *
 * O portão roda AQUI (o layout não cobre action nenhuma — N1/N5). Sem
 * `usuarios:ler_detalhe` a página não renderiza nada por baixo (§10) e a
 * recusa entra na trilha.
 *
 * O que cada linha oferece sai de `acoesDisponiveis` (puro, sem trilha): a tela
 * esconde o que o servidor recusaria, e o servidor decide de novo em cada
 * action, com `FOR UPDATE`.
 */
export default async function PaginaUsuarios() {
  const sessao = await exigirSessao();
  try {
    exigirPermissao(sessao, "usuarios:ler_detalhe");
  } catch {
    return (
      <div className="p-4 md:p-6">
        <EstadoErro
          titulo="Você não tem acesso a esta área."
          descricao="Fale com o administrador."
        />
      </div>
    );
  }

  const [usuarios, convites, lojas] = await Promise.all([
    listarUsuarios(),
    listarConvitesAbertos(),
    listarLojasVivas(),
  ]);

  const podeConvidar = pode(sessao.papel, "usuarios", "convidar");
  const papeis = papeisConvidaveisPor(sessao.papel);

  const linhas = usuarios.map((u) => ({
    id: u.id,
    nome: u.nome,
    email: u.email,
    papel: u.papel,
    lojaId: u.lojaId,
    lojaNome: u.lojaNome,
    ativo: u.ativo,
    emProvisionamento: u.emProvisionamento,
    bloqueadoAte: u.bloqueadoAte?.toISOString() ?? null,
    ultimoLoginEm: u.ultimoLoginEm?.toISOString() ?? null,
    trocaDeEmailAberta: u.trocaDeEmailAberta,
    updatedAt: u.updatedAt.toISOString(),
    voce: u.id === sessao.usuarioId,
    disponiveis: acoesDisponiveis(sessao, {
      id: u.id,
      papel: u.papel,
      ativo: u.ativo,
      emProvisionamento: u.emProvisionamento,
      bloqueado: u.bloqueadoAte !== null,
    }),
  }));

  const abertos = convites.map((c) => {
    let podeReenviar = podeConvidar;
    try {
      exigirPapelConvidavel(sessao, c.papel);
    } catch {
      podeReenviar = false;
    }
    return {
      ...c,
      expiraEm: c.expiraEm.toISOString(),
      podeReenviar,
    };
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-4 md:p-6">
      <CabecalhoPagina
        titulo="Usuários"
        descricao="Quem acessa o sistema, com qual papel e em qual loja. Toda mudança pede motivo e fica na trilha."
        breadcrumb={[{ rotulo: "Configurações", rota: "/configuracoes" }, { rotulo: "Usuários" }]}
      />

      {podeConvidar && papeis.length > 0 ? (
        <FormularioConvite papeis={papeis} lojas={lojas} />
      ) : null}

      <ListaConvites convites={abertos} />

      <section className="flex flex-col gap-3">
        <h2 className="text-titulo-secao font-medium">Equipe</h2>
        <ListaUsuarios usuarios={linhas} lojas={lojas} />
      </section>
    </div>
  );
}
