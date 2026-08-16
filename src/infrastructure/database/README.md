# infrastructure/database

**Status:** Placeholder — no code yet

PostgreSQL + pgvector connection/pooling, Drizzle ORM setup, migration runner wiring. Implements repository ports defined by modules — modules must not import a raw DB client directly.

Stack: PostgreSQL + pgvector (`apothem-ai/docs/adr/003-postgresql-pgvector.md`), Drizzle ORM (`apothem-ai/docs/adr/009-zero-cost-initial-stack.md`).
