/**
 * Capabilities are the only unit authorization checks are made against —
 * role bundles are just a default mapping onto these, per
 * apothem-ai/docs/08-security/security-model.md ("Authorization strategy")
 * and apothem-ai/docs/01-product/permissions-matrix.md.
 */
export const CAPABILITIES = [
  'organization.settings.manage',
  'organization.settings.read',
  'organization.billing.manage',
  'organization.billing.read',
  'workspace.membership.manage',
  'workspace.membership.read',
  'agent.read',
  'agent.draft.write',
  'agent.publish',
  'knowledge.manage',
  'knowledge.use',
  'connection.manage',
  'agent.run',
  'approval.decide',
  'policy.manage',
  'run.read',
  'audit.read',
  'apikey.manage',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Organization-scoped capabilities are always resolved from the organization
 * role. A workspace-level role override narrows or widens only workspace
 * capabilities, so it can never be used to escalate to organization
 * settings or billing.
 */
export function isOrganizationScoped(capability: Capability): boolean {
  return capability.startsWith('organization.');
}
