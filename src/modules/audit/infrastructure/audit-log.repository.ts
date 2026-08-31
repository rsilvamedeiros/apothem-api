import type { Database } from '../../../infrastructure/database/client.js';
import type { AuditEvent, AuditPort } from '../application/audit.port.js';
import { auditEvents } from './schema.js';

export class AuditLogRepository implements AuditPort {
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
}
