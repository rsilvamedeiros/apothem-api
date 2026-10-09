import type { AuthorizationService } from '../../authorization/application/authorization.service.js';
import type { TenantContext } from '../../authorization/application/tenant-context.js';
import type { AuthenticatedPrincipal } from '../../identity/application/principal.js';
import type { AuditPort } from '../../audit/application/audit.port.js';
import { ConflictError, NotFoundError } from '../../../common/errors.js';
import type { OrganizationPort } from './organization.port.js';
import type { MembershipPort } from './membership.port.js';
import type { Organization } from '../infrastructure/schema.js';

export interface CreateOrganizationInput {
  name: string;
  slug: string;
}

/**
 * Organization bootstrap has no pre-existing tenant scope to authorize
 * against — any authenticated principal may create an organization and
 * becomes its owner. Every other operation here requires a resolved
 * TenantContext and goes through AuthorizationService.
 */
export class OrganizationService {
  constructor(
    private readonly organizations: OrganizationPort,
    private readonly memberships: MembershipPort,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditPort,
  ) {}

  async create(principal: AuthenticatedPrincipal, input: CreateOrganizationInput): Promise<Organization> {
    // Slugs are globally unique. Checking first returns a clean 409 instead of
    // surfacing the database unique-violation as a 500; a concurrent create
    // that slips past this check is still stopped by the unique constraint.
    if (await this.organizations.findBySlug(input.slug)) {
      throw new ConflictError(`Organization slug "${input.slug}" is already in use`);
    }

    // One atomic write: an organization and its owner exist together or not at all.
    let created;
    try {
      created = await this.organizations.createWithOwner({ name: input.name, slug: input.slug }, principal.id);
    } catch (error) {
      // A concurrent request can take the slug between the check above and the write; the unique index decides.
      if (await this.organizations.findBySlug(input.slug)) {
        throw new ConflictError(`Organization slug "${input.slug}" is already in use`);
      }
      throw error;
    }
    const { organization, membership } = created;

    await this.audit.record({
      organizationId: organization.id,
      actorPrincipalId: principal.id,
      action: 'organization.created',
      targetType: 'organization',
      targetId: organization.id,
      metadata: { slug: organization.slug },
    });
    await this.audit.record({
      organizationId: organization.id,
      actorPrincipalId: principal.id,
      action: 'membership.created',
      targetType: 'membership',
      targetId: membership.id,
      metadata: { principalId: principal.id, role: membership.role },
    });

    return organization;
  }

  async get(context: TenantContext): Promise<Organization> {
    this.authorization.assert(context, 'organization.settings.read');
    const organization = await this.organizations.findById(context.organizationId);
    if (!organization) {
      throw new NotFoundError(`Organization ${context.organizationId} not found`);
    }
    return organization;
  }
}
