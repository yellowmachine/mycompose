CREATE TABLE "app_env_vars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"git_url" text NOT NULL,
	"branch" text DEFAULT 'main' NOT NULL,
	"compose_path" text DEFAULT 'docker-compose.yml' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"live_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apps_slug_unique" UNIQUE("slug"),
	CONSTRAINT "apps_status_check" CHECK ("apps"."status" in ('draft','deploying','running','stopped','failed')),
	CONSTRAINT "apps_slug_check" CHECK ("apps"."slug" ~ '^[a-z]([a-z0-9-]{0,46}[a-z0-9])?$')
);
--> statement-breakpoint
CREATE TABLE "deploys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"git_url" text NOT NULL,
	"branch" text NOT NULL,
	"sha" text,
	"compose_path" text NOT NULL,
	"env_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"log_text" text DEFAULT '' NOT NULL,
	"log_truncated" boolean DEFAULT false NOT NULL,
	"error_summary" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "deploys_status_check" CHECK ("deploys"."status" in ('pending','deploying','succeeded','failed'))
);
--> statement-breakpoint
ALTER TABLE "app_env_vars" ADD CONSTRAINT "app_env_vars_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploys" ADD CONSTRAINT "deploys_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_env_vars_app_key_uidx" ON "app_env_vars" USING btree ("app_id","key");--> statement-breakpoint
CREATE INDEX "deploys_app_started_idx" ON "deploys" USING btree ("app_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "deploys_inflight_uidx" ON "deploys" USING btree ("app_id") WHERE "deploys"."status" in ('pending','deploying');