# System Design: Recipe Importing

**Feature Branch**: `004-recipe-importing`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/004-recipe-importing/v-model/requirements.md`

## Overview

Recipe Importing decomposes into six system components: a URL-based web scraper, an Instagram oEmbed adapter, a physical-copy OCR pipeline, a shared attribution and visibility enforcement layer, a deduplication guard, and a recipe persistence adapter that bridges to the 001 Recipe entity model. Cross-cutting concerns (authentication enforcement, paywall blocking, type safety) are handled by dedicated utility components.

## ID Schema

- **System Component**: `SYS-NNN` — sequential identifier for each component
- **Parent Requirements**: Comma-separated `REQ-NNN` list per component (many-to-many)
- Example: `SYS-003` with Parent Requirements `REQ-001, REQ-005` — component satisfies both requirements

## Decomposition View (IEEE 1016 §5.1)

| SYS ID  | Name                          | Description                                                                                                                                                                                                                                            | Parent Requirements                                  | Type      |
| ------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | --------- |
| SYS-001 | Web URL Extractor             | Fetches a public recipe URL, parses structured recipe data (title, ingredients, instructions, photos) using schema.org/Recipe markup and heuristic fallback, and returns a normalised RecipeImportPayload.                                             | REQ-001, REQ-014                                     | Service   |
| SYS-002 | Instagram oEmbed Adapter      | Calls Instagram's public oEmbed API for a given post URL, extracts caption text, validates that recipe content is present, and returns a normalised RecipeImportPayload. Rejects video-only or image-only posts without text.                          | REQ-002, REQ-003, REQ-IF-001                         | Adapter   |
| SYS-003 | OCR Physical Copy Pipeline    | Accepts a photo upload, submits it to an OCR/text extraction service, returns raw extracted text, and presents it to the user for review and correction before producing a RecipeImportPayload.                                                        | REQ-009, REQ-011, REQ-IF-002                         | Service   |
| SYS-004 | Attribution & Visibility Gate | Enforces attribution rules (source URL, original author, platform) and visibility rules (public for web/Instagram imports, private for physical copies). Enforces the clone-and-edit rule for premium users.                                           | REQ-004, REQ-005, REQ-006, REQ-007, REQ-010, REQ-013 | Module    |
| SYS-005 | Deduplication Guard           | Checks whether a recipe with the same source URL already exists in the database before persisting a new import. Surfaces the existing public recipe and offers a clone option when a duplicate is detected.                                            | REQ-008, REQ-CN-001                                  | Module    |
| SYS-006 | Paywall Blocklist Enforcer    | Maintains and consults a blocklist of known paywalled recipe domains. Rejects import attempts from blocked sources with a user-facing explanation. Flags manually entered paid-source recipes to prevent public visibility.                            | REQ-012, REQ-013, REQ-CN-002                         | Module    |
| SYS-007 | Recipe Persistence Adapter    | Persists a validated RecipeImportPayload as a Recipe entity conforming to the 001-commise-recipe-app schema. Handles Instagram source-deletion edge case by preserving the record with an updated attribution note.                                    | REQ-IF-003, REQ-015                                  | Adapter   |
| SYS-008 | Auth Enforcement Middleware   | Verifies the Clerk session token on all import endpoints via the 002-user-auth `AuthMiddleware` (networkless `verifyToken` with `CLERK_JWT_KEY` + `azp` enforcement). Rejects unauthenticated requests with HTTP 401 before any import logic executes. | REQ-IF-004                                           | Utility   |
| SYS-009 | Import Orchestrator           | Coordinates the end-to-end import flow: routes requests to the correct extractor (SYS-001/002/003), invokes SYS-006 (paywall check), SYS-005 (deduplication), SYS-004 (attribution/visibility), and SYS-007 (persistence).                             | REQ-001, REQ-002, REQ-009, REQ-NF-001, REQ-NF-002    | Subsystem |

## Dependency View (IEEE 1016 §5.2)

| Source  | Target  | Relationship | Failure Impact                                                                 |
| ------- | ------- | ------------ | ------------------------------------------------------------------------------ |
| SYS-009 | SYS-001 | Calls        | Web URL imports fail; orchestrator returns error to caller                     |
| SYS-009 | SYS-002 | Calls        | Instagram imports fail; orchestrator returns error to caller                   |
| SYS-009 | SYS-003 | Calls        | Physical copy imports fail; orchestrator returns error to caller               |
| SYS-009 | SYS-006 | Calls        | Paywall check skipped; risk of accepting blocked sources — must be hard-fail   |
| SYS-009 | SYS-005 | Calls        | Deduplication skipped; duplicate public recipes may be created                 |
| SYS-009 | SYS-004 | Calls        | Attribution/visibility not enforced; legal compliance risk — must be hard-fail |
| SYS-009 | SYS-007 | Calls        | Recipe not persisted; import appears to succeed but data is lost               |
| SYS-009 | SYS-008 | Uses         | All import requests pass unauthenticated; security breach                      |
| SYS-004 | SYS-007 | Writes       | Visibility metadata not stored; attribution rules not persisted                |
| SYS-005 | SYS-007 | Reads        | Cannot check for duplicates; deduplication fails                               |

### Dependency Diagram

```text
[Client Request]
      │
      ▼
  SYS-008 (Auth Enforcement Middleware)
      │ authenticated
      ▼
  SYS-009 (Import Orchestrator)
      ├──► SYS-006 (Paywall Blocklist Enforcer)
      ├──► SYS-001 (Web URL Extractor)
      ├──► SYS-002 (Instagram oEmbed Adapter)
      ├──► SYS-003 (OCR Physical Copy Pipeline)
      ├──► SYS-005 (Deduplication Guard) ──► SYS-007 (reads)
      ├──► SYS-004 (Attribution & Visibility Gate) ──► SYS-007 (writes)
      └──► SYS-007 (Recipe Persistence Adapter)
```

## Interface View (IEEE 1016 §5.3)

### External Interfaces

| Component | Interface Name          | Protocol | Input                                                                                         | Output                                             | Error Handling                                       |
| --------- | ----------------------- | -------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| SYS-009   | POST /import/url        | REST     | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `RecipeEntity` or `DuplicateFoundResult` (Derived) | 400 invalid URL, 401 unauth, 422 paywall/unreachable |
| SYS-009   | POST /import/instagram  | REST     | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `RecipeEntity` or `DuplicateFoundResult` (Derived) | 400 no caption, 401 unauth, 422 paywall/video-only   |
| SYS-009   | POST /import/photo      | REST     | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `OcrDraftPayload` for user review (Derived)        | 400 invalid image, 401 unauth, 422 OCR failure       |
| SYS-009   | POST /import/photo/save | REST     | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `RecipeEntity` (Derived)                           | 400 invalid payload, 401 unauth                      |

### Internal Interfaces

| Source  | Target  | Interface Name               | Protocol                                                                                      | Data Format                                             | Error Handling                                  |
| ------- | ------- | ---------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------- | ---------------------- |
| SYS-009 | SYS-001 | extractFromUrl()             | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `string` → `RecipeImportPayload` (Derived)              | Throws `UrlUnreachableError`, `ExtractionError` |
| SYS-009 | SYS-002 | extractFromInstagram()       | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `string` → `RecipeImportPayload` (Derived)              | Throws `NoCaptionError`, `OEmbedApiError`       |
| SYS-009 | SYS-003 | extractFromPhoto()           | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `Buffer` → `OcrDraftPayload` (Derived)                  | Throws `OcrServiceError`                        |
| SYS-009 | SYS-006 | checkPaywall()               | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `string` (URL/domain) → `boolean` (Derived)             | Throws `PaywallBlockedError` on match           |
| SYS-009 | SYS-005 | checkDuplicate()             | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `string` (sourceUrl) → `DuplicateCheckResult` (Derived) | Throws `DatabaseError`                          |
| SYS-009 | SYS-004 | applyAttributionVisibility() | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `RecipeImportPayload` → `AttributedPayload` (Derived)   | Throws `AttributionError`                       |
| SYS-009 | SYS-007 | persistRecipe()              | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `AttributedPayload` → `RecipeEntity` (Derived)          | Throws `PersistenceError`                       |
| SYS-004 | SYS-007 | updateVisibility()           | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{ recipeId, visibility }` → `void` (Derived)           | Throws `PersistenceError`                       |
| SYS-005 | SYS-007 | findBySourceUrl()            | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `string` → `RecipeEntity \ (Derived)                    | null`                                           | Throws `DatabaseError` |

## Data Design View (IEEE 1016 §5.4)

| Entity                | Component | Storage    | Protection at Rest     | Protection in Transit | Retention                                       |
| --------------------- | --------- | ---------- | ---------------------- | --------------------- | ----------------------------------------------- |
| RecipeImportPayload   | SYS-009   | In-memory  | N/A (transient)        | TLS (HTTPS)           | Discarded after persistence                     |
| RecipeEntity          | SYS-007   | PostgreSQL | RDS encryption at rest | TLS (pg SSL)          | Retained until user deletion                    |
| OcrDraftPayload       | SYS-003   | In-memory  | N/A (transient)        | TLS (HTTPS)           | Discarded after user saves or abandons          |
| PaywallBlocklist      | SYS-006   | In-memory  | N/A (config/env)       | N/A (internal)        | Updated on deploy; no user data                 |
| SourceAttributionMeta | SYS-004   | PostgreSQL | RDS encryption at rest | TLS (pg SSL)          | Retained with RecipeEntity; updated on deletion |
| Clerk session token   | SYS-008   | In-memory  | N/A (transient)        | TLS (HTTPS)           | Discarded after request lifecycle               |

---

## Coverage Summary

| Metric                        | Count |
| ----------------------------- | ----- |
| Total System Components (SYS) | 9     |
| Total Requirements Covered    | 22    |
| Functional Requirements       | 15    |
| Non-Functional Requirements   | 5     |
| Interface Requirements        | 4     |
| Constraint Requirements       | 4     |
| Uncovered Requirements        | 0     |

## Requirements Coverage Matrix

| REQ ID     | Covered By       |
| ---------- | ---------------- |
| REQ-001    | SYS-001, SYS-009 |
| REQ-002    | SYS-002          |
| REQ-003    | SYS-002          |
| REQ-004    | SYS-004          |
| REQ-005    | SYS-004          |
| REQ-006    | SYS-004          |
| REQ-007    | SYS-004          |
| REQ-008    | SYS-005          |
| REQ-009    | SYS-003, SYS-009 |
| REQ-010    | SYS-004          |
| REQ-011    | SYS-003          |
| REQ-012    | SYS-006          |
| REQ-013    | SYS-004, SYS-006 |
| REQ-014    | SYS-001          |
| REQ-015    | SYS-007          |
| REQ-NF-001 | SYS-009          |
| REQ-NF-002 | SYS-009          |
| REQ-NF-003 | SYS-001          |
| REQ-NF-004 | SYS-009          |
| REQ-NF-005 | SYS-009          |
| REQ-IF-001 | SYS-002          |
| REQ-IF-002 | SYS-003          |
| REQ-IF-003 | SYS-007          |
| REQ-IF-004 | SYS-008          |
| REQ-CN-001 | SYS-005          |
| REQ-CN-002 | SYS-006          |
| REQ-CN-003 | SYS-002          |
| REQ-CN-004 | SYS-006          |
