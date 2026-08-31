import type { AuthorizationService } from '../../authorization/application/authorization.service.js';
import type { TenantContext } from '../../authorization/application/tenant-context.js';
import type { AuditPort } from '../../audit/application/audit.port.js';
import { ConflictError, NotFoundError } from '../../../common/errors.js';
import type { WorkspacePort } from './workspace.port.js';
import type { Workspace } from '../infrastructure/schema.js';

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
}

export class WorkspaceService {
  constructor(
    private readonly workspaces: WorkspacePort,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditPort,
  ) {}

  async create(context: TenantContext, input: CreateWorkspaceInput): Promise<Workspace> {
    this.authorization.assert(context, 'workspace.membership.manage');

    const existing = await this.workspaces.findBySlug(context.organizationId, input.slug);
    if (existing) {
      throw new ConflictError(`Workspace slug "${input.slug}" is already in use in this organization`);
    }

    const workspace = await this.workspaces.create({
      organizationId: context.organizationId,
      name: input.name,
      slug: input.slug,
    });

    await this.audit.record({
      organizationId: context.organizationId,
      workspaceId: workspace.id,
      actorPrincipalId: context.principal.id,
      action: 'workspace.created',
      targetType: 'workspace',
      targetId: workspace.id,
      metadata: { slug: workspace.slug },
    });

    return workspace;
  }

  async list(context: TenantContext): Promise<Workspace[]> {
    this.authorization.assert(context, 'workspace.membership.read');
    return this.workspaces.listByOrganization(context.organizationId);
  }

  async get(context: TenantContext, workspaceId: string): Promise<Workspace> {
    this.authorization.assert(context, 'workspace.membership.read');
    const workspace = await this.workspaces.findById(context.organizationId, workspaceId);
    if (!workspace) {
      throw new NotFoundError(`Workspace ${workspaceId} not found`);
    }
    return workspace;
  }
}
