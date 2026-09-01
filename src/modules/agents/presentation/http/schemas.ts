import { z } from 'zod';

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const jsonObject = z.record(z.string(), z.unknown());

export const createAgentBodySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(63).regex(slugPattern, 'slug must be lowercase kebab-case'),
  description: z.string().max(2000).optional(),
});
export type CreateAgentBody = z.infer<typeof createAgentBodySchema>;

export const updateAgentDraftBodySchema = z.object({
  instructions: z.string().max(50_000).optional(),
  modelPolicy: jsonObject.optional(),
  knowledgeBindings: z.array(jsonObject).optional(),
  toolBindings: z.array(jsonObject).optional(),
  memoryPolicy: jsonObject.optional(),
  guardrails: jsonObject.optional(),
});
export type UpdateAgentDraftBody = z.infer<typeof updateAgentDraftBodySchema>;

export const agentCollectionParamsSchema = z.object({
  organizationId: z.string().uuid(),
  workspaceId: z.string().uuid(),
});

export const agentItemParamsSchema = agentCollectionParamsSchema.extend({
  agentId: z.string().uuid(),
});

export const agentVersionItemParamsSchema = agentItemParamsSchema.extend({
  versionId: z.string().uuid(),
});

export const agentResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  status: z.enum(['draft', 'active', 'disabled', 'archived']),
  activeVersionId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const agentDraftResponseSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  instructions: z.string(),
  modelPolicy: jsonObject,
  knowledgeBindings: z.array(jsonObject),
  toolBindings: z.array(jsonObject),
  memoryPolicy: jsonObject,
  guardrails: jsonObject,
  updatedAt: z.string(),
});

export const agentWithDraftResponseSchema = z.object({
  agent: agentResponseSchema,
  draft: agentDraftResponseSchema,
});

export const agentVersionResponseSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  versionNumber: z.number().int(),
  instructions: z.string(),
  modelPolicy: jsonObject,
  knowledgeBindings: z.array(jsonObject),
  toolBindings: z.array(jsonObject),
  memoryPolicy: jsonObject,
  guardrails: jsonObject,
  checksum: z.string(),
  publishedByPrincipalId: z.string().uuid(),
  createdAt: z.string(),
});
