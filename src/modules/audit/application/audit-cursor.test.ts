import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeAuditCursor, encodeAuditCursor } from './audit-cursor.js';
import { InvalidInputError } from '../../../common/errors.js';

const POSITION = { createdAt: new Date('2026-03-04T05:06:07.890Z'), id: '3f1c1c3e-4a52-4d5e-8c53-0d3f5b1a2e10' };

describe('audit cursor', () => {
  it('round-trips a position', () => {
    expect(decodeAuditCursor(encodeAuditCursor(POSITION))).toEqual(POSITION);
  });

  it('round-trips any date and uuid (property)', () => {
    fc.assert(
      fc.property(fc.date({ noInvalidDate: true }), fc.uuid(), (createdAt, id) => {
        const decoded = decodeAuditCursor(encodeAuditCursor({ createdAt, id }));
        expect(decoded.createdAt.getTime()).toBe(createdAt.getTime());
        expect(decoded.id).toBe(id);
      }),
    );
  });

  it('is opaque and URL-safe', () => {
    const cursor = encodeAuditCursor(POSITION);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain(POSITION.id);
  });

  it.each([
    ['empty', ''],
    ['not base64url json', 'not a cursor!'],
    ['json without fields', Buffer.from('{}').toString('base64url')],
    ['bad date', Buffer.from(JSON.stringify({ c: 'nope', i: POSITION.id })).toString('base64url')],
    ['bad id', Buffer.from(JSON.stringify({ c: POSITION.createdAt.toISOString(), i: "1'; drop table audit_events;--" })).toString('base64url')],
    ['wrong types', Buffer.from(JSON.stringify({ c: 1, i: 2 })).toString('base64url')],
    ['array', Buffer.from('[]').toString('base64url')],
  ])('rejects a malformed cursor (%s) as invalid input', (_label, cursor) => {
    expect(() => decodeAuditCursor(cursor)).toThrow(InvalidInputError);
  });
});
