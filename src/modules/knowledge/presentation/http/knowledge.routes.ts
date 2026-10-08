import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../../../../infrastructure/http/app-services.js';
import { resolveTenantContext } from '../../../../infrastructure/http/tenant-context.middleware.js';
import { toJsonSchema, errorResponseJsonSchema } from '../../../../infrastructure/http/openapi.js';
import {
  MAX_BASE_DESCRIPTION_LENGTH,
  MAX_BASE_NAME_LENGTH,
  MAX_DOCUMENT_TITLE_LENGTH,
  MAX_RAW_CONTENT_LENGTH,
  MAX_SEARCH_QUERY_LENGTH,
} from '../../application/knowledge.service.js';
import type { KnowledgeDocumentSummary, KnowledgeEvidence } from '../../application/knowledge.port.js';
import type { KnowledgeBase } from '../../infrastructure/schema.js';

const workspaceParams = z.object({ organizationId: z.string().uuid(), workspaceId: z.string().uuid() });
const baseParams = workspaceParams.extend({ knowledgeBaseId: z.string().uuid() });
const documentParams = baseParams.extend({ documentId: z.string().uuid() });

const createBaseBody = z.object({
  name: z.string().min(1).max(MAX_BASE_NAME_LENGTH),
  description: z.string().max(MAX_BASE_DESCRIPTION_LENGTH).optional(),
});

const addDocumentBody = z.object({
  title: z.string().min(1).max(MAX_DOCUMENT_TITLE_LENGTH),
  content: z.string().min(1).max(MAX_RAW_CONTENT_LENGTH),
});

const searchBody = z.object({ query: z.string().min(1).max(MAX_SEARCH_QUERY_LENGTH) });

const nullableString = z.string().nullable();

const knowledgeBaseResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: nullableString,
  status: z.enum(['active', 'archived']),
  createdAt: z.string(),
  archivedAt: nullableString,
});

const documentResponse = z.object({
  id: z.string().uuid(),
  knowledgeBaseId: z.string().uuid(),
  title: z.string(),
  checksum: z.string(),
  contentLength: z.number().int(),
  chunkCount: z.number().int(),
  createdAt: z.string(),
});

const evidenceResponse = z.object({
  evidenceId: z.string().uuid(),
  knowledgeBaseId: z.string().uuid(),
  documentId: z.string().uuid(),
  title: z.string(),
  section: nullableString,
  ordinal: z.number().int(),
  text: z.string(),
  score: z.number(),
});

const addDocumentResponse = z.object({ document: documentResponse, replayed: z.boolean() });

const errorResponses = {
  400: errorResponseJsonSchema,
  401: errorResponseJsonSchema,
  403: errorResponseJsonSchema,
  404: errorResponseJsonSchema,
  409: errorResponseJsonSchema,
} as const;

function serializeBase(base: KnowledgeBase) {
  return {
    id: base.id,
    name: base.name,
    description: base.description,
    status: base.status,
    createdAt: base.createdAt.toISOString(),
    archivedAt: base.archivedAt ? base.archivedAt.toISOString() : null,
  };
}

function serializeDocument(document: KnowledgeDocumentSummary) {
  return {
    id: document.id,
    knowledgeBaseId: document.knowledgeBaseId,
    title: document.title,
    checksum: document.checksum,
    contentLength: document.contentLength,
    chunkCount: document.chunkCount,
    createdAt: document.createdAt.toISOString(),
  };
}

function serializeEvidence(evidence: KnowledgeEvidence) {
  return {
    evidenceId: evidence.chunkId,
    knowledgeBaseId: evidence.knowledgeBaseId,
    documentId: evidence.documentId,
    title: evidence.documentTitle,
    section: evidence.section,
    ordinal: evidence.ordinal,
    text: evidence.text,
    score: evidence.score,
  };
}

export async function knowledgeRoutes(app: FastifyInstance, opts: { services: AppServices }): Promise<void> {
  const { services } = opts;
  const base = '/v1/organizations/:organizationId/workspaces/:workspaceId/knowledge-bases';

  async function context(request: Parameters<typeof resolveTenantContext>[0], organizationId: string, workspaceId: string) {
    return resolveTenantContext(request, services.authenticator, services.tenantContextResolver, organizationId, workspaceId);
  }

  app.post(
    base,
    {
      schema: {
        tags: ['knowledge'],
        params: toJsonSchema(workspaceParams),
        body: toJsonSchema(createBaseBody),
        response: { 201: toJsonSchema(knowledgeBaseResponse), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId } = workspaceParams.parse(request.params);
      const input = createBaseBody.parse(request.body);
      const created = await services.knowledgeService.createBase(await context(request, organizationId, workspaceId), input);
      reply.status(201).send(serializeBase(created));
    },
  );

  app.get(
    base,
    {
      schema: {
        tags: ['knowledge'],
        params: toJsonSchema(workspaceParams),
        response: { 200: toJsonSchema(z.object({ knowledgeBases: z.array(knowledgeBaseResponse) })), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId } = workspaceParams.parse(request.params);
      const bases = await services.knowledgeService.listBases(await context(request, organizationId, workspaceId));
      reply.status(200).send({ knowledgeBases: bases.map(serializeBase) });
    },
  );

  app.get(
    `${base}/:knowledgeBaseId`,
    {
      schema: {
        tags: ['knowledge'],
        params: toJsonSchema(baseParams),
        response: { 200: toJsonSchema(knowledgeBaseResponse), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId, knowledgeBaseId } = baseParams.parse(request.params);
      const found = await services.knowledgeService.getBase(await context(request, organizationId, workspaceId), knowledgeBaseId);
      reply.status(200).send(serializeBase(found));
    },
  );

  app.post(
    `${base}/:knowledgeBaseId/archive`,
    {
      schema: {
        tags: ['knowledge'],
        params: toJsonSchema(baseParams),
        response: { 200: toJsonSchema(knowledgeBaseResponse), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId, knowledgeBaseId } = baseParams.parse(request.params);
      const archived = await services.knowledgeService.archiveBase(await context(request, organizationId, workspaceId), knowledgeBaseId);
      reply.status(200).send(serializeBase(archived));
    },
  );

  app.post(
    `${base}/:knowledgeBaseId/documents`,
    {
      schema: {
        tags: ['knowledge'],
        params: toJsonSchema(baseParams),
        body: toJsonSchema(addDocumentBody),
        response: { 200: toJsonSchema(addDocumentResponse), 201: toJsonSchema(addDocumentResponse), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId, knowledgeBaseId } = baseParams.parse(request.params);
      const input = addDocumentBody.parse(request.body);
      const result = await services.knowledgeService.addDocument(await context(request, organizationId, workspaceId), knowledgeBaseId, input);
      // Identical content already in the base is not an error: the existing document comes back.
      reply.status(result.replayed ? 200 : 201).send({ document: serializeDocument(result.document), replayed: result.replayed });
    },
  );

  app.get(
    `${base}/:knowledgeBaseId/documents`,
    {
      schema: {
        tags: ['knowledge'],
        params: toJsonSchema(baseParams),
        response: { 200: toJsonSchema(z.object({ documents: z.array(documentResponse) })), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId, knowledgeBaseId } = baseParams.parse(request.params);
      const documents = await services.knowledgeService.listDocuments(await context(request, organizationId, workspaceId), knowledgeBaseId);
      reply.status(200).send({ documents: documents.map(serializeDocument) });
    },
  );

  app.delete(
    `${base}/:knowledgeBaseId/documents/:documentId`,
    {
      schema: {
        tags: ['knowledge'],
        params: toJsonSchema(documentParams),
        response: { 204: { type: 'null' }, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId, knowledgeBaseId, documentId } = documentParams.parse(request.params);
      await services.knowledgeService.removeDocument(await context(request, organizationId, workspaceId), knowledgeBaseId, documentId);
      reply.status(204).send();
    },
  );

  app.post(
    `${base}/:knowledgeBaseId/search`,
    {
      schema: {
        tags: ['knowledge'],
        params: toJsonSchema(baseParams),
        body: toJsonSchema(searchBody),
        response: { 200: toJsonSchema(z.object({ results: z.array(evidenceResponse) })), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId, knowledgeBaseId } = baseParams.parse(request.params);
      const { query } = searchBody.parse(request.body);
      const results = await services.knowledgeService.search(await context(request, organizationId, workspaceId), knowledgeBaseId, query);
      reply.status(200).send({ results: results.map(serializeEvidence) });
    },
  );
}
