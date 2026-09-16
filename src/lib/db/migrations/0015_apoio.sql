CREATE TABLE "alertas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"severidade" text NOT NULL,
	"mensagem" text NOT NULL,
	"conversa_id" uuid,
	"contato_id" uuid,
	"pedido_id" uuid,
	"negocio_id" uuid,
	"chave_deduplicacao" text NOT NULL,
	"reconhecido_por" uuid,
	"reconhecido_em" timestamp (3) with time zone,
	"resolvido_em" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "alertas_tipo_lista" CHECK ("alertas"."tipo" in ('sla_estourado', 'risco_avaliacao', 'negocio_parado', 'pagamento_pendente', 'primeiro_contato', 'cliente_retornando', 'follow_up_atrasado', 'sessao_uazapi_caiu', 'integracao_com_erro')),
	CONSTRAINT "alertas_severidade_lista" CHECK ("alertas"."severidade" in ('baixa', 'media', 'alta', 'critica'))
);
--> statement-breakpoint
CREATE TABLE "consentimentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"criado_em" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"loja_id" uuid NOT NULL,
	"contato_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"concedido" boolean NOT NULL,
	"origem" text NOT NULL,
	"canal" text,
	"mensagem_id" uuid,
	"termo_versao" text NOT NULL,
	"ip" text,
	"registrado_por" uuid,
	CONSTRAINT "consentimentos_tipo_lista" CHECK ("consentimentos"."tipo" in ('tratamento_dados', 'marketing', 'opt_out', 'opt_in')),
	CONSTRAINT "consentimentos_origem_lista" CHECK ("consentimentos"."origem" in ('mensagem', 'tela', 'importacao', 'contato_direto'))
);
--> statement-breakpoint
CREATE TABLE "lgpd_solicitacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"contato_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"protocolo" text NOT NULL,
	"motivo" text,
	"solicitado_em" timestamp (3) with time zone NOT NULL,
	"executado_por" uuid,
	"executado_em" timestamp (3) with time zone,
	"resultado" jsonb,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "lgpd_solicitacoes_tipo_lista" CHECK ("lgpd_solicitacoes"."tipo" in ('acesso', 'eliminacao', 'correcao'))
);
--> statement-breakpoint
CREATE TABLE "pesquisas_satisfacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"contato_id" uuid NOT NULL,
	"conversa_id" uuid,
	"pedido_id" uuid,
	"nota" integer,
	"comentario" text,
	"gatilho" text NOT NULL,
	"mensagem_id" uuid,
	"enviada_em" timestamp (3) with time zone,
	"respondida_em" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "pesquisas_satisfacao_gatilho_lista" CHECK ("pesquisas_satisfacao"."gatilho" in ('conversa_encerrada', 'pedido_entregue')),
	CONSTRAINT "pesquisas_satisfacao_nota" CHECK ("pesquisas_satisfacao"."nota" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_conversa_id_conversas_id_fk" FOREIGN KEY ("conversa_id") REFERENCES "public"."conversas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_contato_id_contatos_id_fk" FOREIGN KEY ("contato_id") REFERENCES "public"."contatos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_pedido_id_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_reconhecido_por_usuarios_id_fk" FOREIGN KEY ("reconhecido_por") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lgpd_solicitacoes" ADD CONSTRAINT "lgpd_solicitacoes_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lgpd_solicitacoes" ADD CONSTRAINT "lgpd_solicitacoes_contato_id_contatos_id_fk" FOREIGN KEY ("contato_id") REFERENCES "public"."contatos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lgpd_solicitacoes" ADD CONSTRAINT "lgpd_solicitacoes_executado_por_usuarios_id_fk" FOREIGN KEY ("executado_por") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pesquisas_satisfacao" ADD CONSTRAINT "pesquisas_satisfacao_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pesquisas_satisfacao" ADD CONSTRAINT "pesquisas_satisfacao_contato_id_contatos_id_fk" FOREIGN KEY ("contato_id") REFERENCES "public"."contatos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pesquisas_satisfacao" ADD CONSTRAINT "pesquisas_satisfacao_conversa_id_conversas_id_fk" FOREIGN KEY ("conversa_id") REFERENCES "public"."conversas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pesquisas_satisfacao" ADD CONSTRAINT "pesquisas_satisfacao_pedido_id_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pesquisas_satisfacao" ADD CONSTRAINT "pesquisas_satisfacao_mensagem_id_conversas_mensagens_id_fk" FOREIGN KEY ("mensagem_id") REFERENCES "public"."conversas_mensagens"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_alertas_deduplicacao" ON "alertas" USING btree ("loja_id","chave_deduplicacao") WHERE resolvido_em is null and is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_alertas_painel" ON "alertas" USING btree ("loja_id","reconhecido_em","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_alertas_tipo" ON "alertas" USING btree ("loja_id","tipo");--> statement-breakpoint
CREATE INDEX "ix_alertas_loja" ON "alertas" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE INDEX "ix_consentimentos_contato" ON "consentimentos" USING btree ("contato_id","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_consentimentos_loja" ON "consentimentos" USING btree ("loja_id","tipo","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lgpd_solicitacoes_protocolo" ON "lgpd_solicitacoes" USING btree ("loja_id","protocolo") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_lgpd_solicitacoes_contato" ON "lgpd_solicitacoes" USING btree ("contato_id");--> statement-breakpoint
CREATE INDEX "ix_lgpd_solicitacoes_loja" ON "lgpd_solicitacoes" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pesquisas_satisfacao_pedido" ON "pesquisas_satisfacao" USING btree ("pedido_id","gatilho") WHERE pedido_id is not null and is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_pesquisas_satisfacao_contato" ON "pesquisas_satisfacao" USING btree ("contato_id");--> statement-breakpoint
CREATE INDEX "ix_pesquisas_satisfacao_loja" ON "pesquisas_satisfacao" USING btree ("loja_id","is_deleted");--> statement-breakpoint
-- `consentimentos` e a quarta trilha append-only (01-dados.md §7.3). O REVOKE e
-- o gatilho ficam aqui, e nao em 0004, porque e aqui que a tabela nasce.
REVOKE UPDATE, DELETE, TRUNCATE ON consentimentos FROM merlo_app;
--> statement-breakpoint
CREATE TRIGGER trg_consentimentos_imutavel
  BEFORE UPDATE OR DELETE ON consentimentos
  FOR EACH ROW EXECUTE FUNCTION trilha_imutavel();
