import "server-only";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { ErroDeValidacao, paraResultado, type Resultado } from "@/lib/erros";
import { emTransacao, type Transacao } from "@/lib/db/mutacoes";
import { exigirPermissao, exigirSessao, exigirSessaoFresca, type Contexto, type Sessao } from "@/lib/auth/guard";
import { contextoDe, resolverLojaPedida } from "@/lib/auth/loja";
import type { ChavePermissao } from "@/lib/auth/permissoes";
import { conferirOrigem } from "@/lib/seguranca/origem";
import { chaveDeIp, ipDoCliente } from "@/lib/seguranca/ip";
import { limitarPorIp, type Regra } from "@/lib/seguranca/limite";
import { ErroDoAplicativo } from "@/lib/erros";

/**
 * Os DOIS embrulhos de Server Action (02-seguranca.md §3.2,
 * 03-arquitetura.md §4.3). Todo `export` de arquivo `"use server"` usa um deles
 * — a trava T1 reprova export sem nenhum.
 *
 * `acao()` é autenticada; `acaoPublica()` é anônima e OBRIGATÓRIA em `entrar`,
 * `esqueciASenha`, `redefinirSenha`, `consumirConvite` e
 * `verificarSegundoFator`. Sem ela, a escrita anônima não teria checagem de
 * origem (o Next só AVISA quando `Origin` falta — N2) nem teto por IP.
 *
 * `conferirOrigem()` e `limitarPorIp()` moram em `src/lib/seguranca/` e não
 * dentro de `exigirSessao()` como única casa.
 */

export const COOKIE_LOJA = "loja_ativa";

/** `"grava"` exige loja resolvida; `"le"` aceita `todas`; `"nenhuma"` ignora. */
export type ModoDeLoja = "grava" | "le" | "nenhuma";

export type ConfigAcao<E extends z.ZodType, T> = {
  permissao: ChavePermissao;
  entrada: E;
  loja?: ModoDeLoja;
  /** Troca de senha, de fator, de sessões e ação sobre conta alheia. */
  fresca?: boolean;
  /** Área `/primeiro-acesso`: aceita a sessão provisória do convite. */
  provisoria?: boolean;
  /** Área `/perfil/seguranca`: aceita quem está com `precisa_trocar_senha`. */
  trocaDeSenha?: boolean;
  revalidar?: readonly string[];
  executar: (dados: z.output<E>, ctx: Contexto, tx: Transacao) => Promise<T>;
};

export type ConfigAcaoPublica<E extends z.ZodType, T> = {
  /** OBRIGATÓRIO: é o que entra no manifesto de rotas públicas (trava T2). */
  motivo: string;
  limite: Regra;
  entrada: E;
  executar: (dados: z.output<E>, contexto: { ip: string | null }) => Promise<T>;
};

/** `FormData` vira objeto simples antes do Zod; campo repetido vira lista. */
export function normalizarEntrada(bruto: unknown): unknown {
  if (!(bruto instanceof FormData)) return bruto;
  const objeto: Record<string, unknown> = {};
  for (const [chave, valor] of bruto.entries()) {
    const atual = objeto[chave];
    if (atual === undefined) objeto[chave] = valor;
    else if (Array.isArray(atual)) atual.push(valor);
    else objeto[chave] = [atual, valor];
  }
  return objeto;
}

/** O formulário nunca é limpo: o que a pessoa digitou volta em `valores`. */
function valoresDoFormulario(bruto: unknown): Record<string, string> | undefined {
  if (!(bruto instanceof FormData)) return undefined;
  const valores: Record<string, string> = {};
  for (const [chave, valor] of bruto.entries()) {
    if (typeof valor === "string" && !/senha|password|token|codigo/i.test(chave)) {
      valores[chave] = valor;
    }
  }
  return valores;
}

function analisar<E extends z.ZodType>(esquema: E, bruto: unknown): z.output<E> {
  const analise = esquema.safeParse(normalizarEntrada(bruto));
  if (analise.success) return analise.data;

  const campos: Record<string, string[]> = {};
  for (const problema of analise.error.issues) {
    const chave = problema.path.join(".") || "_";
    (campos[chave] ??= []).push(problema.message);
  }
  throw new ErroDeValidacao(campos, valoresDoFormulario(bruto));
}

/** Cookie `loja_ativa`: preferência de UI, NUNCA autorização (§2.4). */
async function lojaPedida(dados: unknown): Promise<string | undefined> {
  const doCorpo =
    typeof dados === "object" && dados !== null && "loja" in dados
      ? (dados as { loja?: unknown }).loja
      : undefined;
  if (typeof doCorpo === "string" && doCorpo !== "") return doCorpo;
  const jarra = await cookies();
  return jarra.get(COOKIE_LOJA)?.value;
}

/**
 * A ordem é a de 03-arquitetura.md §4.3 e não muda:
 * sessão -> permissão -> validação -> escopo -> transação -> tradução ->
 * revalidação.
 *
 * LIMITE CONHECIDO E ESCRITO (I2 parcial): o runtime do Next desserializa o
 * corpo da Server Action ANTES desta função rodar. Não existe guarda anterior
 * ao corpo em Server Action — é por isso que `bodySizeLimit` está em 1 MB e que
 * toda action alcançável sem sessão usa `acaoPublica`, com teto por IP.
 */
export async function executarAcao<E extends z.ZodType, T>(
  cfg: ConfigAcao<E, T>,
  bruto: unknown,
): Promise<Resultado<T>> {
  try {
    const opcoes = {
      ...(cfg.provisoria === undefined ? {} : { provisoria: cfg.provisoria }),
      ...(cfg.trocaDeSenha === undefined ? {} : { trocaDeSenha: cfg.trocaDeSenha }),
    };
    const sessao: Sessao = cfg.fresca
      ? await exigirSessaoFresca(opcoes)
      : await exigirSessao(opcoes);

    exigirPermissao(sessao, cfg.permissao);

    const dados = analisar(cfg.entrada, bruto);

    const modo: ModoDeLoja = cfg.loja ?? "le";
    const pedida = modo === "nenhuma" ? undefined : await lojaPedida(dados);
    // A loja pedida pelo cliente só vale depois de existir e estar viva.
    const resolvida = await resolverLojaPedida(sessao, pedida);
    const ctx = contextoDe(sessao, resolvida);

    if (modo === "grava" && ctx.escopo.tipo !== "uma") {
      const { ErroFaltaLoja } = await import("@/lib/erros");
      throw new ErroFaltaLoja();
    }

    const saida = await emTransacao(ctx, (tx, contexto) => cfg.executar(dados, contexto, tx));

    for (const caminho of cfg.revalidar ?? []) revalidatePath(caminho);

    return { ok: true, dados: saida };
  } catch (erro) {
    // `redirect` e `notFound` são fluxo do Next e precisam subir.
    if (erro instanceof Error && "digest" in erro && String(erro.digest).startsWith("NEXT_")) {
      throw erro;
    }
    return paraResultado(erro);
  }
}

/** Açúcar para quem prefere declarar a action como constante (T1 aceita os dois). */
export function acao<E extends z.ZodType, T>(cfg: ConfigAcao<E, T>) {
  return (bruto: unknown): Promise<Resultado<T>> => executarAcao(cfg, bruto);
}

export class ErroDeExcesso extends ErroDoAplicativo {
  constructor() {
    super("EXCESSO_DE_TENTATIVAS", "Muitas tentativas. Aguarde um instante e tente de novo.", 429);
  }
}

/**
 * Action anônima. `conferirOrigem()` vem PRIMEIRO: `Origin` ausente ou forjada
 * é recusada antes de qualquer trabalho (J7, CVE-2026-27978).
 */
export async function executarAcaoPublica<E extends z.ZodType, T>(
  cfg: ConfigAcaoPublica<E, T>,
  bruto: unknown,
): Promise<Resultado<T>> {
  try {
    const cabecalhos = await headers();
    conferirOrigem(cabecalhos);

    const ip = ipDoCliente(cabecalhos);
    const veredito = await limitarPorIp(`acao:${cfg.motivo}`, chaveDeIp(ip), cfg.limite);
    if (!veredito.permitido) throw new ErroDeExcesso();

    const dados = analisar(cfg.entrada, bruto);
    return { ok: true, dados: await cfg.executar(dados, { ip }) };
  } catch (erro) {
    if (erro instanceof Error && "digest" in erro && String(erro.digest).startsWith("NEXT_")) {
      throw erro;
    }
    return paraResultado(erro);
  }
}

export function acaoPublica<E extends z.ZodType, T>(cfg: ConfigAcaoPublica<E, T>) {
  return (bruto: unknown): Promise<Resultado<T>> => executarAcaoPublica(cfg, bruto);
}
