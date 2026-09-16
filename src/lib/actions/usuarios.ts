"use server";

import type { z } from "zod";
import { executarAcao } from "./_base";
import type { Resultado } from "@/lib/erros";
import {
  destravarConta,
  encerrarSessoesDe,
  iniciarResetDeSenha,
  recuperarAcessoAssistido,
} from "@/lib/usuarios/acesso";
import {
  desativarUsuario as desativar,
  promoverAAdmin as promover,
  reativarUsuario as reativar,
  transferirPosse as transferir,
  trocarPapel as trocar,
} from "@/lib/usuarios/administracao";
import { confirmarTrocaDeEmail, iniciarTrocaDeEmail } from "@/lib/usuarios/trocas-email";
import {
  alvoComVersaoSchema,
  alvoSchema,
  cerimoniaAdminSchema,
  codigoTrocaEmailSchema,
  trocarEmailSchema,
  trocarPapelSchema,
} from "@/lib/validadores/usuarios";

/**
 * Administração de acessos (02-seguranca.md §11.2, REQ-H1..H4, E7, E8;
 * 04-ui.md §5.6).
 *
 * TODA action daqui sobre conta alheia é `fresca: true` (15 min, §7.3) e tem
 * `motivo` de 8 a 255 caracteres no Zod. O resto da cerimônia — `FOR UPDATE`,
 * escada de papéis, auto-alvo, trilha antes do efeito — mora em
 * `src/lib/usuarios/`, dentro da transação que `executarAcao` abre.
 *
 * Nenhuma action aceita senha: o admin NUNCA define a senha de ninguém (E8).
 * Nenhuma espalha o corpo sobre a linha: os esquemas são `strictObject` e o
 * domínio grava campo a campo (H12).
 *
 * `loja: "nenhuma"`: `usuarios` é da rede, e o cookie `loja_ativa` do admin
 * não pode filtrar a pessoa que ele está administrando.
 */

const REDE = "nenhuma" as const;
const TELA = ["/configuracoes/usuarios"] as const;

type SaidaComVersao = Resultado<{ updatedAt: Date }>;

export async function trocarPapel(
  entrada: z.input<typeof trocarPapelSchema>,
): Promise<SaidaComVersao> {
  return executarAcao(
    {
      permissao: "usuarios:editar",
      entrada: trocarPapelSchema,
      loja: REDE,
      fresca: true,
      revalidar: TELA,
      executar: (dados, ctx, tx) => trocar(tx, ctx, dados),
    },
    entrada,
  );
}

/** Só `dono`. A ciência digitada é conferida no Zod (`cerimoniaAdminSchema`). */
export async function promoverAAdmin(
  entrada: z.input<typeof cerimoniaAdminSchema>,
): Promise<SaidaComVersao> {
  return executarAcao(
    {
      permissao: "usuarios:promover_admin",
      entrada: cerimoniaAdminSchema,
      loja: REDE,
      fresca: true,
      revalidar: TELA,
      executar: (dados, ctx, tx) => promover(tx, ctx, dados),
    },
    entrada,
  );
}

/** Só `dono`. Quem transfere vira `admin` e as sessões dos dois caem. */
export async function transferirPosse(
  entrada: z.input<typeof cerimoniaAdminSchema>,
): Promise<SaidaComVersao> {
  return executarAcao(
    {
      permissao: "usuarios:transferir_posse",
      entrada: cerimoniaAdminSchema,
      loja: REDE,
      fresca: true,
      revalidar: TELA,
      executar: (dados, ctx, tx) => transferir(tx, ctx, dados),
    },
    entrada,
  );
}

export async function desativarUsuario(
  entrada: z.input<typeof alvoComVersaoSchema>,
): Promise<SaidaComVersao> {
  return executarAcao(
    {
      permissao: "usuarios:desativar",
      entrada: alvoComVersaoSchema,
      loja: REDE,
      fresca: true,
      revalidar: TELA,
      executar: (dados, ctx, tx) => desativar(tx, ctx, dados),
    },
    entrada,
  );
}

/** Mesma chave de desativar: a matriz não tem `reativar` separado (§2.2). */
export async function reativarUsuario(
  entrada: z.input<typeof alvoComVersaoSchema>,
): Promise<SaidaComVersao> {
  return executarAcao(
    {
      permissao: "usuarios:desativar",
      entrada: alvoComVersaoSchema,
      loja: REDE,
      fresca: true,
      revalidar: TELA,
      executar: (dados, ctx, tx) => reativar(tx, ctx, dados),
    },
    entrada,
  );
}

export async function destravarUsuario(
  entrada: z.input<typeof alvoSchema>,
): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: "usuarios:destravar",
      entrada: alvoSchema,
      loja: REDE,
      fresca: true,
      revalidar: TELA,
      executar: async (dados, ctx, tx) => {
        await destravarConta(tx, ctx, dados);
        return null;
      },
    },
    entrada,
  );
}

/** Dispara o e-mail de redefinição. Nunca recebe senha (E8). */
export async function iniciarResetDeAcesso(
  entrada: z.input<typeof alvoSchema>,
): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: "usuarios:iniciar_reset",
      entrada: alvoSchema,
      loja: REDE,
      fresca: true,
      revalidar: TELA,
      executar: async (dados, ctx, tx) => {
        await iniciarResetDeSenha(tx, ctx, dados);
        return null;
      },
    },
    entrada,
  );
}

/** Perda dos dois fatores (§9.3). O motivo registra como a identidade foi confirmada. */
export async function recuperarAcesso(
  entrada: z.input<typeof alvoSchema>,
): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: "usuarios:recuperar_fator",
      entrada: alvoSchema,
      loja: REDE,
      fresca: true,
      revalidar: TELA,
      executar: async (dados, ctx, tx) => {
        await recuperarAcessoAssistido(tx, ctx, dados);
        return null;
      },
    },
    entrada,
  );
}

export async function encerrarSessoesDoUsuario(
  entrada: z.input<typeof alvoSchema>,
): Promise<Resultado<{ encerradas: number }>> {
  return executarAcao(
    {
      permissao: "usuarios:encerrar_sessoes",
      entrada: alvoSchema,
      loja: REDE,
      fresca: true,
      revalidar: TELA,
      executar: (dados, ctx, tx) => encerrarSessoesDe(tx, ctx, dados),
    },
    entrada,
  );
}

export async function trocarEmail(
  entrada: z.input<typeof trocarEmailSchema>,
): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: "usuarios:trocar_email",
      entrada: trocarEmailSchema,
      loja: REDE,
      fresca: true,
      revalidar: TELA,
      executar: async (dados, ctx, tx) => {
        await iniciarTrocaDeEmail(tx, ctx, dados);
        return null;
      },
    },
    entrada,
  );
}

/**
 * A metade da PRÓPRIA pessoa: confirma o código recebido no endereço novo.
 * O alvo é a sessão corrente — nada de id no corpo (mesma regra de T11).
 */
export async function confirmarMeuNovoEmail(
  entrada: z.input<typeof codigoTrocaEmailSchema>,
): Promise<Resultado<{ email: string }>> {
  return executarAcao(
    {
      permissao: "conta:gerir",
      entrada: codigoTrocaEmailSchema,
      loja: REDE,
      fresca: true,
      revalidar: ["/perfil"],
      executar: (dados, ctx, tx) => confirmarTrocaDeEmail(tx, ctx, dados.codigo),
    },
    entrada,
  );
}
