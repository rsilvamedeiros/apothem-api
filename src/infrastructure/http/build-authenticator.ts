import { createRemoteJWKSet } from 'jose';
import type { AuthenticationPort } from '../../modules/identity/application/authentication.port.js';
import type { PrincipalReaderPort } from '../../modules/identity/application/principal-reader.port.js';
import type { PrincipalProvisionerPort } from '../../modules/identity/application/principal-provisioner.js';
import { DevHeaderAuthenticator } from '../../modules/identity/infrastructure/dev-header-authenticator.js';
import { JwtAuthenticator } from '../../modules/identity/infrastructure/jwt-authenticator.js';
import type { Env } from './env.js';

/** Asymmetric algorithms accepted for keys published by an OIDC provider. */
const JWKS_ALGORITHMS = ['RS256', 'ES256'] as const;

/**
 * Composition point for authentication. `loadEnv` already guarantees that
 * production uses `jwt` and that jwt mode carries issuer and audience, so this
 * only chooses between the shared secret (HS256) and a published key set.
 */
export function buildAuthenticator(
  env: Env,
  principals: PrincipalReaderPort,
  provisioner?: PrincipalProvisionerPort,
): AuthenticationPort {
  if (env.AUTH_MODE === 'dev') {
    return new DevHeaderAuthenticator(principals);
  }

  if (!env.AUTH_JWT_ISSUER || !env.AUTH_JWT_AUDIENCE) {
    throw new Error('AUTH_MODE=jwt requires AUTH_JWT_ISSUER and AUTH_JWT_AUDIENCE');
  }

  const common = {
    issuer: env.AUTH_JWT_ISSUER,
    audience: env.AUTH_JWT_AUDIENCE,
    ...(env.AUTH_JIT_PROVISIONING && provisioner ? { provisioner } : {}),
  };
  if (env.AUTH_JWKS_URL) {
    return new JwtAuthenticator(principals, {
      ...common,
      key: createRemoteJWKSet(new URL(env.AUTH_JWKS_URL)),
      algorithms: JWKS_ALGORITHMS,
    });
  }
  return new JwtAuthenticator(principals, {
    ...common,
    key: new TextEncoder().encode(env.AUTH_SECRET),
    algorithms: ['HS256'],
  });
}
