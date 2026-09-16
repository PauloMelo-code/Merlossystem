CREATE TABLE "conversas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"contato_id" uuid NOT NULL,
	"integracao_id" uuid NOT NULL,
	"status" text DEFAULT 'aberta' NOT NULL,
	"prioridade" text DEFAULT 'media' NOT NULL,
	"responsavel_id" uuid,
	"ultima_mensagem_em" timestamp (3) with time zone,
	"ultima_mensagem_previa" text,
	"ultima_entrada_em" timestamp (3) with time zone,
	"nao_lidas" integer DEFAULT 0 NOT NULL,
	"primeira_resposta_em" timestamp (3) with time zone,
	"sla_estourado_em" timestamp (3) with time zone,
	"resolvida_em" timestamp (3) with time zone,
	"resolvida_por" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "conversas_status_lista" CHECK ("conversas"."status" in ('aberta', 'pendente', 'resolvida', 'arquivada')),
	CONSTRAINT "conversas_prioridade_lista" CHECK ("conversas"."prioridade" in ('baixa', 'media', 'alta', 'urgente')),
	CONSTRAINT "conversas_nao_lidas_positivo" CHECK ("conversas"."nao_lidas" >= 0)
);
--> statement-breakpoint
CREATE TABLE "conversas_mensagens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"conversa_id" uuid NOT NULL,
	"direcao" text NOT NULL,
	"autor_tipo" text NOT NULL,
	"autor_usuario_id" uuid,
	"conteudo" text,
	"tipo_conteudo" text DEFAULT 'texto' NOT NULL,
	"externo_id" text,
	"status_entrega" text,
	"status_atualizado_em" timestamp (3) with time zone,
	"falha_motivo" text,
	"nota_interna" boolean DEFAULT false NOT NULL,
	"responde_a_id" uuid,
	"chave_idempotencia" text,
	"ocorrida_em" timestamp (3) with time zone NOT NULL,
	"metadados" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "conversas_mensagens_direcao_lista" CHECK ("conversas_mensagens"."direcao" in ('entrada', 'saida')),
	CONSTRAINT "conversas_mensagens_autor_tipo_lista" CHECK ("conversas_mensagens"."autor_tipo" in ('contato', 'usuario', 'sistema', 'campanha')),
	CONSTRAINT "conversas_mensagens_tipo_conteudo_lista" CHECK ("conversas_mensagens"."tipo_conteudo" in ('texto', 'imagem', 'video', 'audio', 'documento', 'sticker', 'localizacao', 'template', 'sistema')),
	CONSTRAINT "conversas_mensagens_status_entrega_lista" CHECK ("conversas_mensagens"."status_entrega" in ('pendente', 'enviada', 'entregue', 'lida', 'falhou')),
	CONSTRAINT "conversas_mensagens_conteudo_tamanho" CHECK (char_length("conversas_mensagens"."conteudo") <= 8000),
	CONSTRAINT "conversas_mensagens_nota_sem_canal" CHECK ("conversas_mensagens"."nota_interna" = false
        or ("conversas_mensagens"."externo_id" is null and "conversas_mensagens"."status_entrega" is null)),
	CONSTRAINT "conversas_mensagens_conteudo_presente" CHECK ("conversas_mensagens"."conteudo" is not null or "conversas_mensagens"."tipo_conteudo" <> 'texto')
);
--> statement-breakpoint
CREATE TABLE "conversas_mensagens_midias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"mensagem_id" uuid NOT NULL,
	"midia_id" uuid,
	"url_externa" text,
	"externo_id" text,
	"tipo_arquivo" text NOT NULL,
	"mime_type" text NOT NULL,
	"tamanho_bytes" integer,
	"legenda" text,
	"baixada" boolean DEFAULT false NOT NULL,
	"transcricao" text,
	"transcricao_status" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "conversas_mensagens_midias_tipo_lista" CHECK ("conversas_mensagens_midias"."tipo_arquivo" in ('imagem', 'video', 'audio', 'documento', 'sticker')),
	CONSTRAINT "conversas_mensagens_midias_transcricao_lista" CHECK ("conversas_mensagens_midias"."transcricao_status" in ('pendente', 'processando', 'concluida', 'falhou')),
	CONSTRAINT "conversas_mensagens_midias_origem" CHECK ("conversas_mensagens_midias"."midia_id" is not null or "conversas_mensagens_midias"."url_externa" is not null),
	CONSTRAINT "conversas_mensagens_midias_url" CHECK ("conversas_mensagens_midias"."url_externa" ~ '^https?://')
);
--> statement-breakpoint
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_contato_id_contatos_id_fk" FOREIGN KEY ("contato_id") REFERENCES "public"."contatos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_integracao_id_lojas_integracoes_id_fk" FOREIGN KEY ("integracao_id") REFERENCES "public"."lojas_integracoes"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_responsavel_id_usuarios_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_resolvida_por_usuarios_id_fk" FOREIGN KEY ("resolvida_por") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas_mensagens" ADD CONSTRAINT "conversas_mensagens_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas_mensagens" ADD CONSTRAINT "conversas_mensagens_conversa_id_conversas_id_fk" FOREIGN KEY ("conversa_id") REFERENCES "public"."conversas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas_mensagens" ADD CONSTRAINT "conversas_mensagens_autor_usuario_id_usuarios_id_fk" FOREIGN KEY ("autor_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas_mensagens" ADD CONSTRAINT "conversas_mensagens_responde_a_id_conversas_mensagens_id_fk" FOREIGN KEY ("responde_a_id") REFERENCES "public"."conversas_mensagens"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas_mensagens_midias" ADD CONSTRAINT "conversas_mensagens_midias_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas_mensagens_midias" ADD CONSTRAINT "conversas_mensagens_midias_mensagem_id_conversas_mensagens_id_fk" FOREIGN KEY ("mensagem_id") REFERENCES "public"."conversas_mensagens"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas_mensagens_midias" ADD CONSTRAINT "conversas_mensagens_midias_midia_id_lojas_midias_id_fk" FOREIGN KEY ("midia_id") REFERENCES "public"."lojas_midias"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_conversas_aberta" ON "conversas" USING btree ("contato_id","integracao_id") WHERE status in ('aberta', 'pendente') and is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_conversas_lista" ON "conversas" USING btree ("loja_id","status","ultima_mensagem_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_conversas_integracao" ON "conversas" USING btree ("integracao_id","status");--> statement-breakpoint
CREATE INDEX "ix_conversas_responsavel" ON "conversas" USING btree ("responsavel_id","status");--> statement-breakpoint
CREATE INDEX "ix_conversas_contato" ON "conversas" USING btree ("contato_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_conversas_loja" ON "conversas" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_conversas_mensagens_externo" ON "conversas_mensagens" USING btree ("loja_id","externo_id") WHERE externo_id is not null and is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_conversas_mensagens_idempotencia" ON "conversas_mensagens" USING btree ("conversa_id","chave_idempotencia") WHERE chave_idempotencia is not null;--> statement-breakpoint
CREATE INDEX "ix_conversas_mensagens_cursor" ON "conversas_mensagens" USING btree ("conversa_id","ocorrida_em" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_conversas_mensagens_loja" ON "conversas_mensagens" USING btree ("loja_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_conversas_mensagens_autor" ON "conversas_mensagens" USING btree ("autor_usuario_id");--> statement-breakpoint
CREATE INDEX "ix_conversas_mensagens_midias_mensagem" ON "conversas_mensagens_midias" USING btree ("mensagem_id");--> statement-breakpoint
CREATE INDEX "ix_conversas_mensagens_midias_transcricao" ON "conversas_mensagens_midias" USING btree ("transcricao_status") WHERE transcricao_status = 'pendente';--> statement-breakpoint
CREATE INDEX "ix_conversas_mensagens_midias_loja" ON "conversas_mensagens_midias" USING btree ("loja_id","is_deleted");