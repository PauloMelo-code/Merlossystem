"use client";

import { useState, type FormEvent } from "react";
import type { z, ZodType } from "zod";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Campo, idsDeApoio } from "@/components/comum/campo";
import { ModalConfirmacaoBlock } from "@/components/comum/modal-confirmacao-block";
import { ModalReautenticacao } from "@/components/comum/modal-reautenticacao";
import { reautenticar } from "@/lib/actions/seguranca";
import * as acoes from "@/lib/actions/usuarios";
import type { Papel } from "@/lib/db/schema/_enums/auth";
import type { Resultado } from "@/lib/erros";
import { rotuloDePapel } from "@/lib/ui/tons";
import type { AcaoAdministrativa } from "@/lib/usuarios/regras";
import {
  PAPEIS_EDITAVEIS,
  alvoComVersaoSchema,
  alvoSchema,
  cerimoniaAdminSchema,
  trocarEmailSchema,
  trocarPapelSchema,
} from "@/lib/validadores/usuarios";
import { CampoCienciaAdmin } from "./dialogo-ciencia-admin";
import { CampoLoja, CampoMotivo, CampoPapel, PAPEIS_COM_LOJA, errosDe, type LojaNaTela } from "./campos-comuns";
import { useCerimonia } from "./usar-cerimonia";

export type UsuarioNaTela = {
  id: string;
  nome: string;
  papel: Papel;
  lojaId: string | null;
  updatedAt: string;
};

type Config = {
  menu: string;
  confirmar: string;
  /** Item de 04-ui.md §9.1: passa pelo bloqueio de 3 s. */
  bloqueio: boolean;
  destrutiva: boolean;
  resumo: (nome: string) => string;
};

/** Toda ação exige motivo e sessão fresca; oito delas passam pelo bloqueio. */
const CONFIG: Record<AcaoAdministrativa, Config> = {
  papel: { menu: "Trocar papel ou loja", confirmar: "Trocar papel", bloqueio: true, destrutiva: false,
    resumo: (n) => `${n} passa a ter o papel escolhido e precisa entrar de novo em todos os aparelhos.` },
  promover: { menu: "Promover a administrador", confirmar: "Promover", bloqueio: true, destrutiva: false,
    resumo: (n) => `${n} vira administrador: convida e desativa pessoas, mexe em lojas e integrações. As sessões dela serão encerradas.` },
  transferir: { menu: "Transferir a posse", confirmar: "Transferir posse", bloqueio: true, destrutiva: true,
    resumo: (n) => `${n} vira dono. Você passa a ser administrador e as sessões de vocês dois serão encerradas. O sistema mantém pelo menos um dono.` },
  desativar: { menu: "Desativar acesso", confirmar: "Desativar", bloqueio: true, destrutiva: true,
    resumo: (n) => `${n} perde o acesso agora: todas as sessões caem e convites abertos são cancelados.` },
  reativar: { menu: "Reativar acesso", confirmar: "Reativar", bloqueio: true, destrutiva: false,
    resumo: (n) => `${n} volta a entrar com a senha e o segundo fator que já tinha.` },
  destravar: { menu: "Destravar conta", confirmar: "Destravar", bloqueio: false, destrutiva: false,
    resumo: (n) => `${n} pode tentar entrar de novo agora.` },
  reset: { menu: "Iniciar redefinição de senha", confirmar: "Enviar redefinição", bloqueio: true, destrutiva: true,
    resumo: (n) => `${n} recebe por e-mail o link para criar uma senha nova. As sessões dela caem agora. Você não escolhe a senha.` },
  recuperar: { menu: "Recuperação assistida", confirmar: "Recuperar acesso", bloqueio: true, destrutiva: true,
    resumo: (n) => `Remove TODOS os fatores de ${n}, encerra as sessões e envia a redefinição de senha. No próximo acesso ela cadastra os fatores de novo.` },
  sessoes: { menu: "Encerrar todas as sessões", confirmar: "Encerrar sessões", bloqueio: true, destrutiva: true,
    resumo: (n) => `Todas as sessões de ${n} serão encerradas. Ela precisa entrar de novo em todos os aparelhos.` },
  email: { menu: "Trocar e-mail", confirmar: "Enviar código", bloqueio: false, destrutiva: false,
    resumo: (n) => `${n} recebe um código no e-mail novo e confirma no próprio perfil.` },
};

const SUCESSO: Partial<Record<AcaoAdministrativa, string>> = {
  reset: "Redefinição enviada.",
  recuperar: "Acesso em recuperação. A pessoa recebe o link por e-mail.",
  sessoes: "Sessões encerradas.",
  email: "Código enviado ao e-mail novo.",
  destravar: "Conta destravada.",
};

export function AcoesUsuario({
  usuario,
  disponiveis,
  lojas,
}: {
  usuario: UsuarioNaTela;
  disponiveis: readonly AcaoAdministrativa[];
  lojas: readonly LojaNaTela[];
}) {
  const router = useRouter();
  const [acao, setAcao] = useState<AcaoAdministrativa | null>(null);
  const [motivo, setMotivo] = useState("");
  const [papel, setPapel] = useState<Papel>(usuario.papel);
  const [loja, setLoja] = useState(usuario.lojaId ?? "");
  const [ciencia, setCiencia] = useState("");
  const [emailNovo, setEmailNovo] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});

  const cerimonia = useCerimonia<unknown>(() => {
    const mensagem = acao ? SUCESSO[acao] : undefined;
    if (mensagem) toast.success(mensagem);
    fechar();
    router.refresh();
  });

  if (disponiveis.length === 0) return null;

  function abrir(escolhida: AcaoAdministrativa) {
    setMotivo("");
    setCiencia("");
    setEmailNovo("");
    setPapel(usuario.papel);
    setLoja(usuario.lojaId ?? "");
    setErros({});
    setAcao(escolhida);
  }

  function fechar() {
    setAcao(null);
    cerimonia.cancelar();
  }

  /** Esquema, entrada e chamada de cada ação. Campo por campo: nada de espalhar estado. */
  function preparar(escolhida: AcaoAdministrativa) {
    const alvo = { alvoId: usuario.id, motivo };
    const versao = { ...alvo, updatedAt: usuario.updatedAt };
    const comPapel = {
      ...versao,
      papel: papel as z.input<typeof trocarPapelSchema>["papel"],
      lojaId: PAPEIS_COM_LOJA.includes(papel) ? loja : "",
    };
    const comCiencia = { ...versao, ciencia };
    const comEmail = { ...alvo, emailNovo };
    type Passo = [ZodType, unknown, () => Promise<Resultado<unknown>>];
    const tabela: Record<AcaoAdministrativa, Passo> = {
      papel: [trocarPapelSchema, comPapel, () => acoes.trocarPapel(comPapel)],
      promover: [cerimoniaAdminSchema, comCiencia, () => acoes.promoverAAdmin(comCiencia)],
      transferir: [cerimoniaAdminSchema, comCiencia, () => acoes.transferirPosse(comCiencia)],
      desativar: [alvoComVersaoSchema, versao, () => acoes.desativarUsuario(versao)],
      reativar: [alvoComVersaoSchema, versao, () => acoes.reativarUsuario(versao)],
      destravar: [alvoSchema, alvo, () => acoes.destravarUsuario(alvo)],
      reset: [alvoSchema, alvo, () => acoes.iniciarResetDeAcesso(alvo)],
      recuperar: [alvoSchema, alvo, () => acoes.recuperarAcesso(alvo)],
      sessoes: [alvoSchema, alvo, () => acoes.encerrarSessoesDoUsuario(alvo)],
      email: [trocarEmailSchema, comEmail, () => acoes.trocarEmail(comEmail)],
    };
    const [esquema, entrada, chamada] = tabela[escolhida];
    return { erros: errosDe(esquema, entrada), chamada };
  }

  function continuar(evento: FormEvent) {
    evento.preventDefault();
    if (!acao) return;
    const { erros: encontrados, chamada } = preparar(acao);
    setErros(encontrados);
    if (Object.keys(encontrados).length > 0) return;
    cerimonia.iniciar(chamada, CONFIG[acao].bloqueio);
  }

  const cfg = acao ? CONFIG[acao] : null;
  const opcoesDePapel: Papel[] =
    usuario.papel === "dono" ? ["admin", ...PAPEIS_EDITAVEIS] : [...PAPEIS_EDITAVEIS];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" aria-label={`Ações para ${usuario.nome}`}>
            <MoreHorizontal aria-hidden="true" strokeWidth={2} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {disponiveis.map((item) => (
            <DropdownMenuItem
              key={item}
              variant={CONFIG[item].destrutiva ? "destructive" : "default"}
              onSelect={() => abrir(item)}
            >
              {CONFIG[item].menu}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={acao !== null && !cerimonia.confirmando} onOpenChange={(v) => !v && fechar()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{cfg?.menu}</DialogTitle>
            <DialogDescription>
              {usuario.nome} · {rotuloDePapel(usuario.papel)}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={continuar} noValidate className="flex flex-col gap-4">
            {acao === "papel" ? (
              <>
                <CampoPapel
                  opcoes={opcoesDePapel}
                  valor={papel}
                  onMudar={setPapel}
                  erro={erros.papel}
                />
                {PAPEIS_COM_LOJA.includes(papel) ? (
                  <CampoLoja lojas={lojas} valor={loja} onMudar={setLoja} erro={erros.lojaId} />
                ) : null}
              </>
            ) : null}
            {acao === "promover" || acao === "transferir" ? (
              <CampoCienciaAdmin
                valor={ciencia}
                onMudar={setCiencia}
                erro={erros.ciencia}
                {...(acao === "transferir"
                  ? { aviso: "Quem transfere vira administrador. O sistema mantém pelo menos um dono." }
                  : {})}
              />
            ) : null}
            {acao === "email" ? (
              <Campo nome="emailNovo" rotulo="E-mail novo" {...(erros.emailNovo ? { erro: erros.emailNovo } : {})}>
                <Input
                  id="emailNovo"
                  type="email"
                  autoComplete="off"
                  value={emailNovo}
                  onChange={(e) => setEmailNovo(e.target.value)}
                  aria-invalid={Boolean(erros.emailNovo)}
                  aria-describedby={idsDeApoio("emailNovo", { erro: erros.emailNovo })}
                />
              </Campo>
            ) : null}
            <CampoMotivo
              valor={motivo}
              onMudar={setMotivo}
              erro={erros.motivo}
              {...(acao === "recuperar" ? { rotulo: "Como a identidade foi confirmada, e por quê" } : {})}
            />
            {cerimonia.erro && !cerimonia.confirmando ? (
              <p role="alert" className="text-corpo text-perigo">
                {cerimonia.erro}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={fechar}>
                Cancelar
              </Button>
              <Button type="submit" aria-busy={cerimonia.ocupado} aria-disabled={cerimonia.ocupado}>
                {cfg?.confirmar}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ModalConfirmacaoBlock
        aberto={cerimonia.confirmando}
        titulo={cfg?.menu ?? ""}
        resumo={cfg ? `${cfg.resumo(usuario.nome)} Motivo: “${motivo.trim()}”.` : ""}
        textoConfirmar={cfg?.confirmar ?? "Confirmar"}
        variante={cfg?.destrutiva ? "destrutiva" : "padrao"}
        carregando={cerimonia.ocupado}
        {...(cerimonia.erro ? { erro: cerimonia.erro } : {})}
        onConfirmar={() => void cerimonia.executar()}
        onCancelar={cerimonia.cancelar}
      />

      <ModalReautenticacao
        aberto={cerimonia.reautenticando}
        reautenticarComSenha={reautenticar}
        onConfirmado={cerimonia.reautenticado}
        onCancelar={cerimonia.desistirDaProva}
      />
    </>
  );
}
