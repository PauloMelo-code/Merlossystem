import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import sharp from "sharp";
import type { Sessao } from "@/lib/auth/guard";
import type { Papel } from "@/lib/db/schema/_enums/auth";

/**
 * Massa dos testes de mídia (pacote M3). Não termina em `.test.ts`: o Vitest
 * não o coleta. Cada arquivo cria lojas NOVAS com slug e sigla aleatórios, então
 * não há `truncate` nem colisão entre execuções — o banco `_m3` é recriado por
 * `scripts/db-teste.mjs --sufixo m3`.
 */

const url = process.env.DATABASE_URL_TESTE;
if (!url || !/test/.test(new URL(url).pathname)) {
  throw new Error("DATABASE_URL_TESTE ausente ou sem 'test' no nome do banco.");
}

/** Conexão de DONO: só prepara massa. O código testado usa o próprio pool. */
export const banco = new Pool({ connectionString: url, max: 3 });

export const ORIGEM = "http://localhost:3005";

function sigla(): string {
  return Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
}

export async function criarLoja(): Promise<string> {
  for (let tentativa = 0; tentativa < 20; tentativa += 1) {
    try {
      const { rows } = await banco.query<{ id: string }>(
        `insert into lojas (nome, slug, sigla) values ($1, $2, $3) returning id`,
        ["Loja de teste", `teste-${randomUUID()}`, sigla()],
      );
      return rows[0]!.id;
    } catch (erro) {
      if ((erro as { constraint?: string }).constraint !== "uq_lojas_sigla") throw erro;
    }
  }
  throw new Error("sem sigla livre para a loja de teste");
}

export async function criarPessoa(papel: Papel, lojaId: string | null): Promise<Sessao> {
  const { rows } = await banco.query<{ id: string }>(
    `insert into usuarios (nome, email, email_verificado, papel, loja_id, ativo)
     values ('Pessoa de Teste', $1, true, $2, $3, true) returning id`,
    [`m3-${randomUUID()}@exemplo.invalido`, papel, lojaId],
  );
  return {
    usuarioId: rows[0]!.id,
    sessaoId: randomUUID(),
    papel,
    lojaId,
    ativo: true,
    precisaTrocarSenha: false,
    precisaConfigurarFator: false,
  };
}

/** Contato → integração → conversa → mensagem → anexo. Devolve o id do anexo. */
export async function criarAnexo(
  lojaId: string,
  origem: { midiaId: string } | { url: string },
): Promise<string> {
  const contato = await banco.query<{ id: string }>(
    `insert into contatos (loja_id, nome) values ($1, 'Cliente de teste') returning id`,
    [lojaId],
  );
  const integracao = await banco.query<{ id: string }>(
    `insert into lojas_integracoes (loja_id, provedor, rotulo) values ($1, 'uazapi', 'Número de teste') returning id`,
    [lojaId],
  );
  const conversa = await banco.query<{ id: string }>(
    `insert into conversas (loja_id, contato_id, integracao_id) values ($1, $2, $3) returning id`,
    [lojaId, contato.rows[0]!.id, integracao.rows[0]!.id],
  );
  const mensagem = await banco.query<{ id: string }>(
    `insert into conversas_mensagens (loja_id, conversa_id, direcao, autor_tipo, tipo_conteudo, ocorrida_em)
     values ($1, $2, 'entrada', 'contato', 'imagem', now()) returning id`,
    [lojaId, conversa.rows[0]!.id],
  );
  const anexo = await banco.query<{ id: string }>(
    `insert into conversas_mensagens_midias (loja_id, mensagem_id, midia_id, url_externa, tipo_arquivo, mime_type)
     values ($1, $2, $3, $4, 'imagem', 'image/png') returning id`,
    [
      lojaId,
      mensagem.rows[0]!.id,
      "midiaId" in origem ? origem.midiaId : null,
      "url" in origem ? origem.url : null,
    ],
  );
  return anexo.rows[0]!.id;
}

export async function criarEtiqueta(lojaId: string, nome: string): Promise<string> {
  const { rows } = await banco.query<{ id: string }>(
    `insert into lojas_etiquetas (loja_id, nome, slug) values ($1, $2, $3) returning id`,
    [lojaId, nome, `${nome.toLowerCase()}-${randomUUID()}`],
  );
  return rows[0]!.id;
}

export async function png(largura = 40, altura = 30, cor = "#c0392b"): Promise<Buffer> {
  return sharp({ create: { width: largura, height: altura, channels: 3, background: cor } })
    .png()
    .toBuffer();
}

export async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: "#2980b9" } })
    .jpeg()
    .toBuffer();
}

export async function linhaDaMidia(id: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await banco.query("select * from lojas_midias where id = $1", [id]);
  return rows[0];
}

export function pedidoDeUpload(
  corpo: Uint8Array | string,
  tipo: string,
  consulta = "pasta=produtos",
  extras: { tamanho?: number; origem?: string | null } = {},
): Request {
  const bytes = typeof corpo === "string" ? Buffer.from(corpo) : Buffer.from(corpo);
  const cabecalhos = new Headers({
    "content-type": tipo,
    "content-length": String(extras.tamanho ?? bytes.byteLength),
  });
  if (extras.origem !== null) cabecalhos.set("origin", extras.origem ?? ORIGEM);
  return new Request(`${ORIGEM}/api/midias?${consulta}`, {
    method: "POST",
    headers: cabecalhos,
    body: bytes,
    duplex: "half",
  } as RequestInit);
}

export function pedidoDeLeitura(id: string, consulta = "", cabecalhos: Record<string, string> = {}): Request {
  return new Request(`${ORIGEM}/api/midias/${id}${consulta}`, { headers: cabecalhos });
}

export const parametros = (id: string) => ({ params: Promise.resolve({ id }) });
