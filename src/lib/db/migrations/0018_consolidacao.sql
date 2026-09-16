-- 0018 — consolidação do R1 (DF1). Não cria tabela.
--   1. CHECK do nome de modelo: `{1,512}` estoura o limite de repetição do
--      Postgres (255) e TODO insert em lojas_integracoes_templates falhava.
--   2. Listas fechadas ampliadas pela onda 2 (ACOES_AUDITADAS, TIPOS_ALERTA).
--   3. ATOR_SISTEMA: exceção no CHECK papel × loja, CHECK que o mantém inerte
--      e a semente (função idempotente, reusada pelos testes que truncam
--      `usuarios`). Ver ADR 0031 e 0032.
ALTER TABLE "alertas" DROP CONSTRAINT "alertas_tipo_lista";--> statement-breakpoint
ALTER TABLE "auditoria_eventos" DROP CONSTRAINT "auditoria_eventos_acao_lista";--> statement-breakpoint
ALTER TABLE "usuarios" DROP CONSTRAINT "usuarios_papel_loja";--> statement-breakpoint
ALTER TABLE "lojas_integracoes_templates" DROP CONSTRAINT "lojas_integracoes_templates_nome";--> statement-breakpoint
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_tipo_lista" CHECK ("alertas"."tipo" in ('sla_estourado', 'risco_avaliacao', 'negocio_parado', 'pagamento_pendente', 'primeiro_contato', 'cliente_retornando', 'follow_up_atrasado', 'sessao_uazapi_caiu', 'integracao_com_erro', 'espelho_divergente'));--> statement-breakpoint
ALTER TABLE "auditoria_eventos" ADD CONSTRAINT "auditoria_eventos_acao_lista" CHECK ("auditoria_eventos"."acao" in ('loja_criada', 'loja_alterada', 'loja_desativada', 'usuario_criado', 'usuario_alterado', 'usuario_desativado', 'usuario_reativado', 'usuario_papel_alterado', 'integracao_conectada', 'integracao_alterada', 'integracao_desconectada', 'integracao_pareada', 'conversa_resolvida', 'conversa_reaberta', 'conversa_transferida', 'conversa_prioridade_alterada', 'conversa_criada', 'conversa_arquivada', 'mensagem_enviada', 'mensagem_reenviada', 'mensagem_nota_interna', 'mensagem_recebida', 'midia_enviada', 'midia_excluida', 'midia_recebida', 'midia_alterada', 'contato_criado', 'contato_alterado', 'contato_excluido', 'contato_etiqueta_alterada', 'negocio_criado', 'negocio_estagio_alterado', 'negocio_valor_alterado', 'negocio_excluido', 'pedido_criado', 'pedido_status_alterado', 'pedido_cancelado', 'pedido_lancado_masc', 'pedido_dispensado_masc', 'pedido_voltou_fila_masc', 'pedido_rastreio_informado', 'pagamento_gerado', 'pagamento_confirmado', 'pagamento_estornado', 'devolucao_criada', 'devolucao_status_alterado', 'devolucao_estorno_aprovado', 'devolucao_concluida', 'campanha_criada', 'campanha_iniciada', 'campanha_pausada', 'campanha_concluida', 'campanha_excluida', 'campanha_alterada', 'template_enviado', 'template_aprovado', 'template_rejeitado', 'template_criado', 'template_alterado', 'template_excluido', 'template_pausado', 'resposta_rapida_criada', 'resposta_rapida_alterada', 'resposta_rapida_excluida', 'agendamento_criado', 'agendamento_reagendado', 'agendamento_cancelado', 'produto_sincronizado', 'produto_preco_alterado', 'lgpd_exportado', 'lgpd_anonimizado', 'lgpd_solicitacao_registrada', 'consentimento_registrado', 'alerta_reconhecido', 'convite_expirado'));--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_ator_sistema_inerte" CHECK ("usuarios"."id" <> '00000000-0000-4000-8000-000000000001'
        or ("usuarios"."ativo" = false and "usuarios"."papel" = 'viewer' and "usuarios"."two_factor_enabled" = false));--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_papel_loja" CHECK (("usuarios"."papel" in ('dono', 'admin', 'gerente') and "usuarios"."loja_id" is null)
        or ("usuarios"."papel" in ('vendedor', 'viewer') and "usuarios"."loja_id" is not null)
        or ("usuarios"."id" = '00000000-0000-4000-8000-000000000001' and "usuarios"."loja_id" is null));--> statement-breakpoint
ALTER TABLE "lojas_integracoes_templates" ADD CONSTRAINT "lojas_integracoes_templates_nome" CHECK ("lojas_integracoes_templates"."nome" ~ '^[a-z0-9_]+$' and char_length("lojas_integracoes_templates"."nome") <= 512);--> statement-breakpoint
CREATE OR REPLACE FUNCTION semear_ator_sistema() RETURNS void AS $$
BEGIN
  -- viewer, inativo, sem credencial (nenhuma linha em usuarios_contas) e com
  -- e-mail em domínio reservado `.invalid` (RFC 2606): não recebe reset, não
  -- entra, não aparece como pessoa.
  INSERT INTO usuarios
    (id, nome, email, email_verificado, papel, loja_id, ativo,
     precisa_trocar_senha, precisa_configurar_fator, two_factor_enabled)
  VALUES
    ('00000000-0000-4000-8000-000000000001', 'Sistema', 'sistema@merlostore.invalid',
     false, 'viewer', NULL, false, false, false, false)
  ON CONFLICT (id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
SELECT semear_ator_sistema();
