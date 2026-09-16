CREATE TABLE "auditoria_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"criado_em" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"ator_tipo" text NOT NULL,
	"ator_id" uuid,
	"loja_id" uuid,
	"acao" text NOT NULL,
	"entidade" text NOT NULL,
	"entidade_id" text,
	"antes" jsonb,
	"depois" jsonb,
	"motivo" text,
	"ip" text,
	"agente" text,
	"detalhes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "auditoria_eventos_ator_tipo_lista" CHECK ("auditoria_eventos"."ator_tipo" in ('usuario', 'sistema', 'integracao')),
	CONSTRAINT "auditoria_eventos_acao_lista" CHECK ("auditoria_eventos"."acao" in ('loja_criada', 'loja_alterada', 'loja_desativada', 'usuario_criado', 'usuario_alterado', 'usuario_desativado', 'usuario_reativado', 'usuario_papel_alterado', 'integracao_conectada', 'integracao_alterada', 'integracao_desconectada', 'integracao_pareada', 'conversa_resolvida', 'conversa_reaberta', 'conversa_transferida', 'conversa_prioridade_alterada', 'mensagem_enviada', 'mensagem_reenviada', 'mensagem_nota_interna', 'midia_enviada', 'midia_excluida', 'contato_criado', 'contato_alterado', 'contato_excluido', 'contato_etiqueta_alterada', 'negocio_criado', 'negocio_estagio_alterado', 'negocio_valor_alterado', 'negocio_excluido', 'pedido_criado', 'pedido_status_alterado', 'pedido_cancelado', 'pedido_lancado_masc', 'pedido_dispensado_masc', 'pedido_voltou_fila_masc', 'pagamento_gerado', 'pagamento_confirmado', 'pagamento_estornado', 'devolucao_criada', 'devolucao_status_alterado', 'devolucao_estorno_aprovado', 'devolucao_concluida', 'campanha_criada', 'campanha_iniciada', 'campanha_pausada', 'campanha_concluida', 'campanha_excluida', 'template_enviado', 'template_aprovado', 'template_rejeitado', 'produto_sincronizado', 'produto_preco_alterado', 'lgpd_exportado', 'lgpd_anonimizado', 'lgpd_solicitacao_registrada', 'consentimento_registrado')),
	CONSTRAINT "auditoria_eventos_ator_coerente" CHECK ("auditoria_eventos"."ator_tipo" <> 'usuario' or "auditoria_eventos"."ator_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "auth_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"criado_em" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"tipo" text NOT NULL,
	"ator_tipo" text DEFAULT 'usuario' NOT NULL,
	"usuario_id" uuid,
	"email_hash" text,
	"sessao_id" uuid,
	"meio" text,
	"resultado" text NOT NULL,
	"ip" text,
	"agente" text,
	"ator_id" uuid,
	"alvo_id" uuid,
	"motivo" text,
	"detalhes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "auth_eventos_tipo_lista" CHECK ("auth_eventos"."tipo" in ('login_sucesso', 'senha_aceita_aguardando_2fa', 'login_falha', 'conta_bloqueada', 'conta_destravada', 'logout', 'sessao_criada', 'sessao_encerrada', 'reset_solicitado', 'reset_concluido', 'senha_trocada', 'fator_adicionado', 'fator_removido', 'passkey_adicionada', 'passkey_removida', 'papel_alterado', 'admin_promovido', 'admin_rebaixado', 'posse_transferida', 'dono_semeado', 'usuario_desativado', 'usuario_reativado', 'convite_emitido', 'convite_usado', 'email_trocado', 'recusa_403', 'sonda_caminho_desligado', 'webhook_recusado', 'recuperacao_assistida', 'limitador_indisponivel', 'hibp_indisponivel', 'email_seguranca_falhou', 'ip_cadeia_inesperada')),
	CONSTRAINT "auth_eventos_ator_tipo_lista" CHECK ("auth_eventos"."ator_tipo" in ('usuario', 'sistema', 'integracao')),
	CONSTRAINT "auth_eventos_meio_lista" CHECK ("auth_eventos"."meio" in ('senha', 'senha+totp', 'passkey', 'convite', 'reset', 'admin', 'sistema')),
	CONSTRAINT "auth_eventos_resultado_lista" CHECK ("auth_eventos"."resultado" in ('sucesso', 'falha', 'recusado'))
);
--> statement-breakpoint
CREATE INDEX "ix_auditoria_eventos_entidade" ON "auditoria_eventos" USING btree ("entidade","entidade_id","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_auditoria_eventos_loja" ON "auditoria_eventos" USING btree ("loja_id","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_auditoria_eventos_ator" ON "auditoria_eventos" USING btree ("ator_id","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_auditoria_eventos_acao" ON "auditoria_eventos" USING btree ("acao","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_auth_eventos_usuario" ON "auth_eventos" USING btree ("usuario_id","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_auth_eventos_tipo" ON "auth_eventos" USING btree ("tipo","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_auth_eventos_email_hash" ON "auth_eventos" USING btree ("email_hash","criado_em" DESC NULLS LAST);--> statement-breakpoint
-- Append-only de verdade (01-dados.md §7.3): o REVOKE tira o poder do papel da
-- aplicacao, e o gatilho fecha para qualquer papel, inclusive o dono.
-- `consentimentos` e a quarta trilha; o REVOKE e o gatilho dela ficam em
-- 0015_apoio, que e onde a tabela nasce.
-- `lojas_integracoes_eventos` NAO entra aqui: e diario de ingestao e a
-- aplicacao precisa marcar `processado_em` e mascarar o corpo (§6.4).
REVOKE UPDATE, DELETE, TRUNCATE ON auth_eventos, auditoria_eventos,
  usuarios_senhas_historico FROM merlo_app;
--> statement-breakpoint
CREATE TRIGGER trg_auth_eventos_imutavel
  BEFORE UPDATE OR DELETE ON auth_eventos
  FOR EACH ROW EXECUTE FUNCTION trilha_imutavel();
--> statement-breakpoint
CREATE TRIGGER trg_auditoria_eventos_imutavel
  BEFORE UPDATE OR DELETE ON auditoria_eventos
  FOR EACH ROW EXECUTE FUNCTION trilha_imutavel();
--> statement-breakpoint
CREATE TRIGGER trg_usuarios_senhas_historico_imutavel
  BEFORE UPDATE OR DELETE ON usuarios_senhas_historico
  FOR EACH ROW EXECUTE FUNCTION trilha_imutavel();
