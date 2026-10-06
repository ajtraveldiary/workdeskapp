ALTER TABLE "reports" ADD COLUMN "label_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "label_ids" text[] DEFAULT '{}'::text[] NOT NULL;