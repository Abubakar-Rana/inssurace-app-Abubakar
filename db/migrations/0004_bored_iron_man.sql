ALTER TABLE "coi_requests" ADD COLUMN "viewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coi_requests" ADD COLUMN "viewed_by" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coi_requests" ADD CONSTRAINT "coi_requests_viewed_by_users_id_fk" FOREIGN KEY ("viewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
