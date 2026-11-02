CREATE TABLE "planned_offs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "planned_offs" ADD CONSTRAINT "planned_offs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_offs" ADD CONSTRAINT "planned_offs_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "planned_offs_employee_date" ON "planned_offs" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "planned_offs_user_date" ON "planned_offs" USING btree ("user_id","date");