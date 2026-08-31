export type PrincipalType = 'user' | 'service_account';

/**
 * Minimal identity carried by an authenticated request. Deliberately excludes
 * organization/workspace/role — that is membership, resolved separately per
 * apothem-ai/docs/03-domain/users-memberships.md ("separate identity from
 * organization membership").
 */
export interface AuthenticatedPrincipal {
  readonly id: string;
  readonly type: PrincipalType;
  readonly email: string;
  readonly name: string;
}
