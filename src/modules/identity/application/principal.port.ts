import type { Principal, NewPrincipal } from '../infrastructure/schema.js';

export interface PrincipalPort {
  findById(principalId: string): Promise<Principal | undefined>;
  findByEmail(email: string): Promise<Principal | undefined>;
  findManyByIds(principalIds: readonly string[]): Promise<Principal[]>;
  create(input: NewPrincipal): Promise<Principal>;
}
