# Contract: Portability (FR-016…FR-020)

**Owner service**: `packages/services/recipe-service`

⚠️ **Reuse, not new build (R-02).** `GET /api/v1/account/export` already ships a zod-contracted GDPR
Art. 15/20 export — `account.schema.ts`, `export.service.ts`, `export.dal.ts`, `export.mappers.ts` — covering
`RecipeExport`, `CollectionExport`, `CollectionMembershipExport`, `PhotoExport`, `RatingExport`,
`VersionExport`, `AuthorHandleExport`. **That document is the machine-readable export format.** This feature
adds a product surface, a renderer, and — the actual gap — an importer.

## Endpoints

| Method | Path                                     | Purpose                               | FR                     | Status          |
| ------ | ---------------------------------------- | ------------------------------------- | ---------------------- | --------------- |
| `GET`  | `/api/v1/account/export`                 | Lossless machine-readable library     | FR-018                 | **Ships today** |
| `GET`  | `/api/v1/recipes/export?format=document` | Human-readable document               | FR-019                 | New             |
| `POST` | `/api/v1/recipes/migrations`             | Import a competitor or Commise export | FR-016, FR-017, FR-020 | New             |
| `GET`  | `/api/v1/recipes/migrations/{id}`        | Per-item outcome + restart position   | FR-017                 | New             |

## Migration response

```text
{
  id: string
  sourceApp: 'paprika'|'anylist'|'copymethat'|'recime'|'commise'
  total: number
  processed: number
  items: Array<{ ordinal: number; outcome: 'imported'|'skipped'|'failed'; detail: string|null }>
}
```

## Invariants

1. **Partial success is preserved** — a failed item never discards imported ones (FR-017).
2. **Restartable without duplication** from `processed` (FR-017).
3. `sourceApp: 'commise'` is the **round-trip importer**. Until it exists, nothing proves the shipped export
   is lossless — which is what SC-005 actually measures.
4. Migrated recipes carry provenance and attestation like any other import (`004-FR-014a`, `016-FR-014`).
   ⛔ Bulk migration is **not** a side door around provenance, and cannot declare `imported_public` without
   the grant ADR-0023 requires.
5. **No third-party photo bytes are copied** on migration (`016-FR-027`); images are referenced or omitted.
6. Export is available on **every tier** (Assumption 4) — but note `ExportRateLimit` is deliberately the
   tightest cap in the service, sized for a privacy request. Re-tuning it for a routine action is part of
   FR-018 and must not weaken the erasure-path protection it also guards.
