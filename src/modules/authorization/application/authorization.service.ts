import { ForbiddenError } from '../../../common/errors.js';
import { ROLE_CAPABILITIES } from '../domain/role.js';
import { isOrganizationScoped, type Capability } from '../domain/capability.js';
import type { TenantContext } from './tenant-context.js';

/**
 * The only place capability decisions are made. Route handlers and
 * application services call assertCapability instead of comparing roles
 * directly, so the permission matrix stays in one place.
 */
export class AuthorizationService {
  can(context: TenantContext, capability: Capability): boolean {
    const effectiveRole = isOrganizationScoped(capability)
      ? context.organizationRole
      : (context.workspaceRole ?? context.organizationRole);
    // Unknown/unmapped role fails closed rather than defaulting to allow.
    // hasOwn guards against inherited keys such as "toString" or "__proto__".
    if (!Object.hasOwn(ROLE_CAPABILITIES, effectiveRole)) {
      return false;
    }
    return ROLE_CAPABILITIES[effectiveRole].has(capability);
  }

  assert(context: TenantContext, capability: Capability): void {
    if (!this.can(context, capability)) {
      throw new ForbiddenError(`Principal ${context.principal.id} lacks capability "${capability}"`);
    }
  }
}
