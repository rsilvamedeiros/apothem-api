# workers/ai

**Status:** Placeholder — no code yet

Long-running job consumers for agent runs, knowledge ingestion/embedding and (later) workflow execution. Horizontally scalable, stateless between steps except for persisted execution state — a worker process dying must trigger retry/recovery, never silent loss of a run.

Reference: `apothem-ai/docs/02-architecture/architecture-overview.md` ("AI worker/runtime"), `apothem-ai/docs/02-architecture/background-jobs.md`.
