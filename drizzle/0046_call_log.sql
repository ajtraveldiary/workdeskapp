CREATE TABLE "call_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"source" text NOT NULL,
	"request" text NOT NULL,
	"status" integer,
	"started_at" timestamp with time zone NOT NULL,
	"ms" integer DEFAULT 0 NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"limit" integer,
	"failed" integer DEFAULT 0 NOT NULL,
	"ran_out" boolean DEFAULT false NOT NULL,
	"self_check" boolean DEFAULT false NOT NULL,
	"job_id" uuid,
	"entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "jobs_active";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "call_log_id" uuid;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_logs_started" ON "call_logs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "call_logs_user_started" ON "call_logs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active" ON "jobs" USING btree ("user_id","kind") WHERE "jobs"."status" in ('queued', 'running') and "jobs"."kind" in ('notify', 'sync', 'labels', 'upkeep');