import type { WorkspaceMembership, NewWorkspaceMembership } from '../infrastructure/schema.js';
import type { WorkspaceMembershipReaderPort } from './workspace-membership-reader.port.js';

export interface WorkspaceMembershipPort extends WorkspaceMembershipReaderPort {
  listByWorkspace(workspaceId: string): Promise<WorkspaceMembership[]>;
  create(input: NewWorkspaceMembership): Promise<WorkspaceMembership>;
}
