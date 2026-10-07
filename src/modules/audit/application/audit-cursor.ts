import { InvalidInputError } from '../../../common/errors.js';

/** Keyset position of the last event on a page: events are ordered by (createdAt, id) descending. */
export interface AuditCursorPosition {
  readonly createdAt: Date;
  readonly id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeAuditCursor(position: AuditCursorPosition): string {
  return Buffer.from(JSON.stringify({ c: position.createdAt.toISOString(), i: position.id })).toString('base64url');
}

/**
 * Cursors are opaque to clients but still untrusted input: anything that is
 * not a well-formed position is rejected before it can reach a query.
 */
export function decodeAuditCursor(cursor: string): AuditCursorPosition {
  const invalid = new InvalidInputError('Invalid cursor');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
  } catch {
    throw invalid;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalid;
  }
  const { c, i } = parsed as Record<string, unknown>;
  if (typeof c !== 'string' || typeof i !== 'string' || !UUID.test(i)) {
    throw invalid;
  }
  const createdAt = new Date(c);
  if (Number.isNaN(createdAt.getTime())) {
    throw invalid;
  }
  return { createdAt, id: i };
}
