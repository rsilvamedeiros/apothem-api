import { z } from 'zod';
import { MAX_AUDIT_PAGE_SIZE } from '../../application/audit-query.service.js';

export const auditParamsSchema = z.object({
  organizationId: z.string().uuid(),
});

export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_AUDIT_PAGE_SIZE).optional(),
  cursor: z.string().min(1).max(512).optional(),
  workspaceId: z.string().uuid().optional(),
  actorPrincipalId: z.string().uuid().optional(),
  action: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'action must look like "agent.created"')
    .optional(),
});

export const auditEventResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  workspaceId: z.string().uuid().nullable(),
  actorPrincipalId: z.string().uuid(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().uuid(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});

export const auditPageResponseSchema = z.object({
  events: z.array(auditEventResponseSchema),
  nextCursor: z.string().nullable(),
});
