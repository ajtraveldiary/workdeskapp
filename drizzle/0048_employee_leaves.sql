CREATE TABLE "employee_leaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"days" numeric(6, 1) NOT NULL,
	"order_no" text DEFAULT '' NOT NULL,
	"order_date" date,
	"notes" text DEFAULT '' NOT NULL,
	"rejoined_on" date,
	"status" text DEFAULT 'active' NOT NULL,
	"extension_of_id" uuid,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD COLUMN "leave_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_leaves" ADD CONSTRAINT "employee_leaves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_leaves" ADD CONSTRAINT "employee_leaves_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_leaves" ADD CONSTRAINT "employee_leaves_type_id_leave_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_leaves" ADD CONSTRAINT "employee_leaves_extension_of_id_employee_leaves_id_fk" FOREIGN KEY ("extension_of_id") REFERENCES "public"."employee_leaves"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_leaves" ADD CONSTRAINT "employee_leaves_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_leaves_employee" ON "employee_leaves" USING btree ("employee_id","from_date");--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_leave_id_employee_leaves_id_fk" FOREIGN KEY ("leave_id") REFERENCES "public"."employee_leaves"("id") ON DELETE set null ON UPDATE no action;