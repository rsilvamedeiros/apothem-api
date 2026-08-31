import type { PrincipalReaderPort } from '../application/principal-reader.port.js';
import type { AuthenticatedPrincipal } from '../application/principal.js';
import type { PrincipalRepository } from './principal.repository.js';

/** Adapts PrincipalRepository to PrincipalReaderPort, excluding suspended principals. */
export class ActivePrincipalReader implements PrincipalReaderPort {
  constructor(private readonly principals: PrincipalRepository) {}

  async findById(principalId: string): Promise<AuthenticatedPrincipal | undefined> {
    const principal = await this.principals.findById(principalId);
    if (!principal || principal.status !== 'active') {
      return undefined;
    }
    return { id: principal.id, type: principal.type, email: principal.email, name: principal.name };
  }
}
