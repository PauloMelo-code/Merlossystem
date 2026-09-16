CREATE TABLE "lojas_ia_usos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"criado_em" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"loja_id" uuid NOT NULL,
	"usuario_id" uuid,
	"funcao" text NOT NULL,
	"provedor" text NOT NULL,
	"modelo" text NOT NULL,
	"conversa_id" uuid,
	"mensagem_midia_id" uuid,
	"tokens_entrada" integer DEFAULT 0 NOT NULL,
	"tokens_saida" integer DEFAULT 0 NOT NULL,
	"audio_segundos" integer DEFAULT 0 NOT NULL,
	"custo_usd_micros" integer DEFAULT 0 NOT NULL,
	"resultado" text NOT NULL,
	"erro_codigo" text,
	CONSTRAINT "lojas_ia_usos_funcao_lista" CHECK ("lojas_ia_usos"."funcao" in ('sugestao', 'resumo', 'classificacao', 'transcricao')),
	CONSTRAINT "lojas_ia_usos_provedor_lista" CHECK ("lojas_ia_usos"."provedor" in ('anthropic', 'openai', 'simulado')),
	CONSTRAINT "lojas_ia_usos_modelo_lista" CHECK ("lojas_ia_usos"."modelo" in ('claude-sonnet-5', 'claude-haiku-4-5-20251001', 'whisper-1', 'simulado')),
	CONSTRAINT "lojas_ia_usos_resultado_lista" CHECK ("lojas_ia_usos"."resultado" in ('sucesso', 'falha', 'descartada', 'recusada_limite')),
	CONSTRAINT "lojas_ia_usos_nao_negativos" CHECK ("lojas_ia_usos"."tokens_entrada" >= 0 and "lojas_ia_usos"."tokens_saida" >= 0 and "lojas_ia_usos"."audio_segundos" >= 0 and "lojas_ia_usos"."custo_usd_micros" >= 0),
	CONSTRAINT "lojas_ia_usos_erro_curto" CHECK (char_length("lojas_ia_usos"."erro_codigo") <= 40)
);
--> statement-breakpoint
CREATE TABLE "lojas_sla" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loja_id" uuid NOT NULL,
	"provedor" text,
	"prioridade" text,
	"minutos" integer NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid,
	CONSTRAINT "lojas_sla_provedor_lista" CHECK ("lojas_sla"."provedor" in ('whatsapp_oficial', 'uazapi', 'instagram', 'facebook', 'tiktok')),
	CONSTRAINT "lojas_sla_prioridade_lista" CHECK ("lojas_sla"."prioridade" in ('baixa', 'media', 'alta', 'urgente')),
	CONSTRAINT "lojas_sla_um_alvo" CHECK (num_nonnulls("lojas_sla"."provedor", "lojas_sla"."prioridade") = 1),
	CONSTRAINT "lojas_sla_minutos_faixa" CHECK ("lojas_sla"."minutos" between 1 and 1440)
);
--> statement-breakpoint
ALTER TABLE "alertas" DROP CONSTRAINT "alertas_tipo_lista";--> statement-breakpoint
ALTER TABLE "auditoria_eventos" DROP CONSTRAINT "auditoria_eventos_acao_lista";--> statement-breakpoint
ALTER TABLE "lojas_integracoes" DROP CONSTRAINT "lojas_integracoes_provedor_lista";--> statement-breakpoint
ALTER TABLE "lojas_integracoes_eventos" DROP CONSTRAINT "lojas_integracoes_eventos_provedor_lista";--> statement-breakpoint
ALTER TABLE "pagamentos" DROP CONSTRAINT "pagamentos_provedor_lista";--> statement-breakpoint
DROP INDEX "ix_conversas_mensagens_midias_transcricao";--> statement-breakpoint
ALTER TABLE "conversas" ADD COLUMN "ia_intencao" text;--> statement-breakpoint
ALTER TABLE "conversas" ADD COLUMN "ia_urgencia" text;--> statement-breakpoint
ALTER TABLE "conversas" ADD COLUMN "ia_sentimento" text;--> statement-breakpoint
ALTER TABLE "conversas" ADD COLUMN "ia_classificada_ate" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "conversas_mensagens_midias" ADD COLUMN "ordem" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lojas_ia_usos" ADD CONSTRAINT "lojas_ia_usos_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lojas_ia_usos" ADD CONSTRAINT "lojas_ia_usos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lojas_ia_usos" ADD CONSTRAINT "lojas_ia_usos_conversa_id_conversas_id_fk" FOREIGN KEY ("conversa_id") REFERENCES "public"."conversas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lojas_ia_usos" ADD CONSTRAINT "lojas_ia_usos_mensagem_midia_id_conversas_mensagens_midias_id_fk" FOREIGN KEY ("mensagem_midia_id") REFERENCES "public"."conversas_mensagens_midias"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "lojas_sla" ADD CONSTRAINT "lojas_sla_loja_id_lojas_id_fk" FOREIGN KEY ("loja_id") REFERENCES "public"."lojas"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "ix_lojas_ia_usos_loja" ON "lojas_ia_usos" USING btree ("loja_id","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_lojas_ia_usos_usuario" ON "lojas_ia_usos" USING btree ("usuario_id","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lojas_sla_provedor" ON "lojas_sla" USING btree ("loja_id","provedor") WHERE provedor is not null and is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lojas_sla_prioridade" ON "lojas_sla" USING btree ("loja_id","prioridade") WHERE prioridade is not null and is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_lojas_sla_loja" ON "lojas_sla" USING btree ("loja_id","is_deleted");--> statement-breakpoint
CREATE INDEX "ix_conversas_ia_varredura" ON "conversas" USING btree ("ultima_entrada_em") WHERE status in ('aberta', 'pendente') and is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lojas_integracoes_pagamento" ON "lojas_integracoes" USING btree ("loja_id") WHERE provedor in ('mercadopago', 'pagamento_simulado') and is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pesquisas_satisfacao_conversa" ON "pesquisas_satisfacao" USING btree ("conversa_id") WHERE gatilho = 'conversa_encerrada' and is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_pesquisas_satisfacao_periodo" ON "pesquisas_satisfacao" USING btree ("loja_id","enviada_em" DESC NULLS LAST) WHERE is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_negocios_aberto_por_contato" ON "negocios" USING btree ("contato_id") WHERE estagio in ('lead', 'interessada', 'negociando', 'fechando') and is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pagamentos_um_pendente" ON "pagamentos" USING btree ("pedido_id") WHERE status = 'pendente' and is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_conversas_mensagens_midias_transcricao" ON "conversas_mensagens_midias" USING btree ("transcricao_status") WHERE transcricao_status in ('pendente', 'processando');--> statement-breakpoint
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_tipo_lista" CHECK ("alertas"."tipo" in ('sla_estourado', 'risco_avaliacao', 'negocio_parado', 'pagamento_pendente', 'primeiro_contato', 'cliente_retornando', 'follow_up_atrasado', 'sessao_uazapi_caiu', 'integracao_com_erro', 'espelho_divergente', 'pagamento_conferir'));--> statement-breakpoint
ALTER TABLE "auditoria_eventos" ADD CONSTRAINT "auditoria_eventos_acao_lista" CHECK ("auditoria_eventos"."acao" in ('loja_criada', 'loja_alterada', 'loja_desativada', 'usuario_criado', 'usuario_alterado', 'usuario_desativado', 'usuario_reativado', 'usuario_papel_alterado', 'integracao_conectada', 'integracao_alterada', 'integracao_desconectada', 'integracao_pareada', 'conversa_resolvida', 'conversa_reaberta', 'conversa_transferida', 'conversa_prioridade_alterada', 'conversa_criada', 'conversa_arquivada', 'mensagem_enviada', 'mensagem_reenviada', 'mensagem_nota_interna', 'mensagem_recebida', 'midia_enviada', 'midia_excluida', 'midia_recebida', 'midia_alterada', 'contato_criado', 'contato_alterado', 'contato_excluido', 'contato_etiqueta_alterada', 'negocio_criado', 'negocio_alterado', 'negocio_estagio_alterado', 'negocio_valor_alterado', 'negocio_excluido', 'pedido_criado', 'pedido_status_alterado', 'pedido_cancelado', 'pedido_lancado_masc', 'pedido_dispensado_masc', 'pedido_voltou_fila_masc', 'pedido_rastreio_informado', 'pagamento_gerado', 'pagamento_confirmado', 'pagamento_estornado', 'pagamento_cancelado', 'pagamento_status_alterado', 'devolucao_criada', 'devolucao_status_alterado', 'devolucao_estorno_aprovado', 'devolucao_concluida', 'pesquisa_enviada', 'pesquisa_respondida', 'campanha_criada', 'campanha_iniciada', 'campanha_pausada', 'campanha_concluida', 'campanha_excluida', 'campanha_alterada', 'template_enviado', 'template_aprovado', 'template_rejeitado', 'lookbook_criado', 'lookbook_alterado', 'lookbook_excluido', 'sla_alterado', 'template_criado', 'template_alterado', 'template_excluido', 'template_pausado', 'resposta_rapida_criada', 'resposta_rapida_alterada', 'resposta_rapida_excluida', 'agendamento_criado', 'agendamento_reagendado', 'agendamento_cancelado', 'produto_sincronizado', 'produto_preco_alterado', 'lgpd_exportado', 'lgpd_anonimizado', 'lgpd_solicitacao_registrada', 'consentimento_registrado', 'artigo_criado', 'artigo_alterado', 'artigo_excluido', 'artigo_etiqueta_alterada', 'alerta_reconhecido', 'convite_expirado'));--> statement-breakpoint
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_ia_intencao_lista" CHECK ("conversas"."ia_intencao" in ('interesse_compra', 'pergunta_preco', 'pergunta_tamanho', 'pergunta_disponibilidade', 'pergunta_frete', 'pedido_troca', 'reclamacao', 'elogio', 'duvida_geral', 'saudacao', 'outro'));--> statement-breakpoint
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_ia_urgencia_lista" CHECK ("conversas"."ia_urgencia" in ('baixa', 'media', 'alta', 'urgente'));--> statement-breakpoint
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_ia_sentimento_lista" CHECK ("conversas"."ia_sentimento" in ('positivo', 'neutro', 'negativo'));--> statement-breakpoint
ALTER TABLE "conversas_mensagens_midias" ADD CONSTRAINT "conversas_mensagens_midias_ordem_positiva" CHECK ("conversas_mensagens_midias"."ordem" >= 0);--> statement-breakpoint
ALTER TABLE "lojas_integracoes" ADD CONSTRAINT "lojas_integracoes_provedor_lista" CHECK ("lojas_integracoes"."provedor" in ('whatsapp_oficial', 'uazapi', 'instagram', 'facebook', 'tiktok', 'tiktok_shop', 'bling', 'mercadopago', 'pagamento_simulado'));--> statement-breakpoint
ALTER TABLE "lojas_integracoes_eventos" ADD CONSTRAINT "lojas_integracoes_eventos_provedor_lista" CHECK ("lojas_integracoes_eventos"."provedor" in ('whatsapp_oficial', 'uazapi', 'instagram', 'facebook', 'tiktok', 'tiktok_shop', 'bling', 'mercadopago', 'pagamento_simulado'));--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_provedor_lista" CHECK ("pagamentos"."provedor" in ('mercadopago', 'asaas', 'pagbank', 'pagamento_simulado'));