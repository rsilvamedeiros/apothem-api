# knowledge

**Status:** v1 implemented (ADR-014)

Owns knowledge bases, their documents and permission-aware retrieval. A first-class platform domain, not a helper inside agents. Every retrieved passage keeps the identity of its source so an answer can be traced back to authorized evidence.

## What v1 does

- A **knowledge base** belongs to one workspace (`active` or `archived`). A **document** is plain text or Markdown added through the API, normalized and stored with its SHA-256 checksum. Adding identical content to a base again returns the existing document.
- **Chunks** are derived, rebuildable data: a deterministic chunker (`CHUNKER_VERSION`) keeps paragraphs together, records the nearest Markdown heading as `section`, and never exceeds 500 characters.
- **Retrieval** is lexical PostgreSQL full-text search (`simple` configuration, prefix match from 3 characters, OR across at most 12 plain terms, `ts_rank_cd` ranking). The scope is part of the SQL `WHERE`: workspace, bound bases, active base, ready document. Nothing is filtered after ranking.
- Agents reach it through the read-only `search_knowledge` tool plus the `knowledgeBindings` of the **published** version. The model never names bases; the runtime passes the bound ids to the executor. The result is trimmed to fit the tool result limit and re-enters the model as delimited, untrusted data.

## Limits

20 active bases per workspace, 100 documents per base, 100,000 characters per document, 500 passages per document, 3 passages per search, 300-character tool queries.

## Layout

```text
domain/          chunker, safe search terms, knowledge bindings contract (pure)
application/     ports, KnowledgeService, KnowledgeRetriever
infrastructure/  Drizzle schema (migration 0005), repositories, full-text search
presentation/    /v1/organizations/:o/workspaces/:w/knowledge-bases routes
```

## Security notes

- Tenant and workspace come from the authenticated context; a base of another workspace is indistinguishable from a missing one.
- Capabilities: `knowledge.manage` (owner, admin, builder) writes; `knowledge.use` (also operator) reads and searches. Auditors have neither.
- Audit events carry ids, checksums and sizes only (`knowledge_base.created|archived`, `knowledge_document.added|removed`); text and queries are never copied. Run steps keep the evidence (ids, titles) under the run's retention; the public step view omits it.
- Document text is untrusted content. It is stripped of control and bidirectional override characters, stored as text, and never interpreted as instructions.

## Not in v1

Embeddings and pgvector (next, behind an embedding method on the Model Gateway), files and URLs, connector sync, reranking, per-base ACLs, background ingestion.

Reference docs (`apothem-ai/docs/`): `adr/014-knowledge-v1.md`, `03-domain/knowledge.md`, `05-knowledge/knowledge-architecture.md`, `05-knowledge/retrieval-reranking-citations.md`.
