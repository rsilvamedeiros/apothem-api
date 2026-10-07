import type { AuthenticatedPrincipal } from './principal.js';

export interface PrincipalReaderPort {
  findById(principalId: string): Promise<AuthenticatedPrincipal | undefined>;
  /** Matches case-insensitively; only active principals are returned. */
  findByEmail(email: string): Promise<AuthenticatedPrincipal | undefined>;
}
