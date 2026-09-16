"use client";

import { Badge } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { SeloStatus } from "@/components/comum/selo-status";
import { TabelaDados, type Coluna } from "@/components/comum/tabela-dados";
import { Tempo } from "@/components/comum/tempo";
import type { AcaoAdministrativa } from "@/lib/usuarios/regras";
import { AcoesUsuario, type UsuarioNaTela } from "./acoes-usuario";
import type { LojaNaTela } from "./campos-comuns";

export type LinhaDeUsuario = UsuarioNaTela & {
  email: string;
  lojaNome: string | null;
  ativo: boolean;
  emProvisionamento: boolean;
  bloqueadoAte: string | null;
  ultimoLoginEm: string | null;
  trocaDeEmailAberta: boolean;
  disponiveis: AcaoAdministrativa[];
  voce: boolean;
};

/**
 * Estado da conta em TEXTO (04-ui.md §11.5). Não é enum de `tons.ts`, então
 * não ganha cor própria: a regra é que só `SeloStatus` pinta selo.
 */
function Situacao({ linha }: { linha: LinhaDeUsuario }) {
  const selos: string[] = [];
  if (linha.emProvisionamento) selos.push("Primeiro acesso pendente");
  else selos.push(linha.ativo ? "Ativa" : "Desativada");
  if (linha.bloqueadoAte) selos.push("Bloqueada");
  if (linha.trocaDeEmailAberta) selos.push("Troca de e-mail aberta");
  return (
    <span className="flex flex-wrap gap-1">
      {selos.map((selo) => (
        <Badge key={selo} variant="outline">
          {selo}
        </Badge>
      ))}
    </span>
  );
}

function Acoes({ linha, lojas }: { linha: LinhaDeUsuario; lojas: readonly LojaNaTela[] }) {
  if (linha.voce) {
    return <span className="text-legenda text-muted-foreground">Você · use Meu perfil</span>;
  }
  return <AcoesUsuario usuario={linha} disponiveis={linha.disponiveis} lojas={lojas} />;
}

/**
 * Acessos da equipe (04-ui.md §5.6). A coluna de ações só traz o que o
 * servidor aceitaria para ESTA pessoa (`acoesDisponiveis`): admin não vê
 * ação sobre outro admin nem sobre o dono, e a própria linha manda para
 * "Meu perfil" (INV-32).
 */
export function ListaUsuarios({
  usuarios,
  lojas,
}: {
  usuarios: readonly LinhaDeUsuario[];
  lojas: readonly LojaNaTela[];
}) {
  const colunas: Coluna<LinhaDeUsuario>[] = [
    {
      chave: "nome",
      rotulo: "Pessoa",
      render: (u) => (
        <span className="flex flex-col">
          <span className="font-medium">{u.nome}</span>
          <span className="text-legenda text-muted-foreground">{u.email}</span>
        </span>
      ),
    },
    { chave: "papel", rotulo: "Papel", render: (u) => <SeloStatus dominio="papel" valor={u.papel} /> },
    { chave: "loja", rotulo: "Loja", render: (u) => u.lojaNome ?? "Todas" },
    { chave: "situacao", rotulo: "Situação", render: (u) => <Situacao linha={u} /> },
    {
      chave: "acesso",
      rotulo: "Último acesso",
      render: (u) => (u.ultimoLoginEm ? <Tempo valor={u.ultimoLoginEm} /> : "Nunca entrou"),
    },
    { chave: "acoes", rotulo: "Ações", render: (u) => <Acoes linha={u} lojas={lojas} /> },
  ];

  return (
    <TabelaDados
      colunas={colunas}
      itens={usuarios}
      chave={(u) => u.id}
      vazio={
        <EstadoVazio
          titulo="Ninguém cadastrado ainda."
          descricao="Convide a primeira pessoa da equipe pelo formulário acima."
        />
      }
      cartaoMobile={(u) => (
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-medium">{u.nome}</span>
            <span className="truncate text-legenda text-muted-foreground">{u.email}</span>
            <span className="flex flex-wrap items-center gap-1">
              <SeloStatus dominio="papel" valor={u.papel} />
              <span className="text-legenda">{u.lojaNome ?? "Todas as lojas"}</span>
            </span>
            <Situacao linha={u} />
          </div>
          <Acoes linha={u} lojas={lojas} />
        </div>
      )}
    />
  );
}
