CREATE TABLE "pedidos_devolucoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"pedido_id" uuid NOT NULL,
	"contato_id" uuid NOT NULL,
	"conversa_id" uuid,
	"tipo" text NOT NULL,
	"motivo" text NOT NULL,
	"motivo_detalhe" text,
	"status" text DEFAULT 'solicitada' NOT NULL,
	"rastreio_codigo" text,
	"valor_estorno" numeric(12, 2),
	"metodo_estorno" text,
	"pagamento_id" uuid,
	"resolvido_por" uuid,
	"resolvido_em" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "pedidos_devolucoes_tipo_lista" CHECK ("pedidos_devolucoes"."tipo" in ('troca', 'devolucao', 'reembolso')),
	CONSTRAINT "pedidos_devolucoes_motivo_lista" CHECK ("pedidos_devolucoes"."motivo" in ('tamanho_errado', 'defeito', 'diferente_do_esperado', 'mudou_de_ideia', 'outro')),
	CONSTRAINT "pedidos_devolucoes_status_lista" CHECK ("pedidos_devolucoes"."status" in ('solicitada', 'aprovada', 'em_transito', 'recebida', 'concluida', 'negada')),
	CONSTRAINT "pedidos_devolucoes_metodo_lista" CHECK ("pedidos_devolucoes"."metodo_estorno" in ('pix', 'cartao', 'credito_loja')),
	CONSTRAINT "pedidos_devolucoes_estorno_positivo" CHECK ("pedidos_devolucoes"."valor_estorno" >= 0),
	CONSTRAINT "pedidos_devolucoes_resolucao" CHECK ("pedidos_devolucoes"."status" not in ('concluida', 'negada')
        or ("pedidos_devolucoes"."resolvido_por" is not null and "pedidos_devolucoes"."resolvido_em" is not null))
);
--> statement-breakpoint
CREATE TABLE "pedidos_devolucoes_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"devolucao_id" uuid NOT NULL,
	"pedido_item_id" uuid NOT NULL,
	"quantidade" integer NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "pedidos_devolucoes_itens_quantidade" CHECK ("pedidos_devolucoes_itens"."quantidade" > 0)
);
--> statement-breakpoint
CREATE TABLE "pedidos_devolucoes_midias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"devolucao_id" uuid NOT NULL,
	"midia_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid
);
--> statement-breakpoint
ALTER TABLE "pedidos_devolucoes" ADD CONSTRAINT "pedidos_devolucoes_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos_devolucoes" ADD CONSTRAINT "pedidos_devolucoes_pedido_id_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos_devolucoes" ADD CONSTRAINT "pedidos_devolucoes_contato_id_contatos_id_fk" FOREIGN KEY ("contato_id") REFERENCES "public"."contatos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos_devolucoes" ADD CONSTRAINT "pedidos_devolucoes_conversa_id_conversas_id_fk" FOREIGN KEY ("conversa_id") REFERENCES "public"."conversas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos_devolucoes" ADD CONSTRAINT "pedidos_devolucoes_pagamento_id_pagamentos_id_fk" FOREIGN KEY ("pagamento_id") REFERENCES "public"."pagamentos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos_devolucoes" ADD CONSTRAINT "pedidos_devolucoes_resolvido_por_usuarios_id_fk" FOREIGN KEY ("resolvido_por") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos_devolucoes_itens" ADD CONSTRAINT "pedidos_devolucoes_itens_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos_devolucoes_itens" ADD CONSTRAINT "pedidos_devolucoes_itens_devolucao_id_pedidos_devolucoes_id_fk" FOREIGN KEY ("devolucao_id") REFERENCES "public"."pedidos_devolucoes"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos_devolucoes_itens" ADD CONSTRAINT "pedidos_devolucoes_itens_pedido_item_id_pedidos_itens_id_fk" FOREIGN KEY ("pedido_item_id") REFERENCES "public"."pedidos_itens"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos_devolucoes_midias" ADD CONSTRAINT "pedidos_devolucoes_midias_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos_devolucoes_midias" ADD CONSTRAINT "pedidos_devolucoes_midias_devolucao_id_pedidos_devolucoes_id_fk" FOREIGN KEY ("devolucao_id") REFERENCES "public"."pedidos_devolucoes"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos_devolucoes_midias" ADD CONSTRAINT "pedidos_devolucoes_midias_midia_id_lojas_midias_id_fk" FOREIGN KEY ("midia_id") REFERENCES "public"."lojas_midias"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "ix_pedidos_devolucoes_pedido" ON "pedidos_devolucoes" USING btree ("pedido_id");--> statement-breakpoint
CREATE INDEX "ix_pedidos_devolucoes_status" ON "pedidos_devolucoes" USING btree ("loja_id","status");--> statement-breakpoint
CREATE INDEX "ix_pedidos_devolucoes_loja" ON "pedidos_devolucoes" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pedidos_devolucoes_itens" ON "pedidos_devolucoes_itens" USING btree ("devolucao_id","pedido_item_id") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_pedidos_devolucoes_itens_loja" ON "pedidos_devolucoes_itens" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pedidos_devolucoes_midias" ON "pedidos_devolucoes_midias" USING btree ("devolucao_id","midia_id") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_pedidos_devolucoes_midias_loja" ON "pedidos_devolucoes_midias" USING btree ("loja_id","is_deleted");