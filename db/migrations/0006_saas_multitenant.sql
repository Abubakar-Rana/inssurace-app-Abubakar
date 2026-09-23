CREATE TABLE IF NOT EXISTS "platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_mail_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"email_address" text NOT NULL,
	"username" text NOT NULL,
	"password_enc" text NOT NULL,
	"imap_host" text NOT NULL,
	"imap_port" integer DEFAULT 993 NOT NULL,
	"smtp_host" text NOT NULL,
	"smtp_port" integer DEFAULT 465 NOT NULL,
	"mailbox" text DEFAULT 'INBOX' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_nowcerts_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_enc" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sync_interval_minutes" integer DEFAULT 30 NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"last_sync_error" text,
	"last_sync_stats" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "source" text DEFAULT 'certflow' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "source" text DEFAULT 'certflow' NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "allow_user_management" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "auto_send" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "data_source" text DEFAULT 'certflow' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_logins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "source" text DEFAULT 'certflow' NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "external_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_mail_settings" ADD CONSTRAINT "tenant_mail_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_nowcerts_settings" ADD CONSTRAINT "tenant_nowcerts_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_ext_idx" ON "clients" USING btree ("tenant_id","source","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policies_ext_idx" ON "policies" USING btree ("tenant_id","source","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicles_ext_idx" ON "vehicles" USING btree ("tenant_id","source","external_id");