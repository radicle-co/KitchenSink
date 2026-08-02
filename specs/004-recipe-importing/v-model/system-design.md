# System Design: Recipe Importing

**Feature Branch**: `004-recipe-importing`
**Created**: 2026-05-09
**Regenerated**: 2026-08-02
**Status**: Approved for architecture
**Source**: `specs/004-recipe-importing/v-model/requirements.md`
**Standard**: IEEE 1016

> **Regeneration note.** The previous revision decomposed into nine components including an "Attribution &
> Visibility Gate" and a "Clone Service" — both of which **already ship in 001** (`evaluateVisibility` in
> `@kitchensink/recipe-core`, `RecipesService.clone()`). Building them here would have forked the C-004
> visibility rule into two authorities. It also had no component for file import, ingredient-line parsing, or
> normalization, and its Interface View was filled with the placeholder string "Derived — supports cross-cutting
> implementation constraints for traced parent system behavior" in every cell. This revision decomposes the
> **ingestion** scope only, and names real interfaces.

## Overview

Recipe Importing decomposes into thirteen system components. Four are **channel adapters** (URL fetch,
Instagram oEmbed, OCR, file parse) that each turn an external artefact into a common extracted payload. One
**extractor chain** turns fetched HTML into that payload. A **normalization** component turns the payload into
something the shipped schema can actually hold. Three **policy** components (provenance, paywall, dedup) decide
what may be imported and how it is classified. A **draft store** and **job orchestrator** own the asynchronous
lifecycle, and a **confirmation bridge** hands the completed draft to 001's shipped write path. A shared
**import UI** covers web and mobile.

Authentication, attribution storage, visibility enforcement, cloning, error mapping, and rate limiting are
**shipped platform capabilities consumed by this feature**, not components of it.

## ID Schema

- **System Component**: `SYS-NNN` — sequential, never renumbered.
- **Parent Requirements**: comma-separated `REQ-*` list (many-to-many).

## Decomposition View (IEEE 1016 §5.1)

| SYS ID  | Name                       | Description                                                                                                                                                                                                                                                                                                       | Parent Requirements                                                                      | Type      |
| ------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------- |
| SYS-001 | Source Fetcher             | Performs the bounded, SSRF-guarded outbound HTTP GET: scheme check, DNS resolution with private-range rejection, connection pinning, timeout, redirect cap with per-hop re-validation, response-size cap, and content-type restriction. Wrapped in a per-domain circuit breaker.                                  | REQ-001, REQ-018, REQ-024, REQ-NF-007, REQ-NF-008, REQ-NF-009, REQ-030                   | Service   |
| SYS-002 | Extractor Chain            | Runs the ordered extractor Strategy set (JSON-LD → microdata → heuristic HTML) over fetched markup, returning the first non-null `ExtractedRecipe` with a per-field confidence, or null when nothing matches.                                                                                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | Subsystem |
| SYS-003 | Instagram oEmbed Adapter   | Calls the Meta-hosted oEmbed endpoint with an application credential, extracts caption text, and rejects posts with no recipe text. Disabled by default behind a capability flag.                                                                                                                                 | REQ-005, REQ-IF-001, REQ-CN-004                                                          | Adapter   |
| SYS-004 | OCR Pipeline               | Accepts an uploaded photograph, stores it, submits it to the OCR provider behind the `OcrProvider` port, and returns extracted raw text. Owns the source-image lifecycle including deletion.                                                                                                                      | REQ-007, REQ-026, REQ-IF-002, REQ-035                                                    | Service   |
| SYS-005 | File Parser                | Determines file type by magic-byte inspection and parses JSON, YAML, or Markdown-with-frontmatter into an `ExtractedRecipe`.                                                                                                                                                                                      | REQ-006, REQ-033                                                                         | Service   |
| SYS-006 | Normalizer                 | Converts an `ExtractedRecipe` into a persistable shape: ingredient lines → structured quantity/unit/name (raw retained), ISO-8601 durations → minutes, free-text servings → integer, and sanitization of all text. Computes `missingRequired`.                                                                    | REQ-008, REQ-009, REQ-011, REQ-012, REQ-NF-010                                           | Module    |
| SYS-007 | Provenance Classifier      | Pure policy mapping (channel, attestation, citation reachability) → `sourceType`. Owns the D-003 attestation rule and the secondary heuristic flag.                                                                                                                                                               | REQ-014, REQ-021, REQ-022, REQ-023, REQ-CN-003, REQ-031, REQ-032, REQ-035                | Module    |
| SYS-008 | Paywall Blocklist          | Stores and serves the blocklist as data with an admin-scoped CRUD surface and audit trail; matches by exact host or registrable suffix. Consulted before every fetch and on every redirect hop.                                                                                                                   | REQ-017, REQ-018, REQ-019, REQ-020, REQ-030                                              | Service   |
| SYS-009 | Deduplication Guard        | Canonicalizes a source URL, looks up an existing non-deleted recipe, and relies on the partial unique index as the authoritative race-safe guarantee.                                                                                                                                                             | REQ-003, REQ-004, REQ-CN-001, REQ-CN-002, REQ-033, REQ-034                               | Module    |
| SYS-010 | Import Draft Store         | Owns the `import_drafts` lifecycle (`open → confirmed \| expired`), owner-scoped reads, user corrections, and expiry sweeping., REQ-027                                                                                                                                                                           | REQ-012, REQ-026, REQ-027                                                                | Service   |
| SYS-011 | Import Job Orchestrator    | Owns the `import_jobs` lifecycle for the asynchronous channels, idempotency-key handling, the fixed pipeline sequence, and typed failure recording.                                                                                                                                                               | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | Subsystem |
| SYS-012 | Draft Confirmation Bridge  | Validates a draft against the shipped `CreateRecipeRequest` contract and creates the recipe through 001's shipped write path, delegating visibility to `evaluateVisibility` and ingredient resolution to the food client.                                                                                         | REQ-010, REQ-013, REQ-015, REQ-IF-003, REQ-IF-005, REQ-CN-007, REQ-031, REQ-033, REQ-034 | Subsystem |
| SYS-015 | Contract & Quality Gates   | Cross-cutting verification mechanism: the published API contract plus the CI gates that enforce type safety, documented exports, path conventions, and mutation thresholds. Realised as pipeline gates rather than runtime code — listed as a component so these requirements are traceable rather than orphaned. | REQ-IF-006, REQ-NF-001, REQ-NF-002, REQ-NF-013, REQ-CN-009                               | Utility   |
| SYS-014 | Auth Enforcement (shipped) | The shipped Clerk session-token middleware guarding every import endpoint. Listed as a component so `REQ-IF-004` is traceable; **implemented by 002, not by 004** — 004 consumes it unchanged.                                                                                                                    | REQ-IF-004                                                                               | Utility   |
| SYS-013 | Import UI                  | Shared web + mobile surface: channel entry, job progress, draft review and completion, attribution display, and typed error recovery. Copy is localized and shared across platforms.                                                                                                                              | REQ-016, REQ-025, REQ-NF-004, REQ-NF-005, REQ-NF-006, REQ-CN-008                         | Component |

**Consumed, not built** (shipped in 001/002 — listed so the decomposition is honest about its boundary):
Clerk session-token middleware (`REQ-IF-004`), `evaluateVisibility` C-004 policy, `RecipesService.clone()`,
`ApiExceptionFilter` + `RecipeErrorCode`, `@nestjs/throttler`, and the OpenAPI contract + typed client
(`REQ-IF-006`).

## Dependency View (IEEE 1016 §5.2)

| Source  | Target  | Relationship | Failure impact                                                                                                                  |
| ------- | ------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| SYS-011 | SYS-008 | Calls        | Blocklist not consulted → paid content fetched. **Hard-fail**: a blocklist error must abort the import., REQ-029, REQ-NF-011    |
| SYS-011 | SYS-001 | Calls        | No fetch → URL/Instagram imports fail with a typed error., REQ-029, REQ-NF-011                                                  |
| SYS-001 | SYS-008 | Calls        | Per-redirect re-check lost → redirect bypasses the blocklist., REQ-030                                                          |
| SYS-011 | SYS-002 | Calls        | No extraction → `IMPORT_NO_RECIPE_FOUND`., REQ-029, REQ-NF-011                                                                  |
| SYS-011 | SYS-003 | Calls        | Instagram channel unavailable; no other channel affected (D-002)., REQ-029, REQ-NF-011                                          |
| SYS-011 | SYS-004 | Calls        | OCR channel unavailable; source image must still be cleaned up., REQ-029, REQ-NF-011                                            |
| SYS-011 | SYS-005 | Calls        | File channel unavailable., REQ-029, REQ-NF-011                                                                                  |
| SYS-011 | SYS-006 | Calls        | Unnormalized payload cannot be persisted. **Hard-fail.**, REQ-029, REQ-NF-011                                                   |
| SYS-011 | SYS-007 | Calls        | Provenance unclassified → visibility policy cannot be applied. **Hard-fail** (never default to public)., REQ-029, REQ-NF-011    |
| SYS-011 | SYS-009 | Calls        | Duplicate check skipped; the unique index still prevents a duplicate, surfacing as a constraint violation., REQ-029, REQ-NF-011 |
| SYS-011 | SYS-010 | Writes       | Draft not stored → import result lost after the job completes., REQ-029, REQ-NF-011                                             |
| SYS-013 | SYS-010 | Reads/Writes | User cannot review or correct a draft.                                                                                          |
| SYS-012 | SYS-010 | Reads        | Cannot confirm; no recipe created., REQ-031, REQ-033, REQ-034                                                                   |
| SYS-012 | SYS-009 | Uses         | Relies on the unique index at insert as the final dedup authority., REQ-031, REQ-033, REQ-034                                   |
| SYS-013 | SYS-011 | Calls        | User cannot start an import or observe progress.                                                                                |

### Dependency Diagram

```text
                         [Client: web / mobile]
                                   │
                       SYS-013 Import UI
                                   │
                  (shipped Clerk auth middleware)
                                   │
                    SYS-011 Import Job Orchestrator
                                   │
      ┌────────────┬───────────────┼───────────────┬──────────────┐
      ▼            ▼               ▼               ▼              ▼
 SYS-008       SYS-001         SYS-003         SYS-004        SYS-005
 Blocklist  Source Fetcher   Instagram       OCR Pipeline   File Parser
      ▲            │          (gated)              │              │
      └── per-hop ─┘               │               │              │
                   │               │               │              │
                   ▼               │               │              │
              SYS-002 Extractor Chain              │              │
                   └───────────────┴───────────────┴──────────────┘
                                   │
                          SYS-006 Normalizer
                                   │
                     SYS-007 Provenance Classifier
                                   │
                      SYS-009 Deduplication Guard
                                   │
                     SYS-010 Import Draft Store
                                   │  (user reviews via SYS-013)
                                   ▼
                  SYS-012 Draft Confirmation Bridge
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
   001 shipped write path                    003 food catalog
   (+ evaluateVisibility C-004)              (async resolution)
```

## Interface View (IEEE 1016 §5.3)

### External Interfaces

| Component | Interface                                                | Protocol | Input                                     | Output                      | Errors                                                           |
| --------- | -------------------------------------------------------- | -------- | ----------------------------------------- | --------------------------- | ---------------------------------------------------------------- |
| SYS-011   | `POST /api/v1/recipes/import/url`                        | REST     | `{ url }` + `Idempotency-Key`             | `202 { jobId }`             | `400` invalid URL · `401` · `422` blocked/unreachable · `429`    |
| SYS-011   | `POST /api/v1/recipes/import/instagram`                  | REST     | `{ url }` + `Idempotency-Key`             | `202 { jobId }`             | `401` · `404` when the capability flag is off · `422` no caption |
| SYS-011   | `POST /api/v1/recipes/import/file`                       | REST     | `multipart/form-data`                     | `201 { draftId }`           | `413` too large · `415` unsupported format                       |
| SYS-011   | `POST /api/v1/recipes/import/photo`                      | REST     | `multipart/form-data` + `Idempotency-Key` | `202 { jobId }`             | `413` · `415` · `422` OCR failed · `503` provider unavailable    |
| SYS-011   | `GET /api/v1/recipes/import/jobs/{id}`                   | REST     | job id                                    | `200` job state → `draftId` | `404` absent or not the caller's                                 |
| SYS-010   | `GET /api/v1/recipes/import/drafts/{id}`                 | REST     | draft id                                  | `200 ImportDraft`           | `404` · `410` expired                                            |
| SYS-010   | `PATCH /api/v1/recipes/import/drafts/{id}`               | REST     | partial draft corrections                 | `200 ImportDraft`           | `404` · `410` · `422` invalid correction                         |
| SYS-012   | `POST /api/v1/recipes/import/drafts/{id}/confirm`        | REST     | draft id                                  | `201 RecipeResponse`        | `404` · `410` · `422` incomplete draft                           |
| SYS-010   | `DELETE /api/v1/recipes/import/drafts/{id}`              | REST     | draft id                                  | `204`                       | `404`                                                            |
| SYS-011   | `GET /api/v1/recipes/import/sources`                     | REST     | —                                         | `200` enabled channels      | `401`                                                            |
| SYS-008   | `GET/POST/DELETE /api/v1/admin/import/paywalled-domains` | REST     | domain + reason (admin scope)             | `200`/`201`/`204`           | `403` without the admin scope                                    |
| SYS-003   | Meta oEmbed endpoint                                     | HTTPS    | post URL + app credential                 | caption text                | `503` on provider failure · rate-limit classified explicitly     |
| SYS-004   | AWS Textract                                             | AWS SDK  | image object                              | raw text + confidence       | `503` on provider failure or timeout                             |
| SYS-012   | food-service client                                      | HTTPS    | parsed ingredient names                   | resolution ids/status       | Degrades: unresolved ingredients do not block confirmation       |

### Internal Interfaces

| Source  | Target  | Interface                                                                | Data                                                                          | Errors                                                  |
| ------- | ------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| SYS-011 | SYS-001 | `fetchSource(url): FetchedDocument`                                      | `CanonicalSourceUrl` → `{ body, contentType, finalUrl }`, REQ-029, REQ-NF-011 | `SourceUnreachable`, `SourceBlocked`, `PayloadTooLarge` |
| SYS-001 | SYS-008 | `assertNotBlocked(host): void`                                           | host → void, REQ-030                                                          | `SourceBlocked`                                         |
| SYS-011 | SYS-002 | `extract(document): ExtractedRecipe \| null`, REQ-029, REQ-NF-011        | markup → extracted payload + confidence                                       | never throws; null means no match                       |
| SYS-011 | SYS-003 | `fetchCaption(url): ExtractedRecipe`                                     | post URL → extracted payload, REQ-029, REQ-NF-011                             | `NoCaption`, `ProviderUnavailable`                      |
| SYS-011 | SYS-004 | `extractText(objectKey): OcrText`                                        | S3 key → raw text, REQ-029, REQ-NF-011                                        | `OcrFailed`, `ProviderUnavailable`                      |
| SYS-011 | SYS-005 | `parseFile(bytes): ExtractedRecipe`                                      | bytes → extracted payload, REQ-029, REQ-NF-011                                | `UnsupportedFormat`                                     |
| SYS-011 | SYS-006 | `normalize(extracted): NormalizedDraft`                                  | extracted → persistable + `missingRequired[]`, REQ-029, REQ-NF-011            | pure; no throw                                          |
| SYS-011 | SYS-007 | `classify(channel, attestation): SourceType`                             | pure inputs → `sourceType`, REQ-029, REQ-NF-011                               | pure; total function                                    |
| SYS-011 | SYS-009 | `findExisting(canonicalUrl): RecipeSummary \| null`, REQ-029, REQ-NF-011 | canonical URL → existing recipe                                               | `DatabaseError`                                         |
| SYS-011 | SYS-010 | `createDraft(...)`, `expireDue()`                                        | normalized draft → stored draft, REQ-029, REQ-NF-011                          | `DatabaseError`                                         |
| SYS-012 | SYS-010 | `loadForOwner(id, ownerId): ImportDraft`                                 | id + owner → draft, REQ-031, REQ-033, REQ-034                                 | `DraftNotFound`, `DraftExpired`                         |
| SYS-012 | 001     | `RecipesService.create(principal, CreateRecipeRequest)`                  | validated request → recipe, REQ-031, REQ-033, REQ-034                         | shipped recipe-domain errors                            |

## Data Design View (IEEE 1016 §5.4)

| Entity                | Component | Storage           | At rest         | In transit   | Retention                                                 |
| --------------------- | --------- | ----------------- | --------------- | ------------ | --------------------------------------------------------- |
| `import_jobs` row     | SYS-011   | PostgreSQL        | RDS encryption  | TLS (pg SSL) | Pruned after a bounded window; carries no recipe content  |
| `import_drafts` row   | SYS-010   | PostgreSQL        | RDS encryption  | TLS (pg SSL) | Deleted at `expires_at` or on confirm/discard (REQ-026)   |
| OCR source image      | SYS-004   | S3                | SSE             | TLS          | Deleted no later than draft expiry (REQ-026)              |
| `paywalled_domains`   | SYS-008   | PostgreSQL        | RDS encryption  | TLS (pg SSL) | Retained; audit trail is the point                        |
| Fetched document body | SYS-001   | In-memory, capped | N/A (transient) | TLS          | Discarded after extraction. **Never logged** (REQ-NF-012) |
| OCR extracted text    | SYS-004   | In-memory         | N/A (transient) | TLS          | Written to the draft only. **Never logged** (REQ-NF-012)  |
| Recipe                | 001       | PostgreSQL        | RDS encryption  | TLS (pg SSL) | 001's shipped retention and erasure rules apply unchanged |
| Meta app credential   | SYS-003   | SSM/Secrets       | KMS             | TLS          | Rotated; never logged or returned                         |

## Requirements Coverage Matrix

| REQ ID     | Covered by                  | REQ ID     | Covered by                |
| ---------- | --------------------------- | ---------- | ------------------------- |
| REQ-001    | SYS-001, SYS-002            | REQ-021    | SYS-007, SYS-013          |
| REQ-002    | SYS-002                     | REQ-022    | SYS-007                   |
| REQ-003    | SYS-009                     | REQ-023    | SYS-007                   |
| REQ-004    | SYS-009, SYS-012            | REQ-024    | SYS-011                   |
| REQ-005    | SYS-003                     | REQ-025    | SYS-013                   |
| REQ-006    | SYS-005                     | REQ-026    | SYS-004, SYS-010          |
| REQ-007    | SYS-004                     | REQ-027    | SYS-010, SYS-011          |
| REQ-008    | SYS-006                     | REQ-028    | SYS-011                   |
| REQ-009    | SYS-006                     | REQ-NF-001 | all (inspection)          |
| REQ-010    | SYS-012                     | REQ-NF-002 | all (inspection)          |
| REQ-011    | SYS-006                     | REQ-NF-003 | SYS-002                   |
| REQ-012    | SYS-006, SYS-010            | REQ-NF-004 | SYS-013                   |
| REQ-013    | SYS-012                     | REQ-NF-005 | SYS-013                   |
| REQ-014    | SYS-007                     | REQ-NF-006 | SYS-013                   |
| REQ-015    | SYS-012                     | REQ-NF-007 | SYS-001                   |
| REQ-016    | SYS-013                     | REQ-NF-008 | SYS-001                   |
| REQ-017    | SYS-008                     | REQ-NF-009 | SYS-001                   |
| REQ-018    | SYS-001, SYS-008            | REQ-NF-010 | SYS-006                   |
| REQ-019    | SYS-008                     | REQ-NF-011 | SYS-011                   |
| REQ-020    | SYS-008                     | REQ-NF-012 | SYS-001, SYS-004, SYS-011 |
| REQ-IF-001 | SYS-003                     | REQ-CN-001 | SYS-009                   |
| REQ-IF-002 | SYS-004                     | REQ-CN-002 | SYS-009                   |
| REQ-IF-003 | SYS-012                     | REQ-CN-003 | SYS-007                   |
| REQ-IF-004 | _shipped 002 middleware_    | REQ-CN-004 | SYS-003                   |
| REQ-IF-005 | SYS-012                     | REQ-CN-005 | SYS-002                   |
| REQ-IF-006 | _shipped contract + client_ | REQ-CN-006 | SYS-002                   |
|            |                             | REQ-CN-007 | SYS-012 (inspection, all) |
|            |                             | REQ-CN-008 | SYS-013                   |

## Coverage Summary

| Metric                                                  | Count                      |
| ------------------------------------------------------- | -------------------------- |
| Total system components (SYS)                           | 13                         |
| Total requirements                                      | 62                         |
| Requirements covered by a 004 component                 | 53                         |
| Requirements satisfied by a shipped platform capability | 2 (REQ-IF-004, REQ-IF-006) |
| Uncovered requirements                                  | 0                          |
