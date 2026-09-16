CREATE TABLE "negocios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"contato_id" uuid NOT NULL,
	"conversa_id" uuid,
	"responsavel_id" uuid,
	"estagio" text DEFAULT 'lead' NOT NULL,
	"valor" numeric(12, 2) DEFAULT '0' NOT NULL,
	"motivo_perda" text,
	"observacao_perda" text,
	"previsao_fechamento" date,
	"ultima_atividade_em" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "negocios_estagio_lista" CHECK ("negocios"."estagio" in ('lead', 'interessada', 'negociando', 'fechando', 'ganho', 'perdido')),
	CONSTRAINT "negocios_motivo_perda_lista" CHECK ("negocios"."motivo_perda" in ('preco', 'tamanho_indisponivel', 'concorrente', 'sem_resposta', 'mudou_de_ideia', 'outro')),
	CONSTRAINT "negocios_valor_positivo" CHECK ("negocios"."valor" >= 0),
	CONSTRAINT "negocios_perda_com_motivo" CHECK ("negocios"."estagio" <> 'perdido' or "negocios"."motivo_perda" is not null)
);
--> statement-breakpoint
ALTER TABLE "negocios" ADD CONSTRAINT "negocios_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "negocios" ADD CONSTRAINT "negocios_contato_id_contatos_id_fk" FOREIGN KEY ("contato_id") REFERENCES "public"."contatos"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "negocios" ADD CONSTRAINT "negocios_conversa_id_conversas_id_fk" FOREIGN KEY ("conversa_id") REFERENCES "public"."conversas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "negocios" ADD CONSTRAINT "negocios_responsavel_id_usuarios_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "ix_negocios_funil" ON "negocios" USING btree ("loja_id","estagio","ultima_atividade_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_negocios_contato" ON "negocios" USING btree ("contato_id");--> statement-breakpoint
CREATE INDEX "ix_negocios_responsavel" ON "negocios" USING btree ("responsavel_id");--> statement-breakpoint
CREATE INDEX "ix_negocios_loja" ON "negocios" USING btree ("loja_id","is_deleted");