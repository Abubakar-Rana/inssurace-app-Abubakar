CREATE TABLE IF NOT EXISTS "llm_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reader" text NOT NULL,
	"mode" text NOT NULL,
	"request_id" uuid,
	"message_id" text,
	"pattern" text NOT NULL,
	"model" text NOT NULL,
	"outcome" text NOT NULL,
	"note" text,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_readings" ADD CONSTRAINT "llm_readings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_readings" ADD CONSTRAINT "llm_readings_request_id_coi_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."coi_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_readings_tenant_idx" ON "llm_readings" USING btree ("tenant_id","created_at");