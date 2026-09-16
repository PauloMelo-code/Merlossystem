import { contextoDe, exigirPermissao, exigirSessao, lojaParaGravar } from "@/lib/auth/guard";
import { resolverLojaPedida } from "@/lib/auth/loja";
import { conferirDeclarado, ErroDeArquivo } from "@/lib/armazenamento/limites";
import { ErroDeValidacao } from "@/lib/erros";
import { receberUpload } from "@/lib/midias";
import { conferirOrigem } from "@/lib/seguranca/origem";
import { uploadSchema } from "@/lib/validadores/midias";
import { respostaDeErro } from "./_resposta";

/**
 * `POST /api/midias` — upload autenticado (03-arquitetura.md §13.1,
 * 02-seguranca.md §15).
 *
 * O corpo é o PRÓPRIO arquivo (não multipart): `Content-Type` = tipo,
 * `Content-Length` = tamanho, `?pasta=&loja=&nome=` na URL. Assim o corte
 * pelo tamanho acontece ANTES de ler um byte, e o resto vai em streaming.
 * Não há presigned PUT: o bucket continua privado e fora da internet.
 *
 * Ordem: origem → sessão → permissão → parâmetros → loja → tipo e tamanho
 * declarados → domínio (assinatura, streaming, miniatura, linha).
 */
export async function POST(req: Request): Promise<Response> {
  try {
    // Rota mutante com cookie: a mesma checagem de origem das actions (J1/J7).
    conferirOrigem(req.headers);
    const sessao = await exigirSessao();
    exigirPermissao(sessao, "midia:enviar");

    const url = new URL(req.url);
    const analise = uploadSchema.safeParse({
      pasta: url.searchParams.get("pasta"),
      loja: url.searchParams.get("loja"),
      nome: url.searchParams.get("nome"),
    });
    if (!analise.success) {
      throw new ErroDeValidacao({ pasta: analise.error.issues.map((i) => i.message) });
    }

    // A loja do parâmetro só vale para gestão, e só se existir e estiver viva.
    const pedida = await resolverLojaPedida(sessao, analise.data.loja);
    const lojaId = lojaParaGravar(sessao, pedida);

    const declarado = conferirDeclarado(req.headers.get("content-type"), req.headers.get("content-length"));
    if ("status" in declarado) throw new ErroDeArquivo(declarado);
    if (!req.body) throw new ErroDeArquivo({ status: 400, motivo: "O arquivo está vazio." });

    const resultado = await receberUpload(
      {
        fonte: req.body,
        mime: req.headers.get("content-type"),
        tamanho: req.headers.get("content-length"),
        nomeOriginal: analise.data.nome,
        pasta: analise.data.pasta,
      },
      contextoDe(sessao, lojaId),
    );
    return Response.json(resultado, {
      status: resultado.duplicada ? 200 : 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (erro) {
    return respostaDeErro(erro, "POST /api/midias");
  }
}
