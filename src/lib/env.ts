import { z } from "zod";

/**
 * Dona da verdade das variáveis de ambiente (03-arquitetura.md §15,
 * 01-dados.md §13.5, 02-seguranca.md §18).
 *
 * Regras que este arquivo cumpre e que a trava T17 confere:
 *   - `process.env` aparece SÓ aqui (e em migrate.ts, db-backup.mjs e
 *     db-teste.mjs, que rodam fora do processo da aplicação);
 *   - nenhum `process.env.X || "literal"` — o valor padrão, quando existe, é
 *     declarado no esquema com `.default()`;
 *   - o boot LANÇA quando falta variável obrigatória do ambiente;
 *   - `.env.example` lista 100% das chaves deste esquema.
 *
 * `PROXIES_CONFIAVEIS` NÃO está aqui de propósito: é constante versionada em
 * `src/lib/seguranca/ip.ts` (02-seguranca.md §7.3). Por ambiente, um valor
 * errado em produção (`0.0.0.0/0`) faria `x-forwarded-for` voltar a ser
 * forjável sem que a trava, que lê o fonte, tivesse como pegar.
 */

/** "true"/"false" explícitos: `z.coerce.boolean()` transformaria "false" em true. */
const booleano = z.enum(["true", "false"]).transform((v) => v === "true");

const urlPostgres = z
  .string()
  .regex(/^postgres(ql)?:\/\/\S+$/, "precisa ser uma URL postgres://");

/** Segredo dedicado: 32 bytes ou mais, diferente em HML e PRD (02-seguranca.md §18). */
const segredo = z.string().min(32, "segredo dedicado precisa de ao menos 32 caracteres");

const esquema = z
  .object({
    // -- Ambiente ----------------------------------------------------------
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /** Única fonte de baseURL, trustedOrigins, rpID e link de e-mail. */
    APP_URL: z.url("precisa ser uma URL absoluta"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3005),

    // -- Banco -------------------------------------------------------------
    /** Papel `merlo_app`. Nunca é dono das tabelas (01-dados.md §7.3). */
    DATABASE_URL: urlPostgres,
    /** Papel `merlo_migracao`. Só migrate.ts, db-backup.mjs e db-teste.mjs. */
    DATABASE_URL_MIGRACAO: urlPostgres.optional(),
    /** Só `tests/integracao`. */
    DATABASE_URL_TESTE: urlPostgres.optional(),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

    // -- Redis / fila ------------------------------------------------------
    REDIS_URL: z.string().regex(/^rediss?:\/\/\S+$/, "precisa ser uma URL redis://"),
    /** `attempts` do BullMQ (03-arquitetura.md §8.2). */
    FILA_TENTATIVAS: z.coerce.number().int().min(1).max(10).default(5),
    /** Teto do processo worker; a concorrência por fila está em §8.1. */
    WORKER_CONCORRENCIA: z.coerce.number().int().min(1).max(32).default(8),

    // -- Autenticação (Better Auth) ---------------------------------------
    /** Versionados, do mais novo para o mais velho: `v2:valor,v1:valor`. */
    BETTER_AUTH_SECRETS: z
      .string()
      .regex(
        /^v\d+:\S{32,}(,v\d+:\S{32,})*$/,
        'precisa ser "v2:segredo,v1:segredo" com segredos de 32+ caracteres',
      ),
    /** HMAC do e-mail em `auth_eventos`. */
    AUTH_EMAIL_HASH_KEY: segredo,
    AUTH_PASSKEY_HABILITADA: booleano.default(true),
    AUTH_HIBP_HABILITADO: booleano.default(true),
    /**
     * Piso da recusa única de login (02-seguranca.md §8). O `.min(300)` é a
     * trava: `PISO_RECUSA_MS=0` em produção desligaria, sem deixar rastro, o
     * único controle que esconde a diferença entre "existe" e "não existe".
     */
    PISO_RECUSA_MS: z.coerce.number().int().min(300).default(450),
    /** Obrigatória quando houver 2 ou mais instâncias web. */
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: segredo.optional(),

    // -- Integrações: cofre e OAuth ---------------------------------------
    /** Chave do cofre AES-256-GCM. Imutável; girar exige plano no runbook. */
    INTEGRATIONS_KEY: segredo,
    /** Assina o `state` do OAuth. Nunca reusar o segredo de auth. */
    INTEGRATIONS_STATE_KEY: segredo,
    BLING_CLIENT_ID: z.string().min(1).optional(),
    BLING_CLIENT_SECRET: z.string().min(1).optional(),
    BLING_REDIRECT_URI: z.url().optional(),

    // -- Canais ------------------------------------------------------------
    /** HMAC dos webhooks WhatsApp/Instagram. */
    META_APP_SECRET: segredo.optional(),
    /** Sem default literal no código: adaptador com versão cravada envelhece. */
    META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/, 'formato "v23.0"').optional(),
    WHATSAPP_VERIFY_TOKEN: segredo.optional(),
    INSTAGRAM_VERIFY_TOKEN: segredo.optional(),
    /** Challenge do webhook do Messenger. PROPRIO: nunca o do Instagram (ADR 0054). */
    FACEBOOK_VERIFY_TOKEN: segredo.optional(),
    /** App da TikTok API for Business (mensagem direta, ADR 0055). Um app por ambiente. */
    TIKTOK_APP_ID: z.string().min(1).optional(),
    /** HMAC do webhook, troca de code, renovação e endereço de entrega do app. */
    TIKTOK_APP_SECRET: segredo.optional(),
    /** Sem default literal no código, como META_GRAPH_VERSION. */
    TIKTOK_API_VERSAO: z.string().regex(/^v\d+\.\d+$/, 'formato "v1.3"').optional(),
    /** O segredo do webhook uazapi é POR INTEGRAÇÃO, no banco. */
    UAZAPI_BASE_URL: z.url().optional(),

    // -- Pagamentos (R2-B, ADR 0041) ---------------------------------------
    /** `desligado`: Mercado Pago não é oferecido. `teste`: só token TEST- (HML). `producao`: só token APP_USR- (PRD). */
    PAGAMENTOS_MERCADOPAGO: z.enum(["desligado", "teste", "producao"]).default("desligado"),

    // -- Mídia (S3/MinIO) --------------------------------------------------
    S3_ENDPOINT: z.url(),
    /** Só para URL assinada de provedor externo (caminho de exceção). */
    S3_ENDPOINT_PUBLICO: z.url().optional(),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_REGION: z.string().min(1),

    // -- E-mail (convite, reset, avisos de segurança) ----------------------
    EMAIL_PROVEDOR: z.string().min(1).optional(),
    EMAIL_REMETENTE: z.email().optional(),
    EMAIL_API_KEY: z.string().min(1).optional(),

    // -- Operação ----------------------------------------------------------
    LOG_NIVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .default("info"),
    /** Por instância. Acima disso o SSE responde 503 e a UI degrada. */
    EVENTOS_MAX_CONEXOES: z.coerce.number().int().min(1).default(200),
    /** 3 por pessoa; 2 para dono e admin, aplicado em `src/server/sse.ts`. */
    EVENTOS_MAX_POR_USUARIO: z.coerce.number().int().min(1).default(3),
    /** `/api/pronto`: comparado com `timingSafeEqual`, nunca com `===`. */
    SONDA_SEGREDO: segredo.optional(),
    DISCORD_WEBHOOK_ALERTAS: z.url().optional(),
    /** Pesquisa de satisfação automática (ADR 0038). Desligada até o cliente aprovar o texto. */
    CSAT_ATIVO: booleano.default(false),

    // -- Inteligência (R2-C, ADRs 0046–0050) ------------------------------
    /** Desligado por padrão: sem chave, o recurso não aparece (U8). */
    IA_PROVEDOR_TEXTO: z.enum(["desligado", "anthropic", "simulado"]).default("desligado"),
    /** Chave da INSTALAÇÃO, não da loja: env, nunca cofre, nunca tela. */
    ANTHROPIC_API_KEY: z.string().regex(/^sk-ant-\S{20,}$/, "formato sk-ant-…").optional(),
    IA_PROVEDOR_TRANSCRICAO: z.enum(["desligado", "openai", "simulado"]).default("desligado"),
    OPENAI_API_KEY: z.string().regex(/^sk-\S{20,}$/, "formato sk-…").optional(),
    /** Manda texto da cliente a terceiro sem ninguém pedir: desligada até o cliente decidir. */
    IA_CLASSIFICACAO_AUTOMATICA: booleano.default(false),
    /** Por loja, por dia de America/Sao_Paulo. String decimal, como dinheiro. */
    IA_LIMITE_DIARIO_USD: z.string().regex(/^\d{1,4}(\.\d{1,2})?$/, 'formato "2.00"').default("2.00"),
  })
  .superRefine((v, ctx) => {
    const exigir = (chave: keyof typeof v, porque: string) => {
      if (v[chave] === undefined) {
        ctx.addIssue({ code: "custom", path: [chave], message: `obrigatória ${porque}` });
      }
    };

    if (v.NODE_ENV === "production") {
      exigir("DATABASE_URL_MIGRACAO", "em HML e PRD: é o papel que aplica a migração");
      exigir("EMAIL_PROVEDOR", "em HML e PRD: convite e reset saem por e-mail");
      exigir("EMAIL_REMETENTE", "em HML e PRD: convite e reset saem por e-mail");
      exigir("EMAIL_API_KEY", "em HML e PRD: convite e reset saem por e-mail");
      exigir("SONDA_SEGREDO", "em HML e PRD: sem ela /api/pronto recusa toda sonda");
    }

    if (v.NODE_ENV === "test") {
      exigir("DATABASE_URL_TESTE", "em teste: a integração nunca roda no banco de dev");
    }

    // Segredo configurado pela metade é pior que segredo ausente: a rota aceita
    // a metade que existe e falha na outra só quando o webhook chega.
    if (v.META_APP_SECRET !== undefined) {
      exigir("META_GRAPH_VERSION", "quando META_APP_SECRET existe");
    }
    if (v.BLING_CLIENT_ID !== undefined) {
      exigir("BLING_CLIENT_SECRET", "quando BLING_CLIENT_ID existe");
      exigir("BLING_REDIRECT_URI", "quando BLING_CLIENT_ID existe");
    }
    if (v.FACEBOOK_VERIFY_TOKEN !== undefined) {
      exigir("META_APP_SECRET", "quando FACEBOOK_VERIFY_TOKEN existe");
    }
    if (v.TIKTOK_APP_ID !== undefined) {
      exigir("TIKTOK_APP_SECRET", "quando TIKTOK_APP_ID existe");
      exigir("TIKTOK_API_VERSAO", "quando TIKTOK_APP_ID existe");
    }

    if (v.IA_PROVEDOR_TEXTO === "anthropic") {
      exigir("ANTHROPIC_API_KEY", "quando IA_PROVEDOR_TEXTO=anthropic");
    }
    if (v.IA_PROVEDOR_TRANSCRICAO === "openai") {
      exigir("OPENAI_API_KEY", "quando IA_PROVEDOR_TRANSCRICAO=openai");
    }
    if (v.NODE_ENV === "production") {
      for (const chave of ["IA_PROVEDOR_TEXTO", "IA_PROVEDOR_TRANSCRICAO"] as const) {
        if (v[chave] === "simulado") {
          ctx.addIssue({ code: "custom", path: [chave], message: "simulado é proibido em produção" });
        }
      }
    }
    if (v.IA_CLASSIFICACAO_AUTOMATICA && v.IA_PROVEDOR_TEXTO === "desligado") {
      ctx.addIssue({
        code: "custom",
        path: ["IA_CLASSIFICACAO_AUTOMATICA"],
        message: "exige IA_PROVEDOR_TEXTO ligado",
      });
    }
  });

const analise = esquema.safeParse(process.env);

if (!analise.success) {
  // Só o nome da variável e o motivo: o valor recusado pode ser o segredo.
  const problemas = analise.error.issues
    .map((i) => `  - ${i.path.join(".") || "(raiz)"}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Ambiente inválido. Corrija as variáveis abaixo (veja .env.example):\n${problemas}`,
  );
}

export const env = analise.data;

export type Ambiente = typeof env;
