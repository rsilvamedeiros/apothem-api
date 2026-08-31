import type { Workspace, NewWorkspace } from '../infrastructure/schema.js';
import type { WorkspaceReaderPort } from './workspace-reader.port.js';

export interface WorkspacePort extends WorkspaceReaderPort {
  // Narrows WorkspaceReaderPort.findById's return type from WorkspaceRecord to the full Workspace row.
  findById(organizationId: string, workspaceId: string): Promise<Workspace | undefined>;
  findBySlug(organizationId: string, slug: string): Promise<Workspace | undefined>;
  listByOrganization(organizationId: string): Promise<Workspace[]>;
  create(input: NewWorkspace): Promise<Workspace>;
}
