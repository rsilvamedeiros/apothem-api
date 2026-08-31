import { z } from 'zod';

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const createOrganizationBodySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(63).regex(slugPattern, 'slug must be lowercase kebab-case'),
});
export type CreateOrganizationBody = z.infer<typeof createOrganizationBodySchema>;

export const organizationParamsSchema = z.object({
  organizationId: z.string().uuid(),
});

export const organizationResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(['active', 'suspended', 'pending_deletion']),
  createdAt: z.string(),
  updatedAt: z.string(),
});
