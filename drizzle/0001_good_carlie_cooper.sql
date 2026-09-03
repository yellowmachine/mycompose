CREATE TABLE "deploy_explanations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deploy_id" uuid NOT NULL,
	"cause_class" text NOT NULL,
	"summary" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" text NOT NULL,
	"model" text NOT NULL,
	"raw" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deploy_explanations_cause_check" CHECK ("deploy_explanations"."cause_class" in ('git','compose','build','image','port','runtime','config','unknown')),
	CONSTRAINT "deploy_explanations_confidence_check" CHECK ("deploy_explanations"."confidence" in ('low','medium','high'))
);
--> statement-breakpoint
ALTER TABLE "deploy_explanations" ADD CONSTRAINT "deploy_explanations_deploy_id_deploys_id_fk" FOREIGN KEY ("deploy_id") REFERENCES "public"."deploys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deploy_explanations_deploy_created_idx" ON "deploy_explanations" USING btree ("deploy_id","created_at" DESC NULLS LAST);