# Contract: Portability (FR-016…FR-020)

**Owner service**: `packages/services/recipe-service`

⚠️ **Reuse, not new build (R-02).** `GET /api/v1/account/export` already ships a zod-contracted GDPR
Art. 15/20 export — `account.schema.ts`, `export.service.ts`, `export.dal.ts`, `export.mappers.ts` — covering
`RecipeExport`, `CollectionExport`, `CollectionMembershipExport`, `PhotoExport`, `RatingExport`,
`VersionExport`, `AuthorHandleExport`. **That document is the machine-readable export format.** This feature
adds a product surface, a renderer, and — the actual gap — an importer.

## Endpoints

| Method  | Path                                     | Purpose                               | FR                     | Status          |
| ------- | ---------------------------------------- | ------------------------------------- | ---------------------- | --------------- |
| `GET`   | `/api/v1/account/export`                 | Lossless machine-readable library     | FR-018                 | **Ships today** |
| `GET`   | `/api/v1/recipes/export?format=document` | Human-readable document               | FR-019                 | New             |
| Not set | ⚠️ **Open question OQ-P1** (below)       | Import a competitor or Commise export | FR-016, FR-017, FR-020 | New             |

## ⚠️ Open question OQ-P1: the URL for library migration (owner to confirm)

The route `/api/v1/recipes/migrations` that this contract used to propose is withdrawn (owner ruling, 2026-10-26).
Bulk recipe import already uses **`/api/v1/import`** ([ADR-0072](../../../docs/architecture/decisions/0072-bulk-recipe-import.md)
§1): `POST /api/v1/import` creates an import, `GET /api/v1/import/{importId}` reads it, and
`POST /api/v1/import/{importId}/advance` moves it on.

**The owner must confirm the URL for this feature's library migration.** Two answers are possible:

1. Library migration IS bulk import, so it uses `/api/v1/import` and ADR-0072's resource. `sourceApp` and the
   per-item outcome below then become fields of that resource.
2. Library migration is a separate resource, and the owner names its URL.

Until the owner answers, no migration route is built. Whatever the answer, ADR-0072's rules hold for every recipe a
migration saves: a per-recipe source statement with a citation, the bulk allowance of 1,000 recipes a rolling day, and one
draft per recipe.

## Migration response

The shape below stands whatever OQ-P1 decides.

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
