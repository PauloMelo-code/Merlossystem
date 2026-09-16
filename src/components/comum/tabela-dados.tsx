"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Tabela de dados do sistema (04-ui.md §6.1 e §8): no máximo 7 colunas,
 * cabeçalho sticky com `aria-sort`, ações de linha SEMPRE visíveis (nunca só
 * no hover — §11.3) e, abaixo de 768 px, a mesma lista vira cartão.
 *
 * A linha abre pelo link do identificador, nunca por `onClick` no `<tr>`: é o
 * que faz "abrir em nova aba" e o teclado funcionarem (§11.3).
 */

export type Coluna<T> = {
  /** Casa com `ordenacao.coluna` e é a chave de React da célula. */
  chave: string;
  rotulo: string;
  /** Número e moeda à direita, com `tabular-nums` (§8). */
  numerica?: boolean;
  ordenavel?: boolean;
  render: (item: T) => ReactNode;
};

export type Ordenacao = { coluna: string; direcao: "asc" | "desc" };

export type Selecao = {
  selecionados: ReadonlySet<string>;
  onAlternar: (chave: string) => void;
  onAlternarTodos: () => void;
};

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

export function TabelaDados<T>({
  colunas,
  itens,
  chave,
  ordenacao,
  onOrdenar,
  selecao,
  acoesEmMassa,
  vazio,
  cartaoMobile,
}: {
  colunas: readonly Coluna<T>[];
  itens: readonly T[];
  chave: (item: T) => string;
  ordenacao?: Ordenacao;
  onOrdenar?: (coluna: string) => void;
  selecao?: Selecao;
  acoesEmMassa?: ReactNode;
  vazio: ReactNode;
  cartaoMobile: (item: T) => ReactNode;
}) {
  if (itens.length === 0) return <>{vazio}</>;

  const todosMarcados =
    selecao !== undefined && itens.length > 0 && selecao.selecionados.size === itens.length;

  return (
    <div className="flex flex-col gap-3">
      {selecao && selecao.selecionados.size > 0 && acoesEmMassa ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-accent px-3 py-2">
          <span className="text-denso text-accent-foreground">
            {selecao.selecionados.size} selecionados
          </span>
          {acoesEmMassa}
        </div>
      ) : null}

      {/* Abaixo de 768 px a tabela vira lista de cartões (§4.4). */}
      <ul className="flex flex-col gap-2 md:hidden">
        {itens.map((item) => (
          <li key={chave(item)} className="rounded-lg border border-border bg-card p-3">
            {cartaoMobile(item)}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              {selecao ? (
                <TableHead className="w-10">
                  <Checkbox
                    checked={todosMarcados}
                    onCheckedChange={selecao.onAlternarTodos}
                    aria-label="Selecionar todos"
                  />
                </TableHead>
              ) : null}
              {colunas.map((coluna) => {
                const ativa = ordenacao?.coluna === coluna.chave;
                const Seta = !ativa ? ChevronsUpDown : ordenacao.direcao === "asc" ? ArrowUp : ArrowDown;
                return (
                  <TableHead
                    key={coluna.chave}
                    className={coluna.numerica ? "text-right tabular-nums" : ""}
                    aria-sort={ativa ? ARIA_SORT[ordenacao.direcao] : "none"}
                  >
                    {coluna.ordenavel && onOrdenar ? (
                      <button
                        type="button"
                        onClick={() => onOrdenar(coluna.chave)}
                        className="inline-flex items-center gap-1.5 font-medium"
                      >
                        {coluna.rotulo}
                        <Seta aria-hidden="true" strokeWidth={2} className="size-3.5" />
                      </button>
                    ) : (
                      coluna.rotulo
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {itens.map((item) => {
              const id = chave(item);
              return (
                <TableRow key={id}>
                  {selecao ? (
                    <TableCell>
                      <Checkbox
                        checked={selecao.selecionados.has(id)}
                        onCheckedChange={() => selecao.onAlternar(id)}
                        aria-label="Selecionar linha"
                      />
                    </TableCell>
                  ) : null}
                  {colunas.map((coluna) => (
                    <TableCell
                      key={coluna.chave}
                      className={coluna.numerica ? "text-right tabular-nums" : ""}
                    >
                      {coluna.render(item)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
