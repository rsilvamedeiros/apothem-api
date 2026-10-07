import { describe, expect, it } from 'vitest';
import { TenantContextResolver } from './tenant-context-resolver.js';
import { ForbiddenError } from '../../../common/errors.js';
import {
  FakeMembershipReader,
  FakeWorkspaceReader,
  FakeWorkspaceMembershipReader,
  FIXTURE_PRINCIPALS,
  ORG_A,
  ORG_B,
  WORKSPACE_A,
  WORKSPACE_B,
} from './__fixtures__/tenant-fixtures.js';

function buildResolver(): TenantContextResolver {
  return new TenantContextResolver(
    new FakeMembershipReader(),
    new FakeWorkspaceReader(),
    new FakeWorkspaceMembershipReader(),
  );
}

describe('TenantContextResolver — IDOR / cross-tenant isolation', () => {
  it('resolves organization-level scope for an active member', async () => {
    const context = await buildResolver().resolve(FIXTURE_PRINCIPALS.ownerA, ORG_A);
    expect(context.organizationId).toBe(ORG_A);
    expect(context.organizationRole).toBe('owner');
    expect(context.workspaceId).toBeUndefined();
  });

  it('rejects a principal with no membership in the requested organization', async () => {
    await expect(buildResolver().resolve(FIXTURE_PRINCIPALS.outsider, ORG_A)).rejects.toThrow(ForbiddenError);
  });

  it('rejects a revoked membership even though the row exists', async () => {
    await expect(buildResolver().resolve(FIXTURE_PRINCIPALS.revokedA, ORG_A)).rejects.toThrow(ForbiddenError);
  });

  it('rejects a member of org A trying to reach org B by supplying org B\'s id', async () => {
    await expect(buildResolver().resolve(FIXTURE_PRINCIPALS.ownerA, ORG_B)).rejects.toThrow(ForbiddenError);
  });

  it('rejects a member of org A supplying a workspace id that belongs to org B', async () => {
    // ownerA is a legitimate member of ORG_A, but WORKSPACE_B belongs to ORG_B —
    // this is the IDOR case: a valid-looking id from another tenant must not resolve.
    await expect(buildResolver().resolve(FIXTURE_PRINCIPALS.ownerA, ORG_A, WORKSPACE_B)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('resolves workspace scope with the base organization role when no workspace override exists', async () => {
    const context = await buildResolver().resolve(FIXTURE_PRINCIPALS.ownerA, ORG_A, WORKSPACE_A);
    expect(context.workspaceId).toBe(WORKSPACE_A);
    expect(context.organizationRole).toBe('owner');
    expect(context.workspaceRole).toBeUndefined();
  });

  it('applies a workspace-level role override when a workspace membership row exists', async () => {
    const context = await buildResolver().resolve(FIXTURE_PRINCIPALS.operatorA, ORG_A, WORKSPACE_A);
    expect(context.organizationRole).toBe('operator');
    expect(context.workspaceRole).toBe('builder');
  });
});

describe('TenantContextResolver — denied paths', () => {
  it('rejects an archived workspace', async () => {
    const resolver = new TenantContextResolver(
      new FakeMembershipReader(),
      { findById: async () => ({ id: WORKSPACE_A, status: 'archived' }) },
      new FakeWorkspaceMembershipReader(),
    );
    await expect(resolver.resolve(FIXTURE_PRINCIPALS.ownerA, ORG_A, WORKSPACE_A)).rejects.toThrow(ForbiddenError);
  });

  it('rejects an invited (not yet accepted) membership', async () => {
    const resolver = new TenantContextResolver(
      { findByPrincipalInOrganization: async () => ({ id: 'm-invited', role: 'admin', status: 'invited' }) },
      new FakeWorkspaceReader(),
      new FakeWorkspaceMembershipReader(),
    );
    await expect(resolver.resolve(FIXTURE_PRINCIPALS.outsider, ORG_A)).rejects.toThrow(ForbiddenError);
  });

  it('does not reveal whether a workspace exists in another organization', async () => {
    const resolver = buildResolver();
    const missing = await resolver.resolve(FIXTURE_PRINCIPALS.ownerA, ORG_A, 'does-not-exist').catch((e: Error) => e);
    const foreign = await resolver.resolve(FIXTURE_PRINCIPALS.ownerA, ORG_A, WORKSPACE_B).catch((e: Error) => e);
    expect(missing).toBeInstanceOf(ForbiddenError);
    expect(foreign).toBeInstanceOf(ForbiddenError);
    expect((foreign as Error).message.replace(WORKSPACE_B, 'X')).toBe(
      (missing as Error).message.replace('does-not-exist', 'X'),
    );
  });

  it('never attaches a workspace id to the context when resolution is denied', async () => {
    const result = await buildResolver()
      .resolve(FIXTURE_PRINCIPALS.outsider, ORG_A, WORKSPACE_A)
      .catch((e: Error) => e);
    expect(result).toBeInstanceOf(ForbiddenError);
  });

  it('does not let one organization member read another member\'s workspace role', async () => {
    const context = await buildResolver().resolve(FIXTURE_PRINCIPALS.ownerA, ORG_A, WORKSPACE_A);
    // ownerA has no workspace override row; operatorA\'s "builder" row must not leak to them.
    expect(context.workspaceRole).toBeUndefined();
  });
});
