CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid,
	"gmail_thread_id" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"from_name" text,
	"from_email" text,
	"snippet" text DEFAULT '' NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"message_count" integer DEFAULT 1 NOT NULL,
	"unread" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'needs_decision' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"has_new_activity" boolean DEFAULT false NOT NULL,
	"category_id" uuid,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gmail_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"refresh_token_enc" text,
	"history_id" text,
	"pending_thread_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"due_date" date,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"category_id" uuid,
	"thread_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_account_id_gmail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gmail_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_accounts" ADD CONSTRAINT "gmail_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_name" ON "categories" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "email_threads_user_thread" ON "email_threads" USING btree ("user_id","gmail_thread_id");--> statement-breakpoint
CREATE INDEX "email_threads_user_state" ON "email_threads" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "events_user_created" ON "events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_user_status_due" ON "tasks" USING btree ("user_id","status","due_date");