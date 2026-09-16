CREATE TABLE "contatos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"nome" text,
	"telefone" text,
	"email" text,
	"whatsapp_id" text,
	"instagram_id" text,
	"facebook_id" text,
	"tiktok_id" text,
	"avatar_url" text,
	"tamanho_preferido" text,
	"observacoes" text,
	"aniversario" date,
	"endereco" jsonb,
	"ultimo_contato_em" timestamp (3) with time zone,
	"ultima_compra_em" timestamp (3) with time zone,
	"opt_out" boolean DEFAULT false NOT NULL,
	"opt_out_em" timestamp (3) with time zone,
	"pedidos_contagem" integer DEFAULT 0 NOT NULL,
	"pedidos_valor_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"anonimizado_em" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "contatos_tamanho_preferido_lista" CHECK ("contatos"."tamanho_preferido" in ('slim', 'plussize', 'ambos')),
	CONSTRAINT "contatos_telefone_e164" CHECK ("contatos"."telefone" ~ '^[1-9][0-9]{9,14}$'),
	CONSTRAINT "contatos_email_formato" CHECK ("contatos"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
	CONSTRAINT "contatos_opt_out_coerente" CHECK ("contatos"."opt_out" = false or "contatos"."opt_out_em" is not null)
);
--> statement-breakpoint
CREATE TABLE "contatos_etiquetas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"contato_id" uuid NOT NULL,
	"etiqueta_id" uuid NOT NULL,
	"origem" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "contatos_etiquetas_origem_lista" CHECK ("contatos_etiquetas"."origem" in ('manual', 'importacao', 'automacao'))
);
--> statement-breakpoint
ALTER TABLE "contatos" ADD CONSTRAINT "contatos_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "contatos_etiquetas" ADD CONSTRAINT "contatos_etiquetas_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "contatos_etiquetas" ADD CONSTRAINT "contatos_etiquetas_contato_id_contatos_id_fk" FOREIGN KEY ("contato_id") REFERENCES "public"."contatos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "contatos_etiquetas" ADD CONSTRAINT "contatos_etiquetas_etiqueta_id_lojas_etiquetas_id_fk" FOREIGN KEY ("etiqueta_id") REFERENCES "public"."lojas_etiquetas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_contatos_telefone" ON "contatos" USING btree ("loja_id","telefone") WHERE telefone is not null and is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_contatos_whatsapp" ON "contatos" USING btree ("loja_id","whatsapp_id") WHERE whatsapp_id is not null and is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_contatos_instagram" ON "contatos" USING btree ("loja_id","instagram_id") WHERE instagram_id is not null and is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_contatos_facebook" ON "contatos" USING btree ("loja_id","facebook_id") WHERE facebook_id is not null and is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_contatos_tiktok" ON "contatos" USING btree ("loja_id","tiktok_id") WHERE tiktok_id is not null and is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_contatos_ultimo_contato" ON "contatos" USING btree ("loja_id","ultimo_contato_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_contatos_opt_out" ON "contatos" USING btree ("loja_id","opt_out");--> statement-breakpoint
CREATE INDEX "ix_contatos_loja" ON "contatos" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_contatos_etiquetas" ON "contatos_etiquetas" USING btree ("contato_id","etiqueta_id") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_contatos_etiquetas_etiqueta" ON "contatos_etiquetas" USING btree ("etiqueta_id");--> statement-breakpoint
CREATE INDEX "ix_contatos_etiquetas_loja" ON "contatos_etiquetas" USING btree ("loja_id","is_deleted");