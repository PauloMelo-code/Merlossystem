import "server-only";
import { randomUUID } from "node:crypto";
import {
  atualizarEstado,
  contextoDeSistema,
  emTransacao,
  inserirAuditado,
  type ContextoDeGravacao,
  type Transacao,
} from "@/lib/db/mutacoes";
import { conversas_mensagens_midias } from "@/lib/db/schema/conversas/mensagens-midias";
import { lojas_midias } from "@/lib/db/schema/midias";
import { ErroDeIntegracao } from "@/lib/erros";
import { enfileirar } from "@/lib/fila/filas";
import { jobId } from "@/lib/fila/idempotencia";
import { buscarExterno, type Provedor } from "@/lib/rede/buscarExterno";
import {
  chaveDaMiniatura,
  chaveDoObjeto,
  detectarMime,
  ErroDeArquivo,
  FORMATOS,
  TETOS,
} from "@/lib/armazenamento/limites";
import { gerarMiniatura, hashDe, lerBytes, subirObjeto } from "@/lib/armazenamento/midia";
import { anexoParaBaixar, chavesDaMidia, midiaPorHash } from "./_consultas";

/**
 * COSTURA — dono: M3, consumida por M1 (05-plano-construcao.md §5).
 *
 * Entrada de mídia que veio de fora (anexo de mensagem recebida):
 *
 *   `bytes` — `guardarMidiaRecebida`: confere a assinatura, sobe ao MinIO e
 *             grava `lojas_midias` (origem `recebida`) na transação de quem
 *             chamou. Imagem ganha miniatura pelo job `gerar-miniatura`, fora
 *             da transação.
 *   `url`   — o anexo (`conversas_mensagens_midias`) nasce com `url_externa` e
 *             `midia_id` nulo, gravado por M1, que então chama
 *             `agendarDownload`. O job `baixar-de-url` busca SEMPRE por
 *             `rede/buscarExterno.ts`, grava a mídia e, no mesmo UPDATE do
 *             anexo, preenche `midia_id`, marca `baixada` e LIMPA `url_externa`
 *             (01-dados-dominio.md §2.4). `url_externa` nunca entra em DTO.
 *
 * O binário sobe dentro do tempo da transação de quem chama, mas não dentro
 * dela: se a transação cair, sobra um objeto sem linha (lixo inofensivo num
 * bucket privado) — nunca uma linha apontando para objeto inexistente.
 */

export type MidiaRecebida = {
  lojaId: string;
  /** Provedor que entregou (`whatsapp_oficial`, `uazapi`, `instagram`). */
  origem: string;
  bytes?: Buffer;
  url?: string;
  tipoMime?: string;
  nomeOriginal?: string;
};

/** Provedor de canal → allowlist de host da busca externa. */
export function provedorDeBusca(origem: string): Provedor {
  if (origem === "uazapi") return "uazapi";
  if (origem === "whatsapp_oficial" || origem === "instagram") return "meta";
  throw new ErroDeIntegracao(`Provedor de mídia desconhecido: ${origem}.`, true);
}

type EntradaBytes = {
  lojaId: string;
  bytes: Buffer;
  tipoMime?: string | null | undefined;
  nomeOriginal?: string | undefined;
};

async function gravarBytes(
  tx: Transacao,
  entrada: EntradaBytes,
  ctx: ContextoDeGravacao,
): Promise<{ midiaId: string; imagem: boolean }> {
  if (entrada.bytes.byteLength === 0) throw new ErroDeArquivo({ status: 400, motivo: "Mídia vazia." });
  const mime = detectarMime(entrada.bytes, entrada.tipoMime);
  const formato = mime ? FORMATOS[mime] : undefined;
  if (!mime || !formato) {
    throw new ErroDeArquivo({ status: 415, motivo: "Tipo de mídia recebida não aceito." });
  }
  if (entrada.bytes.byteLength > TETOS[formato.tipo]) {
    throw new ErroDeArquivo({ status: 413, motivo: "Mídia recebida acima do limite." });
  }

  const hash = hashDe(entrada.bytes);
  const existente = await midiaPorHash(tx, entrada.lojaId, hash);
  if (existente) return { midiaId: existente, imagem: false };

  const id = randomUUID();
  const imagem = formato.tipo === "imagem";
  const chave = chaveDoObjeto(entrada.lojaId, "recebida", id, formato.extensao);
  await subirObjeto(chave, entrada.bytes, mime, entrada.bytes.byteLength);

  await inserirAuditado(
    tx,
    lojas_midias,
    {
      id,
      loja_id: entrada.lojaId,
      nome_original: entrada.nomeOriginal ?? null,
      chave_objeto: chave,
      // Chave determinística: o job escreve o objeto nela, e a rota de
      // leitura cai no original enquanto ele não existe.
      chave_miniatura: imagem ? chaveDaMiniatura(chave) : null,
      tipo_arquivo: formato.tipo,
      mime_type: mime,
      tamanho_bytes: entrada.bytes.byteLength,
      hash_sha256: hash,
      origem: "recebida",
      pasta: null,
      enviada_por: null,
    },
    ctx,
    "midia_recebida",
  );
  return { midiaId: id, imagem };
}

async function agendarMiniatura(lojaId: string, midiaId: string): Promise<void> {
  await enfileirar("midia", "gerar-miniatura", { lojaId, midiaId }, { jobId: jobId("miniatura", midiaId) });
}

export async function guardarMidiaRecebida(
  tx: Transacao,
  midia: MidiaRecebida,
  ctx: ContextoDeGravacao,
): Promise<{ midiaId: string }> {
  if (!midia.bytes) {
    // URL não vira linha de `lojas_midias` antes do download (tamanho e tipo
    // reais são desconhecidos): o anexo guarda a URL e `agendarDownload` busca.
    throw new ErroDeIntegracao(
      "guardarMidiaRecebida recebe bytes; para URL grave o anexo com url_externa e chame agendarDownload.",
      true,
    );
  }
  const { midiaId, imagem } = await gravarBytes(
    tx,
    { lojaId: midia.lojaId, bytes: midia.bytes, tipoMime: midia.tipoMime, nomeOriginal: midia.nomeOriginal },
    ctx,
  );
  if (imagem) await agendarMiniatura(midia.lojaId, midiaId);
  return { midiaId };
}

export type DadosDownload = {
  lojaId: string;
  /** `conversas_mensagens_midias.id` — nunca a URL (ela fica no banco, não no Redis). */
  anexoId: string;
  /** Provedor do canal: decide a allowlist de host. */
  provedor: string;
};

/** Enfileira o download do anexo. `jobId` determinístico: dois pedidos, um job. */
export async function agendarDownload(dados: DadosDownload): Promise<string | null> {
  return enfileirar("midia", "baixar-de-url", dados, { jobId: jobId("download", dados.anexoId) });
}

/**
 * O trabalho do job `baixar-de-url`. Idempotente: anexo já baixado é sucesso.
 * Recusa da busca externa (SSRF, host fora da allowlist, teto) é PERMANENTE.
 */
export async function baixarAnexo(dados: DadosDownload): Promise<"baixada" | "ja-baixada"> {
  const anexo = await anexoParaBaixar(dados.lojaId, dados.anexoId);
  // A transação de M1 pode ainda não ter feito commit: transitório, retenta.
  if (!anexo) throw new ErroDeIntegracao("Anexo ainda não visível.", false);
  if (anexo.baixada || !anexo.urlExterna) return "ja-baixada";

  const resposta = await buscarExterno(anexo.urlExterna, {
    provedor: provedorDeBusca(dados.provedor),
    maxBytes: TETOS.documento,
  });
  if (resposta.status >= 400) {
    // 4xx do provedor (link expirado) não melhora na quinta tentativa.
    throw new ErroDeIntegracao(`Provedor respondeu ${resposta.status}.`, resposta.status < 500);
  }

  const ctx = contextoDeSistema({ origem: "worker", lojaId: dados.lojaId });
  const gravada = await emTransacao(ctx, async (tx) => {
    const nova = await gravarBytes(
      tx,
      { lojaId: dados.lojaId, bytes: resposta.bytes, tipoMime: resposta.tipo ?? anexo.mimeType },
      ctx,
    ).catch((erro: unknown) => {
      if (erro instanceof ErroDeArquivo) throw new ErroDeIntegracao(erro.message, true);
      throw erro;
    });
    // Mesmo UPDATE: `midia_id` satisfaz o CHECK de origem quando `url_externa` some.
    await atualizarEstado(
      tx,
      conversas_mensagens_midias,
      { id: anexo.id, escopo: ctx.escopo },
      { midia_id: nova.midiaId, baixada: true, url_externa: null },
    );
    return nova;
  });
  if (gravada.imagem) await agendarMiniatura(dados.lojaId, gravada.midiaId);
  return "baixada";
}

/**
 * O trabalho do job `gerar-miniatura`. Objeto ausente é SUCESSO: a mídia pode
 * ter sido anonimizada no meio. Reescrever a miniatura é idempotente.
 */
export async function gerarMiniaturaDaMidia(dados: {
  lojaId: string;
  midiaId: string;
}): Promise<"gerada" | "sem-miniatura" | "objeto-ausente"> {
  const midia = await chavesDaMidia(dados.lojaId, dados.midiaId);
  if (!midia) throw new ErroDeIntegracao("Mídia ainda não visível.", false);
  if (midia.tipoArquivo !== "imagem" || !midia.chaveMiniatura) return "sem-miniatura";

  const bytes = await lerBytes(midia.chaveObjeto);
  if (!bytes) return "objeto-ausente";
  const gerada = await gerarMiniatura(bytes).catch(() => {
    throw new ErroDeIntegracao("Imagem ilegível para miniatura.", true);
  });
  await subirObjeto(midia.chaveMiniatura, gerada.miniatura, "image/webp", gerada.miniatura.byteLength);
  return "gerada";
}
