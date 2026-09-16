CREATE TABLE "campanhas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"integracao_id" uuid NOT NULL,
	"template_id" uuid,
	"conteudo_texto" text,
	"variaveis" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"segmento" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"agendada_para" timestamp (3) with time zone,
	"iniciada_em" timestamp (3) with time zone,
	"concluida_em" timestamp (3) with time zone,
	"total_destinatarios" integer DEFAULT 0 NOT NULL,
	"criada_por" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "campanhas_status_lista" CHECK ("campanhas"."status" in ('rascunho', 'agendada', 'enviando', 'pausada', 'concluida', 'cancelada')),
	CONSTRAINT "campanhas_conteudo" CHECK ("campanhas"."template_id" is not null or "campanhas"."conteudo_texto" is not null),
	CONSTRAINT "campanhas_total_positivo" CHECK ("campanhas"."total_destinatarios" >= 0)
);
--> statement-breakpoint
CREATE TABLE "campanhas_destinatarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"campanha_id" uuid NOT NULL,
	"contato_id" uuid NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"mensagem_id" uuid,
	"externo_id" text,
	"erro" text,
	"reservado_em" timestamp (3) with time zone,
	"enviado_em" timestamp (3) with time zone,
	"entregue_em" timestamp (3) with time zone,
	"lido_em" timestamp (3) with time zone,
	"respondido_em" timestamp (3) with time zone,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "campanhas_destinatarios_status_lista" CHECK ("campanhas_destinatarios"."status" in ('pendente', 'reservado', 'enviado', 'entregue', 'lido', 'respondido', 'falhou')),
	CONSTRAINT "campanhas_destinatarios_tentativas" CHECK ("campanhas_destinatarios"."tentativas" >= 0)
);
--> statement-breakpoint
CREATE TABLE "conversas_agendamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"contato_id" uuid NOT NULL,
	"conversa_id" uuid,
	"integracao_id" uuid NOT NULL,
	"conteudo" text,
	"tipo_conteudo" text NOT NULL,
	"template_id" uuid,
	"variaveis" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"midia_id" uuid,
	"agendada_para" timestamp (3) with time zone NOT NULL,
	"gatilho" text NOT NULL,
	"status" text DEFAULT 'agendada' NOT NULL,
	"enviada_em" timestamp (3) with time zone,
	"mensagem_id" uuid,
	"erro" text,
	"cancelada_por" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "conversas_agendamentos_tipo_lista" CHECK ("conversas_agendamentos"."tipo_conteudo" in ('texto', 'template', 'midia')),
	CONSTRAINT "conversas_agendamentos_gatilho_lista" CHECK ("conversas_agendamentos"."gatilho" in ('manual', 'follow_up', 'pos_venda', 'abandono', 'reativacao', 'aniversario', 'promocao')),
	CONSTRAINT "conversas_agendamentos_status_lista" CHECK ("conversas_agendamentos"."status" in ('agendada', 'enviada', 'cancelada', 'falhou')),
	CONSTRAINT "conversas_agendamentos_template" CHECK ("conversas_agendamentos"."tipo_conteudo" <> 'template' or "conversas_agendamentos"."template_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "lojas_integracoes_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"integracao_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"categoria" text NOT NULL,
	"idioma" text DEFAULT 'pt_BR' NOT NULL,
	"cabecalho_tipo" text,
	"cabecalho_conteudo" text,
	"corpo" text NOT NULL,
	"rodape" text,
	"botoes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"variaveis_contagem" integer DEFAULT 0 NOT NULL,
	"meta_template_id" text,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"motivo_rejeicao" text,
	"enviado_em" timestamp (3) with time zone,
	"aprovado_em" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "lojas_integracoes_templates_categoria_lista" CHECK ("lojas_integracoes_templates"."categoria" in ('marketing', 'utility', 'authentication')),
	CONSTRAINT "lojas_integracoes_templates_status_lista" CHECK ("lojas_integracoes_templates"."status" in ('rascunho', 'enviado', 'aprovado', 'rejeitado', 'pausado')),
	CONSTRAINT "lojas_integracoes_templates_cabecalho_lista" CHECK ("lojas_integracoes_templates"."cabecalho_tipo" in ('texto', 'imagem', 'video', 'documento')),
	CONSTRAINT "lojas_integracoes_templates_nome" CHECK ("lojas_integracoes_templates"."nome" ~ '^[a-z0-9_]{1,512}$'),
	CONSTRAINT "lojas_integracoes_templates_variaveis" CHECK ("lojas_integracoes_templates"."variaveis_contagem" >= 0)
);
--> statement-breakpoint
ALTER TABLE "campanhas" ADD CONSTRAINT "campanhas_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "campanhas" ADD CONSTRAINT "campanhas_integracao_id_lojas_integracoes_id_fk" FOREIGN KEY ("integracao_id") REFERENCES "public"."lojas_integracoes"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "campanhas" ADD CONSTRAINT "campanhas_template_id_lojas_integracoes_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."lojas_integracoes_templates"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "campanhas" ADD CONSTRAINT "campanhas_criada_por_usuarios_id_fk" FOREIGN KEY ("criada_por") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "campanhas_destinatarios" ADD CONSTRAINT "campanhas_destinatarios_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "campanhas_destinatarios" ADD CONSTRAINT "campanhas_destinatarios_campanha_id_campanhas_id_fk" FOREIGN KEY ("campanha_id") REFERENCES "public"."campanhas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "campanhas_destinatarios" ADD CONSTRAINT "campanhas_destinatarios_contato_id_contatos_id_fk" FOREIGN KEY ("contato_id") REFERENCES "public"."contatos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "campanhas_destinatarios" ADD CONSTRAINT "campanhas_destinatarios_mensagem_id_conversas_mensagens_id_fk" FOREIGN KEY ("mensagem_id") REFERENCES "public"."conversas_mensagens"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas_agendamentos" ADD CONSTRAINT "conversas_agendamentos_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas_agendamentos" ADD CONSTRAINT "conversas_agendamentos_contato_id_contatos_id_fk" FOREIGN KEY ("contato_id") REFERENCES "public"."contatos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas_agendamentos" ADD CONSTRAINT "conversas_agendamentos_conversa_id_conversas_id_fk" FOREIGN KEY ("conversa_id") REFERENCES "public"."conversas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas_agendamentos" ADD CONSTRAINT "conversas_agendamentos_integracao_id_lojas_integracoes_id_fk" FOREIGN KEY ("integracao_id") REFERENCES "public"."lojas_integracoes"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas_agendamentos" ADD CONSTRAINT "conversas_agendamentos_template_id_lojas_integracoes_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."lojas_integracoes_templates"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas_agendamentos" ADD CONSTRAINT "conversas_agendamentos_midia_id_lojas_midias_id_fk" FOREIGN KEY ("midia_id") REFERENCES "public"."lojas_midias"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas_agendamentos" ADD CONSTRAINT "conversas_agendamentos_mensagem_id_conversas_mensagens_id_fk" FOREIGN KEY ("mensagem_id") REFERENCES "public"."conversas_mensagens"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "conversas_agendamentos" ADD CONSTRAINT "conversas_agendamentos_cancelada_por_usuarios_id_fk" FOREIGN KEY ("cancelada_por") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lojas_integracoes_templates" ADD CONSTRAINT "lojas_integracoes_templates_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lojas_integracoes_templates" ADD CONSTRAINT "lojas_integracoes_templates_integracao_id_lojas_integracoes_id_fk" FOREIGN KEY ("integracao_id") REFERENCES "public"."lojas_integracoes"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "ix_campanhas_status" ON "campanhas" USING btree ("loja_id","status");--> statement-breakpoint
CREATE INDEX "ix_campanhas_agendadas" ON "campanhas" USING btree ("status","agendada_para") WHERE status = 'agendada';--> statement-breakpoint
CREATE INDEX "ix_campanhas_loja" ON "campanhas" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_campanhas_destinatarios" ON "campanhas_destinatarios" USING btree ("campanha_id","contato_id") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_campanhas_destinatarios_reserva" ON "campanhas_destinatarios" USING btree ("campanha_id","status","created_at");--> statement-breakpoint
CREATE INDEX "ix_campanhas_destinatarios_lease" ON "campanhas_destinatarios" USING btree ("reservado_em") WHERE status = 'reservado';--> statement-breakpoint
CREATE INDEX "ix_campanhas_destinatarios_loja" ON "campanhas_destinatarios" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE INDEX "ix_conversas_agendamentos_fila" ON "conversas_agendamentos" USING btree ("status","agendada_para") WHERE status = 'agendada';--> statement-breakpoint
CREATE INDEX "ix_conversas_agendamentos_loja" ON "conversas_agendamentos" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lojas_integracoes_templates_nome" ON "lojas_integracoes_templates" USING btree ("integracao_id","nome","idioma") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_lojas_integracoes_templates_status" ON "lojas_integracoes_templates" USING btree ("loja_id","status");