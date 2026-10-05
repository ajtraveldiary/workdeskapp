CREATE TABLE "gmail_labels" (
	"user_id" uuid NOT NULL,
	"gmail_label_id" text NOT NULL,
	"name" text NOT NULL,
	"background_color" text,
	"text_color" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_labels_user_id_gmail_label_id_pk" PRIMARY KEY("user_id","gmail_label_id")
);
--> statement-breakpoint
ALTER TABLE "email_threads" ADD COLUMN "label_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "gmail_accounts" ADD COLUMN "labels_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gmail_accounts" ADD COLUMN "labels_backfilled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gmail_labels" ADD CONSTRAINT "gmail_labels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;