ALTER TYPE "public"."request_status" ADD VALUE 'awaitingRequester' BEFORE 'ready';--> statement-breakpoint
ALTER TABLE "coi_requests" ADD COLUMN "clarification_sent_at" timestamp with time zone;