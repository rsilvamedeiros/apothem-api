/**
 * Records a security/business-relevant fact, independent from diagnostic
 * logs — see apothem-ai/docs/02-architecture/architecture-overview.md
 * ("Application log vs Audit event") and
 * apothem-ai/docs/03-domain/executions-audit.md.
 */
export interface AuditEvent {
  readonly organizationId: string;
  readonly workspaceId?: string;
  readonly actorPrincipalId: string;
  /** e.g. "organization.created", "workspace.created", "membership.created" */
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AuditPort {
  record(event: AuditEvent): Promise<void>;
}
