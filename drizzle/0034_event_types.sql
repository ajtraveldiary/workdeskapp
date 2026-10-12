CREATE TABLE "event_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "office_events" ADD COLUMN "type_id" uuid;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_events" ADD CONSTRAINT "office_events_type_id_event_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."event_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Every account starts with Meeting, Training and Programme; existing events keep their kind as that type ("other" = no type).
INSERT INTO "event_types" ("user_id", "name", "sort_order") SELECT "u"."id", "d"."name", "d"."ord" FROM "users" "u" CROSS JOIN (VALUES ('Meeting', 1), ('Training', 2), ('Programme', 3)) AS "d"("name", "ord");--> statement-breakpoint
UPDATE "office_events" SET "type_id" = "t"."id" FROM "event_types" "t" WHERE "t"."user_id" = "office_events"."user_id" AND lower("t"."name") = "office_events"."kind";
