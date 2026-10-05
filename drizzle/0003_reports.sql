CREATE TABLE "report_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"label" text NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"frequency" text NOT NULL,
	"due_day" integer NOT NULL,
	"due_month_offset" integer DEFAULT 1 NOT NULL,
	"year_start_month" integer DEFAULT 4 NOT NULL,
	"lead_days" integer DEFAULT 7 NOT NULL,
	"priority" text DEFAULT 'high' NOT NULL,
	"category_id" uuid,
	"responsible" text,
	"first_period_start" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "report_period_id" uuid;--> statement-breakpoint
ALTER TABLE "report_periods" ADD CONSTRAINT "report_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_periods" ADD CONSTRAINT "report_periods_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_periods_report_start" ON "report_periods" USING btree ("report_id","period_start");--> statement-breakpoint
CREATE INDEX "report_periods_user_due" ON "report_periods" USING btree ("user_id","due_date");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_report_period_id_report_periods_id_fk" FOREIGN KEY ("report_period_id") REFERENCES "public"."report_periods"("id") ON DELETE set null ON UPDATE no action;