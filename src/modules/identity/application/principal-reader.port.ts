import type { AuthenticatedPrincipal } from './principal.js';

export interface PrincipalReaderPort {
  findById(principalId: string): Promise<AuthenticatedPrincipal | undefined>;
}
