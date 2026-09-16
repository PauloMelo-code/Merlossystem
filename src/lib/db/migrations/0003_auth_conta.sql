CREATE TABLE "usuarios_convites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"papel" text NOT NULL,
	"loja_id" uuid,
	"token_hash" text NOT NULL,
	"expira_em" timestamp (3) with time zone NOT NULL,
	"usado_em" timestamp (3) with time zone,
	"usado_por_usuario_id" uuid,
	"criado_por" uuid,
	"ciencia_versao" text,
	"bootstrap" boolean DEFAULT false NOT NULL,
	"motivo" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "usuarios_convites_papel_lista" CHECK ("usuarios_convites"."papel" in ('admin', 'gerente', 'vendedor', 'viewer')),
	CONSTRAINT "usuarios_convites_papel_loja" CHECK (("usuarios_convites"."papel" in ('admin', 'gerente') and "usuarios_convites"."loja_id" is null)
        or ("usuarios_convites"."papel" in ('vendedor', 'viewer') and "usuarios_convites"."loja_id" is not null)),
	CONSTRAINT "usuarios_convites_ciencia_admin" CHECK ("usuarios_convites"."papel" <> 'admin' or "usuarios_convites"."ciencia_versao" is not null),
	CONSTRAINT "usuarios_convites_bootstrap" CHECK ("usuarios_convites"."bootstrap" = false
        or ("usuarios_convites"."papel" = 'admin' and "usuarios_convites"."loja_id" is null and "usuarios_convites"."criado_por" is null))
);
--> statement-breakpoint
CREATE TABLE "usuarios_senhas_historico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"senha_hash" text NOT NULL,
	"criado_em" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuarios_trocas_email" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"email_novo" text NOT NULL,
	"codigo_hash" text NOT NULL,
	"expira_em" timestamp (3) with time zone NOT NULL,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"confirmado_em" timestamp (3) with time zone,
	"cancelado_em" timestamp (3) with time zone,
	"cancelado_motivo" text,
	"solicitado_por" uuid NOT NULL,
	"motivo" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid
);
--> statement-breakpoint
ALTER TABLE "usuarios_convites" ADD CONSTRAINT "usuarios_convites_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "usuarios_convites" ADD CONSTRAINT "usuarios_convites_usado_por_usuario_id_usuarios_id_fk" FOREIGN KEY ("usado_por_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "usuarios_convites" ADD CONSTRAINT "usuarios_convites_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "usuarios_senhas_historico" ADD CONSTRAINT "usuarios_senhas_historico_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "usuarios_trocas_email" ADD CONSTRAINT "usuarios_trocas_email_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "usuarios_trocas_email" ADD CONSTRAINT "usuarios_trocas_email_solicitado_por_usuarios_id_fk" FOREIGN KEY ("solicitado_por") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_usuarios_convites_email_aberto" ON "usuarios_convites" USING btree (lower("email")) WHERE usado_em is null and is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_usuarios_convites_token" ON "usuarios_convites" USING btree ("token_hash") WHERE is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_usuarios_convites_bootstrap" ON "usuarios_convites" USING btree ("bootstrap") WHERE bootstrap = true and usado_em is null and is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_usuarios_convites_loja" ON "usuarios_convites" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE INDEX "ix_usuarios_senhas_historico_usuario" ON "usuarios_senhas_historico" USING btree ("usuario_id","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_usuarios_trocas_email_aberta" ON "usuarios_trocas_email" USING btree ("usuario_id") WHERE confirmado_em is null and cancelado_em is null and is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_usuarios_trocas_email_usuario" ON "usuarios_trocas_email" USING btree ("usuario_id","created_at" DESC NULLS LAST);