ALTER TABLE "usuarios_totp" ADD COLUMN "verificado" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "usuarios_totp" ADD COLUMN "falhas_verificacao" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usuarios_totp" ADD COLUMN "bloqueado_ate" timestamp (3) with time zone;