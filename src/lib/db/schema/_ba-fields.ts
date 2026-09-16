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
  /**
   * Os dois modelos de plugin carregam `fields` porque `modelName` sozinho
   * deixa o BA procurando `userId`, `publicKey`, `credentialID`… e o boot falha
   * (02-seguranca.md §4.1 fecha esta lacuna de 01-dados.md §5.10).
   *
   * `verified`, `failedVerificationCount` e `lockedUntil` são campos que o
   * plugin instalado declara e que §5.5 não previa — ver
   * docs/seguranca/conferencia-ba-1.7.5.md §3.
   */
  twoFactor: {
    modelName: "usuarios_totp",
    fields: {
      userId: "usuario_id",
      secret: "secret",
      backupCodes: "backup_codes",
      verified: "verificado",
      failedVerificationCount: "falhas_verificacao",
      lockedUntil: "bloqueado_ate",
      createdAt: "created_at",
    },
  },
  passkey: {
    modelName: "usuarios_passkeys",
    fields: {
      userId: "usuario_id",
      name: "nome",
      publicKey: "chave_publica",
      credentialID: "credential_id",
      counter: "contador",
      deviceType: "tipo_dispositivo",
      backedUp: "backed_up",
      transports: "transportes",
      aaguid: "aaguid",
      createdAt: "created_at",
    },
  },
} as const;
