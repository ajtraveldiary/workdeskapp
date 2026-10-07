CREATE TABLE "employee_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "engagement" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "type_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "contract_days" integer;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "pay_per_day" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "employee_types" ADD CONSTRAINT "employee_types_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_type_id_employee_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."employee_types"("id") ON DELETE no action ON UPDATE no action;