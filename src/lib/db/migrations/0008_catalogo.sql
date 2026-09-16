CREATE TABLE "produtos_categorias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid
);
--> statement-breakpoint
CREATE TABLE "produtos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"categoria_id" uuid,
	"nome" text NOT NULL,
	"sku" text,
	"descricao" text,
	"tipo_grade" text DEFAULT 'ambos' NOT NULL,
	"preco" numeric(12, 2) NOT NULL,
	"preco_comparacao" numeric(12, 2),
	"preco_custo" numeric(12, 2),
	"peso_gramas" integer,
	"destacado" boolean DEFAULT false NOT NULL,
	"bling_produto_id" text,
	"sincronizado_em" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "produtos_tipo_grade_lista" CHECK ("produtos"."tipo_grade" in ('slim', 'plussize', 'ambos')),
	CONSTRAINT "produtos_preco_positivo" CHECK ("produtos"."preco" >= 0),
	CONSTRAINT "produtos_preco_custo_positivo" CHECK ("produtos"."preco_custo" >= 0),
	CONSTRAINT "produtos_preco_comparacao_coerente" CHECK ("produtos"."preco_comparacao" is null or "produtos"."preco_comparacao" >= "produtos"."preco")
);
--> statement-breakpoint
CREATE TABLE "produtos_midias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"midia_id" uuid NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid
);
--> statement-breakpoint
CREATE TABLE "produtos_variacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"tamanho" text NOT NULL,
	"sku" text,
	"bling_produto_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid
);
--> statement-breakpoint
ALTER TABLE "produtos_categorias" ADD CONSTRAINT "produtos_categorias_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_categoria_id_produtos_categorias_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."produtos_categorias"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "produtos_midias" ADD CONSTRAINT "produtos_midias_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "produtos_midias" ADD CONSTRAINT "produtos_midias_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "produtos_midias" ADD CONSTRAINT "produtos_midias_midia_id_lojas_midias_id_fk" FOREIGN KEY ("midia_id") REFERENCES "public"."lojas_midias"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "produtos_variacoes" ADD CONSTRAINT "produtos_variacoes_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "produtos_variacoes" ADD CONSTRAINT "produtos_variacoes_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_produtos_categorias_slug" ON "produtos_categorias" USING btree ("loja_id","slug") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_produtos_categorias_loja" ON "produtos_categorias" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_produtos_sku" ON "produtos" USING btree ("loja_id","sku") WHERE sku is not null and is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_produtos_categoria" ON "produtos" USING btree ("loja_id","categoria_id");--> statement-breakpoint
CREATE INDEX "ix_produtos_destacado" ON "produtos" USING btree ("loja_id","destacado");--> statement-breakpoint
CREATE INDEX "ix_produtos_loja" ON "produtos" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_produtos_midias" ON "produtos_midias" USING btree ("produto_id","midia_id") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_produtos_midias_ordem" ON "produtos_midias" USING btree ("produto_id","ordem");--> statement-breakpoint
CREATE INDEX "ix_produtos_midias_loja" ON "produtos_midias" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_produtos_variacoes_tamanho" ON "produtos_variacoes" USING btree ("produto_id","tamanho") WHERE is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_produtos_variacoes_sku" ON "produtos_variacoes" USING btree ("loja_id","sku") WHERE sku is not null and is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_produtos_variacoes_loja" ON "produtos_variacoes" USING btree ("loja_id","is_deleted");