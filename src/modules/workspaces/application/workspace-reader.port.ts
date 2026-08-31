export interface WorkspaceRecord {
  readonly id: string;
  readonly status: 'active' | 'archived';
}

export interface WorkspaceReaderPort {
  findById(organizationId: string, workspaceId: string): Promise<WorkspaceRecord | undefined>;
}
