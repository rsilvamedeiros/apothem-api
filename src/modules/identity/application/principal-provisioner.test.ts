import { beforeEach, describe, expect, it } from 'vitest';
import { PrincipalProvisioner } from './principal-provisioner.js';
import { FakePrincipalRepository } from '../../../infrastructure/http/__fixtures__/fake-repositories.js';
import type { Principal } from '../infrastructure/schema.js';

describe('PrincipalProvisioner (just-in-time accounts)', () => {
  let principals: FakePrincipalRepository;
  let provisioner: PrincipalProvisioner;

  beforeEach(() => {
    principals = new FakePrincipalRepository();
    provisioner = new PrincipalProvisioner(principals);
  });

  it('creates an active user with a normalized email and the given name', async () => {
    const principal = await provisioner.provision({ email: '  New.User@Example.COM ', name: 'New User' });
    expect(principal).toMatchObject({ type: 'user', email: 'new.user@example.com', name: 'New User' });
    expect((await principals.findByEmail('new.user@example.com'))?.status).toBe('active');
  });

  it('derives a name from the email when none is given', async () => {
    expect((await provisioner.provision({ email: 'jane.doe@example.com' }))?.name).toBe('jane.doe');
    expect((await provisioner.provision({ email: 'x@example.com', name: '   ' }))?.name).toBe('x');
  });

  it('trims and caps the name', async () => {
    const principal = await provisioner.provision({ email: 'long@example.com', name: `  ${'n'.repeat(500)}  ` });
    expect(principal?.name).toHaveLength(200);
  });

  it('returns the existing active account instead of creating a duplicate', async () => {
    const first = await provisioner.provision({ email: 'dup@example.com', name: 'First' });
    const second = await provisioner.provision({ email: 'DUP@example.com', name: 'Second' });
    expect(second?.id).toBe(first?.id);
    expect(second?.name).toBe('First');
  });

  it('never resurrects or returns a suspended account', async () => {
    const suspended = await principals.create({ type: 'user', email: 'gone@example.com', name: 'Gone' });
    (suspended as Principal).status = 'suspended';
    expect(await provisioner.provision({ email: 'gone@example.com', name: 'Gone' })).toBeUndefined();
  });

  it('recovers from a concurrent creation (unique violation) by returning the winner', async () => {
    const winner = await principals.create({ type: 'user', email: 'race@example.com', name: 'Winner' });
    let lookups = 0;
    const racing = Object.create(principals) as FakePrincipalRepository;
    racing.findByEmail = async (email: string) => {
      lookups += 1;
      // The first lookup runs before the other request commits; later ones see it.
      return lookups === 1 ? undefined : principals.findByEmail(email);
    };
    racing.create = async () => {
      throw new Error('duplicate key value violates unique constraint "principals_email_unique"');
    };

    const result = await new PrincipalProvisioner(racing).provision({ email: 'race@example.com', name: 'Loser' });
    expect(result?.id).toBe(winner.id);
  });

  it('rethrows a creation failure that is not a duplicate', async () => {
    const broken = Object.create(principals) as FakePrincipalRepository;
    broken.create = async () => {
      throw new Error('connection refused');
    };
    await expect(new PrincipalProvisioner(broken).provision({ email: 'a@example.com' })).rejects.toThrow(
      'connection refused',
    );
  });

  it.each(['', '   ', 'no-at-sign', 'a@', '@b.com', 'a b@example.com'])('refuses an invalid email %j', async (email) => {
    expect(await provisioner.provision({ email })).toBeUndefined();
    expect(await principals.findManyByIds([])).toEqual([]);
  });
});
