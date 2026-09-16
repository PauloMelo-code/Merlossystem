import "server-only";
import { headers } from "next/headers";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ErroDoAplicativo, ErroDePermissao } from "@/lib/erros";
import { PAPEIS } from "@/lib/db/schema/_enums/auth";
import { conferirOrigem } from "@/lib/seguranca/origem";
import { ipDoCliente } from "@/lib/seguranca/ip";
import type { EscopoLoja } from "./loja";
import { pode } from "./permissoes";
import { FRESCOR_MS, INATIVIDADE_MS, marcarAtividade } from "./sessoes";
import { registrarEventoAuth } from "./trilha";

/**
 * Portão único de autorização (02-seguranca.md §3, contrato de
 * 01-dados.md §13.1).
 *
 * É chamado em TODA page de `(app)`, layout, Route Handler e Server Action.
 * `src/proxy.ts` só redireciona quem não tem cookie e injeta o nonce da CSP —
 * não decide acesso (N1, A5, CVE-2025-29927). Server Action é um POST para a
 * rota onde é usada e NÃO passa por layout (N1/N5): layout que chama o guard
 * não cobre action nenhuma.
 */

/** Vem da constante `PAPEIS`, para não existir uma segunda lista de papéis. */
export type Papel = (typeof PAPEIS)[number];

export type Sessao = {
  usuarioId: string;
  sessaoId: string;
  papel: Papel;
  lojaId: string | null;
  /**
   * Literal `true`: o portão só devolve `Sessao` para quem passou. A sessão
   * PROVISÓRIA do primeiro acesso também chega aqui com `true` — o que a
   * distingue é `precisaConfigurarFator`, lido do banco a cada requisição
   * porque `cookieCache` está desligado (§9.4; a coluna `provisoria` foi
   * rejeitada em R-02 por ser segunda fonte da verdade).
   */
  ativo: true;
  precisaTrocarSenha: boolean;
  precisaConfigurarFator: boolean;
};

export type Contexto = {
  sessao: Sessao;
  escopo: EscopoLoja;
  autorId: string;
  origem: "ui" | "webhook" | "worker";
};

export type { EscopoLoja };

export class ErroNaoAutenticado extends ErroDoAplicativo {
  constructor() {
    super("NAO_AUTENTICADO", "Entre de novo para continuar.", 401);
  }
}

export class ErroSessaoNaoFresca extends ErroDoAplicativo {
  constructor() {
    super("SESSAO_NAO_FRESCA", "Confirme sua identidade para continuar.", 403);
  }
}

export class ErroTrocaObrigatoria extends ErroDoAplicativo {
  constructor() {
    super("TROCA_OBRIGATORIA", "Você precisa definir uma senha nova para continuar.", 403);
  }
}

export class ErroFatorObrigatorio extends ErroDoAplicativo {
  constructor() {
    super("FATOR_OBRIGATORIO", "Conclua a configuração do segundo fator para continuar.", 403);
  }
}

export type OpcoesDeSessao = {
  /** `false` no polling do inbox: senão a inatividade de 60 min nunca chega. */
  renovaAtividade?: boolean;
  /** `true` SÓ na área `/primeiro-acesso` e nas actions daquela pasta. */
  provisoria?: boolean;
  /** `true` SÓ em `/perfil/seguranca` (trocar senha) e em `/sair`. */
  trocaDeSenha?: boolean;
};

type LinhaDoPortao = {
  usuario_id: string;
  papel: string;
  loja_id: string | null;
  ativo: boolean;
  is_deleted: boolean;
  precisa_trocar_senha: boolean;
  precisa_configurar_fator: boolean;
  bloqueado_ate: Date | null;
  sessao_id: string;
  ultimo_uso_em: Date | null;
  criada_em: Date;
  reautenticada_em: Date | null;
};

export function ehPapel(valor: string): valor is Papel {
  return (PAPEIS as readonly string[]).includes(valor);
}

/** `papel === "dono"`, por comparação LITERAL — nunca via `pode()` (REQ-H1). */
export function ehPrivilegioMaximo(papel: Papel): boolean {
  return papel === "dono";
}

/**
 * Resolve a sessão pelo Better Auth e reconfere TUDO no banco. Com
 * `cookieCache` desligado, papel, loja, `ativo` e os gates valem na requisição
 * corrente, não na anterior (REQ-H6, CVE-2026-67337).
 *
 * NUNCA aceita `Authorization` nem segredo de máquina: o canal de máquina é
 * `rotaDeMaquina()`, com código distinto (REQ-A4).
 */
export async function exigirSessao(opcoes: OpcoesDeSessao = {}): Promise<Sessao> {
  const cabecalhos = await headers();

  // J7: Server Action mutante passa por checagem de origem. O Next só AVISA
  // quando `Origin` falta (N2), e `Origin: null` já burlou o nativo.
  if (cabecalhos.get("next-action")) conferirOrigem(cabecalhos);

  const { auth } = await import("./auth");
  const resultado = await auth.api.getSession({ headers: cabecalhos });
  const sessaoBa = (resultado as { session?: { id?: string } } | null)?.session;
  if (!sessaoBa?.id) throw new ErroNaoAutenticado();

  const linhas = await db.execute<LinhaDoPortao>(sql`
    select u.id as usuario_id, u.papel, u.loja_id, u.ativo, u.is_deleted,
           u.precisa_trocar_senha, u.precisa_configurar_fator, u.bloqueado_ate,
           s.id as sessao_id, s.ultimo_uso_em,
           s.created_at as criada_em, s.reautenticada_em
    from usuarios_sessoes s
    join usuarios u on u.id = s.usuario_id
    where s.id = ${sessaoBa.id}::uuid and s.expira_em > now()
    limit 1
  `);
  const linha = linhas.rows[0];
  if (!linha) throw new ErroNaoAutenticado();

  if (linha.is_deleted) throw new ErroNaoAutenticado();
  if (linha.bloqueado_ate && new Date(linha.bloqueado_ate) > new Date()) {
    throw new ErroNaoAutenticado();
  }
  // Papel desconhecido = NENHUMA permissão. Nunca cair para o mais baixo.
  if (!ehPapel(linha.papel)) throw new ErroNaoAutenticado();
  // Conta desativada de verdade (não é a que está em provisionamento).
  if (!linha.ativo && !linha.precisa_configurar_fator) throw new ErroNaoAutenticado();

  // Inatividade de 60 min (F3): `ultimo_uso_em` nulo vale a criação da sessão.
  const ultimoUso = linha.ultimo_uso_em
    ? new Date(linha.ultimo_uso_em)
    : new Date(linha.criada_em);
  if (Date.now() - ultimoUso.getTime() > INATIVIDADE_MS) throw new ErroNaoAutenticado();

  const sessao: Sessao = {
    usuarioId: linha.usuario_id,
    sessaoId: linha.sessao_id,
    papel: linha.papel,
    lojaId: linha.loja_id,
    ativo: true,
    precisaTrocarSenha: linha.precisa_trocar_senha,
    precisaConfigurarFator: linha.precisa_configurar_fator,
  };

  // §9.4, nesta ordem. A conta em provisionamento AUTENTICA — o que ela não
  // faz é alcançar outra coisa além de `/primeiro-acesso`.
  if (sessao.precisaConfigurarFator && opcoes.provisoria !== true) {
    throw new ErroFatorObrigatorio();
  }
  if (sessao.precisaTrocarSenha && opcoes.trocaDeSenha !== true) {
    throw new ErroTrocaObrigatoria();
  }

  if (opcoes.renovaAtividade !== false) {
    await marcarAtividade(sessao.sessaoId, linha.ultimo_uso_em);
  }
  return sessao;
}

/**
 * `exigirSessao()` + `max(created_at, reautenticada_em) <= 15 min` — o MESMO
 * valor de `session.freshAge`, para o frescor nativo do BA e o nosso nunca
 * discordarem (G12: o `sensitiveSessionMiddleware` do BA não confere frescor).
 */
export async function exigirSessaoFresca(opcoes: OpcoesDeSessao = {}): Promise<Sessao> {
  const sessao = await exigirSessao(opcoes);
  const linhas = await db.execute<{ frescor: Date }>(sql`
    select greatest(created_at, coalesce(reautenticada_em, created_at)) as frescor
    from usuarios_sessoes where id = ${sessao.sessaoId}::uuid limit 1
  `);
  const frescor = linhas.rows[0]?.frescor;
  if (!frescor || Date.now() - new Date(frescor).getTime() > FRESCOR_MS) {
    throw new ErroSessaoNaoFresca();
  }
  return sessao;
}

/**
 * `pode()` + trilha + lançamento. Grava `recusa_403` em `auth_eventos` — por
 * isso a navegação usa `pode()` direto: montar menu com `exigirPermissao()`
 * inundaria a trilha de `recusa_403` a cada page view.
 */
export function exigirPermissao(s: Sessao, chave: `${string}:${string}`, lojaId?: string): void {
  const [recurso = "", acao = ""] = chave.split(":", 2);
  if (pode(s.papel, recurso, acao)) return;

  void registrarEventoAuth({
    tipo: "recusa_403",
    usuarioId: s.usuarioId,
    sessaoId: s.sessaoId,
    resultado: "recusado",
    detalhes: { acao: chave, papel: s.papel, ...(lojaId ? { rota: lojaId } : {}) },
  });
  throw new ErroDePermissao();
}

/** IP canônico da requisição corrente, para trilha e limitador. */
export async function ipDaRequisicao(): Promise<string | null> {
  return ipDoCliente(await headers());
}

export { pode } from "./permissoes";
export { exigirAlvoPermitido } from "./permissoes/alvo";
export { contextoDe, escopoDeLoja, lojaParaGravar } from "./loja";
