import type { Agent, NewAgent } from '../infrastructure/schema.js';

export interface AgentPort {
  findById(workspaceId: string, agentId: string): Promise<Agent | undefined>;
  findBySlug(workspaceId: string, slug: string): Promise<Agent | undefined>;
  listByWorkspace(workspaceId: string): Promise<Agent[]>;
  create(input: NewAgent): Promise<Agent>;
  /** Used by publish/disable/archive — never mutates name/slug/description. */
  updateLifecycle(
    agentId: string,
    patch: { status?: Agent['status']; activeVersionId?: string },
  ): Promise<Agent>;
}
