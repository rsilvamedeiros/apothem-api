import type { AuthorizationService } from '../../authorization/application/authorization.service.js';
import type { TenantContext } from '../../authorization/application/tenant-context.js';
import { decodeAuditCursor, encodeAuditCursor } from './audit-cursor.js';
import type { AuditReaderPort, StoredAuditEvent } from './audit-reader.port.js';

export const DEFAULT_AUDIT_PAGE_SIZE = 50;
export const MAX_AUDIT_PAGE_SIZE = 200;

export interface AuditQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly workspaceId?: string;
  readonly action?: string;
  readonly actorPrincipalId?: string;
}

export interface AuditPage {
  readonly events: StoredAuditEvent[];
  /** Opaque; null when this is the last page. */
  readonly nextCursor: string | null;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_AUDIT_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.floor(limit), 1), MAX_AUDIT_PAGE_SIZE);
}

/**
 * Read-only view of the immutable audit log. The organization always comes
 * from the resolved tenant context; filters can narrow results but never
 * widen them past it.
 */
export class AuditQueryService {
  constructor(
    private readonly reader: AuditReaderPort,
    private readonly authorization: AuthorizationService,
  ) {}

  async list(context: TenantContext, query: AuditQuery): Promise<AuditPage> {
    this.authorization.assert(context, 'audit.read');

    const limit = clampLimit(query.limit);
    const after = query.cursor === undefined ? undefined : decodeAuditCursor(query.cursor);

    // One extra row tells us whether another page exists without a count query.
    const rows = await this.reader.list(
      context.organizationId,
      {
        ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.actorPrincipalId ? { actorPrincipalId: query.actorPrincipalId } : {}),
      },
      { limit: limit + 1, ...(after ? { after } : {}) },
    );

    const events = rows.slice(0, limit);
    const last = events[events.length - 1];
    const nextCursor = rows.length > limit && last ? encodeAuditCursor({ createdAt: last.createdAt, id: last.id }) : null;
    return { events, nextCursor };
  }
}
