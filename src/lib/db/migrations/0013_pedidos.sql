CREATE TABLE "pedidos_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"pedido_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"variacao_id" uuid,
	"sku" text,
	"nome" text NOT NULL,
	"tamanho" text NOT NULL,
	"quantidade" integer NOT NULL,
	"preco_unitario" numeric(12, 2) NOT NULL,
	"total_item" numeric(12, 2) NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "pedidos_itens_quantidade" CHECK ("pedidos_itens"."quantidade" > 0),
	CONSTRAINT "pedidos_itens_preco_positivo" CHECK ("pedidos_itens"."preco_unitario" >= 0),
	CONSTRAINT "pedidos_itens_total_positivo" CHECK ("pedidos_itens"."total_item" >= 0),
	CONSTRAINT "pedidos_itens_total_coerente" CHECK ("pedidos_itens"."total_item" = "pedidos_itens"."preco_unitario" * "pedidos_itens"."quantidade")
);
--> statement-breakpoint
CREATE TABLE "pedidos_numeracao" (
	"loja_id" uuid NOT NULL,
	"ano_mes" text NOT NULL,
	"ultimo_numero" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "pedidos_numeracao_pk" PRIMARY KEY("loja_id","ano_mes"),
	CONSTRAINT "pedidos_numeracao_ano_mes" CHECK ("pedidos_numeracao"."ano_mes" ~ '^[0-9]{2}(0[1-9]|1[0-2])$'),
	CONSTRAINT "pedidos_numeracao_nunca_excluida" CHECK ("pedidos_numeracao"."is_deleted" = false),
	CONSTRAINT "pedidos_numeracao_positivo" CHECK ("pedidos_numeracao"."ultimo_numero" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pagamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"pedido_id" uuid NOT NULL,
	"provedor" text NOT NULL,
	"metodo" text NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"valor" numeric(12, 2) NOT NULL,
	"externo_id" text,
	"pix_copia_cola" text,
	"qrcode_midia_id" uuid,
	"link_pagamento" text,
	"expira_em" timestamp (3) with time zone,
	"pago_em" timestamp (3) with time zone,
	"estornado_em" timestamp (3) with time zone,
	"criado_por" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "pagamentos_provedor_lista" CHECK ("pagamentos"."provedor" in ('mercadopago', 'asaas', 'pagbank', 'manual')),
	CONSTRAINT "pagamentos_metodo_lista" CHECK ("pagamentos"."metodo" in ('pix', 'cartao', 'boleto', 'link', 'dinheiro')),
	CONSTRAINT "pagamentos_status_lista" CHECK ("pagamentos"."status" in ('pendente', 'aprovado', 'recusado', 'estornado', 'expirado', 'cancelado')),
	CONSTRAINT "pagamentos_valor_positivo" CHECK ("pagamentos"."valor" > 0)
);
--> statement-breakpoint
CREATE TABLE "pedidos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"contato_id" uuid NOT NULL,
	"negocio_id" uuid,
	"conversa_id" uuid,
	"numero" text NOT NULL,
	"status" text DEFAULT 'confirmado' NOT NULL,
	"pagamento_status" text DEFAULT 'pendente' NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"frete" numeric(12, 2) DEFAULT '0' NOT NULL,
	"desconto" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"forma_pagamento" text,
	"entrega_metodo" text,
	"rastreio_codigo" text,
	"rastreio_url" text,
	"endereco_entrega" jsonb,
	"observacoes" text,
	"masc_status" text DEFAULT 'pendente' NOT NULL,
	"masc_venda_id" text,
	"masc_lancado_em" timestamp (3) with time zone,
	"masc_lancado_por" uuid,
	"masc_observacao" text,
	"cancelado_em" timestamp (3) with time zone,
	"cancelado_motivo" text,
	"criado_por" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "pedidos_status_lista" CHECK ("pedidos"."status" in ('confirmado', 'preparando', 'enviado', 'entregue', 'devolvido', 'cancelado')),
	CONSTRAINT "pedidos_pagamento_status_lista" CHECK ("pedidos"."pagamento_status" in ('pendente', 'pago', 'estornado', 'cancelado')),
	CONSTRAINT "pedidos_forma_pagamento_lista" CHECK ("pedidos"."forma_pagamento" in ('pix', 'cartao', 'boleto', 'link', 'dinheiro')),
	CONSTRAINT "pedidos_masc_status_lista" CHECK ("pedidos"."masc_status" in ('pendente', 'lancado', 'dispensado')),
	CONSTRAINT "pedidos_subtotal_positivo" CHECK ("pedidos"."subtotal" >= 0),
	CONSTRAINT "pedidos_frete_positivo" CHECK ("pedidos"."frete" >= 0),
	CONSTRAINT "pedidos_desconto_positivo" CHECK ("pedidos"."desconto" >= 0),
	CONSTRAINT "pedidos_total_positivo" CHECK ("pedidos"."total" >= 0),
	CONSTRAINT "pedidos_total_coerente" CHECK ("pedidos"."total" = "pedidos"."subtotal" + "pedidos"."frete" - "pedidos"."desconto"),
	CONSTRAINT "pedidos_desconto_ate_subtotal" CHECK ("pedidos"."desconto" <= "pedidos"."subtotal"),
	CONSTRAINT "pedidos_rastreio_url" CHECK ("pedidos"."rastreio_url" ~ '^https://'),
	CONSTRAINT "pedidos_masc_lancado" CHECK ("pedidos"."masc_status" <> 'lancado'
        or ("pedidos"."masc_venda_id" is not null and "pedidos"."masc_lancado_em" is not null)),
	CONSTRAINT "pedidos_masc_dispensado" CHECK ("pedidos"."masc_status" <> 'dispensado' or "pedidos"."masc_observacao" is not null)
);
--> statement-breakpoint
ALTER TABLE "pedidos_itens" ADD CONSTRAINT "pedidos_itens_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos_itens" ADD CONSTRAINT "pedidos_itens_pedido_id_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos_itens" ADD CONSTRAINT "pedidos_itens_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos_itens" ADD CONSTRAINT "pedidos_itens_variacao_id_produtos_variacoes_id_fk" FOREIGN KEY ("variacao_id") REFERENCES "public"."produtos_variacoes"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos_numeracao" ADD CONSTRAINT "pedidos_numeracao_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_pedido_id_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_qrcode_midia_id_lojas_midias_id_fk" FOREIGN KEY ("qrcode_midia_id") REFERENCES "public"."lojas_midias"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_contato_id_contatos_id_fk" FOREIGN KEY ("contato_id") REFERENCES "public"."contatos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_conversa_id_conversas_id_fk" FOREIGN KEY ("conversa_id") REFERENCES "public"."conversas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_masc_lancado_por_usuarios_id_fk" FOREIGN KEY ("masc_lancado_por") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "ix_pedidos_itens_pedido" ON "pedidos_itens" USING btree ("pedido_id");--> statement-breakpoint
CREATE INDEX "ix_pedidos_itens_produto" ON "pedidos_itens" USING btree ("produto_id");--> statement-breakpoint
CREATE INDEX "ix_pedidos_itens_variacao" ON "pedidos_itens" USING btree ("variacao_id");--> statement-breakpoint
CREATE INDEX "ix_pedidos_itens_loja" ON "pedidos_itens" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pagamentos_externo" ON "pagamentos" USING btree ("provedor","externo_id") WHERE externo_id is not null and is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_pagamentos_pedido" ON "pagamentos" USING btree ("pedido_id");--> statement-breakpoint
CREATE INDEX "ix_pagamentos_status" ON "pagamentos" USING btree ("loja_id","status");--> statement-breakpoint
CREATE INDEX "ix_pagamentos_expiracao" ON "pagamentos" USING btree ("status","expira_em") WHERE status = 'pendente';--> statement-breakpoint
CREATE INDEX "ix_pagamentos_loja" ON "pagamentos" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pedidos_numero" ON "pedidos" USING btree ("loja_id","numero") WHERE is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pedidos_masc_venda" ON "pedidos" USING btree ("loja_id","masc_venda_id") WHERE masc_venda_id is not null and is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_pedidos_fila_masc" ON "pedidos" USING btree ("loja_id","masc_status") WHERE masc_status = 'pendente' and status not in ('cancelado', 'devolvido');--> statement-breakpoint
CREATE INDEX "ix_pedidos_lista" ON "pedidos" USING btree ("loja_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_pedidos_contato" ON "pedidos" USING btree ("contato_id");--> statement-breakpoint
CREATE INDEX "ix_pedidos_negocio" ON "pedidos" USING btree ("negocio_id");--> statement-breakpoint
CREATE INDEX "ix_pedidos_loja" ON "pedidos" USING btree ("loja_id","is_deleted");