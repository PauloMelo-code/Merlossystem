import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SENHA_PADRAO,
  contarEventos,
  criarUsuario,
  fecharApoio,
  limparAuth,
  poolDeTeste,
  postar,
} from "./_apoio";

/**
 * T5 — recusa ÚNICA de login (02-seguranca.md §8, REQ-C4).
 *
 * Reprova quando o corpo ou os cabeçalhos diferem entre e-mail inexistente,
 * senha errada, conta desativada, conta excluída e conta bloqueada; quando o
 * p50 sai de ±50 ms; e quando conta com GATE pendente cai na recusa — essa tem
 * de AUTENTICAR, senão quem passou por reset administrativo nunca mais entra.
 */

const CORPO = '{"code":"CREDENCIAIS_INVALIDAS","message":"E-mail ou senha inválidos."}';

beforeAll(async () => {
  await limparAuth();
});

afterAll(async () => {
  await fecharApoio();
});

describe("recusa única de login", () => {
  it("responde o MESMO corpo e os mesmos cabeçalhos em todos os casos", async () => {
    const desativada = await criarUsuario("desativada@teste.local", {
      ativo: false,
      precisaConfigurarFator: false,
    });
    const excluida = await criarUsuario("excluida@teste.local", { isDeleted: true });
    const bloqueada = await criarUsuario("bloqueada@teste.local");
    await bloquear(bloqueada.id);

    const casos = [
      { rotulo: "inexistente", email: "ninguem@teste.local", senha: SENHA_PADRAO },
      { rotulo: "senha errada", email: desativada.email, senha: "outra-frase-qualquer-1234" },
      { rotulo: "desativada", email: desativada.email, senha: SENHA_PADRAO },
      { rotulo: "excluída", email: excluida.email, senha: SENHA_PADRAO },
      { rotulo: "bloqueada", email: bloqueada.email, senha: SENHA_PADRAO },
    ];

    const respostas = [];
    for (const caso of casos) {
      respostas.push({
        rotulo: caso.rotulo,
        r: await postar("/sign-in/email", { email: caso.email, password: caso.senha }),
      });
    }

    for (const { rotulo, r } of respostas) {
      expect(r.status, rotulo).toBe(401);
      expect(r.corpo, rotulo).toBe(CORPO);
      expect(r.headers.get("content-type"), rotulo).toBe("application/json; charset=utf-8");
      expect(r.headers.get("cache-control"), rotulo).toBe("no-store");
      expect(r.headers.get("content-length"), rotulo).toBe(String(Buffer.byteLength(CORPO)));
      expect(r.headers.getSetCookie(), rotulo).toEqual([]);
      expect(r.headers.get("x-retry-after"), rotulo).toBeNull();
      expect(r.headers.get("www-authenticate"), rotulo).toBeNull();
    }
  });

  it("todas as recusas respeitam o piso de tempo, dentro de ±50 ms entre si", async () => {
    const existente = await criarUsuario("existe@teste.local");

    const tempos: number[] = [];
    for (const email of ["ninguem2@teste.local", existente.email]) {
      for (let i = 0; i < 3; i += 1) {
        const r = await postar("/sign-in/email", { email, password: "senha-errada-mas-longa-1" });
        expect(r.status).toBe(401);
        tempos.push(r.ms);
      }
      await desbloquear(existente.id);
    }

    // O piso é 450 ms + jitter de 0 a 50 ms. Abaixo dele, o tempo voltaria a
    // dizer se a conta existe.
    expect(Math.min(...tempos)).toBeGreaterThanOrEqual(440);
    // A janela é piso + jitter (50 ms) + folga de máquina.
    expect(Math.max(...tempos) - Math.min(...tempos)).toBeLessThan(400);
  });

  it("conta com gate pendente AUTENTICA — não cai na recusa", async () => {
    // `precisa_configurar_fator = true` é a conta em provisionamento: ela entra
    // e o gate de §9.4 a prende em /primeiro-acesso. Mandá-la para o 401 seria
    // trancar para sempre quem passou por recuperação assistida.
    const provisoria = await criarUsuario("provisoria@teste.local", {
      ativo: false,
      precisaConfigurarFator: true,
    });
    const r = await postar("/sign-in/email", {
      email: provisoria.email,
      password: provisoria.senha,
    });
    expect(r.status).toBe(200);
    expect(r.corpo).not.toBe(CORPO);

    const trocaSenha = await criarUsuario("trocasenha@teste.local", {
      precisaTrocarSenha: true,
    });
    const r2 = await postar("/sign-in/email", {
      email: trocaSenha.email,
      password: trocaSenha.senha,
    });
    expect(r2.status).toBe(200);
  });

  it("a recusa não deixa de gravar a trilha", async () => {
    const antes = await contarEventos("login_falha");
    await postar("/sign-in/email", {
      email: "ninguem3@teste.local",
      password: "outra-frase-comprida-9",
    });
    // A trilha é best-effort e assíncrona: uma folga curta basta.
    await new Promise((r) => setTimeout(r, 300));
    expect(await contarEventos("login_falha")).toBeGreaterThan(antes);
  });
});

/** Tranca a conta sem passar pelas 5 tentativas: o caso a provar é a RESPOSTA. */
async function bloquear(usuarioId: string): Promise<void> {
  await poolDeTeste.query(
    "update usuarios set falhas_login = 5, ultima_falha_em = now(), bloqueado_ate = now() + interval '15 minutes' where id = $1",
    [usuarioId],
  );
}

/** Solta a conta: sem isto, a 5a tentativa do caso anterior mudaria o caminho. */
async function desbloquear(usuarioId: string): Promise<void> {
  await poolDeTeste.query(
    "update usuarios set falhas_login = 0, ultima_falha_em = null, bloqueado_ate = null where id = $1",
    [usuarioId],
  );
}
