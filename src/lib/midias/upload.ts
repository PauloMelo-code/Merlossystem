import "server-only";
import { randomUUID } from "node:crypto";
import type { Contexto } from "@/lib/auth/guard";
import { db } from "@/lib/db/client";
import { emTransacao, inserirAuditado } from "@/lib/db/mutacoes";
import type { PastaMidia } from "@/lib/db/schema/_enums/catalogo";
import { lojas_midias } from "@/lib/db/schema/midias";
import { ErroDoAplicativo, ErroFaltaLoja } from "@/lib/erros";
import {
  chaveDaMiniatura,
  chaveDoObjeto,
  conferirAssinatura,
  conferirDeclarado,
  ErroDeArquivo,
} from "@/lib/armazenamento/limites";
import {
  abrirCorpo,
  gerarMiniatura,
  juntar,
  removerObjeto,
  subirObjeto,
} from "@/lib/armazenamento/midia";
import { midiaPorHash } from "./_consultas";

/**
 * Upload do navegador (03-arquitetura.md §13.1). Quem chama (`POST
 * /api/midias`) já passou por sessão, permissão e loja; aqui a ordem é:
 *
 *   tipo e tamanho DECLARADOS → assinatura dos primeiros bytes → streaming ao
 *   MinIO com teto → reconferência do tamanho real → miniatura (imagem) →
 *   linha em `lojas_midias`.
 *
 * O binário sobe ANTES da transação e sai de novo se a linha não nascer: o
 * MinIO não faz rollback, e objeto sem linha é lixo que ninguém encontra.
 */

export type EntradaUpload = {
  fonte: ReadableStream<Uint8Array>;
  mime: string | null;
  tamanho: string | null;
  nomeOriginal?: string | undefined;
  pasta: PastaMidia;
};

export type ResultadoUpload = { id: string; duplicada: boolean };

function ehHashDuplicado(erro: unknown): boolean {
  const e = erro as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const alvo = e?.cause ?? e;
  return alvo?.code === "23505" && alvo?.constraint === "uq_lojas_midias_hash";
}

export async function receberUpload(entrada: EntradaUpload, ctx: Contexto): Promise<ResultadoUpload> {
  if (ctx.escopo.tipo !== "uma") throw new ErroFaltaLoja();
  const lojaId = ctx.escopo.lojaId;

  const declarado = conferirDeclarado(entrada.mime, entrada.tamanho);
  if ("status" in declarado) throw new ErroDeArquivo(declarado);
  const { formato, tamanho, mime } = declarado;

  // O teto efetivo é o tamanho declarado: passar dele é mentira do cliente.
  const aberto = await abrirCorpo(entrada.fonte, tamanho);
  if (aberto.inicio.byteLength === 0) {
    throw new ErroDeArquivo({ status: 400, motivo: "O arquivo está vazio." });
  }
  const recusa = conferirAssinatura(formato, aberto.inicio);
  if (recusa) {
    await aberto.cancelar();
    throw new ErroDeArquivo(recusa);
  }

  const id = randomUUID();
  const chave = chaveDoObjeto(lojaId, "upload", id, formato.extensao);
  let chaveMiniatura: string | null = null;
  let dimensoes: { largura: number | null; altura: number | null } = { largura: null, altura: null };

  const tamanhoErrado = () =>
    new ErroDeArquivo({ status: 400, motivo: "O arquivo chegou incompleto. Envie de novo." });

  try {
    if (formato.tipo === "imagem") {
      const bytes = await juntar(aberto.corpo);
      if (bytes.byteLength !== tamanho) throw tamanhoErrado();
      const gerada = await gerarMiniatura(bytes).catch(() => {
        throw new ErroDeArquivo({ status: 415, motivo: "A imagem está corrompida ou não pôde ser lida." });
      });
      await subirObjeto(chave, bytes, mime, tamanho);
      chaveMiniatura = chaveDaMiniatura(chave);
      await subirObjeto(chaveMiniatura, gerada.miniatura, "image/webp", gerada.miniatura.byteLength);
      dimensoes = { largura: gerada.largura, altura: gerada.altura };
    } else {
      await subirObjeto(chave, aberto.corpo, mime, tamanho);
      if (aberto.fim().total !== tamanho) throw tamanhoErrado();
    }
  } catch (erro) {
    await aberto.cancelar();
    await removerSilencioso(chave, chaveMiniatura);
    // Corpo menor que o declarado estoura no S3 como erro genérico.
    if (!(erro instanceof ErroDoAplicativo) && aberto.fim().total !== tamanho) throw tamanhoErrado();
    throw erro;
  }

  const { hash } = aberto.fim();

  try {
    await emTransacao(ctx, (tx) =>
      inserirAuditado(
        tx,
        lojas_midias,
        {
          id,
          loja_id: lojaId,
          nome_original: entrada.nomeOriginal ?? null,
          chave_objeto: chave,
          chave_miniatura: chaveMiniatura,
          tipo_arquivo: formato.tipo,
          mime_type: mime,
          tamanho_bytes: tamanho,
          largura: dimensoes.largura,
          altura: dimensoes.altura,
          hash_sha256: hash,
          origem: "upload",
          pasta: entrada.pasta,
          enviada_por: ctx.autorId,
        },
        ctx,
        "midia_enviada",
      ),
    );
    return { id, duplicada: false };
  } catch (erro) {
    await removerSilencioso(chave, chaveMiniatura);
    if (!ehHashDuplicado(erro)) throw erro;
    // O mesmo arquivo já está na galeria desta loja: devolve o que existe.
    const existente = await midiaPorHash(db, lojaId, hash);
    if (!existente) throw erro;
    return { id: existente, duplicada: true };
  }
}

async function removerSilencioso(...chaves: (string | null)[]): Promise<void> {
  await Promise.allSettled(chaves.filter((c): c is string => c !== null).map(removerObjeto));
}
