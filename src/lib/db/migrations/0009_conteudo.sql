CREATE TABLE "base_conhecimento_artigos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"titulo" text NOT NULL,
	"conteudo" text NOT NULL,
	"categoria" text,
	"criado_por" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "base_conhecimento_artigos_categoria_lista" CHECK ("base_conhecimento_artigos"."categoria" in ('medidas', 'frete', 'troca', 'pagamento', 'tecidos', 'combinacoes', 'procedimentos'))
);
--> statement-breakpoint
CREATE TABLE "base_conhecimento_artigos_etiquetas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"artigo_id" uuid NOT NULL,
	"etiqueta_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid
);
--> statement-breakpoint
CREATE TABLE "lookbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"capa_midia_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid
);
--> statement-breakpoint
CREATE TABLE "lookbooks_midias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"lookbook_id" uuid NOT NULL,
	"midia_id" uuid NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid
);
--> statement-breakpoint
CREATE TABLE "lookbooks_produtos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"lookbook_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid
);
--> statement-breakpoint
CREATE TABLE "respostas_rapidas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"titulo" text NOT NULL,
	"conteudo" text NOT NULL,
	"categoria" text,
	"atalho" text,
	"ativa" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "respostas_rapidas_categoria_lista" CHECK ("respostas_rapidas"."categoria" in ('frete', 'medidas', 'troca', 'pagamento', 'rastreio', 'geral')),
	CONSTRAINT "respostas_rapidas_atalho_formato" CHECK ("respostas_rapidas"."atalho" ~ '^/[a-z0-9-]{1,30}$')
);
--> statement-breakpoint
ALTER TABLE "base_conhecimento_artigos" ADD CONSTRAINT "base_conhecimento_artigos_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "base_conhecimento_artigos" ADD CONSTRAINT "base_conhecimento_artigos_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "base_conhecimento_artigos_etiquetas" ADD CONSTRAINT "base_conhecimento_artigos_etiquetas_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "base_conhecimento_artigos_etiquetas" ADD CONSTRAINT "base_conhecimento_artigos_etiquetas_artigo_id_base_conhecimento_artigos_id_fk" FOREIGN KEY ("artigo_id") REFERENCES "public"."base_conhecimento_artigos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "base_conhecimento_artigos_etiquetas" ADD CONSTRAINT "base_conhecimento_artigos_etiquetas_etiqueta_id_lojas_etiquetas_id_fk" FOREIGN KEY ("etiqueta_id") REFERENCES "public"."lojas_etiquetas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lookbooks" ADD CONSTRAINT "lookbooks_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lookbooks" ADD CONSTRAINT "lookbooks_capa_midia_id_lojas_midias_id_fk" FOREIGN KEY ("capa_midia_id") REFERENCES "public"."lojas_midias"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lookbooks_midias" ADD CONSTRAINT "lookbooks_midias_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lookbooks_midias" ADD CONSTRAINT "lookbooks_midias_lookbook_id_lookbooks_id_fk" FOREIGN KEY ("lookbook_id") REFERENCES "public"."lookbooks"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lookbooks_midias" ADD CONSTRAINT "lookbooks_midias_midia_id_lojas_midias_id_fk" FOREIGN KEY ("midia_id") REFERENCES "public"."lojas_midias"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lookbooks_produtos" ADD CONSTRAINT "lookbooks_produtos_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lookbooks_produtos" ADD CONSTRAINT "lookbooks_produtos_lookbook_id_lookbooks_id_fk" FOREIGN KEY ("lookbook_id") REFERENCES "public"."lookbooks"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lookbooks_produtos" ADD CONSTRAINT "lookbooks_produtos_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "respostas_rapidas" ADD CONSTRAINT "respostas_rapidas_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "ix_base_conhecimento_artigos_loja" ON "base_conhecimento_artigos" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_base_conhecimento_artigos_etiquetas" ON "base_conhecimento_artigos_etiquetas" USING btree ("artigo_id","etiqueta_id") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_base_conhecimento_etiquetas_loja" ON "base_conhecimento_artigos_etiquetas" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE INDEX "ix_lookbooks_loja" ON "lookbooks" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lookbooks_midias" ON "lookbooks_midias" USING btree ("lookbook_id","midia_id") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_lookbooks_midias_ordem" ON "lookbooks_midias" USING btree ("lookbook_id","ordem");--> statement-breakpoint
CREATE INDEX "ix_lookbooks_midias_loja" ON "lookbooks_midias" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lookbooks_produtos" ON "lookbooks_produtos" USING btree ("lookbook_id","produto_id") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_lookbooks_produtos_ordem" ON "lookbooks_produtos" USING btree ("lookbook_id","ordem");--> statement-breakpoint
CREATE INDEX "ix_lookbooks_produtos_loja" ON "lookbooks_produtos" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_respostas_rapidas_atalho" ON "respostas_rapidas" USING btree ("loja_id","atalho") WHERE atalho is not null and is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_respostas_rapidas_loja" ON "respostas_rapidas" USING btree ("loja_id","is_deleted");