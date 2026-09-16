CREATE TABLE "lojas_integracoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid,
	"provedor" text NOT NULL,
	"rotulo" text NOT NULL,
	"status" text DEFAULT 'desconectado' NOT NULL,
	"credenciais_cifradas" text,
	"credenciais_aad" text,
	"referencia_externa" text,
	"segredo_webhook_hash" text,
	"expira_em" timestamp (3) with time zone,
	"ultimo_erro" text,
	"ultima_sincronizacao" timestamp (3) with time zone,
	"revogada_em" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "lojas_integracoes_provedor_lista" CHECK ("lojas_integracoes"."provedor" in ('whatsapp_oficial', 'uazapi', 'instagram', 'facebook', 'tiktok_shop', 'bling')),
	CONSTRAINT "lojas_integracoes_status_lista" CHECK ("lojas_integracoes"."status" in ('desconectado', 'conectado', 'expirado', 'erro')),
	CONSTRAINT "lojas_integracoes_rede" CHECK (("lojas_integracoes"."provedor" = 'bling') = ("lojas_integracoes"."loja_id" is null))
);
--> statement-breakpoint
CREATE TABLE "lojas_integracoes_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provedor" text NOT NULL,
	"integracao_id" uuid,
	"loja_id" uuid,
	"tipo" text NOT NULL,
	"evento_externo_id" text,
	"assinatura_ok" boolean NOT NULL,
	"ip" text,
	"corpo" jsonb NOT NULL,
	"cabecalhos" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"erro" text,
	"processado_em" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "lojas_integracoes_eventos_provedor_lista" CHECK ("lojas_integracoes_eventos"."provedor" in ('whatsapp_oficial', 'uazapi', 'instagram', 'facebook', 'tiktok_shop', 'bling')),
	CONSTRAINT "lojas_integracoes_eventos_tipo_lista" CHECK ("lojas_integracoes_eventos"."tipo" in ('recebido', 'recusado', 'descartado', 'processado', 'falhou'))
);
--> statement-breakpoint
ALTER TABLE "lojas_integracoes" ADD CONSTRAINT "lojas_integracoes_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lojas_integracoes_referencia" ON "lojas_integracoes" USING btree ("provedor","referencia_externa") WHERE referencia_externa is not null and is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_lojas_integracoes_loja" ON "lojas_integracoes" USING btree ("loja_id","provedor");--> statement-breakpoint
CREATE INDEX "ix_lojas_integracoes_provedor_status" ON "lojas_integracoes" USING btree ("provedor","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lojas_integracoes_eventos_externo" ON "lojas_integracoes_eventos" USING btree ("provedor","evento_externo_id") WHERE evento_externo_id is not null;--> statement-breakpoint
CREATE INDEX "ix_lojas_integracoes_eventos_criado" ON "lojas_integracoes_eventos" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ix_lojas_integracoes_eventos_integracao" ON "lojas_integracoes_eventos" USING btree ("integracao_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_lojas_integracoes_eventos_tipo" ON "lojas_integracoes_eventos" USING btree ("tipo","created_at");