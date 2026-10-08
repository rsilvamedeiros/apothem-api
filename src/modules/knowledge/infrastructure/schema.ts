import { customType, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from '../../organizations/infrastructure/schema.js';
import { workspaces } from '../../workspaces/infrastructure/schema.js';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const knowledgeBaseStatusEnum = pgEnum('knowledge_base_status', ['active', 'archived']);
export const knowledgeDocumentStatusEnum = pgEnum('knowledge_document_status', ['ready']);

/** A permissioned collection of documents that belongs to exactly one workspace (ADR-014). */
export const knowledgeBases = pgTable(
  'knowledge_bases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    status: knowledgeBaseStatusEnum('status').notNull().default('active'),
    createdByPrincipalId: uuid('created_by_principal_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    index('knowledge_bases_workspace_idx').on(table.workspaceId, table.createdAt),
    // Two live bases in a workspace cannot share a name; an archived one frees it.
    uniqueIndex('knowledge_bases_workspace_name_uq').on(table.workspaceId, table.name).where(sql`${table.status} = 'active'`),
  ],
);

/**
 * The authoritative, normalized text of one source item. Chunks are derived
 * from `content` and can be rebuilt; `chunkerVersion` records how.
 */
export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    /** SHA-256 of the normalized content: adding the same content twice to a base is a no-op. */
    checksum: text('checksum').notNull(),
    contentLength: integer('content_length').notNull(),
    chunkCount: integer('chunk_count').notNull(),
    chunkerVersion: text('chunker_version').notNull(),
    status: knowledgeDocumentStatusEnum('status').notNull().default('ready'),
    createdByPrincipalId: uuid('created_by_principal_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('knowledge_documents_base_idx').on(table.knowledgeBaseId, table.createdAt),
    uniqueIndex('knowledge_documents_base_checksum_uq').on(table.knowledgeBaseId, table.checksum),
  ],
);

/**
 * A retrieval unit. Tenant columns are repeated on purpose so the retrieval
 * query can be constrained by workspace and base without trusting a join.
 */
export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    section: text('section'),
    searchVector: tsvector('search_vector').generatedAlwaysAs(sql`to_tsvector('simple', "text")`),
  },
  (table) => [
    uniqueIndex('knowledge_chunks_document_ordinal_uq').on(table.documentId, table.ordinal),
    index('knowledge_chunks_base_idx').on(table.workspaceId, table.knowledgeBaseId),
    index('knowledge_chunks_search_idx').using('gin', table.searchVector),
  ],
);

export type KnowledgeBase = typeof knowledgeBases.$inferSelect;
export type NewKnowledgeBase = typeof knowledgeBases.$inferInsert;
export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;
export type NewKnowledgeDocument = typeof knowledgeDocuments.$inferInsert;
export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type NewKnowledgeChunk = typeof knowledgeChunks.$inferInsert;
