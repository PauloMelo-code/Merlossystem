/**
 * De-para Better Auth -> coluna. FONTE ÚNICA (01-dados.md §5.10).
 *
 * A 1.7 valida o schema no boot: divergência derruba TODO `/api/auth/**`
 * (07/G27). Por isso o de-para vive numa constante só, e `src/lib/auth/auth.ts`
 * é montado a partir dela — nenhum documento redigita nome de coluna.
 *
 * A trava `tests/integracao/ba-fields.test.ts` (T4) importa esta constante e
 * `getTableColumns()` de cada tabela e reprova se algum valor não for nome de
 * coluna existente: a divergência aparece no CI, não no boot de produção.
 */
export const CAMPOS_BA = {
  user: {
    modelName: "usuarios",
    fields: {
      name: "nome",
      email: "email",
      emailVerified: "email_verificado",
      image: "avatar_url",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  account: {
    modelName: "usuarios_contas",
    fields: {
      userId: "usuario_id",
      accountId: "conta_id",
      providerId: "provedor_id",
      password: "senha_hash",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expira_em",
      refreshTokenExpiresAt: "refresh_token_expira_em",
      scope: "escopo",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  session: {
    modelName: "usuarios_sessoes",
    fields: {
      userId: "usuario_id",
      token: "token",
      expiresAt: "expira_em",
      ipAddress: "ip",
      userAgent: "agente",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  verification: {
    modelName: "usuarios_verificacoes",
    fields: {
      identifier: "identificador",
      value: "valor",
      expiresAt: "expira_em",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  twoFactor: { modelName: "usuarios_totp" },
  passkey: { modelName: "usuarios_passkeys" },
} as const;
