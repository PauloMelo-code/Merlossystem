-- 0000_base — papéis de banco e a função que torna a trilha imutável.
-- 01-dados.md §7.3 e §9; 03-arquitetura.md §6.1.
--
-- Dois papéis, e só dois:
--   merlo_app       aplicação e worker (DATABASE_URL). NUNCA é dono das
--                   tabelas — é isso que faz o REVOKE da migração 0004 valer.
--   merlo_migracao  migração e backup (DATABASE_URL_MIGRACAO). É o dono.
-- O papel merlo_manutencao dos rascunhos não existe: ele só servia para o
-- DELETE de retenção, que foi eliminado (retenção é anonimização por UPDATE).
--
-- Os papéis nascem SEM senha: senha em migração é segredo versionado. Quem
-- provisiona o ambiente define a senha fora daqui (docs/seguranca/runbook.md).
-- Em dev e em teste o papel é assumido com `SET ROLE merlo_app`, que já faz as
-- permissões valerem — inclusive para um superusuário.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'merlo_app') THEN
    CREATE ROLE merlo_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'merlo_migracao') THEN
    CREATE ROLE merlo_migracao LOGIN;
  END IF;
END
$$;
--> statement-breakpoint
-- Trilha append-only de verdade: o REVOKE protege do papel da aplicação, o
-- gatilho protege de qualquer papel, inclusive do dono e de um superusuário
-- distraído. Instalado nas 4 tabelas de trilha pela migração 0004, e SOMENTE
-- nelas — `lojas_integracoes_eventos` é diário de ingestão e precisa de UPDATE.
CREATE OR REPLACE FUNCTION trilha_imutavel() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'trilha e append-only';
END;
$$ LANGUAGE plpgsql;
