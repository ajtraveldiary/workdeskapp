CREATE TABLE "leave_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"on_date" date NOT NULL,
	"days" numeric(6, 1) NOT NULL,
	"kind" text NOT NULL,
	"credit_for" text,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"short" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"has_account" boolean DEFAULT true NOT NULL,
	"draws_on_id" uuid,
	"per_day" numeric(3, 1) DEFAULT 1 NOT NULL,
	"may_go_negative" boolean DEFAULT false NOT NULL,
	"max_balance" numeric(6, 1),
	"service_limit" numeric(6, 1),
	"medical" boolean DEFAULT false NOT NULL,
	"yearly_days" numeric(5, 1),
	"from_duty" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "designations" ADD COLUMN "gazetted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "gazetted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "probation_declared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_type_id_leave_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_draws_on_id_leave_types_id_fk" FOREIGN KEY ("draws_on_id") REFERENCES "public"."leave_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leave_ledger_credit" ON "leave_ledger" USING btree ("employee_id","type_id","credit_for");--> statement-breakpoint
CREATE INDEX "leave_ledger_employee" ON "leave_ledger" USING btree ("employee_id","type_id");--> statement-breakpoint
-- Probation declared (user request 2026-10-30): yes where a declared date is entered, and for permanent staff who
-- completed 2 years of service more than 2 years ago (the app already took their declared date as just not entered).
UPDATE "employees" SET "probation_declared" = true WHERE "probation_declared_on" IS NOT NULL OR ("permanent" AND "joined_service_on" IS NOT NULL AND "joined_service_on" <= (current_date - interval '4 years')::date);
