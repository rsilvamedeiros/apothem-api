import type { AuthenticatedPrincipal } from './principal.js';
import type { PrincipalPort } from './principal.port.js';
import type { Principal } from '../infrastructure/schema.js';

export interface ProvisionInput {
  readonly email: string;
  readonly name?: string | undefined;
}

export interface PrincipalProvisionerPort {
  /** Returns the active account for the email, creating it when missing. `undefined` means "do not authenticate". */
  provision(input: ProvisionInput): Promise<AuthenticatedPrincipal | undefined>;
}

const MAX_NAME_LENGTH = 200;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toAuthenticated(principal: Principal): AuthenticatedPrincipal {
  return { id: principal.id, type: principal.type, email: principal.email, name: principal.name };
}

/**
 * Just-in-time account creation for a provider-verified email (ADR-012). It
 * only creates an identity: access to any organization still requires a
 * membership. A suspended account is never created again or returned.
 */
export class PrincipalProvisioner implements PrincipalProvisionerPort {
  constructor(private readonly principals: PrincipalPort) {}

  async provision(input: ProvisionInput): Promise<AuthenticatedPrincipal | undefined> {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL.test(email)) {
      return undefined;
    }

    const existing = await this.principals.findByEmail(email);
    if (existing) {
      return existing.status === 'active' ? toAuthenticated(existing) : undefined;
    }

    const name = input.name?.trim().slice(0, MAX_NAME_LENGTH) || email.split('@')[0] || email;
    try {
      return toAuthenticated(await this.principals.create({ type: 'user', email, name }));
    } catch (error) {
      // Two first logins can race; the unique email constraint lets exactly one win.
      const winner = await this.principals.findByEmail(email);
      if (winner) {
        return winner.status === 'active' ? toAuthenticated(winner) : undefined;
      }
      throw error;
    }
  }
}
