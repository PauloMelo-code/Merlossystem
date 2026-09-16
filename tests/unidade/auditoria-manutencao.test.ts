import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Processador da fila `manutencao` (M8): só traduz a carga para o domínio.
 * O domínio é simulado aqui; o efeito real de cada função está nos testes de
 * integração do módulo dono.
 */

const m = vi.hoisted(() => ({
  removerBinarios: vi.fn(async (ids: readonly string[]) => ids.length),
  limparMidiasExpiradas: vi.fn(async () => 0),
  registrarObjetosRemovidos: vi.fn(async () => undefined),
  fecharConvitesVencidos: vi.fn(async () => 0),
}));

vi.mock("@/lib/midias", () => ({
  removerBinarios: m.removerBinarios,
  limparMidiasExpiradas: m.limparMidiasExpiradas,
}));
vi.mock("@/lib/lgpd/objetos-removidos", () => ({ registrarObjetosRemovidos: m.registrarObjetosRemovidos }));
vi.mock("@/lib/auditoria", () => ({
  anonimizarEventosAntigos: vi.fn(),
  fecharConvitesVencidos: m.fecharConvitesVencidos,
}));
vi.mock("@/lib/alertas", () => ({ gerarAlertas: vi.fn(), reconciliar: vi.fn() }));
vi.mock("@/lib/relatorios", () => ({ resumirDiaAnterior: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { expirarConvites, limparMidia } = await import("@/server/processadores/manutencao");
type JobManutencao = Parameters<typeof limparMidia>[0];
const job = (data: JobManutencao["data"]) => ({ data }) as Pick<Job, "data"> as JobManutencao;

const LOJA = "11111111-1111-4111-8111-111111111111";
const SOLICITACAO = "22222222-2222-4222-8222-222222222222";
const MIDIA = "33333333-3333-4333-8333-333333333333";

beforeEach(() => vi.clearAllMocks());

describe("limpar-midia", () => {
  it("carga da LGPD: remove na hora só ids válidos e registra na solicitação", async () => {
    await limparMidia(job({ lojaId: LOJA, solicitacaoId: SOLICITACAO, midiaIds: [MIDIA, "x';drop"] }));
    expect(m.removerBinarios).toHaveBeenCalledWith([MIDIA]);
    expect(m.registrarObjetosRemovidos).toHaveBeenCalledWith(SOLICITACAO, 1);
    expect(m.limparMidiasExpiradas).not.toHaveBeenCalled();
  });

  it("solicitação inválida: remove, mas não grava em lugar nenhum", async () => {
    await limparMidia(job({ lojaId: LOJA, solicitacaoId: "nao-e-uuid", midiaIds: [MIDIA] }));
    expect(m.removerBinarios).toHaveBeenCalledOnce();
    expect(m.registrarObjetosRemovidos).not.toHaveBeenCalled();
  });

  it("sem lista: varredura dos 90 dias, da loja ou da rede", async () => {
    await limparMidia(job({ lojaId: LOJA }));
    await limparMidia(job({ lojaId: "lixo", midiaIds: [] }));
    expect(m.limparMidiasExpiradas.mock.calls).toEqual([[LOJA], [undefined]]);
    expect(m.removerBinarios).not.toHaveBeenCalled();
  });
});

describe("expirar-convites", () => {
  it("fecha os vencidos pela porta da fundação", async () => {
    await expirarConvites();
    expect(m.fecharConvitesVencidos).toHaveBeenCalledOnce();
  });
});
