import { and, asc, count, eq } from 'drizzle-orm';
import type { Database } from '../../../infrastructure/database/client.js';
import type { KnowledgeBasePort } from '../application/knowledge.port.js';
import { knowledgeBases, type KnowledgeBase, type NewKnowledgeBase } from './schema.js';

export class KnowledgeBaseRepository implements KnowledgeBasePort {
  constructor(private readonly db: Database) {}

  async create(input: NewKnowledgeBase): Promise<KnowledgeBase> {
    const [row] = await this.db.insert(knowledgeBases).values(input).returning();
    if (!row) {
      throw new Error('Failed to create knowledge base');
    }
    return row;
  }

  async findById(workspaceId: string, knowledgeBaseId: string): Promise<KnowledgeBase | undefined> {
    const [row] = await this.db
      .select()
      .from(knowledgeBases)
      .where(and(eq(knowledgeBases.workspaceId, workspaceId), eq(knowledgeBases.id, knowledgeBaseId)))
      .limit(1);
    return row;
  }

  async findActiveByName(workspaceId: string, name: string): Promise<KnowledgeBase | undefined> {
    const [row] = await this.db
      .select()
      .from(knowledgeBases)
      .where(and(eq(knowledgeBases.workspaceId, workspaceId), eq(knowledgeBases.name, name), eq(knowledgeBases.status, 'active')))
      .limit(1);
    return row;
  }

  async listByWorkspace(workspaceId: string): Promise<KnowledgeBase[]> {
    return this.db
      .select()
      .from(knowledgeBases)
      .where(eq(knowledgeBases.workspaceId, workspaceId))
      .orderBy(asc(knowledgeBases.createdAt), asc(knowledgeBases.id));
  }

  async countActive(workspaceId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(knowledgeBases)
      .where(and(eq(knowledgeBases.workspaceId, workspaceId), eq(knowledgeBases.status, 'active')));
    return row?.total ?? 0;
  }

  async archive(workspaceId: string, knowledgeBaseId: string, archivedAt: Date): Promise<KnowledgeBase | undefined> {
    const [row] = await this.db
      .update(knowledgeBases)
      .set({ status: 'archived', archivedAt })
      .where(and(eq(knowledgeBases.workspaceId, workspaceId), eq(knowledgeBases.id, knowledgeBaseId), eq(knowledgeBases.status, 'active')))
      .returning();
    return row;
  }
}
