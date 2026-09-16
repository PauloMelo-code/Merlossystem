-- 0020 — integridade do R2 (custom, única). Não cria tabela e não semeia ator
-- (o ATOR_SISTEMA é da 0018; C3 do plano do R2).
--
-- R2-E: FK compostas dos lookbooks e FK de modified_by de lojas_sla (ADR 0058, 0060).
-- As tabelas de lookbook nasceram vazias no R1 (sem modulo): as constraints entram sem backfill.
ALTER TABLE lookbooks ADD CONSTRAINT uq_lookbooks_id_loja UNIQUE (id, loja_id);
--> statement-breakpoint
ALTER TABLE lookbooks ADD CONSTRAINT fkc_lookbooks_capa FOREIGN KEY (capa_midia_id, loja_id)
  REFERENCES lojas_midias (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE lookbooks_midias ADD CONSTRAINT fkc_lookbooks_midias_lookbook FOREIGN KEY (lookbook_id, loja_id)
  REFERENCES lookbooks (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE lookbooks_midias ADD CONSTRAINT fkc_lookbooks_midias_midia FOREIGN KEY (midia_id, loja_id)
  REFERENCES lojas_midias (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE lookbooks_produtos ADD CONSTRAINT fkc_lookbooks_produtos_lookbook FOREIGN KEY (lookbook_id, loja_id)
  REFERENCES lookbooks (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE lookbooks_produtos ADD CONSTRAINT fkc_lookbooks_produtos_produto FOREIGN KEY (produto_id, loja_id)
  REFERENCES produtos (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
-- O laco de 0016 so pegou as tabelas que existiam: tabela nova com modified_by ganha a FK aqui.
ALTER TABLE lojas_sla ADD CONSTRAINT fk_lojas_sla_modified_by FOREIGN KEY (modified_by)
  REFERENCES usuarios (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
-- Explicito (idempotente): nunca DELETE nem TRUNCATE para a aplicacao.
GRANT SELECT, INSERT, UPDATE ON lojas_sla TO merlo_app;
--> statement-breakpoint
-- lojas_ia_usos: registro de uso append-only (R2-C, ADR 0048). O ALTER DEFAULT
-- PRIVILEGES da 0016 deu SELECT, INSERT e UPDATE a tabela criada na 0019_r2;
-- o GRANT e explicito e o REVOKE vem depois.
GRANT SELECT, INSERT ON lojas_ia_usos TO merlo_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON lojas_ia_usos FROM merlo_app;
--> statement-breakpoint
CREATE TRIGGER trg_lojas_ia_usos_imutavel
  BEFORE UPDATE OR DELETE ON lojas_ia_usos
  FOR EACH ROW EXECUTE FUNCTION trilha_imutavel();
