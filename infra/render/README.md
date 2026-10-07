# infra/render

**Status:** Placeholder — no `render.yaml` yet

Render deploy configuration for the backend (API), per `apothem-ai/docs/adr/010-hosting-render-supabase-vercel.md`. The database is Supabase Postgres (connect through the pooler, prepared statements disabled with transaction pooling). Secrets (`DATABASE_URL`, provider keys) live only in Render environment settings.
