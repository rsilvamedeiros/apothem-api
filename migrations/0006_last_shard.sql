CREATE TYPE "public"."workspace_tool_rule" AS ENUM('blocked', 'approval_required');--> statement-breakpoint
CREATE TABLE "tool_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"rule" "workspace_tool_rule" NOT NULL,
	"updated_by_principal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tool_policies" ADD CONSTRAINT "tool_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_policies" ADD CONSTRAINT "tool_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tool_policies_workspace_tool_uq" ON "tool_policies" USING btree ("workspace_id","tool_name");