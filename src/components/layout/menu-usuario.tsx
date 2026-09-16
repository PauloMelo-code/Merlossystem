"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { CircleUser, Keyboard, LogOut, Monitor, Moon, ShieldCheck, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AvatarContato } from "@/components/comum/avatar-contato";

/**
 * Menu do usuário (04-ui.md §4.3): perfil, perfil > segurança, tema, atalhos e
 * sair. É um dos DOIS lugares onde o tema é alternado (o outro é `/perfil`) —
 * e ambos falam com o mesmo provedor único (§2.10).
 *
 * "Sair" é um `<form>` para uma Server Action, nunca um `<a href>`: encerrar
 * sessão é efeito, e efeito não sai por GET (um pré-carregador de link
 * derrubaria a sessão de quem só passou o mouse).
 */

export type UsuarioDoMenu = {
  nome: string;
  papelRotulo: string;
  avatarUrl?: string | null;
};

const TEMAS = [
  { valor: "light", rotulo: "Claro", Icone: Sun },
  { valor: "dark", rotulo: "Escuro", Icone: Moon },
  { valor: "system", rotulo: "Sistema", Icone: Monitor },
] as const;

export function MenuUsuario({
  usuario,
  sair,
  onAbrirAtalhos,
}: {
  usuario: UsuarioDoMenu;
  sair: () => Promise<void>;
  onAbrirAtalhos?: () => void;
}) {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="gap-2" aria-label="Sua conta">
          <AvatarContato nome={usuario.nome} url={usuario.avatarUrl ?? null} tamanho="pequeno" />
          <span className="hidden max-w-32 truncate lg:inline">{usuario.nome}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate">{usuario.nome}</span>
          <span className="block text-legenda font-normal text-texto-terciario">
            {usuario.papelRotulo}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/perfil">
            <CircleUser aria-hidden="true" strokeWidth={2} />
            Meu perfil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/perfil/seguranca">
            <ShieldCheck aria-hidden="true" strokeWidth={2} />
            Segurança
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-legenda font-normal text-texto-terciario">
          Tema
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
          {TEMAS.map(({ valor, rotulo, Icone }) => (
            <DropdownMenuRadioItem key={valor} value={valor}>
              <Icone aria-hidden="true" strokeWidth={2} />
              {rotulo}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        {onAbrirAtalhos ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onAbrirAtalhos}>
              <Keyboard aria-hidden="true" strokeWidth={2} />
              Ajuda e atalhos
            </DropdownMenuItem>
          </>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <form action={sair}>
            <button type="submit" className="flex w-full items-center gap-2">
              <LogOut aria-hidden="true" strokeWidth={2} className="size-4" />
              Sair
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
