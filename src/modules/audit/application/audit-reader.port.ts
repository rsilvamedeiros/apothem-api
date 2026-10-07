export interface StoredAuditEvent {
  readonly id: string;
  readonly organizationId: string;
  readonly workspaceId: string | null;
  readonly actorPrincipalId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: Date;
}

export interface AuditEventFilter {
  readonly workspaceId?: string;
  readonly action?: string;
  readonly actorPrincipalId?: string;
}

export interface AuditPageRequest {
  /** Already clamped by the service; implementations may rely on it. */
  readonly limit: number;
  readonly after?: { readonly createdAt: Date; readonly id: string };
}

/**
 * Read side of the audit log. Every query is scoped by organization; there is
 * deliberately no update or delete operation (audit records are immutable).
 * Implementations return events newest first, ordered by (createdAt, id).
 */
export interface AuditReaderPort {
  list(organizationId: string, filter: AuditEventFilter, page: AuditPageRequest): Promise<StoredAuditEvent[]>;
}
