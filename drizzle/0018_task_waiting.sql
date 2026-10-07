ALTER TABLE "tasks" ADD COLUMN "waiting_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "reply_by" date;