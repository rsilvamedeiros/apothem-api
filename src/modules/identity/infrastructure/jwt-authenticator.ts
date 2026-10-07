import { jwtVerify, type CryptoKey, type JWTVerifyGetKey, type KeyObject } from 'jose';
import type { AuthenticationPort } from '../application/authentication.port.js';
import type { AuthenticatedPrincipal } from '../application/principal.js';
import type { PrincipalReaderPort } from '../application/principal-reader.port.js';
import type { PrincipalProvisionerPort } from '../application/principal-provisioner.js';

export interface JwtAuthenticatorConfig {
  readonly issuer: string;
  readonly audience: string;
  /** Shared secret bytes (HS256) or a key resolver such as a remote/local JWKS. */
  readonly key: Uint8Array | CryptoKey | KeyObject | JWTVerifyGetKey;
  /** Explicit allow list. Never derived from the token header, which prevents algorithm confusion. */
  readonly algorithms: readonly string[];
  /** When set, a verified email without an account gets one (sign-up). Leave unset to admit existing accounts only. */
  readonly provisioner?: PrincipalProvisionerPort;
}

/** Small tolerance for clock drift between the identity provider and this API. */
const CLOCK_TOLERANCE_SECONDS = 5;

/**
 * Verifies a signed bearer token (self-hosted OIDC per ADR-009/ADR-012) and
 * maps it to an existing, active principal by verified email.
 *
 * Fails closed: any problem (signature, expiry, issuer, audience, algorithm,
 * missing or unverified claims, unknown or suspended account) yields `null`
 * and never throws, so callers answer 401 without leaking why.
 */
export class JwtAuthenticator implements AuthenticationPort {
  readonly credentialSource = 'bearer' as const;

  constructor(
    private readonly principals: PrincipalReaderPort,
    private readonly config: JwtAuthenticatorConfig,
  ) {}

  async authenticate(credential: string | undefined): Promise<AuthenticatedPrincipal | null> {
    if (!credential) {
      return null;
    }

    try {
      // jose treats a function as a key resolver and anything else as a key.
      const { payload } = await jwtVerify(credential, this.config.key as never, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: [...this.config.algorithms],
        requiredClaims: ['exp', 'sub'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });

      const { sub, email, email_verified: emailVerified } = payload;
      if (typeof sub !== 'string' || sub.length === 0) return null;
      if (typeof email !== 'string' || email.length === 0) return null;
      // Only a provider-verified address may be matched to an account.
      if (emailVerified !== true) return null;

      const existing = await this.principals.findByEmail(email);
      if (existing) return existing;
      if (!this.config.provisioner) return null;

      return (await this.config.provisioner.provision({ email, name: typeof payload.name === 'string' ? payload.name : undefined })) ?? null;
    } catch {
      return null;
    }
  }
}
