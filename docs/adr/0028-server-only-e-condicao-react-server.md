# ADR 0028 — `server-only` fica; fora do Next, o processo liga `--conditions=react-server`

Data: 16/09/2026
Status: Aceito

## Contexto

`03-arquitetura.md` manda `import "server-only"` no topo de `db/client.ts`,
`auth/*`, `seguranca/*`, `rede/*` e `armazenamento/*`. E a barreira que impede
um componente cliente de importar o pool do banco ou o cofre.

O pacote `server-only` LANCA no import quando a condicao de exportacao
`react-server` nao esta ligada. O Next liga sozinho; Node puro, `tsx` e Vitest
nao. O worker (BullMQ) alcanca `db/client.ts`, e os testes de efeito alcancam
`auth/**`.

## Decisao

A marca `server-only` permanece em todo modulo de servidor. Cada runtime fora
do Next resolve a condicao de um jeito unico e escrito:

| Runtime | Como |
|---|---|
| Worker em dev | `tsx watch --conditions=react-server src/server/worker.ts` (`npm run worker`) |
| Worker na imagem | `node --conditions=react-server dist/worker.mjs` (bundle esbuild com `server-only` externo, ADR 0023) |
| Vitest | alias de `server-only` para o `empty.js` que o proprio pacote publica sob `react-server` (`config/vitest.config.ts`) |
| Scripts (`primeiro-dono`, `seed-dev`) | nao importam modulo `server-only`: usam `pg` e `env` diretamente |

## Alternativas consideradas

- **Remover `server-only`**: some a barreira de build contra vazamento de
  codigo de servidor para o cliente. Rejeitada.
- **Trocar por comentario ou regra de lint**: nao falha no build do Next.
  Rejeitada.

## Consequencias

- Processo Node novo que alcance `src/lib/**` precisa da condicao; sem ela, nao
  sobe — falha alta e imediata, nunca silenciosa.
- Script que precise de modulo `server-only` roda com
  `tsx --conditions=react-server`, e isso fica escrito no `package.json`.
