import { z } from 'zod';

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const createWorkspaceBodySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(63).regex(slugPattern, 'slug must be lowercase kebab-case'),
});
export type CreateWorkspaceBody = z.infer<typeof createWorkspaceBodySchema>;

export const workspaceParamsSchema = z.object({
  organizationId: z.string().uuid(),
});

export const workspaceItemParamsSchema = z.object({
  organizationId: z.string().uuid(),
  workspaceId: z.string().uuid(),
});

export const workspaceResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(['active', 'archived']),
  createdAt: z.string(),
  updatedAt: z.string(),
});
