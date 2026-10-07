import type { AuthenticatedPrincipal } from './principal.js';

/** Where the HTTP layer must read the credential for a given authenticator. */
export type CredentialSource = 'x-principal-id' | 'bearer';

/**
 * Boundary between the HTTP layer and whatever verifies identity (session
 * cookie, bearer token, OIDC introspection...). Per ADR-009/ADR-012 the target
 * is a self-hosted OIDC provider issuing signed tokens. Application/domain
 * code must depend on this interface, never on a concrete auth library.
 */
export interface AuthenticationPort {
  /** Tells the transport layer where this authenticator expects its credential. */
  readonly credentialSource: CredentialSource;

  /**
   * Returns the authenticated principal for the given credential, or `null`
   * if the credential is missing/invalid/expired. Never throws for "not
   * authenticated": callers treat `null` as unauthenticated and fail closed.
   */
  authenticate(credential: string | undefined): Promise<AuthenticatedPrincipal | null>;
}
