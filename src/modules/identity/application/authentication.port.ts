import type { AuthenticatedPrincipal } from './principal.js';

/**
 * Boundary between the HTTP layer and whatever verifies identity (session
 * cookie, bearer token, OIDC introspection...). Per ADR-009 the target is a
 * self-hosted OIDC provider (Auth.js/Lucia) — not implemented yet, so only
 * the port and a bootstrap adapter exist for now. Application/domain code
 * must depend on this interface, never on a concrete auth library.
 */
export interface AuthenticationPort {
  /**
   * Returns the authenticated principal for the given credential, or `null`
   * if the credential is missing/invalid/expired. Never throws for "not
   * authenticated" — callers treat `null` as unauthenticated and fail closed.
   */
  authenticate(credential: string | undefined): Promise<AuthenticatedPrincipal | null>;
}
