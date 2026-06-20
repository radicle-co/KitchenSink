CREATE TABLE "fetch_queue" (
	"fdc_id" text PRIMARY KEY NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL,
	"first_requested" timestamp with time zone DEFAULT now() NOT NULL,
	"last_requested" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"fetched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fetch_requesters" (
	"fdc_id" text NOT NULL,
	"sub" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fetch_requesters_fdc_id_sub_pk" PRIMARY KEY("fdc_id","sub")
);
--> statement-breakpoint
CREATE TABLE "foods" (
	"fdc_id" integer PRIMARY KEY NOT NULL,
	"description" text,
	"data_type" text,
	"fetch_status" text DEFAULT 'pending' NOT NULL,
	"upc_code" text,
	"brand_owner" text,
	"brand_name" text,
	"calories" numeric,
	"protein_g" numeric,
	"carbs_g" numeric,
	"fat_g" numeric,
	"fiber_g" numeric,
	"sodium_mg" numeric,
	"sugar_g" numeric,
	"saturated_fat_g" numeric,
	"cholesterol_mg" numeric,
	"vitamin_a_iu" numeric,
	"vitamin_c_mg" numeric,
	"calcium_mg" numeric,
	"iron_mg" numeric,
	"raw_json" jsonb,
	"search_vector" "tsvector",
	"request_count" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone,
	"last_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usda_call_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usda_sync_metadata" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_full_sync_at" timestamp with time zone,
	"last_incremental_at" timestamp with time zone,
	"foundation_version" text,
	"sr_legacy_version" text,
	"branded_version" text
);
--> statement-breakpoint
CREATE INDEX "idx_fetch_queue_priority" ON "fetch_queue" USING btree ("request_count" DESC,"first_requested" ASC) WHERE "fetch_queue"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_fetch_requesters_sub" ON "fetch_requesters" USING btree ("sub");--> statement-breakpoint
CREATE INDEX "idx_foods_fetch_status_fetched_at" ON "foods" USING btree ("fetch_status","fetched_at");--> statement-breakpoint
CREATE INDEX "idx_foods_last_requested" ON "foods" USING btree ("last_requested_at");--> statement-breakpoint
CREATE INDEX "idx_foods_search" ON "foods" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "idx_foods_data_type" ON "foods" USING btree ("data_type");--> statement-breakpoint
CREATE INDEX "idx_foods_upc" ON "foods" USING btree ("upc_code");--> statement-breakpoint
CREATE INDEX "idx_usda_call_log_called_at" ON "usda_call_log" USING btree ("called_at");