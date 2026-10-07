import { describe, expect, it } from 'vitest';
import { DevHeaderAuthenticator } from './dev-header-authenticator.js';
import type { PrincipalReaderPort } from '../application/principal-reader.port.js';
import type { AuthenticatedPrincipal } from '../application/principal.js';

const KNOWN_PRINCIPAL: AuthenticatedPrincipal = {
  id: 'principal-1',
  type: 'user',
  email: 'demo@apothemai.com.br',
  name: 'Demo',
};

class FakePrincipalReader implements PrincipalReaderPort {
  async findById(principalId: string): Promise<AuthenticatedPrincipal | undefined> {
    return principalId === KNOWN_PRINCIPAL.id ? KNOWN_PRINCIPAL : undefined;
  }

  async findByEmail(): Promise<AuthenticatedPrincipal | undefined> {
    return undefined;
  }
}

describe('DevHeaderAuthenticator', () => {
  const authenticator = new DevHeaderAuthenticator(new FakePrincipalReader());

  it('resolves a known principal id to its principal', async () => {
    await expect(authenticator.authenticate(KNOWN_PRINCIPAL.id)).resolves.toEqual(KNOWN_PRINCIPAL);
  });

  it('fails closed when the credential is missing', async () => {
    await expect(authenticator.authenticate(undefined)).resolves.toBeNull();
  });

  it('fails closed when the credential does not match any principal', async () => {
    await expect(authenticator.authenticate('unknown-id')).resolves.toBeNull();
  });
});
