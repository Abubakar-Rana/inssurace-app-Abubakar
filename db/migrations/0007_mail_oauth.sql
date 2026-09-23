ALTER TABLE "tenant_mail_settings" ALTER COLUMN "username" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_mail_settings" ALTER COLUMN "password_enc" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_mail_settings" ALTER COLUMN "imap_host" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_mail_settings" ALTER COLUMN "smtp_host" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_mail_settings" ADD COLUMN "provider" text DEFAULT 'imap' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_mail_settings" ADD COLUMN "oauth_refresh_token_enc" text;--> statement-breakpoint
ALTER TABLE "tenant_mail_settings" ADD COLUMN "oauth_scopes" text;--> statement-breakpoint
ALTER TABLE "tenant_mail_settings" ADD COLUMN "connected_by" uuid;