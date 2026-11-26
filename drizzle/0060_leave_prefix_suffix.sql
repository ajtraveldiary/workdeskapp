ALTER TABLE "employee_leaves" ADD COLUMN "prefix_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_leaves" ADD COLUMN "suffix_days" integer DEFAULT 0 NOT NULL;