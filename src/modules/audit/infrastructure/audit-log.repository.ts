import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import type { Database } from '../../../infrastructure/database/client.js';
import type { AuditEvent, AuditPort } from '../application/audit.port.js';
import type {
  AuditEventFilter,
  AuditPageRequest,
  AuditReaderPort,
  StoredAuditEvent,
} from '../application/audit-reader.port.js';
import { auditEvents } from './schema.js';

/**
 * Append-only: `record` inserts, `list` reads. No update or delete exists on
 * purpose — audit records must survive resource archival.
 */
export class AuditLogRepository implements AuditPort, AuditReaderPort {
  constructor(private readonly db: Database) {}

  async record(event: AuditEvent): Promise<void> {
    await this.db.insert(auditEvents).values({
      organizationId: event.organizationId,
      workspaceId: event.workspaceId,
      actorPrincipalId: event.actorPrincipalId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      metadata: event.metadata,
    });
  }

  async list(organizationId: string, filter: AuditEventFilter, page: AuditPageRequest): Promise<StoredAuditEvent[]> {
    // The organization predicate is unconditional; every other condition only narrows it.
    const conditions: SQL[] = [eq(auditEvents.organizationId, organizationId)];
    if (filter.workspaceId) conditions.push(eq(auditEvents.workspaceId, filter.workspaceId));
    if (filter.action) conditions.push(eq(auditEvents.action, filter.action));
    if (filter.actorPrincipalId) conditions.push(eq(auditEvents.actorPrincipalId, filter.actorPrincipalId));
    if (page.after) {
      const keyset = or(
        lt(auditEvents.createdAt, page.after.createdAt),
        and(eq(auditEvents.createdAt, page.after.createdAt), lt(auditEvents.id, page.after.id)),
      );
      if (keyset) conditions.push(keyset);
    }

    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(and(...conditions))
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(page.limit);

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      workspaceId: row.workspaceId,
      actorPrincipalId: row.actorPrincipalId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt,
    }));
  }
}
