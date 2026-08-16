# infrastructure/secrets

**Status:** Placeholder — no code yet

Encryption boundary for external credentials (API keys, OAuth tokens, database credentials for Connect). Raw secrets must never be stored in normal application tables or logged in plaintext. Designed to allow a future migration to AWS Secrets Manager/Vault/KMS without changing calling code.

Reference docs (`apothem-ai/docs/`):
- `08-security/secrets-encryption.md`
- `06-connect/credentials-oauth.md`
