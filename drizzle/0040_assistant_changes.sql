ALTER TABLE "assistant_log" ADD COLUMN "change" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_log" ADD COLUMN "touched" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "assistant_changes" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "assistant_per_hour" integer DEFAULT 30 NOT NULL;