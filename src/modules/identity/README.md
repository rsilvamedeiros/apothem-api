# identity

**Status:** Implemented - principals, dev header authenticator and strict JWT bearer authentication

Owns user/principal identity and how a request proves it. Not authorization/permissions (see `../authorization`), not organization membership (see `../organizations`). Decision record: `apothem-ai/docs/adr/012-authentication-signed-bearer-tokens.md`.

## Authenticators (`AuthenticationPort`)

- `JwtAuthenticator` (`AUTH_MODE=jwt`): verifies `Authorization: Bearer <token>`. Checks signature, required `exp` and `sub`, issuer, audience, an explicit algorithm allow list and a 5 second clock tolerance, then maps the verified email (`email_verified === true`, case-insensitive) to an existing active principal. Any failure returns `null` (generic 401). Keys: `AUTH_SECRET` (at least 32 characters, HS256) or `AUTH_JWKS_URL` (RS256/ES256).
- `DevHeaderAuthenticator` (`AUTH_MODE=dev`): trusts an `x-principal-id` header. Local development and tests only; `loadEnv` refuses `NODE_ENV=production` unless `AUTH_MODE=jwt`.
- The transport reads the credential from the source each authenticator declares (`credentialSource`). The two sources are exclusive: in `jwt` mode the dev header is never read.

## Rules enforced (and tested)

- Production cannot boot with the dev authenticator; jwt mode requires issuer, audience and a strong key.
- Tampered, expired, unsigned (`alg: none`), wrong-issuer, wrong-audience, wrong-key, wrong-algorithm, unverified-email and unknown-account tokens are all rejected, with no hint of the reason in the response.
- A suspended account is rejected on the next request.
- Authorization is unchanged: tokens carry identity only.

## Local use

```bash
# .env: AUTH_MODE=jwt, AUTH_JWT_ISSUER, AUTH_JWT_AUDIENCE, AUTH_SECRET (32+ chars)
npm run auth:dev-token -- someone@example.com   # prints a 1 hour HS256 token for an existing account
curl -H "Authorization: Bearer <token>" http://localhost:3001/v1/organizations/<id>
```

## Known gaps

- No token issuer yet (Auth.js or another OIDC server must sign tokens), no refresh, no token deny list (use short lifetimes), no just-in-time provisioning.

Reference docs (`apothem-ai/docs/`):
- `03-domain/users-memberships.md`
- `08-security/authentication-authorization-rbac.md`