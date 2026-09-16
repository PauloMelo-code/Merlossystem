import "server-only";
import { headers } from "next/headers";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ErroDoAplicativo } from "@/lib/erros";
import { logger } from "@/lib/logger";
import { sanitizarErroBanco } from "@/lib/db/erros";
import type { Sessao } from "./guard";
import { auth } from "./auth";
import { enfileirarEmailSeguranca } from "./emails";
import { revogarSessoesDe } from "./sessoes";
import { registrarEventoAuth } from "./trilha";

/**
 * Ciclo de vida do SEGUNDO FATOR (02-seguranca.md §9.1, §9.2 item 7, §9.3).
 *
 * Duas telas usam exatamente estas funções: `/primeiro-acesso` (provisionamento)
 * e `/perfil/seguranca` (substituir fator). Ter duas cópias seria ter um
 * caminho onde a conta fica sem fator e outro onde ela fica.
 *
 * TODO cadastro passa por `auth.api.*` SERVER-SIDE: `/two-factor/enable`,
 * `/passkey/generate-register-options` e `/passkey/verify-registration` estão
 * DESLIGADOS por HTTP (G5, CVE-2025-71400). `disabledPaths` só alcança o
 * roteador HTTP — a chamada direta é o caminho suportado, e ela só acontece
 * dentro de action com `exigirSessaoFresca()`.
 *
 * NÃO existe aqui: desligar o 2º fator, ler a semente, gerar código de resgate
 * nem remover o último fator (U13, G4/G5). A única porta é substituir.
 */

export class ErroDeFator extends ErroDoAplicativo {
  constructor(mensagem: string) {
    super("FATOR", mensagem, 400);
  }
}

export type PasskeyVisivel = {
  id: string;
  nome: string | null;
  criadaEm: Date;
  sincronizada: boolean;
  fabricante: string;
};

export type EstadoDosFatores = {
  totpAtivo: boolean;
  passkeys: PasskeyVisivel[];
  /** Quantos fatores independentes a conta tem agora. */
  total: number;
};

/**
 * AAGUID -> fabricante. Lista curta e honesta: o que não está aqui aparece
 * como "Chave de segurança", nunca como palpite (04-ui.md §5.1).
 */
const FABRICANTES: Readonly<Record<string, string>> = {
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome no computador",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "Chaveiro do iCloud",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "Chaveiro do iCloud",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Gerenciador do Google",
  "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "b84e4048-15dc-4dd0-8640-f4f60813c8af": "NordPass",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
};

function fabricanteDe(aaguid: string | null): string {
  if (!aaguid) return "Chave de segurança";
  return FABRICANTES[aaguid.toLowerCase()] ?? "Chave de segurança";
}

/**
 * Estado real dos fatores, lido do banco. `verificado = false` é TOTP em
 * cadastro: ainda não conta como fator.
 */
export async function estadoDosFatores(usuarioId: string): Promise<EstadoDosFatores> {
  const [totp, chaves] = await Promise.all([
    db.execute<{ verificado: boolean }>(sql`
      select verificado from usuarios_totp
      where usuario_id = ${usuarioId}::uuid limit 1
    `),
    db.execute<{
      id: string;
      nome: string | null;
      created_at: Date;
      backed_up: boolean | null;
      aaguid: string | null;
    }>(sql`
      select id, nome, created_at, backed_up, aaguid from usuarios_passkeys
      where usuario_id = ${usuarioId}::uuid
      order by created_at desc
    `),
  ]);

  const totpAtivo = totp.rows[0]?.verificado === true;
  const passkeys = chaves.rows.map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    criadaEm: new Date(linha.created_at),
    sincronizada: linha.backed_up === true,
    fabricante: fabricanteDe(linha.aaguid),
  }));

  return { totpAtivo, passkeys, total: (totpAtivo ? 1 : 0) + passkeys.length };
}

/**
 * §9.2 item 7 — o provisionamento só fecha quando existe um fator de verdade.
 * `ativo = true`, `two_factor_enabled = true`, `precisa_configurar_fator =
 * false`, e a sessão provisória MORRE: a pessoa entra de novo, agora pelo
 * caminho normal (REQ-F4).
 *
 * Em sessão plena (alguém acrescentando uma passkey no perfil) esta função não
 * revoga nada — só o provisionamento derruba sessão.
 */
export async function concluirProvisionamento(sessao: Sessao): Promise<boolean> {
  if (!sessao.precisaConfigurarFator) return false;

  const estado = await estadoDosFatores(sessao.usuarioId);
  if (estado.total === 0) return false;

  await db.execute(sql`
    update usuarios
    set ativo = true, two_factor_enabled = true, precisa_configurar_fator = false,
        updated_at = now(), modified_by = ${sessao.usuarioId}::uuid
    where id = ${sessao.usuarioId}::uuid
  `);
  await revogarSessoesDe(sessao.usuarioId);
  return true;
}

/**
 * Marca a conta como "tem segundo fator" quando o fator recém-cadastrado não é
 * o TOTP. O BA só liga `two_factor_enabled` no caminho do TOTP; sem isto, uma
 * conta que só tem passkey passaria no login sem nunca ter provado posse —
 * e o portão de entrega (`ativo AND two_factor_enabled = false` = 0) acusaria.
 */
async function marcarSegundoFator(usuarioId: string): Promise<void> {
  await db.execute(sql`
    update usuarios set two_factor_enabled = true, updated_at = now()
    where id = ${usuarioId}::uuid and two_factor_enabled = false
  `);
}

// ---------------------------------------------------------------------------
// Reautenticação (04-ui.md §7.3, 02-seguranca.md §10)
// ---------------------------------------------------------------------------

/**
 * Carimba o frescor da sessão corrente.
 *
 * `created_at` volta a AGORA de propósito: o `freshSessionMiddleware` do Better
 * Auth mede frescor por `session.createdAt` e é ele que guarda o cadastro de
 * passkey. Sem este carimbo, `exigirSessaoFresca()` diria "fresca" e o BA
 * responderia 403 — a pessoa ficaria sem saída depois de 15 min.
 *
 * `expira_em` NÃO é tocado: o teto absoluto de 12 h continua contando do login
 * (F2). O documento fala em "sessão nova"; o efeito exigido — `created_at`
 * recente com o mesmo teto — é este, sem forjar o cookie assinado do BA fora
 * do runtime dele.
 */
export async function carimbarReautenticacao(sessaoId: string): Promise<void> {
  await db.execute(sql`
    update usuarios_sessoes
    set reautenticada_em = now(), created_at = now(), ultimo_uso_em = now()
    where id = ${sessaoId}::uuid
  `);
}

/**
 * Prova por senha. Falha aqui NÃO alimenta o bloqueio por conta: quem já está
 * dentro errando a própria senha não pode trancar o próprio login (T6).
 */
export async function reautenticarComSenha(sessao: Sessao, senha: string): Promise<void> {
  const linhas = await db.execute<{ senha_hash: string | null }>(sql`
    select senha_hash from usuarios_contas
    where usuario_id = ${sessao.usuarioId}::uuid and provedor_id = 'credential'
    limit 1
  `);
  const guardada = linhas.rows[0]?.senha_hash;
  const { kdf } = await import("./kdf");
  const confere = guardada ? await kdf.verify(guardada, senha) : false;
  if (!confere) throw new ErroDeFator("Senha incorreta.");
  await carimbarReautenticacao(sessao.sessaoId);
}

// ---------------------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------------------

/**
 * Começa o cadastro do TOTP e devolve a URI `otpauth://`. A senha atual é
 * exigida pelo próprio `/two-factor/enable` do BA (e é a segunda prova, além do
 * frescor da sessão).
 *
 * SUBSTITUIR um TOTP existente: o plugin recusa quando já há linha verificada,
 * então a linha vai a `verificado = false` ANTES — que é exatamente o passo
 * "cadastra o novo" de §9.3. Enquanto a confirmação não vem, a conta continua
 * com os demais fatores; por isso a troca de TOTP por TOTP só é oferecida a
 * quem tem passkey OU está em provisionamento.
 */
export async function iniciarTotp(sessao: Sessao, senha: string): Promise<string> {
  const estado = await estadoDosFatores(sessao.usuarioId);
  if (estado.totpAtivo) {
    if (estado.passkeys.length === 0 && !sessao.precisaConfigurarFator) {
      throw new ErroDeFator(
        "Cadastre uma passkey antes de trocar o aplicativo autenticador. Assim a conta nunca fica sem um segundo fator.",
      );
    }
    await db.execute(sql`
      update usuarios_totp set verificado = false where usuario_id = ${sessao.usuarioId}::uuid
    `);
  }

  const resposta = await auth.api.enableTwoFactor({
    body: { password: senha, method: "totp" },
    headers: await headers(),
  });
  const uri = (resposta as { totpURI?: unknown }).totpURI;
  if (typeof uri !== "string") {
    throw new ErroDeFator("Não foi possível preparar o aplicativo autenticador. Tente de novo.");
  }
  return uri;
}

/** Confirma o código e liga o fator. Só aqui o TOTP passa a valer. */
export async function confirmarTotp(sessao: Sessao, codigo: string): Promise<void> {
  try {
    await auth.api.verifyTOTP({ body: { code: codigo }, headers: await headers() });
  } catch {
    // Uma frase só, sem dizer se o código estava errado ou se expirou.
    throw new ErroDeFator("Código incorreto. Confira o aplicativo e tente de novo.");
  }
  await marcarSegundoFator(sessao.usuarioId);
  await avisar(sessao, "fator-adicionado", "fator_adicionado", { fator: "totp" });
}

// ---------------------------------------------------------------------------
// Passkey
// ---------------------------------------------------------------------------

/** Opções do WebAuthn para o navegador criar a credencial. */
export async function opcoesDePasskey(nome: string): Promise<Record<string, unknown>> {
  const opcoes = await auth.api.generatePasskeyRegistrationOptions({
    query: { name: nome },
    headers: await headers(),
  });
  return opcoes as unknown as Record<string, unknown>;
}

/**
 * Conclui o cadastro. O `afterVerification` de `auth.ts` recusa quando o
 * autenticador não fez verificação do usuário (G9) — sem isso a passkey cairia
 * para "posse do aparelho" e deixaria de ser segundo fator.
 */
export async function confirmarPasskey(
  sessao: Sessao,
  resposta: Record<string, unknown>,
  nome: string,
): Promise<void> {
  try {
    await auth.api.verifyPasskeyRegistration({
      body: { response: resposta as never, name: nome },
      headers: await headers(),
    });
  } catch (erro) {
    logger.warn({ erro: String(erro) }, "cadastro de passkey recusado");
    throw new ErroDeFator("Não foi possível cadastrar esta passkey. Tente de novo.");
  }
  await marcarSegundoFator(sessao.usuarioId);
  await avisar(sessao, "passkey-adicionada", "passkey_adicionada", { fator: "passkey" });
}

/**
 * Renomear é rótulo, não acesso: `TIPOS_AUTH_EVENTO` (01-dados.md §16.3) não
 * tem tipo para isso e inventar um seria mudar lista fechada. O dono do
 * aparelho continua o mesmo — quem confere é o `requireResourceOwnership`.
 */
export async function renomearPasskey(passkeyId: string, nome: string): Promise<void> {
  await auth.api.updatePasskey({
    body: { id: passkeyId, name: nome },
    headers: await headers(),
  });
}

/**
 * Remover passkey NUNCA pode zerar os fatores (§9.3). A conferência é nossa,
 * além da que o `requireResourceOwnership` do plugin faz: a CVE-2025-71400 era
 * um IDOR exatamente neste caminho.
 */
export async function removerPasskey(sessao: Sessao, passkeyId: string): Promise<void> {
  const estado = await estadoDosFatores(sessao.usuarioId);
  const alvo = estado.passkeys.find((chave) => chave.id === passkeyId);
  if (!alvo) throw new ErroDeFator("Esta passkey não está na sua conta.");
  if (estado.total <= 1) {
    throw new ErroDeFator(
      "Esta é a sua única forma de provar quem você é. Cadastre outra antes de remover esta.",
    );
  }

  await auth.api.deletePasskey({ body: { id: passkeyId }, headers: await headers() });
  await avisar(sessao, "passkey-removida", "passkey_removida", { fator: "passkey" });
}

// ---------------------------------------------------------------------------

type AssuntoDeFator =
  | "fator-adicionado"
  | "fator-removido"
  | "passkey-adicionada"
  | "passkey-removida";

/**
 * Trilha + aviso ao dono da conta (REQ-D12/D13), nesta ordem e sem `await` no
 * envio: o e-mail sai por fila, nunca dentro da resposta.
 */
async function avisar(
  sessao: Sessao,
  assunto: AssuntoDeFator,
  tipo: "fator_adicionado" | "fator_removido" | "passkey_adicionada" | "passkey_removida",
  detalhes: { fator: string },
): Promise<void> {
  try {
    await registrarEventoAuth({
      tipo,
      usuarioId: sessao.usuarioId,
      sessaoId: sessao.sessaoId,
      meio: detalhes.fator === "passkey" ? "passkey" : "senha+totp",
    });
  } catch (erro) {
    logger.error({ erro: sanitizarErroBanco(erro) }, "trilha de fator falhou");
  }
  enfileirarEmailSeguranca(assunto, sessao.usuarioId);
}
