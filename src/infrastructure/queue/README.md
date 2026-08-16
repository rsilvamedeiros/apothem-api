# infrastructure/queue

**Status:** Placeholder — no code yet

Redis + BullMQ job producers/consumers, kept behind an abstraction so the underlying queue technology can change without touching module code. Expected queues: `agent.run`, `knowledge.ingest`, `knowledge.embed`, `connector.sync`, `workflow.execute`, `tool.execute`.

Reference: `apothem-ai/architecture.md` §32, `apothem-ai/docs/adr/009-zero-cost-initial-stack.md`.
