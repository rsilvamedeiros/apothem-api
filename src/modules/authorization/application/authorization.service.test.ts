import { describe, expect, it } from 'vitest';
import { AuthorizationService } from './authorization.service.js';
import type { TenantContext } from './tenant-context.js';
import { FIXTURE_PRINCIPALS, ORG_A } from './__fixtures__/tenant-fixtures.js';

function contextWithRole(role: TenantContext['organizationRole']): TenantContext {
  return { principal: FIXTURE_PRINCIPALS.ownerA, organizationId: ORG_A, organizationRole: role };
}

describe('AuthorizationService', () => {
  const service = new AuthorizationService();

  it('grants owners organization-management capabilities', () => {
    expect(service.can(contextWithRole('owner'), 'organization.settings.manage')).toBe(true);
    expect(service.can(contextWithRole('owner'), 'apikey.manage')).toBe(true);
  });

  it('denies operators privileged capabilities the matrix does not grant', () => {
    const context = contextWithRole('operator');
    expect(service.can(context, 'organization.settings.manage')).toBe(false);
    expect(service.can(context, 'connection.manage')).toBe(false);
    expect(service.can(context, 'agent.run')).toBe(true);
  });

  it('grants auditors read-only capabilities only', () => {
    const context = contextWithRole('auditor');
    expect(service.can(context, 'audit.read')).toBe(true);
    expect(service.can(context, 'agent.run')).toBe(false);
    expect(service.can(context, 'knowledge.manage')).toBe(false);
  });

  it('prefers workspaceRole over organizationRole when both are present', () => {
    const context: TenantContext = {
      principal: FIXTURE_PRINCIPALS.operatorA,
      organizationId: ORG_A,
      organizationRole: 'operator',
      workspaceId: 'workspace-a',
      workspaceRole: 'admin',
    };
    expect(service.can(context, 'connection.manage')).toBe(true);
  });

  it('assert throws ForbiddenError when the capability is missing', () => {
    expect(() => service.assert(contextWithRole('auditor'), 'agent.run')).toThrow(/lacks capability/);
  });

  it('fails closed for a role with no matrix entry', () => {
    const context = { ...contextWithRole('owner'), organizationRole: 'unknown-role' } as unknown as TenantContext;
    expect(service.can(context, 'run.read')).toBe(false);
  });
});
