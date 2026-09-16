CREATE TABLE "lojas_midias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"nome_original" text,
	"chave_objeto" text NOT NULL,
	"chave_miniatura" text,
	"tipo_arquivo" text NOT NULL,
	"mime_type" text NOT NULL,
	"tamanho_bytes" integer NOT NULL,
	"largura" integer,
	"altura" integer,
	"duracao_ms" integer,
	"hash_sha256" text,
	"origem" text NOT NULL,
	"pasta" text,
	"enviada_por" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "lojas_midias_tipo_arquivo_lista" CHECK ("lojas_midias"."tipo_arquivo" in ('imagem', 'video', 'audio', 'documento')),
	CONSTRAINT "lojas_midias_origem_lista" CHECK ("lojas_midias"."origem" in ('upload', 'recebida', 'gerada')),
	CONSTRAINT "lojas_midias_pasta_lista" CHECK ("lojas_midias"."pasta" in ('produtos', 'lookbooks', 'stories', 'geral')),
	CONSTRAINT "lojas_midias_tamanho_positivo" CHECK ("lojas_midias"."tamanho_bytes" > 0),
	CONSTRAINT "lojas_midias_pasta_por_origem" CHECK (("lojas_midias"."origem" = 'upload' and "lojas_midias"."pasta" is not null)
        or ("lojas_midias"."origem" <> 'upload' and "lojas_midias"."pasta" is null))
);
--> statement-breakpoint
CREATE TABLE "lojas_midias_etiquetas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"midia_id" uuid NOT NULL,
	"etiqueta_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid
);
--> statement-breakpoint
ALTER TABLE "lojas_midias" ADD CONSTRAINT "lojas_midias_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lojas_midias" ADD CONSTRAINT "lojas_midias_enviada_por_usuarios_id_fk" FOREIGN KEY ("enviada_por") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lojas_midias_etiquetas" ADD CONSTRAINT "lojas_midias_etiquetas_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lojas_midias_etiquetas" ADD CONSTRAINT "lojas_midias_etiquetas_midia_id_lojas_midias_id_fk" FOREIGN KEY ("midia_id") REFERENCES "public"."lojas_midias"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lojas_midias_etiquetas" ADD CONSTRAINT "lojas_midias_etiquetas_etiqueta_id_lojas_etiquetas_id_fk" FOREIGN KEY ("etiqueta_id") REFERENCES "public"."lojas_etiquetas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lojas_midias_chave" ON "lojas_midias" USING btree ("chave_objeto");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lojas_midias_hash" ON "lojas_midias" USING btree ("loja_id","hash_sha256") WHERE hash_sha256 is not null and is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_lojas_midias_origem" ON "lojas_midias" USING btree ("loja_id","origem","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_lojas_midias_tipo" ON "lojas_midias" USING btree ("loja_id","tipo_arquivo");--> statement-breakpoint
CREATE INDEX "ix_lojas_midias_loja" ON "lojas_midias" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lojas_midias_etiquetas" ON "lojas_midias_etiquetas" USING btree ("midia_id","etiqueta_id") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_lojas_midias_etiquetas_etiqueta" ON "lojas_midias_etiquetas" USING btree ("etiqueta_id");--> statement-breakpoint
CREATE INDEX "ix_lojas_midias_etiquetas_loja" ON "lojas_midias_etiquetas" USING btree ("loja_id","is_deleted");