CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
ALTER TYPE "public"."run_status" ADD VALUE 'waiting_approval' BEFORE 'completed';--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_sequence" integer NOT NULL,
	"tool_name" text NOT NULL,
	"arguments" jsonb NOT NULL,
	"requested_by_principal_id" uuid NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by_principal_id" uuid,
	"decision_reason" text,
	"self_approved" boolean DEFAULT false NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_by_principal_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "detail" jsonb;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_notes" ADD CONSTRAINT "workspace_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_notes" ADD CONSTRAINT "workspace_notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_workspace_status_idx" ON "approvals" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_run_step_uq" ON "approvals" USING btree ("run_id","step_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_one_pending_per_run_uq" ON "approvals" USING btree ("run_id") WHERE "approvals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "workspace_notes_workspace_created_idx" ON "workspace_notes" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_notes_idempotency_uq" ON "workspace_notes" USING btree ("workspace_id","idempotency_key");