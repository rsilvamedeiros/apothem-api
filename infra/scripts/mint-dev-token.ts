import { SignJWT } from 'jose';
import { loadEnv } from '../../src/infrastructure/http/env.js';

/**
 * Local-only helper: signs a short-lived HS256 token for an existing account
 * so the bearer path can be exercised by hand (curl, the web app) without an
 * identity provider. It needs AUTH_MODE=jwt and the same AUTH_SECRET as the
 * API, and refuses to run in production.
 *
 *   npm run auth:dev-token -- someone@example.com
 */
async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    throw new Error('Usage: npm run auth:dev-token -- <email>');
  }

  const env = loadEnv();
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to mint tokens in production');
  }
  if (env.AUTH_MODE !== 'jwt' || !env.AUTH_JWT_ISSUER || !env.AUTH_JWT_AUDIENCE) {
    throw new Error('Set AUTH_MODE=jwt, AUTH_JWT_ISSUER and AUTH_JWT_AUDIENCE in .env first');
  }
  if (env.AUTH_JWKS_URL) {
    throw new Error('AUTH_JWKS_URL is set: tokens must come from your identity provider, not this script');
  }

  const token = await new SignJWT({ email: email.trim().toLowerCase(), email_verified: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(`dev:${email.trim().toLowerCase()}`)
    .setIssuer(env.AUTH_JWT_ISSUER)
    .setAudience(env.AUTH_JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(env.AUTH_SECRET));

  console.log(token);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
