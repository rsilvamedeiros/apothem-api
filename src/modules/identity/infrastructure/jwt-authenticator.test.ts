import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { JwtAuthenticator, type JwtAuthenticatorConfig } from './jwt-authenticator.js';
import type { PrincipalReaderPort } from '../application/principal-reader.port.js';
import type { AuthenticatedPrincipal } from '../application/principal.js';

const ISSUER = 'https://auth.apothemai.com.br';
const AUDIENCE = 'apothem-api';
const SECRET = new TextEncoder().encode('a-very-long-random-secret-of-at-least-32-chars');

const ALICE: AuthenticatedPrincipal = { id: 'principal-alice', type: 'user', email: 'alice@example.com', name: 'Alice' };

class FakeReader implements PrincipalReaderPort {
  readonly lookups: string[] = [];
  async findById(): Promise<AuthenticatedPrincipal | undefined> {
    return undefined;
  }
  async findByEmail(email: string): Promise<AuthenticatedPrincipal | undefined> {
    this.lookups.push(email);
    return email.toLowerCase() === ALICE.email ? ALICE : undefined;
  }
}

type Claims = Record<string, unknown>;

async function hs256(claims: Claims, overrides: { issuer?: string; audience?: string; expiresIn?: string | number; key?: Uint8Array; alg?: string } = {}) {
  const jwt = new SignJWT({ email: ALICE.email, email_verified: true, ...claims })
    .setProtectedHeader({ alg: overrides.alg ?? 'HS256' })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? '5m');
  if (!('sub' in claims)) jwt.setSubject('subject-1');
  return jwt.sign(overrides.key ?? SECRET);
}

function build(config: Partial<JwtAuthenticatorConfig> = {}, reader = new FakeReader()) {
  const authenticator = new JwtAuthenticator(reader, { issuer: ISSUER, audience: AUDIENCE, key: SECRET, algorithms: ['HS256'], ...config });
  return { authenticator, reader };
}

describe('JwtAuthenticator (shared secret)', () => {
  it('authenticates a valid token and resolves the principal by verified email', async () => {
    const { authenticator } = build();
    await expect(authenticator.authenticate(await hs256({}))).resolves.toEqual(ALICE);
  });

  it('matches the email case-insensitively', async () => {
    const { authenticator } = build();
    await expect(authenticator.authenticate(await hs256({ email: 'ALICE@Example.com' }))).resolves.toEqual(ALICE);
  });

  it.each([undefined, '', 'garbage', 'a.b.c', 'Bearer x'])('fails closed for a missing or malformed credential (%j)', async (credential) => {
    const { authenticator } = build();
    await expect(authenticator.authenticate(credential)).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const { authenticator } = build();
    const expired = await hs256({}, { expiresIn: Math.floor(Date.now() / 1000) - 3600 });
    await expect(authenticator.authenticate(expired)).resolves.toBeNull();
  });

  it('rejects a wrong issuer and a wrong audience', async () => {
    const { authenticator } = build();
    await expect(authenticator.authenticate(await hs256({}, { issuer: 'https://evil.example' }))).resolves.toBeNull();
    await expect(authenticator.authenticate(await hs256({}, { audience: 'someone-else' }))).resolves.toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const { authenticator } = build();
    const forged = await hs256({}, { key: new TextEncoder().encode('another-secret-another-secret-another-secret') });
    await expect(authenticator.authenticate(forged)).resolves.toBeNull();
  });

  it('rejects an unsigned (alg none) token', async () => {
    const { authenticator } = build();
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 's', email: ALICE.email, email_verified: true, iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 300 }),
    ).toString('base64url');
    await expect(authenticator.authenticate(`${header}.${payload}.`)).resolves.toBeNull();
  });

  it('rejects an algorithm that is not on the allow list (algorithm confusion)', async () => {
    const { authenticator } = build();
    await expect(authenticator.authenticate(await hs256({}, { alg: 'HS512' }))).resolves.toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const { authenticator } = build();
    const [header, , signature] = (await hs256({})).split('.');
    const payload = Buffer.from(
      JSON.stringify({ sub: 's', email: 'admin@example.com', email_verified: true, iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 300 }),
    ).toString('base64url');
    await expect(authenticator.authenticate(`${header}.${payload}.${signature}`)).resolves.toBeNull();
  });

  it('requires exp, sub and a verified email', async () => {
    const { authenticator, reader } = build();
    const noExp = await new SignJWT({ email: ALICE.email, email_verified: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('s')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .sign(SECRET);
    await expect(authenticator.authenticate(noExp)).resolves.toBeNull();
    await expect(authenticator.authenticate(await hs256({ sub: '' }))).resolves.toBeNull();
    await expect(authenticator.authenticate(await hs256({ email_verified: false }))).resolves.toBeNull();
    await expect(authenticator.authenticate(await hs256({ email_verified: 'true' }))).resolves.toBeNull();
    await expect(authenticator.authenticate(await hs256({ email: undefined }))).resolves.toBeNull();
    await expect(authenticator.authenticate(await hs256({ email: 42 }))).resolves.toBeNull();
    expect(reader.lookups).toEqual([]);
  });

  it('fails closed for an unknown or inactive account', async () => {
    const { authenticator } = build();
    await expect(authenticator.authenticate(await hs256({ email: 'stranger@example.com' }))).resolves.toBeNull();
  });

  it('tolerates only a few seconds of clock skew', async () => {
    const { authenticator } = build();
    const justExpired = await hs256({}, { expiresIn: Math.floor(Date.now() / 1000) - 2 });
    await expect(authenticator.authenticate(justExpired)).resolves.toEqual(ALICE);
    const longExpired = await hs256({}, { expiresIn: Math.floor(Date.now() / 1000) - 60 });
    await expect(authenticator.authenticate(longExpired)).resolves.toBeNull();
  });
});

describe('JwtAuthenticator (asymmetric keys / JWKS)', () => {
  let privateKey: CryptoKey;
  let jwks: ReturnType<typeof createLocalJWKSet>;

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256');
    privateKey = pair.privateKey;
    const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
    jwks = createLocalJWKSet({ keys: [jwk] });
  });

  const sign = (key: CryptoKey, alg = 'ES256') =>
    new SignJWT({ email: ALICE.email, email_verified: true })
      .setProtectedHeader({ alg, kid: 'k1' })
      .setSubject('s')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('5m')
      .sign(key);

  it('verifies a token against the published key set', async () => {
    const { authenticator } = build({ key: jwks, algorithms: ['ES256'] });
    await expect(authenticator.authenticate(await sign(privateKey))).resolves.toEqual(ALICE);
  });

  it('rejects a token signed by a key that is not in the set', async () => {
    const { authenticator } = build({ key: jwks, algorithms: ['ES256'] });
    const other = await generateKeyPair('ES256');
    await expect(authenticator.authenticate(await sign(other.privateKey))).resolves.toBeNull();
  });

  it('rejects an HS256 token when only asymmetric algorithms are allowed', async () => {
    const { authenticator } = build({ key: jwks, algorithms: ['ES256'] });
    await expect(authenticator.authenticate(await hs256({}))).resolves.toBeNull();
  });
});
