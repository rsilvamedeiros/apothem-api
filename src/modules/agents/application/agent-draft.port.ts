import type { AgentDraft, NewAgentDraft } from '../infrastructure/schema.js';

export type AgentDraftPatch = Partial<
  Pick<
    NewAgentDraft,
    'instructions' | 'modelPolicy' | 'knowledgeBindings' | 'toolBindings' | 'memoryPolicy' | 'guardrails'
  >
>;

export interface AgentDraftPort {
  findByAgentId(agentId: string): Promise<AgentDraft | undefined>;
  create(input: NewAgentDraft): Promise<AgentDraft>;
  update(agentId: string, patch: AgentDraftPatch): Promise<AgentDraft>;
}
