CREATE TABLE "lojas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"slug" text NOT NULL,
	"sigla" text NOT NULL,
	"bling_deposito_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "lojas_sigla_formato" CHECK ("lojas"."sigla" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "lojas_etiquetas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"slug" text NOT NULL,
	"cor" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "lojas_etiquetas_cor_formato" CHECK ("lojas_etiquetas"."cor" ~ '^#[0-9a-f]{6}$')
);
--> statement-breakpoint
ALTER TABLE "lojas_etiquetas" ADD CONSTRAINT "lojas_etiquetas_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lojas_slug" ON "lojas" USING btree (lower("slug")) WHERE is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lojas_sigla" ON "lojas" USING btree ("sigla") WHERE is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lojas_etiquetas_slug" ON "lojas_etiquetas" USING btree ("loja_id","slug") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_lojas_etiquetas_loja" ON "lojas_etiquetas" USING btree ("loja_id","is_deleted");