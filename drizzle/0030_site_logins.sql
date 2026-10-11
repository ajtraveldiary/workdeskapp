CREATE TABLE "site_logins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"website" text NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"employee_id" uuid,
	"assigned_to" text DEFAULT '' NOT NULL,
	"login_id" text DEFAULT '' NOT NULL,
	"password_enc" text,
	"remarks" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_logins" ADD CONSTRAINT "site_logins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_logins" ADD CONSTRAINT "site_logins_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;