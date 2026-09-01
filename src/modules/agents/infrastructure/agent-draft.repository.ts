import { eq } from 'drizzle-orm';
import type { Database } from '../../../infrastructure/database/client.js';
import { agentDrafts, type AgentDraft, type NewAgentDraft } from './schema.js';
import type { AgentDraftPatch, AgentDraftPort } from '../application/agent-draft.port.js';

export class AgentDraftRepository implements AgentDraftPort {
  constructor(private readonly db: Database) {}

  async findByAgentId(agentId: string): Promise<AgentDraft | undefined> {
    const [row] = await this.db.select().from(agentDrafts).where(eq(agentDrafts.agentId, agentId)).limit(1);
    return row;
  }

  async create(input: NewAgentDraft): Promise<AgentDraft> {
    const [row] = await this.db.insert(agentDrafts).values(input).returning();
    if (!row) {
      throw new Error('Failed to create agent draft');
    }
    return row;
  }

  async update(agentId: string, patch: AgentDraftPatch): Promise<AgentDraft> {
    const [row] = await this.db
      .update(agentDrafts)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(agentDrafts.agentId, agentId))
      .returning();
    if (!row) {
      throw new Error(`Failed to update draft for agent ${agentId}`);
    }
    return row;
  }
}
