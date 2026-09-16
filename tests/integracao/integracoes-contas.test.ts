import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emTransacao } from "@/lib/db/mutacoes";
import { ErroDeColisao, ErroDeValidacao } from "@/lib/erros";
import { fecharFilas } from "@/lib/fila/filas";
import {
  conectarPorToken,
  desconectarConta,
  detalheDaConta,
  editarConta,
  listarContas,
  registrarEstadoDoSistema,
} from "@/lib/integracoes";
import { criarLoja, desativarLoja, editarLoja } from "@/lib/lojas";
import { conferirSegredoPorHash } from "@/lib/seguranca/assinaturas";
import { redisDoLimitador } from "@/lib/seguranca/limite";
import { conectarPorTokenSchema } from "@/lib/validadores/integracoes";
import type { Contexto } from "@/lib/auth/guard";
import {
  aleatorio,
  banco,
  contextoDe,
  linhaDaConta,
  semearConta,
  semearLoja,
  semearUsuario,
  trilhaDe,
} from "./integracoes-apoio";

/**
 * Contas conectadas e lojas contra o Postgres real (01-dados.md §6.1, §6.3;
 * 02-seguranca.md §13). Aceite de M5: "desconectar apaga a credencial cifrada
 * e marca a linha excluída".
 */

let ctx: Contexto;

beforeAll(async () => {
  ctx = contextoDe(await semearUsuario("admin"));
});

afterAll(async () => {
  await fecharFilas();
  await redisDoLimitador().quit().catch(() => undefined);
  await banco.end().catch(() => undefined);
});

async function falhaCom<T>(promessa: Promise<unknown>, tipo: new (...a: never[]) => T): Promise<T> {
  try {
    await promessa;
  } catch (erro) {
    expect(erro).toBeInstanceOf(tipo);
    return erro as T;
  }
  throw new Error("era para falhar");
}

function entradaUazapi(lojaId: string, token: string, referencia = `inst-${aleatorio(4)}`) {
  return conectarPorTokenSchema.parse({
    provedor: "uazapi",
    lojaId,
    rotulo: "WhatsApp Vendas",
    referencia,
    chave_token: token,
  });
}

describe("conectar por token", () => {
  it("credencial só no cofre, segredo do webhook só como hash, trilha sem segredo", async () => {
    const loja = await semearLoja();
    const token = `token-real-${aleatorio(10)}`;
    const conta = await emTransacao(ctx, (tx) => conectarPorToken(tx, entradaUazapi(loja.id, token), ctx));

    const linha = await linhaDaConta(conta.id);
    expect(String(linha.credenciais_cifradas)).toMatch(/^v1:/);
    expect(String(linha.credenciais_cifradas)).not.toContain(token);
    expect(linha.credenciais_aad).toBe(conta.id);
    expect(linha.status).toBe("desconectado");
    expect(conta.segredoWebhook).toBeTruthy();
    expect(conferirSegredoPorHash(conta.segredoWebhook, String(linha.segredo_webhook_hash))).toBe(true);
    expect(String(linha.segredo_webhook_hash)).not.toContain(conta.segredoWebhook!);

    const trilha = await trilhaDe(conta.id);
    expect(trilha.map((t) => t.acao)).toEqual(["integracao_conectada"]);
    expect(JSON.stringify(trilha)).not.toContain(token);
  });

  it("referência repetida entre contas vivas vira erro no campo, não 500", async () => {
    const loja = await semearLoja();
    const ref = `inst-${aleatorio(4)}`;
    await emTransacao(ctx, (tx) => conectarPorToken(tx, entradaUazapi(loja.id, "tok-um-1", ref), ctx));
    const erro = await falhaCom(
      emTransacao(ctx, (tx) => conectarPorToken(tx, entradaUazapi(loja.id, "tok-dois-2", ref), ctx)),
      ErroDeValidacao,
    );
    expect(Object.keys(erro.campos)).toEqual(["referencia"]);
  });

  it("loja excluída ou inexistente é recusada", async () => {
    const erro = await falhaCom(
      emTransacao(ctx, (tx) =>
        conectarPorToken(tx, entradaUazapi("7f000000-0000-4000-8000-0000000000ff", "tok-x-9"), ctx),
      ),
      ErroDeValidacao,
    );
    expect(Object.keys(erro.campos)).toEqual(["lojaId"]);
  });
});

describe("tela: só os 4 últimos caracteres", () => {
  it("lista mascarada e credencial ilegível não derruba a lista", async () => {
    const loja = await semearLoja();
    const boa = await semearConta({ provedor: "uazapi", lojaId: loja.id, credencial: { token: "abcdefgh-WXYZ" } });
    const ruim = await semearConta({ provedor: "uazapi", lojaId: loja.id });
    await banco.query("update lojas_integracoes set credenciais_cifradas = 'v1:lixo:lixo:lixo' where id = $1", [ruim.id]);

    const contas = await listarContas({ tipo: "uma", lojaId: loja.id });
    const vistaBoa = contas.find((c) => c.id === boa.id)!;
    expect(vistaBoa.credencial).toEqual({ token: "********WXYZ" });
    expect(JSON.stringify(contas)).not.toContain("abcdefgh");
    expect(contas.find((c) => c.id === ruim.id)!.credencial).toEqual({ erro: "ilegivel" });
  });

  it("conta de outra loja não aparece no detalhe (vira 404 na action)", async () => {
    const [a, b] = [await semearLoja(), await semearLoja()];
    const conta = await semearConta({ provedor: "uazapi", lojaId: a.id });
    expect(await detalheDaConta(conta.id, { tipo: "uma", lojaId: b.id })).toBeNull();
    expect((await detalheDaConta(conta.id, { tipo: "uma", lojaId: a.id }))?.conta.id).toBe(conta.id);
  });
});

describe("desconectar", () => {
  it("apaga a credencial cifrada e o hash, carimba revogada_em e marca excluída", async () => {
    const loja = await semearLoja();
    const conta = await semearConta({ provedor: "uazapi", lojaId: loja.id });
    const { updated_at } = (await linhaDaConta(conta.id)) as { updated_at: Date };

    await emTransacao(ctx, (tx) => desconectarConta(tx, { id: conta.id, updatedAt: updated_at }, ctx));

    const linha = await linhaDaConta(conta.id);
    expect(linha).toMatchObject({
      credenciais_cifradas: null,
      credenciais_aad: null,
      segredo_webhook_hash: null,
      status: "desconectado",
      is_deleted: true,
    });
    expect(linha.revogada_em).toBeInstanceOf(Date);
    expect(linha.deleted_at).toBeInstanceOf(Date);
    expect((await trilhaDe(conta.id)).map((t) => t.acao)).toEqual([
      "integracao_alterada",
      "integracao_desconectada",
    ]);
    // Referência liberada: conectar de novo com o mesmo identificador funciona.
    await emTransacao(ctx, (tx) =>
      conectarPorToken(tx, { ...entradaUazapi(loja.id, "tok-novo-1"), referencia: conta.referencia }, ctx),
    );
  });

  it("updated_at velho não desconecta ninguém (colisão)", async () => {
    const loja = await semearLoja();
    const conta = await semearConta({ provedor: "uazapi", lojaId: loja.id });
    await falhaCom(
      emTransacao(ctx, (tx) => desconectarConta(tx, { id: conta.id, updatedAt: new Date(0) }, ctx)),
      ErroDeColisao,
    );
    expect((await linhaDaConta(conta.id)).is_deleted).toBe(false);
  });
});

describe("editar e estado de sistema", () => {
  it("renomeia e troca a loja com trava; conta de rede nunca ganha loja", async () => {
    const [a, b] = [await semearLoja(), await semearLoja()];
    const conta = await semearConta({ provedor: "instagram", lojaId: a.id });
    const { updated_at } = (await linhaDaConta(conta.id)) as { updated_at: Date };
    await emTransacao(ctx, (tx) =>
      editarConta(tx, { id: conta.id, updatedAt: updated_at, rotulo: "Instagram Cerro", lojaId: b.id }, ctx),
    );
    expect(await linhaDaConta(conta.id)).toMatchObject({ rotulo: "Instagram Cerro", loja_id: b.id });

    const rede = await semearConta({ provedor: "bling", lojaId: null, credencial: { access_token: "x", refresh_token: "y" } });
    const linhaRede = (await linhaDaConta(rede.id)) as { updated_at: Date };
    await emTransacao(ctx, (tx) =>
      editarConta(tx, { id: rede.id, updatedAt: linhaRede.updated_at, rotulo: "Bling", lojaId: a.id }, ctx),
    );
    expect((await linhaDaConta(rede.id)).loja_id).toBeNull();
  });

  it("estado escrito pelo sistema grava trilha com ator 'sistema' e modified_by nulo", async () => {
    const loja = await semearLoja();
    const conta = await semearConta({ provedor: "uazapi", lojaId: loja.id });
    expect(await registrarEstadoDoSistema(conta.id, { status: "erro", ultimoErro: "token recusado" })).toBe(true);
    const linha = await linhaDaConta(conta.id);
    expect(linha).toMatchObject({ status: "erro", ultimo_erro: "token recusado", modified_by: null });
    const [t] = await trilhaDe(conta.id);
    expect(t).toMatchObject({ acao: "integracao_alterada", ator_tipo: "sistema" });
    // Mesmo status: nada muda, nenhuma trilha nova.
    expect(await registrarEstadoDoSistema(conta.id, { status: "erro", ultimoErro: "token recusado" })).toBe(false);
    expect(await trilhaDe(conta.id)).toHaveLength(1);
  });
});

describe("lojas", () => {
  const dados = () => ({
    nome: `Loja ${aleatorio(2)}`,
    slug: `loja-${aleatorio(4)}`,
    sigla: "",
    blingDepositoId: null as string | null,
  });

  async function siglaLivre(): Promise<string> {
    const loja = await semearLoja();
    // Reaproveita o gerador do apoio: a sigla semeada existe; troca a 1ª letra
    // até achar uma livre.
    for (const letra of "QWXYZJKV") {
      const sigla = `${letra}${loja.sigla.slice(1)}`;
      const { rowCount } = await banco.query("select 1 from lojas where sigla = $1 and is_deleted = false", [sigla]);
      if (!rowCount) return sigla;
    }
    throw new Error("sem sigla livre");
  }

  it("cria com trilha; sigla repetida vira erro no campo sigla", async () => {
    const sigla = await siglaLivre();
    const criada = await emTransacao(ctx, (tx) => criarLoja(tx, { ...dados(), sigla }, ctx));
    expect((await trilhaDe(criada.id)).map((t) => t.acao)).toEqual(["loja_criada"]);

    const erro = await falhaCom(
      emTransacao(ctx, (tx) => criarLoja(tx, { ...dados(), sigla }, ctx)),
      ErroDeValidacao,
    );
    expect(Object.keys(erro.campos)).toEqual(["sigla"]);
    expect(erro.valores?.sigla).toBe(sigla);
  });

  it("editar com updated_at velho é colisão", async () => {
    const loja = await semearLoja();
    await falhaCom(
      emTransacao(ctx, (tx) =>
        editarLoja(tx, { ...dados(), sigla: loja.sigla, id: loja.id, updatedAt: new Date(0) }, ctx),
      ),
      ErroDeColisao,
    );
  });

  it("desativar é recusado com vendedora ativa ou conta conectada, e aceito sem elas", async () => {
    const ocupada = await semearLoja();
    await semearUsuario("vendedor", ocupada.id);
    await semearConta({ provedor: "uazapi", lojaId: ocupada.id });
    const { rows } = await banco.query<{ updated_at: Date }>("select updated_at from lojas where id = $1", [ocupada.id]);
    const erro = await falhaCom(
      emTransacao(ctx, (tx) => desativarLoja(tx, { id: ocupada.id, updatedAt: rows[0]!.updated_at }, ctx)),
      ErroDeValidacao,
    );
    expect(erro.campos._).toHaveLength(2);

    const livre = await semearLoja();
    const { rows: r2 } = await banco.query<{ updated_at: Date }>("select updated_at from lojas where id = $1", [livre.id]);
    await emTransacao(ctx, (tx) => desativarLoja(tx, { id: livre.id, updatedAt: r2[0]!.updated_at }, ctx));
    const { rows: depois } = await banco.query<{ is_deleted: boolean }>("select is_deleted from lojas where id = $1", [livre.id]);
    expect(depois[0]!.is_deleted).toBe(true);
    expect((await trilhaDe(livre.id)).map((t) => t.acao)).toEqual(["loja_desativada"]);
  });
});
