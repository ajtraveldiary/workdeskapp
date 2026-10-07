CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"device" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sent_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "push_notified_for" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vapid_public_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vapid_private_key_enc" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "push_summary_on" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "push_summary_time" text DEFAULT '09:30' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "push_summary_sent_on" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "push_due_on" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;