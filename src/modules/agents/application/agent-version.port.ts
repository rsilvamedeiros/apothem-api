import type { AgentVersion, NewAgentVersion } from '../infrastructure/schema.js';

export interface AgentVersionPort {
  /** Immutable — there is deliberately no update/delete method on this port. */
  create(input: NewAgentVersion): Promise<AgentVersion>;
  findById(agentId: string, versionId: string): Promise<AgentVersion | undefined>;
  listByAgent(agentId: string): Promise<AgentVersion[]>;
  findLatestVersionNumber(agentId: string): Promise<number>;
}
