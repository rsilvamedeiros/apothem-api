import type { PrincipalReaderPort } from '../application/principal-reader.port.js';
import type { AuthenticatedPrincipal } from '../application/principal.js';
import type { PrincipalPort } from '../application/principal.port.js';
import type { Principal } from './schema.js';

/** Adapts a PrincipalPort to PrincipalReaderPort, excluding suspended principals. */
export class ActivePrincipalReader implements PrincipalReaderPort {
  constructor(private readonly principals: PrincipalPort) {}

  async findById(principalId: string): Promise<AuthenticatedPrincipal | undefined> {
    return toAuthenticated(await this.principals.findById(principalId));
  }

  async findByEmail(email: string): Promise<AuthenticatedPrincipal | undefined> {
    return toAuthenticated(await this.principals.findByEmail(email.trim().toLowerCase()));
  }
}

function toAuthenticated(principal: Principal | undefined): AuthenticatedPrincipal | undefined {
  if (!principal || principal.status !== 'active') {
    return undefined;
  }
  return { id: principal.id, type: principal.type, email: principal.email, name: principal.name };
}
