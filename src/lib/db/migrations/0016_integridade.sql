-- 0016_integridade — o que o ORM nao expressa (01-dados.md §4.6 e §9).
--
-- Tres blocos:
--   1. UNIQUE (id, loja_id) nos pais  -> custo zero, ja existe PK sobre id;
--   2. FK COMPOSTA (id, loja_id) nos filhos -> e o que torna IMPOSSIVEL um
--      filho apontar para pai de outra loja. O `loja_id` redundante so fecha o
--      vazamento com esta constraint; sem ela, ele podia divergir do pai;
--   3. FK de `modified_by` nas 40 tabelas -> nao pode sair de
--      `_compartilhado.ts` porque `.references()` criaria ciclo de import com
--      `usuarios.ts`. A constraint nao precisa existir no schema TS para valer
--      no banco, e o drizzle-kit nao a remove (o diff sai do snapshot dele).
-- Fecha com os GRANTs do papel da aplicacao.

ALTER TABLE contatos ADD CONSTRAINT uq_contatos_id_loja UNIQUE (id, loja_id);
--> statement-breakpoint
-- `lojas_integracoes.loja_id` e nulo para a conta de rede (Bling): a FK
-- composta e MATCH SIMPLE e nao dispara com coluna nula, e o CHECK
-- `lojas_integracoes_rede` garante que canal nunca tem loja nula.
ALTER TABLE lojas_integracoes ADD CONSTRAINT uq_lojas_integracoes_id_loja UNIQUE (id, loja_id);
--> statement-breakpoint
ALTER TABLE conversas ADD CONSTRAINT uq_conversas_id_loja UNIQUE (id, loja_id);
--> statement-breakpoint
ALTER TABLE conversas_mensagens ADD CONSTRAINT uq_conversas_mensagens_id_loja UNIQUE (id, loja_id);
--> statement-breakpoint
ALTER TABLE pedidos ADD CONSTRAINT uq_pedidos_id_loja UNIQUE (id, loja_id);
--> statement-breakpoint
ALTER TABLE pedidos_devolucoes ADD CONSTRAINT uq_pedidos_devolucoes_id_loja UNIQUE (id, loja_id);
--> statement-breakpoint
ALTER TABLE campanhas ADD CONSTRAINT uq_campanhas_id_loja UNIQUE (id, loja_id);
--> statement-breakpoint
ALTER TABLE produtos ADD CONSTRAINT uq_produtos_id_loja UNIQUE (id, loja_id);
--> statement-breakpoint
ALTER TABLE lojas_midias ADD CONSTRAINT uq_lojas_midias_id_loja UNIQUE (id, loja_id);
--> statement-breakpoint
ALTER TABLE conversas ADD CONSTRAINT fkc_conversas_contato FOREIGN KEY (contato_id, loja_id)
  REFERENCES contatos (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE conversas ADD CONSTRAINT fkc_conversas_integracao FOREIGN KEY (integracao_id, loja_id)
  REFERENCES lojas_integracoes (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE conversas_mensagens ADD CONSTRAINT fkc_conversas_mensagens_conversa FOREIGN KEY (conversa_id, loja_id)
  REFERENCES conversas (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE conversas_mensagens_midias ADD CONSTRAINT fkc_conversas_mensagens_midias_mensagem FOREIGN KEY (mensagem_id, loja_id)
  REFERENCES conversas_mensagens (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE conversas_agendamentos ADD CONSTRAINT fkc_conversas_agendamentos_contato FOREIGN KEY (contato_id, loja_id)
  REFERENCES contatos (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE pedidos ADD CONSTRAINT fkc_pedidos_contato FOREIGN KEY (contato_id, loja_id)
  REFERENCES contatos (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE pedidos_itens ADD CONSTRAINT fkc_pedidos_itens_pedido FOREIGN KEY (pedido_id, loja_id)
  REFERENCES pedidos (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE pagamentos ADD CONSTRAINT fkc_pagamentos_pedido FOREIGN KEY (pedido_id, loja_id)
  REFERENCES pedidos (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE pedidos_devolucoes ADD CONSTRAINT fkc_pedidos_devolucoes_pedido FOREIGN KEY (pedido_id, loja_id)
  REFERENCES pedidos (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE pedidos_devolucoes_itens ADD CONSTRAINT fkc_pedidos_devolucoes_itens_devolucao FOREIGN KEY (devolucao_id, loja_id)
  REFERENCES pedidos_devolucoes (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE campanhas_destinatarios ADD CONSTRAINT fkc_campanhas_destinatarios_campanha FOREIGN KEY (campanha_id, loja_id)
  REFERENCES campanhas (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE campanhas_destinatarios ADD CONSTRAINT fkc_campanhas_destinatarios_contato FOREIGN KEY (contato_id, loja_id)
  REFERENCES contatos (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE produtos_midias ADD CONSTRAINT fkc_produtos_midias_produto FOREIGN KEY (produto_id, loja_id)
  REFERENCES produtos (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE produtos_midias ADD CONSTRAINT fkc_produtos_midias_midia FOREIGN KEY (midia_id, loja_id)
  REFERENCES lojas_midias (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE produtos_variacoes ADD CONSTRAINT fkc_produtos_variacoes_produto FOREIGN KEY (produto_id, loja_id)
  REFERENCES produtos (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE negocios ADD CONSTRAINT fkc_negocios_contato FOREIGN KEY (contato_id, loja_id)
  REFERENCES contatos (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
-- FK de `modified_by` nas 40 tabelas que tem a coluna. O laco existe para a
-- lista nao poder divergir do schema: quem tem `modified_by` ganha a FK, sem
-- excecao e sem redigitar 40 nomes. As 8 tabelas de fora (4 trilhas
-- append-only, 4 de framework) nao tem a coluna, entao nem entram no laco.
-- `scripts/verificar-schema.mjs` confere que o resultado sao exatamente 40.
DO $$
DECLARE
  alvo text;
BEGIN
  FOR alvo IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'modified_by'
    ORDER BY table_name
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (modified_by)
         REFERENCES usuarios (id) ON DELETE RESTRICT ON UPDATE RESTRICT',
      alvo, 'fk_' || alvo || '_modified_by'
    );
  END LOOP;
END
$$;
--> statement-breakpoint
-- GRANTs finais. `merlo_app` NUNCA recebe DELETE nem TRUNCATE em tabela
-- nenhuma: a unica exclusao fisica do sistema e de objeto no MinIO.
GRANT USAGE ON SCHEMA public TO merlo_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO merlo_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO merlo_app;
--> statement-breakpoint
-- Reaplicado DEPOIS do GRANT acima: o `ON ALL TABLES` devolveria o UPDATE que
-- 0004 e 0015 tiraram das quatro trilhas. Ordem importa.
REVOKE UPDATE, DELETE, TRUNCATE ON auth_eventos, auditoria_eventos,
  consentimentos, usuarios_senhas_historico FROM merlo_app;
