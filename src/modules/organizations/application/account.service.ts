import type { AuthenticatedPrincipal } from '../../identity/application/principal.js';
import type { OrganizationRole } from '../../authorization/domain/role.js';
import type { OrganizationPort } from './organization.port.js';
import type { MembershipPort } from './membership.port.js';

export interface AccountOverview {
  readonly principal: { readonly id: string; readonly email: string; readonly name: string };
  readonly organizations: readonly {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly role: OrganizationRole;
  }[];
}

/**
 * "Who am I and where can I go": the caller's own identity and the active
 * organizations they belong to. It needs only authentication, never a tenant
 * context, because it can only ever read memberships of the caller.
 */
export class AccountService {
  constructor(
    private readonly organizations: OrganizationPort,
    private readonly memberships: MembershipPort,
  ) {}

  async overview(principal: AuthenticatedPrincipal): Promise<AccountOverview> {
    const own = await this.memberships.listByPrincipal(principal.id);
    const active = own.filter((membership) => membership.status === 'active');

    const resolved = await Promise.all(
      active.map(async (membership) => {
        const organization = await this.organizations.findById(membership.organizationId);
        return organization && organization.status === 'active'
          ? { id: organization.id, name: organization.name, slug: organization.slug, role: membership.role }
          : undefined;
      }),
    );

    return {
      principal: { id: principal.id, email: principal.email, name: principal.name },
      organizations: resolved
        .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
}
