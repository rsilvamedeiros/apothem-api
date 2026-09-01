import { and, eq } from 'drizzle-orm';
import type { Database } from '../../../infrastructure/database/client.js';
import { agents, type Agent, type NewAgent } from './schema.js';
import type { AgentPort } from '../application/agent.port.js';

/** Every lookup requires workspaceId — see tenant-isolation.md. */
export class AgentRepository implements AgentPort {
  constructor(private readonly db: Database) {}

  async findById(workspaceId: string, agentId: string): Promise<Agent | undefined> {
    const [row] = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.workspaceId, workspaceId), eq(agents.id, agentId)))
      .limit(1);
    return row;
  }

  async findBySlug(workspaceId: string, slug: string): Promise<Agent | undefined> {
    const [row] = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.workspaceId, workspaceId), eq(agents.slug, slug)))
      .limit(1);
    return row;
  }

  async listByWorkspace(workspaceId: string): Promise<Agent[]> {
    return this.db.select().from(agents).where(eq(agents.workspaceId, workspaceId));
  }

  async create(input: NewAgent): Promise<Agent> {
    const [row] = await this.db.insert(agents).values(input).returning();
    if (!row) {
      throw new Error('Failed to create agent');
    }
    return row;
  }

  async updateLifecycle(
    agentId: string,
    patch: { status?: Agent['status']; activeVersionId?: string },
  ): Promise<Agent> {
    const [row] = await this.db
      .update(agents)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(agents.id, agentId))
      .returning();
    if (!row) {
      throw new Error(`Failed to update agent ${agentId}`);
    }
    return row;
  }
}
