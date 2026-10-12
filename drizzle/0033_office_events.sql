CREATE TABLE "office_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'meeting' NOT NULL,
	"start_date" date NOT NULL,
	"due_day" integer NOT NULL,
	"start_time" text,
	"end_time" text,
	"repeat" text DEFAULT 'never' NOT NULL,
	"end_date" date,
	"venue" text DEFAULT '' NOT NULL,
	"meeting_url" text DEFAULT '' NOT NULL,
	"organiser" text DEFAULT '' NOT NULL,
	"attendee_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tag_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"thread_id" uuid,
	"prep_days" integer,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notified_for" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "event_date" date;--> statement-breakpoint
ALTER TABLE "office_events" ADD CONSTRAINT "office_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_events" ADD CONSTRAINT "office_events_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_event_id_office_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."office_events"("id") ON DELETE set null ON UPDATE no action;