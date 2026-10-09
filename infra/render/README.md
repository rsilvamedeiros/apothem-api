# infra/render

**Status:** Ready to deploy once the accounts and secrets exist (ADR-010). Nothing here has been deployed yet.

Deploy configuration for the API on Render, with Supabase as the database. The full step-by-step, including the web app on Vercel, is the runbook in `apothem-ai/docs/15-infrastructure/deploy-runbook.md`.

## Files

- `render.yaml` - the Render Blueprint: one Docker web service, `/health` as the health check, non-secret settings as values, secrets as `sync: false` (typed once in the dashboard).
- `env.production.example` - every variable production needs, with fake placeholders. `src/infrastructure/http/deploy-config.test.ts` checks that it, `render.yaml`, the Dockerfile and `package.json` agree with the code.
- `../../Dockerfile` - multi-stage image, production dependencies only, non-root, `npm run start:prod`.

## How it starts

`npm run start:prod` applies pending migrations, then starts the server. That is safe because this stack runs one instance (free Render plan). If a second instance is ever added, move the migration to a deploy step first, or two instances could migrate at once.

`/health` is liveness only (no database), so a database outage does not restart the service in a loop; `/ready` also checks the database.

## What each secret is

| Variable | Where it comes from | Rule |
|---|---|---|
| `DATABASE_URL` | Supabase, Connect, **Transaction pooler** (port 6543), with `?sslmode=require` | Prepared statements stay off (`DATABASE_PREPARED_STATEMENTS=false`) |
| `AUTH_SECRET` | `openssl rand -base64 48` | 32+ characters; the web app signs the API token with the same value |
| `AUTH_JWT_ISSUER` | the web app's public URL | must equal the web app's `APOTHEM_API_TOKEN_ISSUER` |
| `ANTHROPIC_API_KEY` | optional | unset keeps the mock model (no cost) |

## Checks

- Before pushing: `npm run build && npm run smoke:prod` boots the built output as production does (also run in CI).
- After a deploy: `GET /health` returns 200, `GET /ready` returns 200 (database reachable), and a request with `x-principal-id` but no token returns 401.

## Not verified yet

The Docker image has not been built in this repository's CI or on a machine with Docker; `smoke:prod` covers the same compiled output. Build it once before the first deploy: `docker build -t apothem-api .`.
