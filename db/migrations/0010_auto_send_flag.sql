ALTER TABLE "coi_requests" ADD COLUMN "auto_send_error" text;--> statement-breakpoint
ALTER TABLE "coi_requests" ADD COLUMN "auto_send_at" timestamp with time zone;