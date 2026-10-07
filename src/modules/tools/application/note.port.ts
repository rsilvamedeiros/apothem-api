import type { NewWorkspaceNote, WorkspaceNote } from '../infrastructure/schema.js';

/** Every query is scoped by workspace. Notes are soft deleted, never hard deleted. */
export interface NotePort {
  create(input: NewWorkspaceNote): Promise<WorkspaceNote>;
  findByIdempotencyKey(workspaceId: string, key: string): Promise<WorkspaceNote | undefined>;
}
