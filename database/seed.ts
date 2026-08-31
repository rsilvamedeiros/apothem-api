import { createDatabaseClient } from '../src/infrastructure/database/client.js';
import { loadEnv } from '../src/infrastructure/http/env.js';
import { OrganizationRepository } from '../src/modules/organizations/infrastructure/organization.repository.js';
import { MembershipRepository } from '../src/modules/organizations/infrastructure/membership.repository.js';
import { WorkspaceRepository } from '../src/modules/workspaces/infrastructure/workspace.repository.js';
import { WorkspaceMembershipRepository } from '../src/modules/workspaces/infrastructure/workspace-membership.repository.js';
import { PrincipalRepository } from '../src/modules/identity/infrastructure/principal.repository.js';

/**
 * Demo fixtures for local development/CI — not a migration. Idempotent by
 * slug/email so it can run repeatedly against the same database.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const { db, close } = createDatabaseClient(env.DATABASE_URL);

  const principalRepo = new PrincipalRepository(db);
  const organizationRepo = new OrganizationRepository(db);
  const membershipRepo = new MembershipRepository(db);
  const workspaceRepo = new WorkspaceRepository(db);
  const workspaceMembershipRepo = new WorkspaceMembershipRepository(db);

  const principal =
    (await principalRepo.findByEmail('demo@apothemai.com.br')) ??
    (await principalRepo.create({
      type: 'user',
      email: 'demo@apothemai.com.br',
      name: 'Demo User',
    }));

  const organization =
    (await organizationRepo.findBySlug('demo-org')) ??
    (await organizationRepo.create({ name: 'Demo Organization', slug: 'demo-org' }));

  const membership =
    (await membershipRepo.findByPrincipalInOrganization(organization.id, principal.id)) ??
    (await membershipRepo.create({
      organizationId: organization.id,
      principalId: principal.id,
      role: 'owner',
    }));

  const workspace =
    (await workspaceRepo.findBySlug(organization.id, 'default')) ??
    (await workspaceRepo.create({
      organizationId: organization.id,
      name: 'Default Workspace',
      slug: 'default',
    }));

  const existingWorkspaceMembership = await workspaceMembershipRepo.findByMembershipInWorkspace(
    workspace.id,
    membership.id,
  );
  if (!existingWorkspaceMembership) {
    await workspaceMembershipRepo.create({
      workspaceId: workspace.id,
      membershipId: membership.id,
      role: 'owner',
    });
  }

  console.log('Seeded demo organization/workspace:', {
    organizationId: organization.id,
    workspaceId: workspace.id,
    principalId: principal.id,
  });

  await close();
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
