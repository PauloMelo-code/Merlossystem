import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { cifrar } from "@/lib/seguranca/cofre";

/**
 * Massa dos testes de integração do atendimento (pacote M1). Cada arquivo cria
 * a PRÓPRIA loja: nada de `truncate`, nada de dado compartilhado entre testes.
 * Não termina em `.test.ts`: o Vitest não o coleta como suíte.
 */

function urlDoBanco(): string {
  const url = process.env.DATABASE_URL_TESTE ?? process.env.DATABASE_URL;
  if (!url || !/\/[^/]*test[^/]*$/.test(new URL(url).pathname)) {
    throw new Error("Os testes de conversas só rodam em banco cujo nome contém \"test\".");
  }
  return url;
}

export const banco = new Pool({ connectionString: urlDoBanco(), max: 4 });

const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const siglaAleatoria = () =>
  Array.from({ length: 3 }, () => LETRAS[Math.floor(Math.random() * LETRAS.length)]).join("");

/** A sigla é única na rede: sorteia de novo quando colide. */
export async function criarLoja(): Promise<string> {
  for (let tentativa = 0; tentativa < 20; tentativa += 1) {
    const id = randomUUID();
    const sufixo = id.slice(0, 8);
    try {
      await banco.query("insert into lojas (id, nome, slug, sigla) values ($1, $2, $3, $4)", [
        id,
        `Loja ${sufixo}`,
        `loja-${sufixo}`,
        siglaAleatoria(),
      ]);
      return id;
    } catch (erro) {
      if ((erro as { code?: string }).code !== "23505") throw erro;
    }
  }
  throw new Error("não foi possível sortear uma sigla livre");
}

export async function criarConta(
  lojaId: string,
  opcoes: {
    provedor?: "whatsapp_oficial" | "uazapi" | "instagram";
    referencia?: string;
    status?: string;
    credenciais?: Record<string, string>;
  } = {},
): Promise<{ id: string; referencia: string }> {
  const id = randomUUID();
  const provedor = opcoes.provedor ?? "whatsapp_oficial";
  const referencia = opcoes.referencia ?? `ref-${id.slice(0, 8)}`;
  const credenciais = opcoes.credenciais ?? (provedor === "uazapi" ? { token: "tk-teste" } : { access_token: "tk-teste" });
  await banco.query(
    `insert into lojas_integracoes
       (id, loja_id, provedor, rotulo, status, referencia_externa, credenciais_cifradas, credenciais_aad)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      lojaId,
      provedor,
      `Vendas ${id.slice(0, 4)}`,
      opcoes.status ?? "conectado",
      referencia,
      cifrar(JSON.stringify(credenciais), id),
      id,
    ],
  );
  return { id, referencia };
}

export async function criarContatoDeCrm(lojaId: string, telefone: string, nome = "Cliente do CRM"): Promise<string> {
  const { rows } = await banco.query<{ id: string }>(
    `insert into contatos (loja_id, nome, telefone) values ($1, $2, $3) returning id`,
    [lojaId, nome, telefone],
  );
  return rows[0]!.id;
}

export async function gravarEvento(provedor: string, conta: { id: string }, lojaId: string, corpo: unknown): Promise<string> {
  const { rows } = await banco.query<{ id: string }>(
    `insert into lojas_integracoes_eventos
       (provedor, integracao_id, loja_id, tipo, evento_externo_id, assinatura_ok, corpo)
     values ($1, $2, $3, 'recebido', $4, true, $5::jsonb) returning id`,
    [provedor, conta.id, lojaId, randomUUID(), JSON.stringify(corpo)],
  );
  return rows[0]!.id;
}

export function payloadWhatsapp(
  phoneNumberId: string,
  m: { id: string; from: string; texto?: string; nome?: string; timestamp?: number },
) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: phoneNumberId },
              contacts: [{ wa_id: m.from, profile: { name: m.nome ?? "Maria Teste" } }],
              messages: [
                {
                  id: m.id,
                  from: m.from,
                  timestamp: String(m.timestamp ?? Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: m.texto ?? "Oi, tem o vestido no P?" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function payloadStatus(phoneNumberId: string, id: string, status: string, erro?: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberId },
              statuses: [
                {
                  id,
                  status,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  ...(erro ? { errors: [{ code: 131047, title: erro }] } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export async function criarUsuarioComSessao(
  lojaId: string | null,
  papel: "dono" | "admin" | "gerente" | "vendedor" | "viewer" = "vendedor",
): Promise<{ usuarioId: string; sessaoId: string }> {
  const usuarioId = randomUUID();
  const sessaoId = randomUUID();
  await banco.query(
    `insert into usuarios (id, nome, email, email_verificado, papel, loja_id, ativo,
       precisa_trocar_senha, precisa_configurar_fator)
     values ($1, 'Vendedora Teste', $2, true, $3, $4, true, false, false)`,
    [usuarioId, `m1-${usuarioId.slice(0, 8)}@teste.invalid`, papel, papel === "vendedor" || papel === "viewer" ? lojaId : null],
  );
  await banco.query(
    `insert into usuarios_sessoes (id, token, usuario_id, expira_em, ultimo_uso_em)
     values ($1, $2, $3, now() + interval '1 hour', now())`,
    [sessaoId, `tk-${sessaoId}`, usuarioId],
  );
  return { usuarioId, sessaoId };
}

export async function fecharBanco(): Promise<void> {
  await banco.end().catch(() => undefined);
}
