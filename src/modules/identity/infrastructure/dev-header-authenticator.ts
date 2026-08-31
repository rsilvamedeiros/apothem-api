import type { AuthenticationPort } from '../application/authentication.port.js';
import type { AuthenticatedPrincipal } from '../application/principal.js';
import type { PrincipalReaderPort } from '../application/principal-reader.port.js';

/**
 * Bootstrap-only authenticator: trusts a principal id handed to it verbatim
 * (e.g. from an `x-principal-id` header) and looks it up. This exists so the
 * rest of the stack (tenant resolution, authorization, future routes) has a
 * real AuthenticationPort to depend on before self-hosted OIDC (ADR-009) is
 * implemented. It must never run in production — callers are expected to
 * refuse to construct/use it outside development and test, and it performs
 * no cryptographic verification of the credential.
 */
export class DevHeaderAuthenticator implements AuthenticationPort {
  constructor(private readonly principals: PrincipalReaderPort) {}

  async authenticate(credential: string | undefined): Promise<AuthenticatedPrincipal | null> {
    if (!credential) {
      return null;
    }
    const principal = await this.principals.findById(credential);
    return principal ?? null;
  }
}
