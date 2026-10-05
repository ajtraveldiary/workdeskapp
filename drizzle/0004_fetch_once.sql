CREATE TABLE "gmail_messages" (
	"account_id" uuid NOT NULL,
	"gmail_message_id" text NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_messages_account_id_gmail_message_id_pk" PRIMARY KEY("account_id","gmail_message_id")
);
--> statement-breakpoint
ALTER TABLE "gmail_accounts" ADD COLUMN "pending_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "gmail_accounts" ADD COLUMN "initial_page_token" text;--> statement-breakpoint
ALTER TABLE "gmail_messages" ADD CONSTRAINT "gmail_messages_account_id_gmail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gmail_accounts"("id") ON DELETE cascade ON UPDATE no action;