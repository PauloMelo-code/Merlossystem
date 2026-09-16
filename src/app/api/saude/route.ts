/**
 * Liveness do orquestrador (03-arquitetura.md §5; o HEALTHCHECK do Dockerfile
 * aponta para ca).
 *
 * NAO abre conexao de pool, NAO consulta Redis, NAO responde versao nem
 * topologia — e por isso que ela nem passa pelo limitador, que e Redis. Rota
 * publica que consulta dependencia a cada chamada e amplificacao barata contra
 * o banco; quem quer saber se o sistema esta PRONTO usa /api/pronto, com
 * segredo.
 */

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return new Response("ok", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
