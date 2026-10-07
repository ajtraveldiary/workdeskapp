ALTER TABLE "email_threads" ADD COLUMN "section_label_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "organize_label_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- "Straight to completed" labels were replaced by sections (user request 2026-10-07).
UPDATE "users" SET "auto_done_label_ids" = '{}';
