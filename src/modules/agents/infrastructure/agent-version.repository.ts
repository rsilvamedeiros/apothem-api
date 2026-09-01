import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../../../infrastructure/database/client.js';
import { agentVersions, type AgentVersion, type NewAgentVersion } from './schema.js';
import type { AgentVersionPort } from '../application/agent-version.port.js';

export class AgentVersionRepository implements AgentVersionPort {
  constructor(private readonly db: Database) {}

  async create(input: NewAgentVersion): Promise<AgentVersion> {
    const [row] = await this.db.insert(agentVersions).values(input).returning();
    if (!row) {
      throw new Error('Failed to create agent version');
    }
    return row;
  }

  async findById(agentId: string, versionId: string): Promise<AgentVersion | undefined> {
    const [row] = await this.db
      .select()
      .from(agentVersions)
      .where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.id, versionId)))
      .limit(1);
    return row;
  }

  async listByAgent(agentId: string): Promise<AgentVersion[]> {
    return this.db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.agentId, agentId))
      .orderBy(desc(agentVersions.versionNumber));
  }

  async findLatestVersionNumber(agentId: string): Promise<number> {
    const [row] = await this.db
      .select({ versionNumber: agentVersions.versionNumber })
      .from(agentVersions)
      .where(eq(agentVersions.agentId, agentId))
      .orderBy(desc(agentVersions.versionNumber))
      .limit(1);
    return row?.versionNumber ?? 0;
  }
}
