CREATE TABLE "usuarios_contas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"conta_id" text NOT NULL,
	"provedor_id" text NOT NULL,
	"senha_hash" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expira_em" timestamp (3) with time zone,
	"refresh_token_expira_em" timestamp (3) with time zone,
	"escopo" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid
);
--> statement-breakpoint
CREATE TABLE "usuarios_passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"nome" text,
	"chave_publica" text NOT NULL,
	"credential_id" text NOT NULL,
	"contador" integer DEFAULT 0 NOT NULL,
	"tipo_dispositivo" text,
	"backed_up" boolean,
	"transportes" text,
	"aaguid" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuarios_sessoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"usuario_id" uuid NOT NULL,
	"expira_em" timestamp (3) with time zone NOT NULL,
	"ip" text,
	"agente" text,
	"ultimo_uso_em" timestamp (3) with time zone,
	"reautenticada_em" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuarios_totp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text DEFAULT '[]' NOT NULL,
	"ultimo_passo_totp" bigint,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"email_verificado" boolean DEFAULT false NOT NULL,
	"avatar_url" text,
	"papel" text DEFAULT 'viewer' NOT NULL,
	"loja_id" uuid,
	"ativo" boolean DEFAULT false NOT NULL,
	"precisa_trocar_senha" boolean DEFAULT false NOT NULL,
	"precisa_configurar_fator" boolean DEFAULT true NOT NULL,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"falhas_login" integer DEFAULT 0 NOT NULL,
	"ultima_falha_em" timestamp (3) with time zone,
	"bloqueado_ate" timestamp (3) with time zone,
	"ultimo_login_em" timestamp (3) with time zone,
	"anonimizado_em" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "usuarios_papel_lista" CHECK ("usuarios"."papel" in ('dono', 'admin', 'gerente', 'vendedor', 'viewer')),
	CONSTRAINT "usuarios_papel_loja" CHECK (("usuarios"."papel" in ('dono', 'admin', 'gerente') and "usuarios"."loja_id" is null)
        or ("usuarios"."papel" in ('vendedor', 'viewer') and "usuarios"."loja_id" is not null)),
	CONSTRAINT "usuarios_bloqueio_coerente" CHECK ("usuarios"."falhas_login" >= 0)
);
--> statement-breakpoint
CREATE TABLE "usuarios_verificacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identificador" text NOT NULL,
	"valor" text NOT NULL,
	"expira_em" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usuarios_contas" ADD CONSTRAINT "usuarios_contas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "usuarios_passkeys" ADD CONSTRAINT "usuarios_passkeys_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "usuarios_sessoes" ADD CONSTRAINT "usuarios_sessoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "usuarios_totp" ADD CONSTRAINT "usuarios_totp_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_usuarios_contas_provedor" ON "usuarios_contas" USING btree ("provedor_id","conta_id");--> statement-breakpoint
CREATE INDEX "ix_usuarios_contas_usuario" ON "usuarios_contas" USING btree ("usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_usuarios_passkeys_credencial" ON "usuarios_passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "ix_usuarios_passkeys_usuario" ON "usuarios_passkeys" USING btree ("usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_usuarios_sessoes_token" ON "usuarios_sessoes" USING btree ("token");--> statement-breakpoint
CREATE INDEX "ix_usuarios_sessoes_usuario" ON "usuarios_sessoes" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "ix_usuarios_sessoes_expira" ON "usuarios_sessoes" USING btree ("expira_em");--> statement-breakpoint
CREATE INDEX "ix_usuarios_totp_usuario" ON "usuarios_totp" USING btree ("usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_usuarios_email" ON "usuarios" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "ix_usuarios_loja_papel" ON "usuarios" USING btree ("loja_id","papel");--> statement-breakpoint
CREATE INDEX "ix_usuarios_ativo" ON "usuarios" USING btree ("ativo");--> statement-breakpoint
CREATE INDEX "ix_usuarios_verificacoes_identificador" ON "usuarios_verificacoes" USING btree ("identificador");--> statement-breakpoint
CREATE INDEX "ix_usuarios_verificacoes_expira" ON "usuarios_verificacoes" USING btree ("expira_em");