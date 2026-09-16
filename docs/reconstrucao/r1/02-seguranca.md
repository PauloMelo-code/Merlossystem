# 02 — Segurança (FINAL): autenticação, autorização, borda e trilha

- **Alvo**: MerlostoreChat v2 — Next 16.3.5 (App Router, `src/proxy.ts`), React 19.3, TypeScript strict, Better Auth 1.7.5 endurecido, Drizzle 0.45.2, PostgreSQL 16 (5437), Redis (6382), MinIO (9002/9003), app na 3005.
- **Status**: este documento **substitui** `spec/rascunho/02-seguranca.md`. Ele é dono da **política** (papéis, matriz, sessão, 2º fator, bloqueio, recusa, borda, trilha, segredos). O **modelo de dados** (`spec/final/01-dados.md` + `01-dados-dominio.md`) é dono de **nome de tabela, coluna, enum, papel e helper**: onde este documento cita um nome, ele é cópia de lá, nunca uma segunda definição.
- **Regra de leitura**: **não existe "a definir" aqui.** Toda pergunta aberta do rascunho foi fechada (§22 lista o que ainda depende de terceiro, com data e plano B). O agente construtor implementa o que está escrito; reabrir exige achado novo **e** ADR.
- IDs `REQ-A1..M6` são do catálogo da skill `/audit-auth-security`; `G1..G28`/`N1..N5` são as armadilhas confirmadas no pacote publicado do Better Auth e do Next (levantamento `07-skill-seguranca.md`); `INV-xx`, `D-xx`, `DN-xx` vêm de `06-travas-e-decisoes.md`.
- Toda exceção a uma regra da casa vai no código como `// EXCECAO-SEG: REQ-X | motivo | decidido por | ate AAAA-MM-DD` **e** num ADR (REQ-M6). A trava T24 reprova exceção sem as 4 partes ou com data vencida.

---

## 1. Decisões deste desenho

| # | Decisão | Motivo |
|---|---|---|
| S-01 | **Better Auth 1.7.5 endurecido** (não auth própria) | padrão da casa (HUG); passkey/TOTP/sessão em banco prontos. As 28 armadilhas são tratáveis por configuração + Route Handler próprio. Auth própria custaria reimplementar WebAuthn e KDF sem ganhar um REQ sequer |
| S-02 | **Sem plugin `admin` do BA** (G24) | `adminUserIds` é bypass total, `set-user-password` não revoga sessão, `remove-user` apaga fisicamente, impersonação instalada, +15 rotas. Papel/loja/`ativo` são colunas nossas |
| S-03 | **5 papéis: `dono`, `admin`, `gerente`, `vendedor`, `viewer`** | decisão fechada em `01-dados.md §11 item 1` e §16.2. Sem `dono`, quem promove `admin` é o próprio `admin` — auto-escalonamento (REQ-H1) |
| S-04 | **Sessão: teto absoluto 12 h sem renovação + inatividade 60 min** | turno de loja; 12 h ≤ 24 h da régua (F2). `disableSessionRefresh: true` é o único teto absoluto real no BA |
| S-05 | **Senha de 15 a 128 caracteres, Argon2id** | no instante em que a senha é conferida ela é **fator único**. 15 = frase curta ("vendas cerro azul"), sem exigir símbolo |
| S-06 | **2º fator obrigatório desde o provisionamento**: passkey (UV exigido) ou TOTP | D1/D2. Não há 2FA obrigatório nativo → o gate é nosso (`precisa_configurar_fator`) |
| S-07 | **Sem OTP por e-mail, sem SMS, sem códigos de resgate, sem "lembrar dispositivo"** | G2, G4, G7. Perda de fator = recuperação assistida por admin (E7) |
| S-08 | **Provisionamento por convite**; admin **nunca** escolhe a senha definitiva | regra da casa; corrige D-14 |
| S-09 | **Delete físico de linha de auth só existe dentro da biblioteca** (sessão, verificação, fator, passkey), com exceção escrita (ADR 0008) | não há soft delete nativo e embrulhar o adapter quebra a cada minor. **Nós não escrevemos nenhum `DELETE`**: não existe job `limpeza-auth` (§10) |
| S-10 | **Um salto de proxy confiável** (Traefik do EasyPanel) na resolução de IP | topologia é cliente → Traefik → app. Cadeia inesperada cai para o socket e alerta |
| S-11 | **Sem webhook de pagamento na v2** | provedor não escolhido; `pagamentos` nasce sem escrita (`01-dados-dominio.md §6.5`). Rota que não existe não tem superfície |
| S-12 | **LGPD por anonimização**, nunca delete físico de linha | ADR 0013; preserva pedido fiscal e trilha; corrige D-03 |
| S-13 | **CSP em enforce desde a entrega 1**, com política mínima segura; `Report-Only` só para **endurecer** (`strict-dynamic`) | entregar sem CSP é entregar XSS com exfiltração livre. O que não se sabe medir entra em Report-Only **em paralelo**, não no lugar |
| S-14 | **Crons viram jobs BullMQ**; nenhuma rota `/api/cron/*` | some a superfície pública inteira (I12) |
| S-15 | **`viewer` não exporta dossiê LGPD nem lê trilha** | corrige D-17 |
| S-16 | **Facebook e TikTok fora do R1: sem rota, sem adaptador, sem segredo no ambiente** | `01-dados.md §11 item 7`. O valor fica no CHECK de `provedor` (custo zero) |
| S-17 | **Ação administrativa só alcança papel estritamente inferior ao do ator** | sem isso, `admin` reseta, desativa e troca o e-mail de outro `admin` e do `dono` — negação de serviço e degrau para tomada de conta |
| S-18 | **Nenhuma opção de segurança do BA entra sem prova de efeito** | `auth.options` devolve o que você escreveu: opção com nome errado passa no teste e não faz nada. §4.4 |

---

## 2. Identidade, papéis e escopo de loja

### 2.1 Papéis (5 — `01-dados.md §16.2`)

| Papel | `loja_id` | O que é |
|---|---|---|
| `dono` | `NULL` | privilégio máximo nomeado. Só ele concede/retira `admin` e transfere a posse. 1 ou 2 pessoas da Merlo |
| `admin` | `NULL` | administração operacional: configuração, integrações, lojas, convites de `gerente`/`vendedor`/`viewer` |
| `gerente` | `NULL` | operação nas duas lojas, **menos** configuração, integrações e usuários (DN-07); exclui; LGPD; lê a trilha de negócio |
| `vendedor` | obrigatória | atende e vende na loja do cadastro; não exclui (exceção: `agendamentos:cancelar`, INV-20) |
| `viewer` | obrigatória | leitura da própria loja |

O `CHECK usuarios_papel_loja` está em `01-dados.md §5.1` (5 papéis) e o `CHECK convites_papel` em §5.7 (**4 papéis — `dono` não é convidável**). Este documento **não** redigita CHECK: a barreira é do banco.

Default da coluna `papel` é `'viewer'` (menor privilégio, REQ-H1). `ativo` nasce `false`. Papel desconhecido = **nenhuma** permissão — nunca cair para o mais baixo (o contraexemplo é `hug/src/lib/auth/guard.ts:97-101`).

**Ordem de privilégio** (constante `PAPEIS` em `_enums/auth.ts`, na ordem de §16.2): `dono > admin > gerente > vendedor > viewer`. `ehPrivilegioMaximo(papel)` é `papel === "dono"`, por comparação literal, **nunca** via `pode()`.

### 2.2 Matriz de permissão (`recurso:acao`, negação por padrão — REQ-H5)

Tabela literal em **`src/lib/auth/permissoes/`** (pasta por família + `index.ts` de reexport; arquivo único estouraria 499 linhas). `pode(papel, recurso, acao)` é **puro** — sem I/O, sem trilha — e devolve `false` para qualquer par sem entrada. Célula vazia = negado.

| Recurso : ação | dono | admin | gerente | vendedor | viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| `conversas:ler` · `contatos:ler` · `pedidos:ler` · `produtos:ler` · `campanhas:ler` · `modelos:ler` · `respostas:ler` · `agendamentos:ler` · `alertas:ler` · `midia:ler` · `etiquetas:ler` · `lojas:ler` · `relatorios:ler` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `usuarios:listar_colegas` (id, nome, papel, loja — **sem e-mail**) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `conversas:escrever` (enviar, nota interna) · `conversas:gerir` (transferir, resolver, reabrir, arquivar, prioridade, etiquetar) | ✅ | ✅ | ✅ | ✅ | |
| `contatos:criar` · `contatos:editar` · `contatos:optout` · `midia:enviar` · `alertas:reconhecer` | ✅ | ✅ | ✅ | ✅ | |
| `pedidos:criar` · `pedidos:editar` · `pedidos:lancar_masc` | ✅ | ✅ | ✅ | ✅ | |
| `agendamentos:criar` · `agendamentos:editar` · `agendamentos:cancelar` (cancelamento lógico, INV-20) | ✅ | ✅ | ✅ | ✅ | |
| `campanhas:criar` · `campanhas:editar` · `respostas:criar` · `respostas:editar` · `modelos:criar` · `modelos:editar` | ✅ | ✅ | ✅ | ✅ | |
| `campanhas:disparar` (iniciar/retomar) · `modelos:enviar_aprovacao` | ✅ | ✅ | ✅ | | |
| `pedidos:cancelar` · `pedidos:dispensar_masc` (motivo obrigatório, trilha antes) | ✅ | ✅ | ✅ | | |
| `contatos:excluir` · `midia:excluir` · `pedidos:excluir` · `campanhas:excluir` · `respostas:excluir` · `modelos:excluir` · `etiquetas:gerir` | ✅ | ✅ | ✅ | | |
| `produtos:ver_custo` (`produtos.preco_custo` sai do DTO quando falso) | ✅ | ✅ | ✅ | | |
| `relatorios:exportar` (CSV) | ✅ | ✅ | ✅ | | |
| `lgpd:exportar` · `lgpd:anonimizar` · `lgpd:registrar_solicitacao` | ✅ | ✅ | ✅ | | |
| `trilha:ler` (`/auditoria`, `/auditoria/qualidade`, `/auditoria/excluidos`) | ✅ | ✅ | ✅ | | |
| `auditoria:restaurar` (registro soft-deletado) | ✅ | ✅ | ✅ | | |
| `seguranca:ler_eventos` (`auth_eventos`, aba `/auditoria/seguranca`) | ✅ | ✅ | | | |
| `usuarios:ler_detalhe` (e-mail, ativo, último acesso, desativados) | ✅ | ✅ | | | |
| `usuarios:convidar` · `usuarios:editar` · `usuarios:desativar` · `usuarios:destravar` · `usuarios:iniciar_reset` · `usuarios:recuperar_fator` · `usuarios:encerrar_sessoes` · `usuarios:trocar_email` | ✅ | ✅ | | | |
| `usuarios:promover_admin` · `usuarios:rebaixar_admin` · `usuarios:transferir_posse` | ✅ | | | | |
| `lojas:criar` · `lojas:editar` · `lojas:excluir` (o "desativar loja" da UI é soft delete) | ✅ | ✅ | | | |
| `integracoes:ler` · `integracoes:conectar` · `integracoes:editar` · `integracoes:desconectar` (inclusive **leitura** e sessão uazapi — INV-22) | ✅ | ✅ | | | |
| `configuracao:ler` · `configuracao:editar` | ✅ | ✅ | | | |

**`gerente` não tem `seguranca:ler_eventos`** (decisão nova): `auth_eventos` carrega IP, agente, meio e alvo de `dono` e `admin` — dar a trilha de auth a quem não pode nem ver o detalhe de um usuário é contornar o próprio controle. `trilha:ler` (negócio) continua com o gerente, que é o que DN-07 pediu.

A tela **"Meu perfil › Segurança" não tem chave nesta tabela**: é alcançável por qualquer sessão plena (REQ-G1).

**Chaves que nascem junto com a fase R2** (não existem no código do R1, e a política já está decidida para quando entrarem): `devolucoes:ler|criar` (vendedor+), `devolucoes:aprovar|negar` (gerente+), `devolucoes:concluir_estorno` (**gerente+**, motivo obrigatório, trilha antes do efeito), `pagamentos:ler` (vendedor+), `pagamentos:gerar_cobranca` (vendedor+), `pagamentos:marcar_pago` (**gerente+**, motivo obrigatório), `negocios:*`, `conteudo:*` (lookbooks, base de conhecimento). Escrever agora evita que o estorno nasça sem dono no dia em que a tela ligar.

**Invariantes que a trava T12 prova sobre a tabela inteira**: `dono ⊇ admin`; `viewer` nunca escreve (INV-19); `vendedor` só exclui/cancela em `agendamentos:cancelar` (INV-20); `gerente` nunca alcança `configuracao:*`, `integracoes:*`, `usuarios:*` (salvo `listar_colegas`) nem `seguranca:ler_eventos` (INV-21/22); papel inventado não passa em nada (INV-26); **toda ação usada no código existe na tabela e toda entrada da tabela é usada por alguma tela ou action** (INV-27, nos dois sentidos).

### 2.3 Quem pode agir sobre quem (S-17)

Toda action de `src/lib/actions/usuarios.ts` chama, além de `exigirPermissao`, o guarda de alvo:

```ts
// src/lib/auth/permissoes/alvo.ts
export function exigirAlvoPermitido(ator: Sessao, alvo: { id: string; papel: Papel }): void;
```

Regras, nesta ordem (recusa = `403 ALVO_NAO_PERMITIDO` + `recusa_403` na trilha):

1. **auto-alvo recusado** em toda action administrativa (INV-32) — o caminho do próprio usuário é `/perfil/seguranca`;
2. o alvo precisa ter papel **estritamente inferior** ao do ator na ordem de §2.1 — `admin` não reseta, não desativa, não destrava, não encerra sessões, não troca e-mail e não recupera fator de outro `admin`;
3. **ninguém age sobre `dono`, exceto outro `dono`**;
4. `usuarios:convidar` obedece à mesma escada: `admin` convida `gerente`/`vendedor`/`viewer`; convite com papel `admin` só pelo `dono`, com ciência versionada (`CHECK convites_ciencia_admin`, `01-dados.md §5.7`); convite com papel `dono` **não existe** (barreira no `CHECK convites_papel`).

Teste obrigatório (T14): `admin` A tentando resetar/desativar/trocar e-mail de `admin` B e do `dono` → 403 com trilha; `dono` sobre `admin` → 200.

### 2.4 Escopo de loja (REQ-H10, INV-01..12)

Contrato único, do modelo de dados (`01-dados.md §13.1`) — `escopoDeLeitura()` e `exigirLoja()` do rascunho **não existem**:

```ts
// src/lib/auth/loja.ts
export type EscopoLoja = { tipo: "todas" } | { tipo: "uma"; lojaId: string } | { tipo: "nenhuma" };
export function escopoDeLoja(s: Sessao, lojaPedida?: string): EscopoLoja;
export function lojaParaGravar(s: Sessao, lojaPedida?: string): string; // lança ErroFaltaLoja
```

`condicaoDeLoja(tabela, escopo)` vive em `src/lib/db/consultas.ts` e é usada por **toda** consulta de tabela com `loja_id`; `{ tipo: "nenhuma" }` devolve SQL falso (fail-closed).

- `vendedor`/`viewer`: `{ tipo: "uma", lojaId }` **lido do banco**; parâmetro e cookie são **ignorados** (INV-02). Sem loja (estado impossível pelo CHECK) → `{ tipo: "nenhuma" }`, que fecha, nunca abre (INV-04).
- `dono`/`admin`/`gerente`: a loja vem do cookie `loja_ativa` ou de `?loja=`, e só é aceita depois de conferir (a) papel de gestão e (b) que a loja **existe e tem `is_deleted = false`** — `lojas` não tem coluna `ativo` (`01-dados.md §6.1`). Sem escolha: `{ tipo: "todas" }` para ler; para **gravar**, `400 FALTA_LOJA` (nunca chutar — INV-05).
- Registro fora do escopo responde **404**, idêntico a inexistente (INV-09).
- Ids secundários do corpo (`contato_id`, `template_id`, `midia_id`, `produto_id`, `integracao_id`) são conferidos contra a loja **resolvida** (INV-10, REQ-H12). A **FK composta `(id, loja_id)`** (`01-dados.md §4.6`) é a segunda linha: filho de outra loja não entra nem por erro de código.
- O cookie `loja_ativa` é `HttpOnly; Secure; SameSite=Lax; Path=/`, gravado por Server Action. É preferência de UI, **nunca** autorização.

---

## 3. Portão único de autorização

### 3.1 Contrato (`src/lib/auth/guard.ts` — cópia de `01-dados.md §13.1`)

```ts
export type Papel = "dono" | "admin" | "gerente" | "vendedor" | "viewer";
export type Sessao = {
  usuarioId: string; sessaoId: string; papel: Papel;
  lojaId: string | null; ativo: true;
  precisaTrocarSenha: boolean; precisaConfigurarFator: boolean;
};
export type Contexto = { sessao: Sessao; escopo: EscopoLoja; autorId: string; origem: "ui" | "webhook" | "worker" };

export function pode(papel: Papel, recurso: string, acao: string): boolean;   // PURO
export function exigirSessao(opcoes?: { renovaAtividade?: boolean; provisoria?: boolean }): Promise<Sessao>;
export function exigirSessaoFresca(): Promise<Sessao>;
export function exigirPermissao(s: Sessao, chave: `${string}:${string}`, lojaId?: string): void;
export function ehPrivilegioMaximo(papel: Papel): boolean;
export function escopoDeLoja(s: Sessao, lojaPedida?: string): EscopoLoja;
export function lojaParaGravar(s: Sessao, lojaPedida?: string): string;
export function contextoDe(s: Sessao, lojaPedida?: string): Contexto;
export function rotaDeMaquina(cfg: ConfigMaquina): (req: Request) => Promise<Response>;
export function rotaPublica(cfg: ConfigPublica): (req: Request) => Promise<Response>;
```

| Função | Faz | Lança |
|---|---|---|
| `exigirSessao()` | resolve a sessão pelo BA (`auth.api.getSession`) com **cookie cache desligado** → `papel`, `ativo`, `loja_id`, `precisa_*` vêm do banco a cada requisição (REQ-H6); confere `is_deleted` e `bloqueado_ate`; aplica inatividade de 60 min (`usuarios_sessoes.ultimo_uso_em`); aplica os gates de §9.4; chama `conferirOrigem()` quando a requisição é mutante (J7); atualiza `ultimo_uso_em` no máximo a cada 5 min e **só** com `{ renovaAtividade: true }` (o polling do inbox passa `false`) | `401 NAO_AUTENTICADO`, `403 TROCA_OBRIGATORIA`, `403 FATOR_OBRIGATORIO` |
| `exigirSessaoFresca()` | `exigirSessao()` + `max(usuarios_sessoes.created_at, reautenticada_em) ≤ 15 min` — o mesmo valor de `session.freshAge`, para o frescor nativo do BA e o nosso nunca discordarem | `403 SESSAO_NAO_FRESCA` |
| `exigirPermissao(s, "recurso:acao", lojaId?)` | `pode(...)`; falso → grava `recusa_403` (`auth_eventos`, `detalhes.rota`/`detalhes.acao`/`detalhes.papel`) e lança | `403 SEM_PERMISSAO` |
| `pode(papel, recurso, acao)` | **puro**: é o que a navegação e o índice de Configurações usam para renderizar no servidor já filtrados. Montar menu com `exigirPermissao()` inundaria `auth_eventos` de `recusa_403` a cada page view | — |
| `ehPrivilegioMaximo(papel)` | `papel === "dono"`, literal — **nunca** via `pode()` (REQ-H1) | — |
| `rotaDeMaquina(cfg)` | §12; **nunca** aceita cookie de sessão | `401` corpo nulo |
| `rotaPublica(cfg)` | Route Handler sem sessão: `{ motivo, limite, maxBytes }`. Único jeito de um handler não ter portão; o motivo entra no manifesto | — |

`exigirSessao()` **nunca** aceita `Authorization`/segredo de máquina e `rotaDeMaquina()` **nunca** aceita cookie (REQ-A4): canais separados, códigos distintos.

### 3.2 Os dois embrulhos de Server Action

`src/lib/actions/_base.ts` exporta **dois**, e todo `export` de arquivo `"use server"` usa um deles:

```ts
export const acao        = (cfg: { permissao, entrada, revalidar?, executar }) => …  // autenticada
export const acaoPublica = (cfg: { motivo, limite, entrada, executar }) => …         // anônima
```

- `acao()`: `exigirSessao()` (que já confere origem e inatividade) → `exigirPermissao` → `entrada.safeParse` (Zod 4, `z.strictObject`) → `escopoDeLoja` → `executar` dentro de `db.transaction` → tradução de erro em `Resultado<T>` → `revalidateTag`.
- `acaoPublica()`: `conferirOrigem()` → `limitarPorIp(limite)` → `entrada.safeParse` → `executar`. **É obrigatória** em `entrar`, `esqueciASenha`, `redefinirSenha`, `consumirConvite` e `verificarSegundoFator`. Sem ela, a escrita anônima não teria nem checagem de origem (o Next só **avisa** quando `Origin` falta — N2) nem teto por IP, e A6 seria falso.

`conferirOrigem()` e `limitarPorIp()` moram em `src/lib/seguranca/origem.ts` e `limite.ts` — nunca dentro de `exigirSessao()` como única casa.

### 3.3 Onde o portão é chamado

Em **toda** page (server), layout, Route Handler e Server Action. `src/proxy.ts` só redireciona quem não tem cookie e injeta o nonce da CSP — **não decide acesso** (N1, A5, CVE-2025-29927, CVE-2026-64642, CVE-2026-45109). O matcher do proxy exclui `/api/webhooks`, `/api/auth`, `/api/midias`, `/api/eventos`, `_next/static`, `_next/image`.

O layout autenticado chamar o guard **não basta**: Server Action é um POST para a rota onde é usada e não passa por layout (N1/N5). A trava T1 resolve o import do portão por **identidade de função** (não por nome), fatia por `export async function` **e** por `export const x = acao(...)`/`acaoPublica(...)`, exige um piso mínimo de arquivos encontrados e reprova export sem **um dos dois** embrulhos.

### 3.4 Arquivos desta camada

`src/lib/auth/`: `auth.ts` · `guard.ts` · `permissoes/` (pasta) · `loja.ts` · `bloqueio.ts` · `politica-senha.ts` · `senha-gravada.ts` · `sessoes.ts` · `trilha.ts` · `emails.ts` · `convites.ts`.
`src/lib/seguranca/`: `ip.ts` · `origem.ts` · `limite.ts` · `corpo.ts` · `maquina.ts` · `assinaturas.ts` · `alertas.ts` · `cofre.ts` · `rotas-publicas.ts` (manifesto).
`src/lib/actions/`: `_base.ts` · `seguranca.ts` (perfil) · `usuarios.ts` (administração) · `convites.ts`.

---

## 4. Configuração do Better Auth 1.7.5 (`src/lib/auth/auth.ts`)

### 4.1 De-para de colunas: uma constante só

O BA valida o schema no boot; divergência derruba **todo** `/api/auth/**` (G27). Por isso o mapeamento vive em **`src/lib/db/schema/_ba-fields.ts`** (`CAMPOS_BA`, `01-dados.md §5.10`) e o `auth.ts` é montado a partir dele. **Nenhum documento e nenhum arquivo de auth redigita nome de coluna.**

`CAMPOS_BA` nasce completo — além de `user`, `account`, `session` e `verification` de §5.10, ele carrega os campos dos **plugins**, porque `modelName` sozinho deixa o BA procurando `userId`, `publicKey`, `credentialID`… e o boot falha:

| Modelo | Propriedade BA → coluna (`01-dados.md §5.1/§5.5/§5.6`) |
|---|---|
| `user` (complemento) | `twoFactorEnabled: "two_factor_enabled"` |
| `twoFactor` → `usuarios_totp` | `userId: "usuario_id"`, `secret: "secret"`, `backupCodes: "backup_codes"`, `createdAt: "created_at"` |
| `passkey` → `usuarios_passkeys` | `userId: "usuario_id"`, `name: "nome"`, `publicKey: "chave_publica"`, `credentialID: "credential_id"`, `counter: "contador"`, `deviceType: "tipo_dispositivo"`, `backedUp: "backed_up"`, `transports: "transportes"`, `aaguid: "aaguid"`, `createdAt: "created_at"` |

`usuarios_totp.ultimo_passo_totp` é coluna **nossa** (anti-replay, §9.1), não do BA.

**Regra de conflito**: se o pacote instalado exigir uma coluna que o modelo não tem, o caminho é **acrescentar a coluna ao modelo de dados por ADR** — nunca renomear coluna existente nem inventar um segundo de-para. O achado tem de aparecer antes do commit 0 (§4.4).

### 4.2 A instância

```ts
import { betterAuth, APIError, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";          // mesma versão exata do core (M2)
import { nextCookies } from "better-auth/next-js";
import { createAuthMiddleware } from "better-auth/api";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { env } from "@/lib/env";
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";               // o barril (01-dados §2)
import { CAMPOS_BA } from "@/lib/db/schema/_ba-fields";
import { CAMINHOS_DESLIGADOS } from "@/lib/auth/caminhos";
import { armazenamentoLimiteRedis } from "@/lib/seguranca/limite";
import { PROXIES_CONFIAVEIS } from "@/lib/seguranca/ip";
import { politicaDeSenha } from "@/lib/auth/politica-senha";
import { kdf } from "@/lib/auth/kdf";                    // semáforo de concorrência (§6)
import { registrarEventoAuth } from "@/lib/auth/trilha";
import { enfileirarEmailSeguranca } from "@/lib/auth/emails";
import { aposSenhaGravada } from "@/lib/auth/senha-gravada";
import { podeCriarSessao, aposCriarSessao } from "@/lib/auth/sessoes";

export const opcoesAuth = {
  appName: "MerloStore Chat",
  baseURL: env.APP_URL,                 // J1: uma origem só para baseURL, rpID, links e trustedOrigins
  secrets: env.BETTER_AUTH_SECRETS,     // G3: versionados ("v2:…,v1:…") — rotação sem perder semente TOTP
  trustedOrigins: [env.APP_URL],        // J2: nunca "*", nunca curinga
  database: drizzleAdapter(db, { provider: "pg", schema }),

  user: {
    ...CAMPOS_BA.user,
    additionalFields: {                 // input:false → /update-user não aceita estes campos no corpo (H12)
      papel:                  { type: "string",  input: false, required: true,  defaultValue: "viewer" },
      lojaId:                 { type: "string",  input: false, required: false, fieldName: "loja_id" },
      ativo:                  { type: "boolean", input: false, required: true,  defaultValue: false },
      precisaTrocarSenha:     { type: "boolean", input: false, defaultValue: false, fieldName: "precisa_trocar_senha" },
      precisaConfigurarFator: { type: "boolean", input: false, defaultValue: true,  fieldName: "precisa_configurar_fator" },
      falhasLogin:            { type: "number",  input: false, defaultValue: 0,     fieldName: "falhas_login" },
      ultimaFalhaEm:          { type: "date",    input: false, required: false,     fieldName: "ultima_falha_em" },
      bloqueadoAte:           { type: "date",    input: false, required: false,     fieldName: "bloqueado_ate" },
      ultimoLoginEm:          { type: "date",    input: false, required: false,     fieldName: "ultimo_login_em" },
    },
    changeEmail: { enabled: false },    // E12: troca de e-mail é fluxo próprio (§11.2)
    deleteUser:  { enabled: false },    // usuário nunca é apagado (INV-33)
  },
  session: {
    ...CAMPOS_BA.session,
    expiresIn: 60 * 60 * 12,            // S-04 / F2: teto absoluto 12 h
    disableSessionRefresh: true,        // único teto absoluto real
    freshAge: 60 * 15,                  // G11: default era 1 DIA (cadastro de passkey!)
    cookieCache: { enabled: false },    // H6 + CVE-2026-67337 (bypass de 2FA por cache de sessão)
    additionalFields: {
      ultimoUsoEm:     { type: "date", input: false, fieldName: "ultimo_uso_em" },     // F3
      reautenticadaEm: { type: "date", input: false, fieldName: "reautenticada_em" },  // F9
    },
  },
  account:      { ...CAMPOS_BA.account, accountLinking: { enabled: false } },  // A7/C10: sem login social
  verification: { ...CAMPOS_BA.verification, storeIdentifier: "hashed" },      // G1: default era PLAIN

  emailAndPassword: {
    enabled: true,
    disableSignUp: true,                     // C8: sem auto-cadastro
    autoSignIn: false,                       // G14: reset não cria sessão (pularia o 2º fator)
    requireEmailVerification: false,         // a posse do e-mail já foi provada pelo convite (§9.2)
    minPasswordLength: 15,                   // S-05; a política real roda em hooks.before (B9)
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,     // G16: default false
    resetPasswordTokenExpiresIn: 60 * 30,    // E2
    password: {                              // G22: scrypt default fica abaixo do piso OWASP
      hash:   (senha) => kdf.hash(senha),
      verify: ({ hash, password }) => kdf.verify(hash, password),
    },                                       // ATENÇÃO: só KDF aqui. Política aqui = oráculo no login (G22/G23)
    sendResetPassword: async ({ user, token }) => {
      // G15: ignora a `url` do BA (token em path/query vaza em log e Referer). Fragmento + fila.
      void enfileirarEmailSeguranca("reset", user.id, `${env.APP_URL}/redefinir-senha#t=${token}`);
    },
    onPasswordReset: async ({ user }) => { await aposSenhaGravada(user.id, "reset"); },   // E5
  },

  rateLimit: {
    enabled: true,                            // default desliga fora de produção: ligar sempre
    customStorage: armazenamentoLimiteRedis,  // G20: default é um Map em memória
    window: 60, max: 300,                     // balde geral por IP — largo de propósito (NAT da loja)
    customRules: {
      "/sign-in/email":          { window: 60,  max: 20 },
      "/sign-in/passkey":        { window: 60,  max: 20 },
      "/request-password-reset": { window: 600, max: 5  },
      "/reset-password":         { window: 600, max: 10 },
      "/two-factor/*":           { window: 60,  max: 10 },
      "/passkey/*":              { window: 60,  max: 30 },
    },
  },

  advanced: {
    useSecureCookies: env.NODE_ENV === "production",       // F1: prefixo __Secure-
    cookiePrefix: "merlo",
    ipAddress: { trustedProxies: PROXIES_CONFIAVEIS, ipv6Subnet: 64 },  // G21 + CVE-2026-45364
    database: { generateId: "uuid" },                      // 01-dados §4.2
    // NUNCA: disableCSRFCheck, disableOriginCheck
  },

  disabledPaths: CAMINHOS_DESLIGADOS,   // MESMA constante do Route Handler (§5.2) — defesa em 2 camadas

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // B9/E9: política só onde a senha é GRAVADA, e antes do consumo do token (G15)
      if (ctx.path === "/reset-password" || ctx.path === "/change-password") {
        await politicaDeSenha(ctx.body?.newPassword, { usuarioId: ctx.context.session?.user.id });
      }
      // G7/D15: 2ª linha; a 1ª é desligar a opção do plugin (§4.3)
      if (ctx.path.startsWith("/two-factor/") && ctx.body?.trustDevice) {
        throw new APIError("BAD_REQUEST", { message: "Operação não permitida." });
      }
    }),
  },

  databaseHooks: {
    session: {
      create: {
        before: async (sessao, ctx) => { await podeCriarSessao(sessao, ctx); },  // §4.3
        after:  async (sessao, ctx) => { await aposCriarSessao(sessao, ctx); },  // trilha + teto de sessões
      },
      delete: {
        before: async (sessao, ctx) => {
          // G25: a prova tem de existir ANTES do delete físico da biblioteca.
          // try/catch explícito: hook `before` que lança ABORTA a operação — e "sair" tem de sair sempre.
          try { await registrarEventoAuth("sessao_encerrada", sessao, ctx); }
          catch (e) { logger.fatal({ e }, "trilha de sessao_encerrada falhou"); }
        },
      },
    },
    account: {
      update: { before: async (conta, ctx) => { /* E5/B7: /change-password não dispara onPasswordReset */ } },
    },
  },

  plugins: [
    twoFactor({
      issuer: "MerloStore Chat",
      skipVerificationOnEnable: false,
      totpOptions: { digits: 6, period: 30 },
      // otpOptions AUSENTE: sem OTP por e-mail (S-07). Reabrir exige storeOTP:"hashed" e period<=5 (MINUTOS, G2)
      backupCodeOptions: { amount: 0 },        // §4.4: forma confirmada no .d.ts antes de escrever
      accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 900 },  // só do 2º fator
      twoFactorCookieMaxAge: 300,              // D17: desafio de 10 → 5 min
      trustDeviceMaxAge: 0,                    // G7: defesa primária; o hook acima é a segunda
      schema: { twoFactor: CAMPOS_BA.twoFactor, user: { fields: { twoFactorEnabled: "two_factor_enabled" } } },
    }),
    passkey({
      rpID: new URL(env.APP_URL).hostname,     // G10: rpID divergente inutiliza TODAS as chaves de uma vez
      rpName: "MerloStore Chat",
      origin: env.APP_URL,
      authenticatorSelection: { userVerification: "required", residentKey: "required" },  // §9.1
      registration: {
        requireSession: true,
        afterVerification: async ({ verification }) => {           // G9
          if (!verification.registrationInfo?.userVerified)
            throw new APIError("FORBIDDEN", { message: "Verificação do usuário obrigatória." });
        },
      },
      authentication: {
        afterVerification: async ({ verification }) => {           // G8
          if (!verification.authenticationInfo?.userVerified)
            throw new APIError("UNAUTHORIZED", { message: "Não foi possível entrar." });
        },
      },
      schema: { passkey: CAMPOS_BA.passkey },
    }),
    nextCookies(),                          // G28: SEMPRE o último, senão Server Action não grava cookie
  ],
} satisfies BetterAuthOptions;              // S-18: chave desconhecida vira erro de compilação

export const auth = betterAuth(opcoesAuth);
```

Plugins **proibidos** (T4 reprova se aparecerem): `admin`, `haveIBeenPwned` (G23), `emailOTP`, `magicLink`, `apiKey` (CVE-2025-61928), `organization`, `oauthProvider`/`oidc`, `mcp`, `sso`, `anonymous`, `multiSession`, `openAPI`, `deviceAuthorization`.

### 4.3 `podeCriarSessao` / `aposCriarSessao` (`src/lib/auth/sessoes.ts`)

O hook `session.create.before` é o único ponto que cobre **todo** caminho que cria sessão (senha pós-2FA, passkey, convite).

```
podeCriarSessao(sessao, ctx):
  usuario = SELECT ... FROM usuarios WHERE id = sessao.usuario_id
  1. is_deleted           → recusa sempre
  2. ativo = false E precisa_configurar_fator = false → recusa (conta DESATIVADA)
  3. ativo = false E precisa_configurar_fator = true  → PASSA: conta em PROVISIONAMENTO (§9.2/§9.3);
     a sessão nasce provisória e o guard só libera /primeiro-acesso (§9.4)
  4. bloqueado_ate > now() → recusa SOMENTE quando o meio é senha
     (ctx.path é /sign-in/email ou /two-factor/*). No caminho passkey, ignora (C9)
```

`aposCriarSessao(sessao, ctx)`:

1. grava `sessao_criada` e, quando a sessão é **plena**, `login_sucesso` com o `meio` correspondente (`senha+totp` ou `passkey`) e carimba `usuarios.ultimo_login_em`;
2. caminho passkey: zera `falhas_login` e `bloqueado_ate` (C9 — a vítima de um spray não fica trancada fora do próprio sistema);
3. **teto de sessões simultâneas (F14)**: conta as sessões do usuário com `expira_em > now()`; acima de **3** (**2** para `dono`/`admin`), encerra a mais antiga por `internalAdapter.deleteSession` e grava `sessao_encerrada` com `motivo = 'teto_de_sessoes'`.

**Desativar uma conta que ainda está em provisionamento** (`usuarios:desativar` sobre alguém que nunca configurou o fator) também marca `precisa_configurar_fator = false` e invalida o convite: a conta sai do estado 3 e passa a cair no 2. Reabrir o acesso exige convite novo ou recuperação assistida. É o que impede que "desativado" e "em provisionamento" se confundam sem coluna nova.

### 4.4 Prova de efeito, não de presença (S-18)

`auth.options` devolve o objeto que **nós** escrevemos: uma opção com nome errado — ou que não existe nesta minor — passa em qualquer comparação de literais e é ignorada em runtime. Por isso:

1. **`satisfies BetterAuthOptions` + `tsc --noEmit`** (com `exactOptionalPropertyTypes`) é a primeira trava: chave desconhecida não compila.
2. **Conferência no pacote instalado, antes do commit 0** (`docs/seguranca/conferencia-ba-1.7.5.md`, gerada lendo `node_modules/better-auth/dist/**/*.d.ts` e `@better-auth/passkey/dist/**/*.d.ts`). Itens obrigatórios, cada um com plano B escrito:

| Opção | Se não existir com essa forma |
|---|---|
| `secrets` (plural, versionado) | usar `secret` simples + rotação manual documentada no runbook; a semente TOTP passa a exigir recifragem no giro |
| `advanced.ipAddress.trustedProxies` / `ipv6Subnet` | `ipDoCliente()` continua sendo a fonte da verdade nossa; o IP do BA passa a ser ignorado na trilha e o evento é gravado por nós |
| `advanced.database.generateId: "uuid"` | trocar por função: `generateId: () => crypto.randomUUID()` |
| `backupCodeOptions` (desligar emissão) | não registrar o fluxo (as 3 rotas já estão desligadas) e provar por teste que a resposta de `/two-factor/enable` **não** traz `backupCodes` e que `usuarios_totp.backup_codes` fica `'[]'` |
| `twoFactorCookieMaxAge`, `trustDeviceMaxAge` | manter só o `hooks.before` que recusa `trustDevice` e reduzir o desafio no nosso Route Handler |
| `passkey.authentication.afterVerification` | mover a exigência de `userVerified` para `podeCriarSessao` (o hook de sessão vê o caminho e o resultado da verificação) |
| `rateLimit.customStorage` | a assinatura documentada é `consume(key, rule) → { allowed, retryAfter }`, **checando e incrementando numa operação só**; se divergir, o limitador do BA é desligado e todo o teto passa a ser aplicado pelo nosso `limitarPorIp` no Route Handler |
| `verification.storeIdentifier: "hashed"` | hashear o identificador antes de chamar o BA, em `emails.ts` |
| `disabledPaths` | o Route Handler já responde 404 antes do BA; a camada dupla vira simples e o ADR registra |

3. **T4 vira teste de comportamento**, não de literais: id gerado bate `^[0-9a-f-]{36}$`; duas requisições com XFF diferentes gravam IPs diferentes em `auth_eventos`; semente TOTP decifra depois de rotacionar o segredo; `/two-factor/enable` não emite código de resgate; cookie de 2FA expira em 5 min; cadastro de passkey com `userVerified:false` **não** cria sessão; `CAMPOS_BA` bate com `getTableColumns()` de cada tabela (o caso que o modelo de dados já exige em `01-dados.md §14`).

---

## 5. Route Handler do BA e caminhos desligados

### 5.1 Ordem em `src/app/api/auth/[...all]/route.ts`

1. **Canoniza o caminho** antes de comparar: decodifica `%XX`, minúsculas, colapsa barras repetidas, remove barra final e segmento `.`. Compara o resultado com `CAMINHOS_DESLIGADOS`; se casar (igualdade ou regex de parâmetro), responde `new Response(null, { status: 404 })` **antes** de chamar o BA e grava `sonda_caminho_desligado`. Motivo: `disabledPaths` responde 404 **com** corpo `"Not Found"` e caminho inexistente responde 404 **sem** corpo — a diferença de bytes é um oráculo (G19, REQ-L9); e a normalização manual de barra dupla já foi CVE (CVE-2025-71399).
2. `content-length > 16 KB` → 413; leitura com `lerCorpoComTeto(16 KB)` (B8/I11).
3. Se `/sign-in/email`: normaliza **só o e-mail** (`trim().toLowerCase()`), **nunca** a senha; consulta `bloqueio.estaBloqueada(email)`. Bloqueada → não chama o BA, espera o piso de tempo, devolve a recusa única e **não** conta nova falha (C3, "bloqueio como arma").
4. Chama `auth.handler(...)` dentro do semáforo de KDF (§6).
5. `/sign-in/email` com status ≠ 200 → `bloqueio.registrarFalha(email)` **somente** quando a causa é credencial (`401 INVALID_EMAIL_OR_PASSWORD`); **qualquer** não-200 (401, 403 `BANNED_USER`, 429) vira a recusa única de §8. Status 200 → `bloqueio.zerar(email)`; se a resposta é `twoFactorRedirect`, grava `senha_aceita_aguardando_2fa`.
6. Mesma normalização de recusa (bytes e piso de tempo) para `/sign-in/passkey`, `/passkey/generate-authenticate-options`, `/passkey/verify-authentication` e `/two-factor/verify-totp`.
7. `/request-password-reset` responde sempre `200 {"status":true}`, idêntico byte a byte, com piso de tempo (E1).
8. Toda resposta leva `Cache-Control: no-store`; `/sign-out` leva também `Clear-Site-Data: "cache","cookies","storage"`.

### 5.2 Em uso × desligado (`src/lib/auth/caminhos.ts`)

Duas constantes exportadas — `EM_USO` e `CAMINHOS_DESLIGADOS` — consumidas pelo Route Handler, por `disabledPaths` e pelas travas T3/T7.

| Em uso por HTTP | Desligado (404 sem corpo) |
|---|---|
| `POST /sign-in/email` · `POST /sign-out` · `GET /get-session` | `/sign-up/email` · `/verify-email` · `/send-verification-email` (G17: GET que cria sessão) · `/change-email` · `/update-user` · `/delete-user` (+`/callback`) · `/set-password` |
| `POST /request-password-reset` · `POST /reset-password` (token no **corpo**) | `GET /reset-password/:token` (G15) · `/verify-password` · `/change-password` (vai por action com frescor, G12) |
| `POST /two-factor/verify-totp` | `/two-factor/enable` · `/disable` · `/get-totp-uri` · `/generate-backup-codes` · `/verify-backup-code` · `/send-otp` · `/verify-otp` (G5: `enable` pede só sessão + senha, sem frescor) |
| `POST /passkey/generate-authenticate-options` · `/passkey/verify-authentication` · `/sign-in/passkey` | `/passkey/list-user-passkeys` · `/delete-passkey` (CVE-2025-71400, IDOR) · `/update-passkey` |
| — | `/list-sessions` · `/revoke-session` · `/revoke-sessions` · `/revoke-other-sessions` (G13: devolve e recebe o **token**) · `/link-social` · `/unlink-account` · `/list-accounts` · `/refresh-token` · `/get-access-token` · `/account-info` · `/error` · `/reference` |

As actions chamam `auth.api.*` server-side (o `disabledPaths` vale para o roteador HTTP): é assim que o cadastro de TOTP e de passkey funciona com sessão fresca sem expor a rota. A trava T3 varre `node_modules/better-auth/dist/**` e `@better-auth/passkey/dist/**` por `createAuthEndpoint("/...")`, subtrai os `serverOnly` e reprova qualquer caminho fora de `EM_USO ∪ CAMINHOS_DESLIGADOS` — um upgrade que instale rota nova quebra o teste (REQ-A2). T7 testa **cada** caminho desligado em 5 escritas (`//`, `%2F`, barra final, maiúsculas, `/./`).

---

## 6. Política de senha e custo de KDF

`src/lib/auth/politica-senha.ts` é módulo **puro** na parte determinística, importado pelo servidor **e** pelo componente da tela: a mesma lista de motivos dos dois lados (B6).

| Regra | Valor | Motivo |
|---|---|---|
| KDF | **Argon2id** `m=19456 KiB, t=2, p=1` (`@node-rs/argon2`) | piso OWASP; o scrypt default do BA fica abaixo (G22). Addon nativo → `serverExternalPackages` e imagem com binário musl-compatível |
| Comprimento | **15 a 128** | S-05. Sem regra de composição, sem expiração periódica (B4) |
| Normalização | **nenhuma**: nunca `trim()`, `toLowerCase()` nem NFKC na senha | B5 |
| Teto bruto | recusa em `senha.length > 1024` **antes** de qualquer avaliação ou hash | B8: DoS de KDF com senha de 1 MB |
| Vazamento | HIBP k-anonimato (prefixo SHA-1 de 5, `Add-Padding: true`), timeout 1,5 s, **fail-open** com evento `hibp_indisponivel` deduplicado | B3. O plugin do BA é fail-closed e pendurado no hash: HIBP fora do ar travaria toda troca de senha (G23) |
| Lista local | ≥ 3.000 senhas + variantes contextuais (`merlostore`, `merlo`, `centro`, `cerroazul`, `whatsapp`) | rede de segurança quando o HIBP cai |
| Contextuais e sequências | reprova nome, e-mail, loja, marca, alfabeto/teclado/repetição | B6 |
| Histórico | 5 mais recentes de `usuarios_senhas_historico` (append-only, nunca podada), hash Argon2id, leitura **fail-closed** | B7 |
| Onde roda | lista branca `CAMINHOS_QUE_GRAVAM_SENHA`: convite, `/reset-password`, `/change-password`, troca pela action | B9. **Nunca** em `password.hash`/`verify` (rodam no login e virariam oráculo) |
| Vocabulário | mensagens sem "token", "link", "inválido", "expirado" | E10: não confundir senha fraca com link queimado |

**Semáforo de KDF (`src/lib/auth/kdf.ts`)**: `@node-rs/argon2` é addon nativo e roda no threadpool do libuv. Com o default de 4 threads, uma rajada de login satura o pool e trava **toda** I/O de arquivo do processo — inclusive o SSE e `/api/midias/[id]`, que moram no mesmo container. Portanto: `UV_THREADPOOL_SIZE=8` explícito no `Dockerfile` **e** um semáforo de no máximo **4 hashes/verificações em voo**; ao estourar, a requisição recebe a recusa única de §8 (nunca 503, que seria oráculo). O valor final sai de `scripts/medir-kdf.mjs` rodado na VPS (§22).

**Troca de senha (REQ-B10)**: a action chama `auth.api.changePassword({ body: { currentPassword, newPassword, revokeOtherSessions: true }, headers })` **depois** de `exigirSessaoFresca()` — o `sensitiveSessionMiddleware` do BA não confere frescor (G12). **Senha atual errada não alimenta o bloqueio de login**: usa contador próprio no Redis (`senha-atual:<usuarioId>`, 5 em 15 min → `429` na action). Sem isso, existe caminho autenticado para trancar a conta da vítima.

---

## 7. Bloqueio por conta, limitador por IP e IP canônico

### 7.1 Bloqueio por **conta**, atômico e persistido (`bloqueio.ts`, REQ-C1)

Primeira linha de defesa. O `accountLockout` do plugin `twoFactor` não serve: conta falha de segundo fator, não de senha. Uma instrução SQL só — nada de `SELECT` seguido de `UPDATE`:

```sql
UPDATE usuarios SET
  falhas_login = CASE WHEN ultima_falha_em IS NULL OR ultima_falha_em < now() - interval '15 min'
                      THEN 1 ELSE falhas_login + 1 END,
  ultima_falha_em = now(),
  bloqueado_ate = CASE WHEN (CASE WHEN ultima_falha_em IS NULL OR ultima_falha_em < now() - interval '15 min'
                                  THEN 1 ELSE falhas_login + 1 END) = 5
                       THEN now() + interval '15 min' ELSE bloqueado_ate END
WHERE lower(email) = $1
  AND is_deleted = false
  AND (bloqueado_ate IS NULL OR bloqueado_ate < now())   -- conta já bloqueada não conta falha nova
RETURNING bloqueado_ate;
```

- 5 falhas em 15 min → 15 min de bloqueio. O `= 5` (e não `>= 5`) mais o filtro do `WHERE` garantem que **martelar não estende** `bloqueado_ate` — era a propriedade que a trava T6 testava e que o SQL do rascunho não tinha.
- E-mail inexistente: **nenhuma escrita** (C5 — requisição anônima não cria linha nem evento antes do limitador por IP).
- Login por **passkey** ignora `bloqueado_ate` e zera `falhas_login` (C9, §4.3).
- Reset concluído zera `falhas_login` e `bloqueado_ate` (E3). Pedido de reset **não** alimenta o contador (E14).
- **Aviso por e-mail à vítima, com dedupe no banco**: antes de enfileirar, a função consulta `auth_eventos` por `conta_bloqueada` do mesmo `usuario_id` nas últimas 24 h (índice `(usuario_id, criado_em DESC)` já existe). Dedupe no Redis seria dedupe que **some** justamente quando o Redis cai — e uma rajada viraria uma rajada de e-mails para a vítima. Redis fica só para o alerta interno da equipe. O envio é `void` (nunca `await` dentro da resposta — C7).
- Destravar manualmente: `usuarios:destravar`, com motivo (8–255) e trilha antes; conta já livre → 409 (H9).

### 7.2 Limitador por IP (`limite.ts`, REQ-C2)

Janela fixa no **Redis** (`MULTI` + `INCR` + `EXPIRE NX` num round trip), plugado como `rateLimit.customStorage` do BA (assinatura `consume(key, rule) → { allowed, retryAfter }`, conferindo e incrementando na **mesma** operação) **e** usado pelos limitadores próprios (`acaoPublica`, webhooks, mídia).

**Fail-open deliberado**: Redis fora do ar → a requisição passa e grava `limitador_indisponivel` (deduplicado 1 h). Motivo escrito: o limitador é defesa em profundidade; o controle real do login é o bloqueio por conta, que é banco. Fail-closed aqui significaria "Redis cai, ninguém entra na loja". O que **não** depende do Redis, justamente por isso: bloqueio por conta, anti-replay de TOTP (§9.1) e dedupe do aviso à vítima (§7.1).

Teste obrigatório: 21 requisições paralelas em `/sign-in/email` → exatamente uma `429` a partir da 21ª.

### 7.3 `ipDoCliente(headers)` — **uma** implementação (`ip.ts`, REQ-C6)

- **Saltos confiáveis: 1** — cliente → Traefik do EasyPanel → app (S-10).
- `PROXIES_CONFIAVEIS` é **constante versionada no código** (`127.0.0.0/8`, `::1/128`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`), **não é variável de ambiente**: por env, um valor errado em produção (`0.0.0.0/0`) faz `x-forwarded-for` voltar a ser forjável e a trava, que lê o fonte, não tem como pegar. Mudar = PR + ADR. A linha `PROXIES_CONFIAVEIS=` do `.env.example` do rascunho de arquitetura **cai**. O boot valida que nenhuma faixa é pública.
- Algoritmo idêntico ao do BA: percorre o XFF **da direita para a esquerda**, descarta enquanto o valor estiver na lista confiável e para no primeiro que não estiver. Se o pacote instalado exportar a função do core, **importar** em vez de reimplementar.
- `MAX_SALTOS_CONFIAVEIS = 1`: precisar descartar mais de um significa cadeia inesperada → usa o endereço do socket e grava `ip_cadeia_inesperada`.
- XFF ausente ou cadeia inteira confiável → endereço do socket. Limitador agrupa IPv6 em **/64** (CVE-2026-45364); a trilha grava o IP completo.
- `grep -rn "x-forwarded-for" src` só pode achar `ip.ts` (T21). Fumaça pós-deploy: requisição com XFF forjado **não** muda o IP gravado.

---

## 8. Recusa única de login (REQ-C4)

O BA já simula o KDF para e-mail inexistente, **mas** conta banida responde `BANNED_USER` e e-mail não verificado responde 403 próprio — depois de a senha estar certa. Isso é o oráculo "esta conta existe, a senha é essa, e ela está desativada" (G18). A normalização é nossa, no Route Handler:

| O que é igual | Valor |
|---|---|
| Status | `401` |
| Corpo (bytes exatos, ordem fixa de chaves) | `{"code":"CREDENCIAIS_INVALIDAS","message":"E-mail ou senha inválidos."}` |
| Cabeçalhos | `content-type: application/json; charset=utf-8`, `cache-control: no-store`, `content-length` idêntico; **sem** `Set-Cookie`, sem `X-Retry-After`, sem `WWW-Authenticate` |
| Tempo | piso `PISO_RECUSA_MS` (default **450 ms**, = p95 do Argon2id medido na VPS) + jitter uniforme 0–50 ms, por `await esperarAte(inicio + piso + jitter)` |

**Caem nesta resposta**: e-mail inexistente · senha errada · conta **desativada** (`ativo = false` e `precisa_configurar_fator = false`) · conta `is_deleted` · conta bloqueada · 429 do limitador · semáforo de KDF cheio.

**NÃO caem**: conta com `precisa_trocar_senha` e conta **sem segundo fator configurado**. Essas contas **autenticam**; quem decide o destino é o gate de §9.4. Mandá-las para o 401 genérico era trancar para sempre toda conta que passasse por recuperação assistida ou por reset administrativo — ela nunca conseguiria entrar para resolver o que o gate pede. A isonomia de C4 continua de pé porque a resposta de **sucesso** já é idêntica para todo mundo (redireciona).

O mesmo tratamento vale para `/sign-in/passkey`, `/two-factor/verify-totp` e para as duas rotas de opções de passkey (§9.1). `/request-password-reset` tem a sua: `200 {"status":true}` sempre, com o mesmo piso (E1), e o envio sai por fila (`void`), porque um `await` no SMTP transforma "existe" em milissegundos a mais.

`PISO_RECUSA_MS` é validado em `env.ts` com `z.coerce.number().int().min(300)`: sem piso mínimo, um `PISO_RECUSA_MS=0` em produção desligaria, sem deixar rastro, o único controle que esconde a diferença entre "existe" e "não existe" — e T5 roda no CI, não em produção. A fumaça pós-deploy mede o p50 das duas recusas em HML e PRD.

---

## 9. Segundo fator, provisionamento e gates

### 9.1 Fatores (S-06/S-07)

- **Passkey** — resistente a phishing (D2), `userVerification: "required"` **e** os dois `afterVerification` exigindo `userVerified`. Sem os hooks, o plugin cabeia `requireUserVerification: false` e a conta cai para "posse do aparelho" (G9); e como passkey cria sessão sem passar pelo 2FA (G8), o UV **é** o segundo fator. **Obrigatória para `dono` e `admin`** (H7).
  **Fluxo sem identificação prévia**: `residentKey: "required"` e `allowCredentials` vazio. `POST /passkey/generate-authenticate-options` é anônimo e, com a lista de credenciais montada por e-mail, responderia diferente conforme a conta existir e ter chave — oráculo de enumeração pela porta da passkey, com teto de 30/min que não atrapalha ninguém. Com credencial descobrível, a resposta é sempre da mesma forma; some o piso de tempo de §8 e o teste é byte a byte entre e-mail existente com passkey, existente sem passkey e inexistente.
- **TOTP** — alternativa para celular de loja sem biometria. 6 dígitos, 30 s, semente cifrada pelo BA com `secrets` (G3).
  **Anti-replay no banco, não no Redis**: `UPDATE usuarios_totp SET ultimo_passo_totp = $passo WHERE usuario_id = $1 AND (ultimo_passo_totp IS NULL OR ultimo_passo_totp < $passo) RETURNING usuario_id` — zero linhas = código já usado, recusa. A coluna existe em `01-dados.md §5.5`. O `SET NX` no Redis do rascunho vivia num subsistema declaradamente fail-open: com o Redis fora, o mesmo código de 6 dígitos voltaria a ser reutilizável na janela de 30 s, que é exatamente o momento em que o limitador também está aberto.
- **Nada mais**: sem OTP por e-mail (mesmo canal do reset — D3), sem SMS (D4), sem códigos de resgate (G4), sem "lembrar dispositivo" (G7).

### 9.2 Convite (REQ-C11, E13, D1)

1. `usuarios:convidar` cria linha em `usuarios_convites` (`01-dados.md §5.7`): `token_hash` (SHA-256 de 32 bytes CSPRNG), `expira_em` 24 h, `papel`, `loja_id`, `ciencia_versao` quando o papel é `admin`, 5 colunas de auditoria. Grava `convite_emitido`.
2. E-mail com `APP_URL/primeiro-acesso#t=<token>` — **fragmento**, nunca query nem segmento de rota (F12/G15: scanner de e-mail corporativo abre o link com GET; o fragmento não sai do navegador e nada é consumido no GET).
3. A página `/primeiro-acesso` **não consome nada**: o componente cliente lê `location.hash`, limpa com `history.replaceState` e manda o token no **corpo** do POST. O consumo é atômico:
   `UPDATE usuarios_convites SET usado_em = now() WHERE token_hash = $1 AND usado_em IS NULL AND expira_em > now() RETURNING *`.
4. Na **mesma transação**, `criarUsuarioPorConvite()` (`src/lib/auth/convites.ts`) cria a identidade — porque **não existe caminho suportado no BA para isso**: `/sign-up/email` está desligado, `disableSignUp: true`, `/set-password` desligado e o plugin `admin` é proibido (S-02):
   - `inserirAuditado(tx, usuarios, { ativo: false, email_verificado: true, precisa_configurar_fator: true, papel, loja_id }, ctx, "usuario_criado")`;
   - `inserirAuditado(tx, usuarios_contas, { usuario_id, provedor_id: "credential", conta_id: usuario_id, senha_hash: await kdf.hash(senha) }, ctx, "usuario_criado")` — **o mesmo `kdf.hash` configurado em `emailAndPassword.password.hash`**, senão o `verify` do BA nunca bate;
   - usar `inserirAuditado` (e não `tx.insert`) mantém a trava do modelo de dados (`.insert(` só em `mutacoes.ts`) intacta: nenhuma exceção nova.
   - a política de senha roda **antes** do consumo do token; erro depois do consumo desfaz a transação e o token volta a `usado_em IS NULL`.
   - **Trava obrigatória**: teste de integração que, depois do convite, autentica com `auth.api.signInEmail` — é o único jeito de provar que o formato do hash bate com o `verify` da biblioteca.
5. **E-mail já existente**: resposta **idêntica** à do caso novo e **nenhuma** coluna alterada (C11 — o convite nunca sobrescreve identidade existente; é o pré-sequestro da Microsoft 2022).
6. A action conclui criando a **sessão provisória** por `auth.api.signInEmail` (passa pelo item 3 de `podeCriarSessao`) e grava `convite_usado`.
7. Passkey com UV **ou** TOTP verificado → `ativo = true`, `two_factor_enabled = true`, `precisa_configurar_fator = false`, revoga a sessão provisória e exige login novo (F4). Grava `fator_adicionado`.

**Semeadura do primeiro dono** (`01-dados.md §5.7`): `scripts/primeiro-dono.ts` roda só se `count(*) FROM usuarios WHERE papel = 'dono' AND is_deleted = false` for 0, emite um convite `bootstrap = true, papel = 'admin'`, imprime o link uma vez e grava `dono_semeado` com `ator_tipo = 'sistema'`. No consumo, dentro da mesma transação, se o convite é `bootstrap` **e** `count(dono ativo) = 0`, o usuário nasce com `papel = 'dono'`. É o único caminho que cria um dono sem outro dono, é auditado, só funciona uma vez e **não** precisa de `dono` no CHECK de `usuarios_convites`. `scripts/primeiro-admin.ts` **não existe**; o script do `package.json` é `"primeiro-dono": "tsx scripts/primeiro-dono.ts"`.

**Mínimo 1 dono, máximo 2**: o piso é garantido por `SELECT ... FOR UPDATE` dentro da transação de rebaixar/desativar/transferir (INV-31). O teto de 2 é garantido pelo **mesmo** `FOR UPDATE` em `transferirPosse`, que recusa quando já há 2 donos ativos. Promessa sem mecanismo é tela que promete o que o código não faz (I6). Teste de corrida obrigatório (T14).

### 9.3 Trocar de fator e perder os dois (REQ-D10/D11)

Não existe "desligar 2FA", "ler a semente" nem "regenerar códigos" por HTTP — os caminhos respondem 404 sem corpo (G5). A única porta é `substituirFator()` em `actions/seguranca.ts`: reautenticação com um fator **existente** há ≤ 5 min → cadastra o novo → remove o antigo → **nunca** deixa a conta com zero fatores.

Perda dos dois = **recuperação assistida** (E7): permissão `usuarios:recuperar_fator`, `exigirAlvoPermitido`, motivo 8–255, confirmação de identidade registrada, **trilha `recuperacao_assistida` antes do efeito e na mesma transação**, e o efeito é: remove fatores, revoga sessões, `precisa_configurar_fator = true`, dispara link de reset de senha. A conta continua entrando pelo login normal e cai no gate — é o item 3 de `podeCriarSessao` que torna isso possível. Runbook em `docs/seguranca/runbook.md`.

### 9.4 Gates de sessão reduzida (REQ-E11)

`exigirSessao()` aplica, nesta ordem, **em página e em action**:

| Estado do usuário | O que a sessão alcança | Fora disso |
|---|---|---|
| `precisa_configurar_fator = true` (provisionamento, recuperação assistida) | **só** `/primeiro-acesso` e as actions dessa pasta | `403 FATOR_OBRIGATORIO` (a UI redireciona) |
| `precisa_trocar_senha = true` | **só** `/perfil/seguranca` (trocar senha) e `/sair` | `403 TROCA_OBRIGATORIA` |
| plena | tudo o que a matriz permitir | — |

Não há coluna nova em `usuarios_sessoes`: "sessão provisória" é derivada do usuário, que é lido do banco a cada requisição porque `cookieCache` está desligado. Teste: sessão provisória não abre nenhuma outra rota e morre ao concluir o fator.

---

## 10. Sessão

| Item | Decisão | REQ / armadilha |
|---|---|---|
| Token | opaco (CSPRNG do BA), validado **no banco** a cada requisição | F1 |
| Cookie | `__Secure-merlo.session_token`; `HttpOnly; Secure; SameSite=Lax; Path=/` | F1 |
| Teto absoluto | **12 h**, `disableSessionRefresh: true` — não renova com uso | F2 |
| Inatividade | **60 min** pelo guard (`ultimo_uso_em`), atualizado no máx. a cada 5 min e só em requisição iniciada pela pessoa | F3 |
| Papel / `ativo` / `loja_id` / gates | lidos do banco a cada requisição | H6, CVE-2026-67337 |
| Sessão nova a cada autenticação | a pré-2FA é apagada pelo plugin; a provisória do convite é revogada ao concluir o fator | F4 |
| **Reautenticação** | cria **sessão nova** (revogando a atual) e carimba `reautenticada_em = now()`. Assim `created_at` volta a ser recente e o `freshAge` **nativo** do BA passa a concordar com `exigirSessaoFresca()` — sem isso, endpoints do BA que exigem frescor (cadastro de passkey) ficariam travados para sempre depois de 15 min | F9, G11 |
| Revogação em massa | desativar conta, trocar papel/loja, remover fator, reset, recuperação assistida → `internalAdapter.deleteUserSessions(userId)` em `sessoes.ts` | F5 |
| Listar sessões | **projeção** `id, ip, agente, created_at, expira_em, atual` — a coluna `token` nunca entra no `select` | F6, G13 |
| Encerrar | uma (por `id`, dentro das do próprio usuário) ou todas as outras; exige `exigirSessaoFresca()` | F6, F9 |
| Simultâneas | **3 por pessoa**, **2** para `dono`/`admin`; ao exceder, `aposCriarSessao` derruba a mais antiga e grava `sessao_encerrada` com `motivo = 'teto_de_sessoes'` | F14 |
| Logout | `POST /api/auth/sign-out` + `Clear-Site-Data` | F8, F13 |
| **Limpeza** | **não existe job de limpeza.** Sessão e verificação vencidas são inertes: toda leitura filtra `expira_em > now()`, e o volume de uma equipe de dez pessoas não justifica escrever um `DELETE` que a regra da casa proíbe, o hook bloqueia e a trava T25 reprova. O único delete físico de auth continua sendo o que a biblioteca faz por dentro (S-09) | F10 |
| Nunca | token em URL, `localStorage`, `sessionStorage` ou payload JSON/RSC; página autenticada sem `Cache-Control: no-store` | F13 |

**Exceção declarada (REQ-K3)**: `usuarios_sessoes.token` é gravado **em claro** (`01-dados.md §5.3`) porque a 1.7.5 não oferece hash do token de cookie. Isto **não** é "atendido": vai como `// EXCECAO-SEG: REQ-K3 | Better Auth 1.7.5 não hasheia o token de sessão | arquitetura de segurança | ate 2026-12-15` + ADR 0008, com compensações obrigatórias: `pg_dump` cifrado com `age` antes de sair do servidor, acesso de leitura ao banco nominal (papel `merlo_migracao`, nunca compartilhado), e alerta quando uma sessão é usada de IP ou agente muito diferente do de criação. Revisão a cada minor do BA.

---

## 11. Perfil e ações administrativas

### 11.1 `/perfil/seguranca` (`actions/seguranca.ts`) — REQ-G1..G8

Alcançável de **qualquer** sessão plena (e também durante `precisa_trocar_senha`, com escopo reduzido), sem chave na matriz. Tem: trocar senha (requisitos ao vivo, mesmo módulo do servidor) · cadastrar/substituir TOTP · cadastrar, renomear e remover passkey (nome, criada em, sincronizada, fabricante por AAGUID) · listar e encerrar sessões · estado (fatores ativos, senha alterada em, últimos 20 eventos da própria conta vindos de `auth_eventos`).

**Não tem**: desligar o 2º fator, códigos de resgate, token de sessão. E **nenhuma action desta área recebe `usuarioId`**: o alvo é sempre `exigirSessao().usuarioId` (trava T11). Remover passkey confere o dono na própria action, além do BA (CVE-2025-71400 era exatamente um IDOR nesse caminho).

### 11.2 Administração (`actions/usuarios.ts`) — REQ-H1..H4, E7, E8

Toda ação sobre conta alheia: `exigirSessaoFresca()` + `exigirPermissao` + `exigirAlvoPermitido` (§2.3) + `motivo` (Zod 8–255) + trilha com ator, alvo, antes e depois. `ModalConfirmacaoBlock` de 3 s na UI (`components/comum/modal-confirmacao-block.tsx`) para desativar, promover, transferir posse, resetar acesso e recuperar fator.

| Action | Regra |
|---|---|
| `convidarUsuario` | escada de §2.3; `admin` só pelo `dono`, com `ciencia_versao` |
| `promoverAAdmin(alvoId, motivo, ciencia)` | só `dono`; ciência textual versionada (`CIENCIA_ADMIN_V1`) digitada; **`admin_promovido` gravado antes do UPDATE, na mesma transação** (falha na trilha = não concede); auto-alvo recusado; revoga sessões do alvo |
| `transferirPosse(alvoId, motivo, ciencia)` | só `dono`; mesma cerimônia; `FOR UPDATE` garantindo ≥ 1 e ≤ 2 donos; grava `posse_transferida` antes do efeito |
| `rebaixarAdmin` / `desativarUsuario` | `SELECT ... FOR UPDATE` garantindo `count(dono ativo) ≥ 1` e `count(admin ativo) ≥ 1` (INV-31); sem auto-alvo (INV-32); revoga sessões; desativar conta em provisionamento também fecha o provisionamento (§4.3) |
| `iniciarResetDeSenha(alvoId, motivo)` | dispara o e-mail de reset ao alvo e revoga as sessões dele; **`recuperacao_assistida`/`reset_solicitado` gravado antes, na transação**. **Nunca** define senha — nenhuma action aceita `novaSenha` com `usuarioId` de terceiro (E8). **Cooldown de 60 s por conta-alvo** (`reset:<usuarioId>`, `SET NX EX 60` no Redis) conferido **antes** de enfileirar o e-mail; a resposta é idêntica com ou sem cooldown (D18) |
| `recuperarAcessoAssistido` | §9.3 |
| `destravarConta` | §7.1 |
| `encerrarSessoesDe(alvoId)` | `usuarios:encerrar_sessoes` |
| `iniciarTrocaDeEmail` | grava linha em `usuarios_trocas_email` (`01-dados.md §5.9`) com `codigo_hash` de 6 dígitos (10 min) enviado ao **novo** endereço; o próprio usuário confirma com sessão fresca; aviso ao **antigo** com instrução de contestação; até confirmar, o reset continua indo ao antigo (E12). `usuarios.email_pendente` **não existe** |

Nenhum update espalha o corpo (`...input`) sobre a linha: campo de privilégio só por action dedicada (H12).

### 11.3 Avisos ao dono da conta (REQ-D12/D13)

E-mail em: senha trocada ou resetada, fator adicionado/removido, passkey adicionada/removida, e-mail trocado (ao **antigo**), recuperação assistida concluída, conta bloqueada. Texto: o que mudou, quando, IP aproximado e "não foi você? fale com &lt;contato&gt; e peça bloqueio". Remetente `seguranca@<dominio>`, separado do de campanhas, com SPF/DKIM/DMARC (`p=quarantine` no mínimo) — D16. O worker (fila `emails`, job `email-seguranca`) confere o **retorno** do provedor: `{success:false}` sem exceção é a armadilha registrada; falha → `email_seguranca_falhou`, e a resposta HTTP segue genérica.

---

## 12. Superfície de máquina

Um wrapper, `rotaDeMaquina()` (`src/lib/seguranca/maquina.ts`), na ordem **fixa** (REQ-I2):

teto por **IP** → teto por **integração** → `content-length` → leitura com teto (256 KB) → carregar integração/credencial → validade (`is_deleted`, `status`) → **assinatura/segredo sobre o corpo cru** (`timingSafeEqual`) → anti-repetição (id do evento ou `ts` ± 5 min) → persistir evento em `lojas_integracoes_eventos` → enfileirar → 200. **Nenhum `JSON.parse` antes de autenticar** (INV-48).

| Superfície (R1) | Autenticação | Notas |
|---|---|---|
| WhatsApp oficial / Instagram (Meta) | HMAC-SHA256 do **corpo cru** com `META_APP_SECRET`, header `X-Hub-Signature-256: sha256=<hex>`, `timingSafeEqual`. GET de challenge com token **por canal** (`WHATSAPP_VERIFY_TOKEN`, `INSTAGRAM_VERIFY_TOKEN`) | INV-44/45; token compartilhado entre canais era a falha antiga |
| uazapi | segredo **por integração** em header `x-uazapi-secret`, guardado como SHA-256 em `lojas_integracoes.segredo_webhook_hash`, comparado por `timingSafeEqual` dos hashes. **Nunca** `?segredo=` (D-10/I15) | rota `/api/webhooks/uazapi/[integracaoId]` |
| Facebook, TikTok Shop | **não existem** (S-16): sem rota, sem adaptador, sem segredo no ambiente | o valor segue no CHECK de `provedor`, custo zero |
| Pagamento | **não existe na v2** (S-11) | entra com a assinatura do provedor escolhido |
| Crons | **não existem** (S-14): jobs do worker BullMQ (`upsertJobScheduler`, nunca `repeat`) | some a superfície pública |
| OAuth Bling (o sistema como **cliente**) | `state` = HMAC(`INTEGRATIONS_STATE_KEY`, `nonce.expira.usuarioId`), validade 5 min, **uso único** (`SET NX` no Redis) e amarrado ao cookie `__Host-merlo.oauth_nonce` (HttpOnly, SameSite=Lax); `redirect_uri` fixo de env; PKCE S256 onde houver; troca do `code` só no servidor; o callback reconfere que o iniciador ainda é `admin` ativo | D-11 |

**Isonomia da recusa de máquina** (rota com `integracaoId` na URL): `401` com **corpo nulo**, sem `reason`, **com o mesmo piso de tempo**, para os três casos — integração inexistente, integração revogada e assinatura inválida. Quando não há segredo carregado, a comparação roda mesmo assim contra um hash fixo, por `timingSafeEqual`: sem isso dá para descobrir quais UUIDs existem comparando forma e tempo das respostas. O teto por IP **e** por `integracaoId` é aplicado **antes** de tocar o banco, o que também tira a rajada dirigida a uma integração específica.

Regras comuns: segredo ausente no ambiente ⇒ **recusa** (403/401), nunca "aceita porque não configurou" (INV-43). Segredo só em cabeçalho (I15). `grep -nE "(SECRET|TOKEN)[^\n]*(===|!==)"` tem de vir vazio. Idempotência por id do evento (único parcial `(provedor, evento_externo_id)` em `lojas_integracoes_eventos` + `jobId` determinístico, sem `:`). Evento de integração sem loja é descartado com registro, nunca vira contato "chutando" a loja (INV-53/I9) — e o `CHECK integracoes_rede` (`01-dados.md §6.3`) já torna "canal sem loja" impossível no banco. `ip_allowlist` não se aplica (Meta não publica faixas estáveis) — decisão escrita.

Worker e app são processos do mesmo serviço: nenhuma identidade trafega por cabeçalho. Nenhum handler lê `x-user-id`, `x-loja-id` ou `x-roles` (I13).

---

## 13. Cofre de credenciais (`src/lib/seguranca/cofre.ts`, REQ-K2/K3)

AES-256-GCM, IV de 12 bytes aleatório por operação, tag de autenticação, **AAD = `lojas_integracoes.id`** (coluna `credenciais_aad`), envelope versionado `v1:<iv>:<tag>:<cifrado>` em base64url, gravado em `credenciais_cifradas`. Chave **dedicada** `INTEGRATIONS_KEY` (32 bytes), **nunca** derivada do segredo de auth (o contraexemplo é `hug/src/lib/security/secrets.ts:30-38`: girar o segredo de auth invalidaria todas as credenciais). Chave ausente ou de tamanho errado → `CofreError` e a rota responde 503 — **jamais** grava em texto plano. Adulteração de texto, tag, IV ou versão → erro genérico. A tela vê só as chaves e os 4 últimos caracteres; credencial ilegível vira `{erro:"ilegivel"}` sem derrubar a listagem. `INTEGRATIONS_KEY` diferente em HML e PRD; plano de rotação (`v2:`) no runbook. Desconectar apaga o campo cifrado e marca a linha excluída, preservando a trilha.

Nada de valor fica em claro no banco (K3): token de convite, de reset e de troca de e-mail (hash), semente TOTP (cifrada pelo BA), segredo de webhook (hash), credenciais de integração (cifradas). **A exceção é o token de sessão** — §10.

---

## 14. Borda: cabeçalhos, CSP, origem e CSRF

### 14.1 Cabeçalhos (`next.config.ts` → `headers()`, REQ-J4)

`Strict-Transport-Security: max-age=31536000; includeSubDomains` · `X-Content-Type-Options: nosniff` · `Referrer-Policy: strict-origin-when-cross-origin` · `X-Frame-Options: DENY` + `frame-ancestors 'none'` · `Permissions-Policy: camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self)` · `Cache-Control: no-store` em toda página e resposta autenticada · `poweredByHeader: false`.

### 14.2 CSP (REQ-J5, S-13)

**Entra em enforce na primeira entrega**, com a política que se sabe segura:

```
default-src 'self'; script-src 'self' 'nonce-<por requisição>'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:;
connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
```

- O nonce é gerado no `src/proxy.ts` por requisição. **Consequência escrita no ADR**: nonce por requisição obriga renderização dinâmica — nenhuma rota de `(app)` usa `generateStaticParams` nem cache estático. O app é 100% autenticado e já era dinâmico, então o custo é conhecido e aceito.
- `img-src` **não** lista o host público do MinIO: o bucket é privado e a URL persistida é sempre a rota interna `/api/midias/[id]` (§15). Se algum dia o host aparecer sendo necessário, o achado é outro (alguém está servindo mídia por fora do portão).
- `Report-Only` existe **em paralelo**, e só para endurecer (`strict-dynamic`, remover `style-src 'unsafe-inline'`), com coletor próprio (`/api/csp` via `rotaPublica`, 16 KB, limitado, sem persistência longa). Prazo para fechar o endurecimento: **15/12/2026**, com `// EXCECAO-SEG: REQ-J5 | style-src 'unsafe-inline' enquanto o Tailwind v4 injeta estilo | arquitetura de segurança | ate 2026-12-15`.
- `'unsafe-inline'` em `script-src` reprova no CI, sem exceção.

### 14.3 Origem e CSRF (REQ-J1/J3/J7)

- `origemEsperada()` = `new URL(env.APP_URL).origin`, **uma** função. Nunca `request.url`, `nextUrl.host`, `Host` ou `X-Forwarded-Host` — atrás do Traefik esses valores são do proxy, não do cliente (T21).
- **Toda** Server Action mutante passa por `conferirOrigem()`: as autenticadas por dentro de `acao()`, as anônimas por dentro de `acaoPublica()`. Exige `Origin` igual à esperada **ou** `Sec-Fetch-Site: same-origin`; `Origin` **ausente** → recusa. Motivo: o Next deixa passar requisição sem `Origin` só com um aviso (N2) e `Origin: null` já burlou a proteção nativa (CVE-2026-27978). Teste: POST de action pública com `Origin: https://evil.example` e com `Origin` ausente → 403.
- `callbackURL` / `redirectTo` / `?volta=` só aceitam caminho relativo de lista interna (`/^\/(?!\/)[\w\-\/]*$/` + prefixos permitidos): `https://evil.example`, `//evil.example` e `/\evil.example` caem em `/` (CVE-2025-53535, INV-40).
- `next.config` sem `rewrites`/`redirects` montados a partir de parâmetro do request (CVE-2026-64645).

---

## 15. Upload e mídia privada

- Bucket MinIO **privado** (`mc anonymous set none`). A URL persistida é sempre a rota interna **`GET /api/midias/[id]`** (`?miniatura=1`), nunca a do bucket. `/api/media/[id]/raw` do rascunho **não existe** (`01-dados.md §13.2`).
- Essa rota chama `exigirSessao()` **e** o escopo de loja, responde `Cache-Control: private, no-store` e **não** assina nada. Mídia de outra loja = 404.
- **Exceção escrita**: a rota **serve mídia com `is_deleted = true` quando ela é referenciada por uma mensagem** (`01-dados-dominio.md §3.1`, RN-M06) — senão a foto some do histórico. Vai no código como `// EXCECAO-SEG: RN-M06 | histórico de mensagem precisa do binário | arquitetura de segurança | ate 2027-09-15` e é a **única** entrada na lista branca da trava T25. Teste obrigatório: mídia excluída **referenciada** continua sendo servida; mídia excluída **não referenciada** responde 404.
- `conversas_mensagens_midias.url_externa` é coluna de trabalho do job de download e **nunca** entra em DTO (trava própria do modelo de dados): a URL do provedor é pública e contornaria o portão.
- Quem baixa de fora (Meta/uazapi) recebe URL assinada gerada **no envio**, TTL 600 s, nunca persistida.
- Chave `{loja}/{origem}/{uuid}.{ext}`: extensão minúscula, nome original nunca vira chave, `..` não escapa, sem extensão → `.bin`.
- Allowlist fechada de MIME (**sem SVG, HTML ou executável**), conferida contra os magic bytes, ignorando parâmetro e caixa do `content-type`; tetos por tipo (imagem 5 MB, vídeo/áudio 16 MB, documento 100 MB); vazio 400, acima 413, tipo recusado 415. Corte pelo `content-length` **antes** de ler o corpo e reconferência do tamanho real depois.
- Mídia privada não passa por `next/image` (`unoptimized`): o Next 16.3.3 desligou a otimização AVIF por RCE (GHSA-2xp9-vwfh-vxw4) e `images.dangerouslyAllowLocalIP` bloqueia o MinIO local.
- Excluir mídia marca a linha; o binário sai pelo job `limpar-midia` (fila `manutencao`) **90 dias** depois (`01-dados-dominio.md §3.1`) e na anonimização LGPD. O backup do bucket sai junto do `pg_dump`, antes de deploy em PRD.

---

## 16. LGPD

- **Anonimização, não exclusão física** (S-12, ADR 0013): `anonimizarContato(contatoId, protocolo, motivo)` segue a ordem exata de `01-dados-dominio.md §8` — trilha `lgpd_anonimizado` em `auditoria_eventos` **antes** do efeito (o efeito destrói o estado anterior), depois os `UPDATE`s, e o binário sai **fora da transação**, pelo job idempotente. É a única exclusão física do sistema, e ela é de arquivo, não de linha.
- Escopo **por loja** (DN-05): a mesma pessoa nas duas lojas são dois contatos; a tela avisa.
- Permissões `lgpd:exportar`, `lgpd:anonimizar`, `lgpd:registrar_solicitacao` para `dono`/`admin`/`gerente`; **viewer não** (S-15).
- Tudo com motivo/protocolo, modal block de 3 s e trilha sem PII no evento.
- Dossiê de acesso: passa pelo escopo de loja, sai paginado com `no-store`, e o download é registrado (`lgpd_exportado`).
- Consentimento e opt-out: gravados por `registrarConsentimento()` com o IP resolvido por `ipDoCliente()` no servidor, **nunca** vindo do corpo (D-04 forjava a prova de consentimento). **Opt-out é de marketing**: bloqueia campanha e agendamento promocional, não bloqueia a resposta 1:1 do atendimento (`01-dados-dominio.md §7.2`). O filtro de campanha lê `consentimentos`, não o espelho `contatos.opt_out`.

---

## 17. Trilha de auditoria

Duas tabelas append-only (`01-dados.md §7`), marcadas `compliance:append-only`, com `REVOKE UPDATE, DELETE, TRUNCATE` + trigger `trilha_imutavel()`:

- **`auth_eventos`** — funil de sessão e segurança. Tipos: a constante `TIPOS_AUTH_EVENTO` (33 valores, `01-dados.md §7.1`). Nenhum evento fora dela existe; `detalhes` é `{ rota?, acao?, papel?, tentativas?, contagem? }` e o **motivo é coluna própria**.
- **`auditoria_eventos`** — ações de negócio, com `antes`/`depois` e `"(alterado)"` no lugar do valor para campo de `CAMPOS_PII`.

Regras:

1. **Funil único de entrada**: `databaseHooks.session.create.after` cobre **todo** caminho que cria sessão. Nenhuma lista de rotas decide o que é login. A sessão pré-2FA (criada e apagada pelo plugin) vira `senha_aceita_aguardando_2fa`, nunca `login_sucesso` (L2).
2. **Política de gravação por tipo de evento, não por tabela** (fecha o conflito entre os rascunhos):
   - **best-effort** (`registrarEventoAuth` nunca lança: `try/catch` em volta de tudo, `.catch` na promessa e `Promise.race` com teto de 3 s; falha → log CRITICAL): entrada e saída de sessão — `sessao_criada`, `login_sucesso`, `login_falha`, `logout`, `sessao_encerrada`, `senha_aceita_aguardando_2fa`, `recusa_403`, `sonda_caminho_desligado`, `webhook_recusado` e os eventos de infraestrutura (`limitador_indisponivel`, `hibp_indisponivel`, `ip_cadeia_inesperada`, `email_seguranca_falhou`). Trilha não pode impedir alguém de entrar (REQ-L3).
   - **fail-closed, gravada ANTES do efeito e na mesma transação**: `admin_promovido`, `admin_rebaixado`, `posse_transferida`, `papel_alterado`, `usuario_desativado`, `reset_solicitado` iniciado por admin, `recuperacao_assistida`, `dono_semeado`, `convite_emitido` com papel `admin` — mais `lgpd_anonimizado` e `dispensado_masc`, que vivem em `auditoria_eventos` (`01-dados.md §7.4`). Se a trilha falhar, o efeito não acontece. É o defeito D-13 do sistema antigo (auditoria best-effort até para troca de papel) que isso fecha.
   - T20 testa os **dois** lados: o best-effort que não derruba o login, e o fail-closed que derruba a promoção.
3. **Nunca** na trilha ou no log: senha, hash, token de sessão/reset/convite, OTP/TOTP, semente, segredo de integração, corpo cru de webhook. O logger (pino) tem `redact` de `password`, `newPassword`, `currentPassword`, `token`, `code`, `secret`, `authorization`, `cookie`.
4. Erro do driver `pg` nunca vai cru ao log: `sanitizarErroBanco(e)` remove `detail`, `where` e `parameters` — o `detail` de violação de UNIQUE carrega `Key (email)=(valor)` (K4).
5. **Alertas** deduplicados (`SET NX EX 3600`) para: `conta_bloqueada`, `email_seguranca_falhou`, `sonda_caminho_desligado`, `senha_aceita_aguardando_2fa` sem `login_sucesso` em 10 min, rajada de `webhook_recusado`, `admin_promovido`, `posse_transferida`, `dono_semeado`, `limitador_indisponivel`, `hibp_indisponivel`, `ip_cadeia_inesperada`.
   **Canal e conteúdo**: o **e-mail aos admins** leva o conteúdo; o **Discord da equipe** leva só `"Evento de segurança: <tipo>. Veja em /auditoria/seguranca"` — sem nome, e-mail, IP ou alvo. Discord é canal de terceiro, sem controle de retenção, e quem tiver a URL escreve nele; mandar para lá o mapa de quem é admin e quando o sistema está sob ataque é entregar o reconhecimento de graça. A URL (`DISCORD_WEBHOOK_ALERTAS`) é segredo rotacionável no runbook.
6. **Tela**: aba **`/auditoria/seguranca`** (`seguranca:ler_eventos`), com filtro por tipo, usuário e período. `/configuracoes/seguranca` **não existe** (`01-dados.md §13.2`) — a pessoa não distingue "as duas trilhas", e as três abas de auditoria já são o lugar onde ela procura.

---

## 18. Segredos, ambiente e seed

- **Nenhuma senha literal** em seed, README, `CLAUDE.md`, docs ou teste; **nenhum seed no entrypoint do container** (nem `Dockerfile`, nem `docker-entrypoint`, nem `scripts.start`).
- Primeiro operador: `scripts/primeiro-dono.ts` (§9.2). Não aceita senha. Substitui o `/api/register` público do sistema antigo, que tinha TOCTOU e ficava exposto depois de todo deploy com banco vazio (D-02).
- Seed de dados: só lojas e catálogos (DN-04), nunca usuário com credencial.
- **`src/lib/env.ts` é a dona da verdade** (`01-dados.md §13.5`): toda variável obrigatória por ambiente, validada com Zod, `throw` no boot, **sem** `process.env.X || "literal"`, e `process.env` só nesse arquivo (K1). `.env.example` e esta seção são **conferidos a partir dela** pela trava T17, que reprova (a) `.env.example` incompleto e (b) **variável citada em documento e ausente do `env.ts`**.
- Segredos dedicados ≥ 32 bytes, diferentes em HML e PRD: `BETTER_AUTH_SECRETS` (versionados), `INTEGRATIONS_KEY`, `INTEGRATIONS_STATE_KEY`, `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `INSTAGRAM_VERIFY_TOKEN`, `AUTH_EMAIL_HASH_KEY` (HMAC do e-mail em `auth_eventos`). `FACEBOOK_VERIFY_TOKEN` e `TIKTOK_SHOP_APP_SECRET` **não existem** (S-16). `gitleaks` no CI.
- Variáveis de segurança que faltavam no `.env.example` da arquitetura e agora são obrigatórias: `AUTH_EMAIL_HASH_KEY`, `PISO_RECUSA_MS` (`z.coerce.number().int().min(300)`, default 450), `DATABASE_URL_MIGRACAO` (papel `merlo_migracao`). `PROXIES_CONFIAVEIS` **sai** do `.env.example`: é constante versionada (§7.3).
- Interruptores com default seguro (M3): `AUTH_PASSKEY_HABILITADA=true`, `AUTH_HIBP_HABILITADO=true` (fail-open), `PISO_RECUSA_MS=450`.
- Versões conferidas no **lockfile** (M2): `next ≥ 16.3.3` (recomendado 16.3.5), `better-auth ≥ 1.7.3` (1.7.5), `@better-auth/*` **iguais** ao core, `drizzle-orm 0.45.2` (CVE-2026-39356 — nome de coluna dinâmico só por mapa fechado, nunca `sql.identifier()` com string do cliente), `@node-rs/argon2` estável. `npm audit --omit=dev --audit-level=high` limpo; Renovate semanal.
- **`scripts/check-compliance.mjs` do repositório novo nasce com o marcador `compliance:framework`** (`01-dados.md §4.3`): a versão da base mais uma constante e uma cláusula na janela de 600 caracteres, com **dois** casos novos em `tests/check-compliance.test.mjs` (aceita a tabela marcada; continua acusando a não marcada). O PR para a estrutura base é assíncrono e não bloqueia o commit 0. As 4 tabelas marcadas são `usuarios_sessoes`, `usuarios_verificacoes`, `usuarios_totp`, `usuarios_passkeys` — usar `compliance:append-only` nelas seria mentira gravada no marcador, já que a biblioteca apaga por dentro.

---

## 19. Cobertura do catálogo REQ-A1..M6

Legenda: ✅ atendido · ⚠ atendido com exceção escrita (não conte como verde) · ⚪ não se aplica, com decisão escrita.

| REQ | Como é atendido / por que não se aplica |
|---|---|
| A1 ✅ | `docs/seguranca/caminhos-de-acesso.md` + manifesto `rotas-publicas.ts`; toda linha com portão, limitador e trilha |
| A2 ✅ | §5.2: caminhos sem chamador desligados, 404 **sem corpo**, `disabledPaths` com a mesma constante, varredura do pacote instalado (T3) e 5 escritas por caminho (T7) |
| A3 ✅ | §3.2/§3.3: `acao()` ou `acaoPublica()` em **todo** export `'use server'`; portão no início de todo handler |
| A4 ✅ | `rotaDeMaquina` × `exigirSessao` isolados; códigos distintos |
| A5 ✅ | portão em page/layout/handler/action; `proxy.ts` só UX |
| A6 ✅ | área pública enumerada; `acaoPublica` obrigatória, com origem **e** teto por IP; tokens em `#` |
| A7 ⚪ | sem login social/OIDC/SAML (`accountLinking.enabled:false`). OAuth Bling é cliente de API → I14 |
| A8 ⚪ | sem GraphQL/tRPC/gRPC; Server Actions são N endpoints POST, cobertos por A3 |
| B1–B10 ✅ | §6 (KDF, 15–128, HIBP fail-open, sem composição/expiração, histórico fail-closed, tetos, política só onde grava, troca com frescor) |
| C1 ✅ | §7.1, `UPDATE` atômico único, `= 5`, sem contar falha durante o bloqueio |
| C2 ✅ | §7.2, Redis compartilhado, fail-open com alerta |
| C3 ✅ | bloqueada/desativada recusada antes do KDF, sem contar falha |
| C4 ✅ | §8, recusa única byte a byte + piso com mínimo validado; gates fora da recusa |
| C5 ✅ | nenhuma escrita por requisição anônima antes do limitador |
| C6 ✅ | §7.3, uma função, um salto confiável, constante versionada |
| C7 ✅ | aviso à vítima com dedupe **no banco**, enfileirado |
| C8 ✅ | `disableSignUp`, sem conta padrão, seed fora do entrypoint, primeiro dono por CLI |
| C9 ✅ | passkey entra com conta bloqueada e zera o contador (§4.3) |
| C10 ⚪ | sem auto-cadastro, sem social, sem magic link/e-mail OTP |
| C11 ✅ | convite nunca sobrescreve identidade existente; resposta idêntica; consumo e criação na mesma transação; `criarUsuarioPorConvite` com o mesmo KDF |
| D1 ✅ | 2º fator no provisionamento; gate `precisa_configurar_fator`; SQL de fumaça = 0 contas ativas sem fator |
| D2 ✅ | passkey em produção, `rpID` da mesma `APP_URL`; obrigatória para `dono`/`admin` |
| D3 ⚪ | sem OTP por e-mail (S-07) |
| D4 ✅ | sem SMS/telefone em nenhum papel |
| D5 ✅ | TOTP com `accountLockout` 5/900 s + `customRules`; código nunca em log |
| D6 ✅ | semente cifrada com `secrets`; **anti-replay no banco** (`ultimo_passo_totp`), não no Redis |
| D7 ⚪ | sem códigos de resgate (G4); rotas desligadas e teste que prova resposta sem `backupCodes` |
| D8 ✅ | `userVerified` exigido no cadastro e no login; cadastro com sessão fresca |
| D9 ✅ | `podeCriarSessao` recusa inativo/excluído em todo caminho, inclusive passkey |
| D10 ✅ | 4 caminhos desligados; `substituirFator` com reautenticação e piso de 1 fator |
| D11 ✅ | adicionar/substituir fator exige o fator atual (ou a sessão provisória do 1º acesso) |
| D12–D13 ✅ | §11.3, com conferência do retorno do provedor |
| D14 ✅ | login oferece passkey como ação primária; senha+TOTP em "outras opções" |
| D15 ✅ | `trustDeviceMaxAge: 0` **e** `hooks.before` recusando `trustDevice` |
| D16 ✅ | remetente `seguranca@` com SPF/DKIM/DMARC, separado de campanhas |
| D17 ✅ | desafio 2FA amarrado ao login, cookie de 5 min |
| D18 ✅ | cooldown de 60 s por conta-alvo (`reset:<usuarioId>`, `SET NX EX 60`) antes de enfileirar, resposta idêntica; sem CAPTCHA (sistema interno — decisão escrita) |
| E1–E6 ✅ | §8, §6, §11.2 (resposta e tempo idênticos, token hasheado e atômico, `revokeSessionsOnPasswordReset`, `autoSignIn:false`, `aposSenhaGravada` única, sem pergunta secreta) |
| E7 ✅ | recuperação assistida com motivo, identidade registrada e trilha antes, na transação |
| E8 ✅ | admin **inicia** reset e revoga sessões; nunca define senha |
| E9–E10 ✅ | política antes do consumo do token; vocabulário sem "token/link/expirado" |
| E11 ✅ | §9.4, gates em página **e** action, com login liberado para quem precisa passar por eles |
| E12 ✅ | `usuarios_trocas_email`, confirmação pelo dono da conta, aviso ao antigo |
| E13–E14 ✅ | sem senha temporária; `randomBytes(32)`; reset não alimenta o bloqueio |
| F1–F14 ✅ | §10 (F11: DBSC avaliado e não adotado — teto + revogação cobrem) |
| G1–G8 ✅ | §11.1 |
| H1 ✅ | `dono` por comparação literal; default `viewer`; CHECK no banco; papel só por action dedicada |
| H2 ✅ | ciência versionada, trilha antes na mesma transação, sem auto-alvo, §2.3 |
| H3 ✅ | `FOR UPDATE` garantindo ≥ 1 dono, ≤ 2 donos e ≥ 1 admin ativos |
| H4 ✅ | motivo obrigatório + ator/alvo/antes/depois |
| H5 ✅ | matriz fail-closed §2.2; menu é reflexo de `pode()`; rota sem mapeamento não renderiza |
| H6 ✅ | papel/loja/`ativo`/gates do banco a cada requisição; mudança revoga sessões |
| H7 ✅ | `dono`/`admin`: passkey obrigatória, máx. 2 sessões, frescor em toda ação de configuração |
| H8 ✅ | `scripts/primeiro-dono.ts` + convite `bootstrap` (§9.2) |
| H9 ✅ | `destravarConta` com motivo e 409 se já livre |
| H10 ✅ | §2.4 + FK composta `(id, loja_id)` |
| H11 ⚪ | sem impersonação; suporte usa recuperação assistida |
| H12 ✅ | todo id do cliente conferido contra a loja resolvida; nenhum update espalha o corpo |
| I1–I15 ✅ | §12 (ordem fixa, 401 corpo nulo com isonomia e piso, teto por IP e por integração antes do banco, idempotência, segredo só em cabeçalho, sem Swagger, sem cron HTTP, sem identidade por cabeçalho) |
| J1–J7 ✅ | §14, com CSP em **enforce** desde a entrega |
| K1 ✅ | §18 |
| K2 ✅ | §13 |
| K3 ⚠ | tudo hasheado ou cifrado, **menos o token de sessão**, que a 1.7.5 grava em claro: `EXCECAO-SEG: REQ-K3` + ADR + compensações (§10) |
| K4 ✅ | `sanitizarErroBanco` |
| K5 ✅ | `timestamptz(3)` em toda coluna de instante (T19, e o modelo de dados já obriga) |
| K6 ✅ | índices listados nas migrações |
| K7 ⚪ | sem MongoDB |
| K8 ✅ | `pg_dump` cifrado (`age`) antes de sair do servidor + **backup do bucket MinIO** junto, antes de deploy em PRD; restauração testada em HML |
| L1–L9 ✅ | §17, com política de gravação por tipo de evento |
| M1 ✅ | §20 + `docs/seguranca/matriz-req-teste.md` |
| M2 ✅ | versões mínimas no lockfile + audit + Renovate |
| M3 ✅ | interruptores com default seguro e piso validado |
| M4 ✅ | `scripts/fumaca-seguranca.mjs` no deploy |
| M5 ✅ | releitura da régua a cada minor do BA/Next, item no PR template |
| M6 ✅ | formato `EXCECAO-SEG` com 4 partes; T24 reprova data vencida |

**Exceções abertas hoje, todas com ADR**: delete físico de linha de auth **pela biblioteca** (S-09, ADR 0008, revisão a cada minor) · **token de sessão em claro** (REQ-K3, §10) · `style-src 'unsafe-inline'` até 15/12/2026 (S-13) · **sem códigos de resgate** (S-07, mitigado por E7) · mídia soft-deletada servida quando referenciada por mensagem (RN-M06, §15) · `dono` e `admin` sem terceiro nível de aprovação (a rede tem 2 pessoas).

---

## 20. Travas (o que reprova o CI)

Pipeline: `lint` → `tsc --noEmit` → `compliance` + `test:compliance` → travas → testes → build → deploy → fumaça.
Os testes de integração sobem o `docker compose` (Postgres 5437 banco `merlostore_test`, Redis 6382). Antes de rodar, o setup confere que o host do `DATABASE_URL` é local e que o nome do banco contém `test` — senão aborta.

| # | Arquivo | Tipo | Reprova quando |
|---|---|---|---|
| T1 | `tests/seguranca/guarda.test.ts` | fonte | handler de escrita ou export `'use server'` sem **`acao()` ou `acaoPublica()`** (por identidade de função, com piso mínimo de arquivos) |
| T2 | `tests/seguranca/inventario.test.ts` | fonte | rota/action fora do manifesto público e sem portão; item do manifesto sem linha em `docs/seguranca/caminhos-de-acesso.md`; rota fora da árvore canônica de `01-dados.md §13.2` |
| T3 | `tests/seguranca/caminhos-ba.test.ts` | fonte | caminho instalado pelo BA (varrido em `node_modules`) fora de `EM_USO ∪ CAMINHOS_DESLIGADOS` |
| T4 | `tests/seguranca/auth-config.test.ts` + `auth-efeito.test.ts` | config + integração | plugin proibido; `nextCookies` fora do fim; passkey sem os dois `afterVerification`; `CAMPOS_BA` com valor que não é coluna; **e os testes de efeito de §4.4** (uuid, XFF, semente após rotação, sem `backupCodes`, cookie de 2FA, UV falso não cria sessão) |
| T5 | `tests/seguranca/recusa-unica.test.ts` | integração | corpo/cabeçalho diferentes entre inexistente, senha errada, desativada, bloqueada e 429; p50 fora de ±50 ms; **conta com gate pendente caindo na recusa** (tem de autenticar) |
| T6 | `tests/seguranca/bloqueio-conta.test.ts` | integração | 8 tentativas **paralelas** não somam 8; a 7ª resposta difere da 1ª; passkey não zera; reset alimenta o bloqueio; martelar estende `bloqueado_ate`; senha atual errada trancando o login |
| T7 | `tests/seguranca/caminhos-desligados.test.ts` | integração | caminho desligado, em qualquer das 5 escritas, com corpo ou status ≠ `/api/auth/nao-existe` |
| T8 | `tests/seguranca/reset.test.ts` | integração | token em claro no banco; dois consumos simultâneos com 2 sucessos; `Set-Cookie` na resposta; sessão anterior viva; link com `?token`; senha fraca queimando o token; cooldown mudando a resposta |
| T9 | `tests/seguranca/sessoes.test.ts` | integração | `token` na projeção/payload RSC; sessão sobrevive a desativação ou troca de papel; renovação por uso; frescor ignorado; 4ª sessão simultânea não derruba a mais antiga; reautenticação que não renova o frescor nativo |
| T10 | `tests/seguranca/passkey-uv.test.ts` | integração | resposta WebAuthn simulada com `userVerified:false` criando sessão; `generate-authenticate-options` respondendo diferente para e-mail existente com passkey, existente sem passkey e inexistente |
| T11 | `tests/seguranca/perfil-sem-userid.test.ts` + `perfil-proibidos.test.ts` | fonte | `userId`/`usuarioId` em action do perfil; chamada a `disableTwoFactor`, `getTOTPURI` fora do cadastro, `generateBackupCodes` |
| T12 | `tests/seguranca/rbac.test.ts` | fonte | invariantes de §2.2 nos dois sentidos (chave usada sem entrada **e** entrada sem tela/action); gerente alcançando `configuracao:*`/`usuarios:*`/`seguranca:ler_eventos`; admin promovendo admin; viewer escrevendo; papel inventado passando |
| T13 | `tests/seguranca/escopo-loja.test.ts` | fonte + integração | handler/action de domínio sem escopo de loja (fatiado por função, com piso); id de outra loja com resposta ≠ 404; loja pedida aceita sem validação |
| T14 | `tests/seguranca/admin-actions.test.ts` | integração | ação sobre conta alheia sem motivo; **alvo de papel igual ou superior aceito**; trilha depois do efeito; corrida deixando zero dono/admin ou três donos; sessões do alvo vivas; admin definindo senha |
| T15 | `tests/seguranca/webhooks.test.ts` | integração | POST forjado escreve linha; recusa com corpo; recusa de integração inexistente diferente da de assinatura inválida (forma ou tempo); `?segredo=` aceito; corpo acima do teto lido; `JSON.parse` antes da assinatura; evento repetido processado 2× |
| T16 | `tests/seguranca/oauth-integracoes.test.ts` | integração | `state` reutilizado, expirado, de outra sessão ou adulterado aceito |
| T17 | `tests/seguranca/segredos.test.ts` | fonte | `process.env.X \|\| "literal"`; `process.env` fora de `env.ts`; `===` com segredo; `.env.example` incompleto; **variável citada em doc e ausente de `env.ts`**; senha literal em `scripts/`, `docs/`, `README`, `CLAUDE.md` |
| T18 | `tests/seguranca/sem-segredo-em-claro.test.ts` | integração | exercita convite, reset, TOTP e conexão de integração e depois encontra o valor emitido em claro no banco (o token de sessão é a exceção nomeada) |
| T19 | `tests/seguranca/timestamps.test.ts` | fonte | `timestamp(` no schema sem `precision: 3` e `withTimezone: true` |
| T20 | `tests/seguranca/trilha.test.ts` | integração | `UPDATE`/`DELETE` permitido na trilha; evento faltando no funil; **hook best-effort que derruba o login**; **evento fail-closed que não derruba o efeito quando falha**; tipo fora de `TIPOS_AUTH_EVENTO`; campo proibido gravado; ação destrutiva que grava a trilha depois |
| T21 | `tests/seguranca/origem.test.ts` | fonte + integração | origem derivada do request fora de `origem.ts`; `x-forwarded-for` fora de `ip.ts`; action **pública ou autenticada** aceitando `Origin` forjado ou ausente; XFF forjado mudando o IP gravado; `PROXIES_CONFIAVEIS` lido de env |
| T22 | `tests/seguranca/cabecalhos.test.ts` | config + integração | cabeçalho de §14.1 ausente; CSP ausente ou em Report-Only puro; `'unsafe-inline'` em `script-src`; host do MinIO em `img-src`; matcher do proxy cobrindo rota de máquina |
| T23 | `tests/seguranca/versoes.test.ts` | fonte (lockfile) | versão abaixo do mínimo; `@better-auth/*` com versão ≠ `better-auth` |
| T24 | `tests/seguranca/excecoes.test.ts` + `matriz-req-teste.test.ts` | fonte | `EXCECAO-SEG` sem as 4 partes ou vencida; REQ do portão sem teste mapeado |
| T25 | `tests/travas/soft-delete.test.ts` | fonte | `db.delete`/`deleteMany`/`tx.delete`/`DELETE FROM` no código; `select` de domínio sem filtro de soft delete **fora da lista branca de um caminho só** (a rota de mídia, §15); delete sobre tabela de trilha |
| T26 | `tests/travas/bling-somente-leitura.test.ts` | fonte | cliente Bling com `PUT/PATCH/DELETE` ou mais de 2 `POST` (ADR 0004) |
| T27 | `tests/travas/rotas-publicas.test.ts` | fonte | segmento `[token]` em rota pública; link de e-mail montado com `?token=` ou `/token`; rota fora do mapa canônico |
| T28 | `tests/seguranca/convite.test.ts` | integração | depois do convite, `auth.api.signInEmail` **não** autentica (formato de hash divergente); convite para e-mail existente alterando coluna; token voltando a valer depois de erro; convite `bootstrap` criando um segundo dono |
| CI-1 | `node scripts/check-compliance.mjs` + `node tests/check-compliance.test.mjs` | script | violação das regras absolutas; auditor sem o marcador `compliance:framework` ou sem os dois casos novos |
| CI-2 | `npm audit --omit=dev --audit-level=high` + `gitleaks detect` | ferramenta | advisory alto em dependência de runtime; segredo no histórico |
| CI-3 | `scripts/fumaca-seguranca.mjs` (pós-deploy HML/PRD) | fumaça | `GET /api/auth/get-session` ≠ 200 (schema do BA, G27); action com origem certa e sem cookie ≠ 401; origem forjada ≠ 403; `POST /api/auth/sign-up/email` ≠ 404 sem corpo; cabeçalhos e **CSP em enforce**; SQL "contas ativas sem 2º fator" ≠ 0; p50 das duas recusas fora de ±50 ms; XFF forjado mudando o IP gravado; `dig TXT _dmarc` vazio |

---

## 21. Nomes e contratos que este documento consome (não redefine)

| Assunto | Fonte única | Valor |
|---|---|---|
| Tabelas, colunas, CHECKs, enums, papéis | `01-dados.md §16`, `01-dados-dominio.md` | 48 tabelas; 5 papéis; `PAPEIS_CONVIDAVEIS` sem `dono`; `TIPOS_AUTH_EVENTO` (33) |
| De-para Better Auth | `src/lib/db/schema/_ba-fields.ts` (`CAMPOS_BA`) | §4.1 |
| Portão | `01-dados.md §13.1` | §3.1 |
| Escopo de loja | `01-dados.md §13.1` + `consultas.ts` | `EscopoLoja`, `condicaoDeLoja()` |
| Mutação | `src/lib/db/mutacoes.ts` | `inserirAuditado`, `atualizarComTrava`, `excluirLogico`, `atualizarContador`, `atualizarEstado` |
| Rotas | `01-dados.md §13.2` | `/entrar` · `/entrar/verificar` · `/primeiro-acesso` · `/esqueci-a-senha` · `/redefinir-senha` (**nenhuma com `[token]`**) · `/perfil/seguranca` · `/auditoria` (+`qualidade`, `excluidos`, `seguranca`) · `/configuracoes/usuarios` · `/api/midias/[id]` |
| Resultado de action | `src/lib/erros.ts` (`01-dados.md §13.3`) | `{ ok:true; dados } \| { ok:false; codigo; mensagem; erros?; valores? }` |
| Formatação | `src/lib/formato.ts` | único módulo de moeda/data/telefone/centavos |
| Componentes de padrão único | `src/components/comum/` | `modal-confirmacao-block.tsx`, `confirmar-exclusao.tsx`, `campo.tsx`, `selo-status.tsx`, … |
| Escopo do R1 | `01-dados.md §13.4` + `src/lib/navegacao.ts` (`fase: "R1" \| "R2"`) | fora: trocas/devoluções, funil, lookbooks, base de conhecimento, CSAT, pagamentos, IA, transcrição, TikTok, Facebook, SLA configurável |
| Filas | `03-arquitetura §8.1` | `manutencao` = `gerar-alertas`, `limpar-midia`, `expirar-convites`, `resumo-diario`, `retencao-eventos`. **Nenhum job de auth apaga linha** (§10) |

**O que a UI precisa materializar**: login com passkey como ação primária e senha+TOTP em "outras opções"; `/primeiro-acesso` e `/redefinir-senha` lendo o token de `location.hash`, limpando com `history.replaceState` e enviando no corpo; `/perfil/seguranca` com tudo de §11.1 e nada do que §11.1 diz que não tem; aba `/auditoria/seguranca` para `auth_eventos`; seletor de loja só para gestão (vendedor vê etiqueta fixa); modal block de 3 s em desativar usuário, promover a admin, transferir posse, resetar acesso, recuperar fator, anonimizar por LGPD, desconectar integração e encerrar todas as sessões; mensagens de senha vindas do **mesmo** módulo do servidor; nenhuma tela que prometa o que o código não faz (U8/I6).

---

## 22. Pendências que dependem de terceiros (não bloqueiam o desenho; bloqueiam o deploy)

| # | O que | Dono | Prazo | O que vale enquanto isso |
|---|---|---|---|---|
| 1 | Medir o comportamento do XFF no Traefik do EasyPanel (apenda ou sobrescreve?) | arquitetura de segurança, em HML | **antes do 1º deploy em HML** | `MAX_SALTOS_CONFIAVEIS = 1` com queda para o socket + `ip_cadeia_inesperada`; o resultado vai para o ADR |
| 2 | Medir o p95 do Argon2id e o teto do semáforo na VPS (`scripts/medir-kdf.mjs`) | arquitetura de segurança, em HML | **antes do 1º deploy em PRD** | `PISO_RECUSA_MS=450`, semáforo em 4, `UV_THREADPOOL_SIZE=8` |
| 3 | Provedor de e-mail transacional + domínio com SPF/DKIM/DMARC (`p=quarantine`) | Paulo | **antes do 1º convite real** | fila `emails` pronta; CI-3 reprova `_dmarc` vazio |
| 4 | Confirmar que **todas** as vendedoras têm aparelho para passkey ou TOTP | Paulo com o cliente | **30 dias antes do deploy em PRD** | **Plano B escrito**: chave de segurança física (FIDO2) por pessoa, comprada antes do deploy. TOTP em aparelho compartilhado da loja é **inaceitável** — é fator único com dono coletivo. Sem confirmação nem chave, o 2º fator obrigatório trava o primeiro acesso de toda a operação no dia da entrega |

---

## 23. Problemas rejeitados (e por quê)

| ID | O que a crítica pediu | Decisão | Motivo |
|---|---|---|---|
| R-01 | Marcar `limpeza-auth` como exceção (`EXCECAO-SEG`) e incluí-lo na fila `manutencao` | **Rejeitado** | A outra saída do mesmo achado é melhor e mais barata: **o job não existe** (§10). Linha vencida é inerte, toda leitura filtra `expira_em > now()` e o volume é de dez pessoas. Zero exceção, zero `DELETE`, zero job — e a trava T25 segue em enforcement total |
| R-02 | Coluna `usuarios_sessoes.provisoria` para marcar a sessão do convite | **Rejeitado** | Divergiria do modelo de dados sem ganhar nada: com `cookieCache` desligado, `precisa_configurar_fator` é lido do banco a cada requisição e **é** a marca (§9.4). Coluna a mais é segunda fonte da verdade |
| R-03 | Coluna `usuarios.ultimo_aviso_bloqueio_em` para o dedupe do aviso de bloqueio | **Rejeitado** | `auth_eventos` já guarda `conta_bloqueada` com índice `(usuario_id, criado_em DESC)`: o dedupe é uma consulta, não uma coluna nova (§7.1). E continua funcionando com o Redis fora, que era o ponto do achado |
| R-04 | Acrescentar à matriz as chaves de trocas/devoluções, pagamentos, lookbooks, base de conhecimento e funil | **Rejeitado como item do R1** | Essas telas estão **fora do R1** (`01-dados.md §13.4`) e INV-27 reprova entrada sem uso: a chave entra junto com a tela. A preocupação real (estorno sem dono) está atendida — a política já está escrita em §2.2, na lista "chaves que nascem com a fase R2" |
| R-05 | Manter `gerente` com `seguranca:ler_eventos` e resolver dando-lhe `usuarios:ler_detalhe` | **Rejeitado** | A incoerência se resolve tirando o acesso maior, não ampliando o menor. Gerente não mexe em usuários (DN-07) e a trilha de auth expõe IP, agente e alvo de `dono` e `admin`. Ele mantém `trilha:ler`, que é a trilha de negócio que o cliente pediu |
| R-06 | Adotar `escopoDeLeitura()`/`exigirLoja()` (nomes deste desenho) como contrato | **Rejeitado** | O modelo de dados fechou o contrato em `§13.1`, e a forma dele é melhor: a união discriminada com `nenhuma` torna o fail-closed do vendedor sem loja explícito, e `condicaoDeLoja()` é o que torna a varredura de escopo mecânica |
| R-07 | Manter a CSP em `Report-Only` até 15/12/2026 | **Rejeitado** | Entregar a primeira versão sem CSP efetiva é entregar XSS com exfiltração livre (o cookie é HttpOnly, a Server Action não é). Enforce com a política mínima segura desde o dia 1; Report-Only fica **em paralelo** só para endurecer (§14.2) |
| R-08 | Convite com papel `dono` quando não existe nenhum dono | **Rejeitado** | Colocaria `dono` no `CHECK convites_papel` e derrubaria a barreira de banco que H1 pede. O convite `bootstrap = true` (§9.2) semeia o dono com o CHECK intacto |
| R-09 | Manter `PROXIES_CONFIAVEIS` como variável de ambiente | **Rejeitado** | Por env, um valor errado em produção faz o XFF voltar a ser forjável e a trava, que lê o fonte, não pega. Constante versionada, mudança por PR + ADR (§7.3) |
| R-10 | Tratar REQ-K3 como ✅ porque o token "está fora de toda projeção" | **Rejeitado** | K3 fala de valor em claro **no banco**. Fica ⚠ com `EXCECAO-SEG`, ADR e compensações (§10) — marcar verde aqui seria a mentira mais cara do documento |

---

**Modelo de dados**: `spec/final/01-dados.md` (+ `01-dados-dominio.md`). **Catálogo de nomes, papéis e enums**: `01-dados.md §16`.
