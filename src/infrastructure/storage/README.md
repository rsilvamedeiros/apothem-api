# infrastructure/storage

**Status:** Placeholder — no code yet

S3-compatible object storage adapter for large files (PDF/DOCX/XLSX/etc.) referenced by Knowledge sources. Large files are never stored directly in PostgreSQL — only metadata.

Stack: MinIO locally, Cloudflare R2 free tier remotely (`apothem-ai/docs/adr/009-zero-cost-initial-stack.md`).
