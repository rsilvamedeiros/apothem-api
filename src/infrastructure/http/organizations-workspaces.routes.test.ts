import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { loadEnv } from './env.js';
import type { Database } from '../database/client.js';
import type { AppServices } from './app-services.js';
import { DevHeaderAuthenticator } from '../../modules/identity/infrastructure/dev-header-authenticator.js';
import { ActivePrincipalReader } from '../../modules/identity/infrastructure/active-principal-reader.js';
import { TenantContextResolver } from '../../modules/authorization/application/tenant-context-resolver.js';
import { AuthorizationService } from '../../modules/authorization/application/authorization.service.js';
import { OrganizationService } from '../../modules/organizations/application/organization.service.js';
import { WorkspaceService } from '../../modules/workspaces/application/workspace.service.js';
import {
  FakeAuditLog,
  FakeMembershipRepository,
  FakeOrganizationRepository,
  FakePrincipalRepository,
  FakeWorkspaceMembershipRepository,
  FakeWorkspaceRepository,
} from './__fixtures__/fake-repositories.js';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unused/unused',
  REDIS_URL: 'redis://unused',
  STORAGE_ENDPOINT: 'http://unused',
  STORAGE_ACCESS_KEY_ID: 'unused',
  STORAGE_SECRET_ACCESS_KEY: 'unused',
  STORAGE_BUCKET: 'unused',
  AUTH_SECRET: 'unused-secret-value',
});

function buildTestServices(): { services: AppServices; principals: FakePrincipalRepository; audit: FakeAuditLog } {
  const principals = new FakePrincipalRepository();
  const memberships = new FakeMembershipRepository();
  const workspaces = new FakeWorkspaceRepository();
  const workspaceMemberships = new FakeWorkspaceMembershipRepository();
  const organizations = new FakeOrganizationRepository();
  const audit = new FakeAuditLog();
  const authorizationService = new AuthorizationService();

  const services: AppServices = {
    authenticator: new DevHeaderAuthenticator(new ActivePrincipalReader(principals)),
    tenantContextResolver: new TenantContextResolver(memberships, workspaces, workspaceMemberships),
    authorizationService,
    organizationService: new OrganizationService(organizations, memberships, authorizationService, audit),
    workspaceService: new WorkspaceService(workspaces, authorizationService, audit),
  };

  return { services, principals, audit };
}

describe('organizations/workspaces HTTP routes', () => {
  let app: FastifyInstance;
  let principals: FakePrincipalRepository;
  let audit: FakeAuditLog;

  beforeEach(async () => {
    const built = buildTestServices();
    principals = built.principals;
    audit = built.audit;
    app = await buildServer(env, {} as Database, built.services);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects organization creation without a credential', async () => {
    const response = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Acme', slug: 'acme' } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('creates an organization, makes the creator its owner, and records audit events', async () => {
    const owner = await principals.create({ type: 'user', email: 'owner@example.com', name: 'Owner' });

    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: { 'x-principal-id': owner.id },
      payload: { name: 'Acme', slug: 'acme' },
    });
    expect(createResponse.statusCode).toBe(201);
    const organization = createResponse.json();
    expect(organization.slug).toBe('acme');

    expect(audit.events.map((e) => e.action)).toEqual(
      expect.arrayContaining(['organization.created', 'membership.created']),
    );

    const getResponse = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${organization.id}`,
      headers: { 'x-principal-id': owner.id },
    });
    expect(getResponse.statusCode).toBe(200);
  });

  it('rejects a principal with no membership from reading an organization (IDOR)', async () => {
    const owner = await principals.create({ type: 'user', email: 'owner2@example.com', name: 'Owner 2' });
    const outsider = await principals.create({ type: 'user', email: 'outsider@example.com', name: 'Outsider' });

    const created = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: { 'x-principal-id': owner.id },
      payload: { name: 'Beta', slug: 'beta' },
    });
    const organization = created.json();

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${organization.id}`,
      headers: { 'x-principal-id': outsider.id },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('creates a workspace as owner and rejects a duplicate slug with 409', async () => {
    const owner = await principals.create({ type: 'user', email: 'owner3@example.com', name: 'Owner 3' });
    const org = (
      await app.inject({
        method: 'POST',
        url: '/v1/organizations',
        headers: { 'x-principal-id': owner.id },
        payload: { name: 'Gamma', slug: 'gamma' },
      })
    ).json();

    const first = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org.id}/workspaces`,
      headers: { 'x-principal-id': owner.id },
      payload: { name: 'Default', slug: 'default' },
    });
    expect(first.statusCode).toBe(201);

    const duplicate = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org.id}/workspaces`,
      headers: { 'x-principal-id': owner.id },
      payload: { name: 'Default Again', slug: 'default' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('CONFLICT');
  });

  it("rejects a member of one organization fetching another organization's workspace by id (cross-tenant IDOR)", async () => {
    const ownerA = await principals.create({ type: 'user', email: 'owner-a@example.com', name: 'Owner A' });
    const ownerB = await principals.create({ type: 'user', email: 'owner-b@example.com', name: 'Owner B' });

    const orgA = (
      await app.inject({
        method: 'POST',
        url: '/v1/organizations',
        headers: { 'x-principal-id': ownerA.id },
        payload: { name: 'Org A', slug: 'org-a' },
      })
    ).json();
    const orgB = (
      await app.inject({
        method: 'POST',
        url: '/v1/organizations',
        headers: { 'x-principal-id': ownerB.id },
        payload: { name: 'Org B', slug: 'org-b' },
      })
    ).json();

    const workspaceB = (
      await app.inject({
        method: 'POST',
        url: `/v1/organizations/${orgB.id}/workspaces`,
        headers: { 'x-principal-id': ownerB.id },
        payload: { name: 'Default', slug: 'default' },
      })
    ).json();

    // ownerA is a legitimate owner of orgA, but tries to reach orgB's workspace
    // by pairing their own orgA id with workspaceB's id in the path.
    const crossTenant = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${orgA.id}/workspaces/${workspaceB.id}`,
      headers: { 'x-principal-id': ownerA.id },
    });
    expect(crossTenant.statusCode).toBe(403);
  });
});
