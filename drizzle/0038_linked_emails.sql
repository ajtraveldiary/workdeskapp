CREATE TABLE "linked_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"task_id" uuid,
	"event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "linked_emails" ADD CONSTRAINT "linked_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_emails" ADD CONSTRAINT "linked_emails_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_emails" ADD CONSTRAINT "linked_emails_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_emails" ADD CONSTRAINT "linked_emails_event_id_office_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."office_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "linked_emails_task" ON "linked_emails" USING btree ("task_id","thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "linked_emails_event" ON "linked_emails" USING btree ("event_id","thread_id");--> statement-breakpoint
CREATE INDEX "linked_emails_thread" ON "linked_emails" USING btree ("thread_id");