# System Test Plan: Recipe Importing

**Feature Branch**: `004-recipe-importing`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/004-recipe-importing/v-model/system-design.md`

## Overview

This document defines the System Test Plan for Recipe Importing. Every system component
in `system-design.md` has one or more Test Cases (STP), and every Test Case has one or
more executable System Scenarios (STS) in technical BDD format (Given/When/Then).

System tests verify **architectural behavior**, not user journeys. Language must be
technical and component-oriented.

## ID Schema

- **System Test Case**: `STP-{NNN}-{X}` — where NNN matches the parent SYS, X is a letter suffix (A, B, C...)
- **System Test Scenario**: `STS-{NNN}-{X}{#}` — nested under the parent STP, with numeric suffix (1, 2, 3...)
- Example: `STS-001-A1` → Scenario 1 of Test Case A verifying SYS-001

## ISO 29119 Test Techniques

Each test case MUST identify its technique by name:

- **Interface Contract Testing** — Verifies API contracts from the Interface View
- **Boundary Value Analysis** — Tests data limits from the Data Design View
- **Equivalence Partitioning** — Tests representative data classes
- **Fault Injection** — Tests failure propagation from the Dependency View

## System Tests

---

### Component Verification: SYS-001 (Web URL Extractor)

**Parent Requirements**: REQ-001, REQ-014, REQ-NF-003

#### Test Case: STP-001-A (Schema.org/Recipe Structured Data Extraction)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `extractFromUrl()` correctly parses schema.org/Recipe markup and returns a well-formed `RecipeImportPayload` with all required fields populated.

- **System Scenario: STS-001-A1**
    - **Given** a publicly reachable URL whose HTML document contains a `<script type="application/ld+json">` block with `@type: "Recipe"` including `name`, `recipeIngredient`, `recipeInstructions`, and `image` fields
    - **When** `extractFromUrl(url)` is invoked
    - **Then** the function returns a `RecipeImportPayload` with `title`, `ingredients`, `instructions`, and `photos` populated from the structured data, and no `ExtractionError` is thrown

- **System Scenario: STS-001-A2**
    - **Given** a publicly reachable URL whose HTML contains no schema.org/Recipe markup but has identifiable recipe content in heuristic-parseable HTML elements
    - **When** `extractFromUrl(url)` is invoked
    - **Then** the function falls back to heuristic extraction and returns a `RecipeImportPayload` with at minimum `title` and `ingredients` populated

#### Test Case: STP-001-B (Unreachable URL Handling)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that `extractFromUrl()` throws `UrlUnreachableError` for 404 and network-unreachable URLs, and that no `RecipeEntity` record is created downstream (REQ-014).

- **System Scenario: STS-001-B1**
    - **Given** a URL that returns HTTP 404
    - **When** `extractFromUrl(url)` is invoked
    - **Then** the function throws `UrlUnreachableError` with status code 404, and the caller (SYS-009) propagates a 422 response without invoking `persistRecipe()`

- **System Scenario: STS-001-B2**
    - **Given** a URL that times out after the configured request timeout threshold
    - **When** `extractFromUrl(url)` is invoked
    - **Then** the function throws `UrlUnreachableError` with a timeout reason, and no `RecipeImportPayload` is produced

#### Test Case: STP-001-C (Extraction Accuracy Boundary)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies that extraction accuracy meets the ≥85% threshold for title, ingredients, and instructions across a representative corpus (REQ-NF-003).

- **System Scenario: STS-001-C1**
    - **Given** a corpus of 20 public recipe URLs with known ground-truth title, ingredients, and instructions
    - **When** `extractFromUrl()` is invoked for each URL
    - **Then** at least 17 of 20 extractions (85%) produce a `RecipeImportPayload` where `title`, `ingredients`, and `instructions` match the ground truth within acceptable edit distance

---

### Component Verification: SYS-002 (Instagram oEmbed Adapter)

**Parent Requirements**: REQ-002, REQ-003, REQ-IF-001, REQ-CN-003

#### Test Case: STP-002-A (Caption-Based Recipe Extraction via oEmbed API)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `extractFromInstagram()` calls the Instagram oEmbed API, extracts recipe content from the caption, and returns a well-formed `RecipeImportPayload`.

- **System Scenario: STS-002-A1**
    - **Given** a valid Instagram post URL whose oEmbed API response contains a `html` field with a caption including recipe text (title, ingredients, instructions)
    - **When** `extractFromInstagram(postUrl)` is invoked
    - **Then** the function returns a `RecipeImportPayload` with `title`, `ingredients`, and `instructions` parsed from the caption, and `sourceUrl` set to the Instagram post URL

- **System Scenario: STS-002-A2**
    - **Given** a valid Instagram post URL whose oEmbed API response returns HTTP 200 but the caption contains no recipe-identifiable text
    - **When** `extractFromInstagram(postUrl)` is invoked
    - **Then** the function throws `NoCaptionError` indicating no recipe content was detected

#### Test Case: STP-002-B (Video-Only and Image-Only Post Rejection)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that `extractFromInstagram()` rejects video-only and image-only posts without recipe text in the caption (REQ-003).

- **System Scenario: STS-002-B1**
    - **Given** an Instagram post URL whose oEmbed response indicates a video post with an empty or non-recipe caption
    - **When** `extractFromInstagram(postUrl)` is invoked
    - **Then** the function throws `NoCaptionError` with reason `VIDEO_ONLY_NO_RECIPE_TEXT`

- **System Scenario: STS-002-B2**
    - **Given** an Instagram post URL whose oEmbed response indicates an image-only post with no caption text
    - **When** `extractFromInstagram(postUrl)` is invoked
    - **Then** the function throws `NoCaptionError` with reason `IMAGE_ONLY_NO_CAPTION`

#### Test Case: STP-002-C (oEmbed API Failure Propagation)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that `extractFromInstagram()` throws `OEmbedApiError` when the Instagram oEmbed API is unavailable or returns an error response.

- **System Scenario: STS-002-C1**
    - **Given** the Instagram oEmbed API endpoint returns HTTP 503
    - **When** `extractFromInstagram(postUrl)` is invoked
    - **Then** the function throws `OEmbedApiError` with the upstream status code, and SYS-009 propagates a 422 response to the caller

---

### Component Verification: SYS-003 (OCR Physical Copy Pipeline)

**Parent Requirements**: REQ-009, REQ-011, REQ-IF-002

#### Test Case: STP-003-A (Photo Upload to OcrDraftPayload Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `extractFromPhoto()` accepts a `Buffer` image input, submits it to the OCR service, and returns an `OcrDraftPayload` containing raw extracted text for user review.

- **System Scenario: STS-003-A1**
    - **Given** a valid JPEG image `Buffer` containing a legible handwritten or printed recipe
    - **When** `extractFromPhoto(imageBuffer)` is invoked
    - **Then** the function returns an `OcrDraftPayload` with a non-empty `rawText` field and a `status` of `PENDING_REVIEW`

- **System Scenario: STS-003-A2**
    - **Given** a valid PNG image `Buffer` containing a printed recipe with clear typography
    - **When** `extractFromPhoto(imageBuffer)` is invoked
    - **Then** the function returns an `OcrDraftPayload` where `rawText` contains recognisable recipe keywords (e.g., ingredient quantities, cooking verbs)

#### Test Case: STP-003-B (OCR Service Failure Propagation)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that `extractFromPhoto()` throws `OcrServiceError` when the OCR service is unavailable, and that no `OcrDraftPayload` is returned.

- **System Scenario: STS-003-B1**
    - **Given** the OCR service endpoint returns HTTP 500
    - **When** `extractFromPhoto(imageBuffer)` is invoked
    - **Then** the function throws `OcrServiceError` with the upstream error detail, and SYS-009 propagates a 422 response to the caller without producing an `OcrDraftPayload`

#### Test Case: STP-003-C (Invalid Image Input Boundary)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies that `extractFromPhoto()` rejects invalid or empty image buffers before invoking the OCR service.

- **System Scenario: STS-003-C1**
    - **Given** an empty `Buffer` (zero bytes)
    - **When** `extractFromPhoto(imageBuffer)` is invoked
    - **Then** the function throws a validation error before making any OCR service call, and the OCR service receives no request

- **System Scenario: STS-003-C2**
    - **Given** a `Buffer` containing a non-image binary payload (e.g., a PDF header)
    - **When** `extractFromPhoto(imageBuffer)` is invoked
    - **Then** the function throws a validation error with reason `INVALID_IMAGE_FORMAT`

---

### Component Verification: SYS-004 (Attribution & Visibility Gate)

**Parent Requirements**: REQ-004, REQ-005, REQ-006, REQ-007, REQ-010, REQ-013

#### Test Case: STP-004-A (Attribution Enforcement for Web/Instagram Imports)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `applyAttributionVisibility()` populates `sourceUrl`, `originalAuthor`, and `platform` fields on the `AttributedPayload` for web and Instagram imports (REQ-004).

- **System Scenario: STS-004-A1**
    - **Given** a `RecipeImportPayload` with `importType: "URL"`, a non-empty `sourceUrl`, and an `originalAuthor` field
    - **When** `applyAttributionVisibility(payload)` is invoked
    - **Then** the returned `AttributedPayload` has `attribution.sourceUrl`, `attribution.originalAuthor`, and `attribution.platform` set, and `visibility` set to `PUBLIC`

- **System Scenario: STS-004-A2**
    - **Given** a `RecipeImportPayload` with `importType: "INSTAGRAM"` and a valid Instagram post URL as `sourceUrl`
    - **When** `applyAttributionVisibility(payload)` is invoked
    - **Then** the returned `AttributedPayload` has `attribution.platform` set to `"instagram"` and `visibility` set to `PUBLIC`

#### Test Case: STP-004-B (Physical Copy Visibility — Private, No Attribution)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that `applyAttributionVisibility()` sets `visibility: PRIVATE` and omits attribution for physical copy imports (REQ-010).

- **System Scenario: STS-004-B1**
    - **Given** a `RecipeImportPayload` with `importType: "PHYSICAL_COPY"` and no `sourceUrl`
    - **When** `applyAttributionVisibility(payload)` is invoked
    - **Then** the returned `AttributedPayload` has `visibility` set to `PRIVATE` and `attribution` is null or absent

#### Test Case: STP-004-C (Clone-and-Edit Premium Visibility Rule)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that a cloned public recipe cannot be made private unless the requesting user is a premium subscriber who has made a substantive edit (REQ-006, REQ-007).

- **System Scenario: STS-004-C1**
    - **Given** a cloned `RecipeEntity` with `visibility: PUBLIC` and a non-premium user attempting to set `visibility: PRIVATE`
    - **When** `updateVisibility({ recipeId, visibility: "PRIVATE" })` is invoked on SYS-004
    - **Then** the function throws `AttributionError` with reason `PREMIUM_REQUIRED_FOR_PRIVATE`

- **System Scenario: STS-004-C2**
    - **Given** a cloned `RecipeEntity` with `visibility: PUBLIC`, a premium user, and a `substantiveEditFlag: true` on the payload
    - **When** `updateVisibility({ recipeId, visibility: "PRIVATE" })` is invoked on SYS-004
    - **Then** the function succeeds and `updateVisibility()` writes `visibility: PRIVATE` to SYS-007

#### Test Case: STP-004-D (Paid-Source Recipe Public Visibility Block)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that recipes flagged as originating from a paid source cannot be made public (REQ-013).

- **System Scenario: STS-004-D1**
    - **Given** a `RecipeImportPayload` with `paidSourceFlag: true`
    - **When** `applyAttributionVisibility(payload)` is invoked
    - **Then** the returned `AttributedPayload` has `visibility` set to `PRIVATE` and `paidSourceFlag` preserved, and any subsequent attempt to set `visibility: PUBLIC` throws `AttributionError`

---

### Component Verification: SYS-005 (Deduplication Guard)

**Parent Requirements**: REQ-008, REQ-CN-001

#### Test Case: STP-005-A (Duplicate Detection by Source URL)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `checkDuplicate(sourceUrl)` queries SYS-007 via `findBySourceUrl()` and returns a `DuplicateCheckResult` indicating whether a matching public recipe already exists (REQ-008, REQ-CN-001).

- **System Scenario: STS-005-A1**
    - **Given** a `sourceUrl` that matches an existing `RecipeEntity` in the database with `visibility: PUBLIC`
    - **When** `checkDuplicate(sourceUrl)` is invoked
    - **Then** the function returns `{ isDuplicate: true, existingRecipeId: "<id>" }` and SYS-009 surfaces the existing recipe without invoking `persistRecipe()`

- **System Scenario: STS-005-A2**
    - **Given** a `sourceUrl` that does not match any existing `RecipeEntity` in the database
    - **When** `checkDuplicate(sourceUrl)` is invoked
    - **Then** the function returns `{ isDuplicate: false }` and SYS-009 proceeds to `applyAttributionVisibility()` and `persistRecipe()`

#### Test Case: STP-005-B (Database Error Propagation from findBySourceUrl)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that a `DatabaseError` from `findBySourceUrl()` propagates correctly and prevents import from proceeding silently.

- **System Scenario: STS-005-B1**
    - **Given** the database connection is unavailable when `checkDuplicate(sourceUrl)` is invoked
    - **When** `findBySourceUrl()` throws `DatabaseError`
    - **Then** `checkDuplicate()` re-throws `DatabaseError`, and SYS-009 returns a 500 error to the caller without creating a duplicate record

---

### Component Verification: SYS-006 (Paywall Blocklist Enforcer)

**Parent Requirements**: REQ-012, REQ-013, REQ-CN-002, REQ-CN-004

#### Test Case: STP-006-A (Blocked Domain Rejection)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that `checkPaywall(url)` throws `PaywallBlockedError` for URLs whose domain appears in the in-memory blocklist (REQ-012).

- **System Scenario: STS-006-A1**
    - **Given** the `PaywallBlocklist` contains the domain `"paywalled-recipes.example.com"` and the input URL is `"https://paywalled-recipes.example.com/recipe/123"`
    - **When** `checkPaywall(url)` is invoked
    - **Then** the function throws `PaywallBlockedError` with the blocked domain and a user-facing explanation, and SYS-009 returns a 422 response without invoking any extractor

- **System Scenario: STS-006-A2**
    - **Given** the `PaywallBlocklist` does not contain the domain of the input URL
    - **When** `checkPaywall(url)` is invoked
    - **Then** the function returns `false` (not blocked) and SYS-009 proceeds to the appropriate extractor

#### Test Case: STP-006-B (Blocklist Boundary — Domain Matching Precision)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies that domain matching is exact (no subdomain leakage) and case-insensitive.

- **System Scenario: STS-006-B1**
    - **Given** the blocklist contains `"blocked.example.com"` and the input URL domain is `"notblocked.example.com"`
    - **When** `checkPaywall(url)` is invoked
    - **Then** the function returns `false` — subdomain `notblocked` is not matched by the `blocked` entry

- **System Scenario: STS-006-B2**
    - **Given** the blocklist contains `"Blocked.Example.COM"` (mixed case) and the input URL domain is `"blocked.example.com"` (lowercase)
    - **When** `checkPaywall(url)` is invoked
    - **Then** the function throws `PaywallBlockedError` — matching is case-insensitive

---

### Component Verification: SYS-007 (Recipe Persistence Adapter)

**Parent Requirements**: REQ-IF-003, REQ-015

#### Test Case: STP-007-A (AttributedPayload to RecipeEntity Persistence Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `persistRecipe(attributedPayload)` writes a `RecipeEntity` conforming to the 001-commise-recipe-app schema and returns the persisted entity with a generated `id` (REQ-IF-003).

- **System Scenario: STS-007-A1**
    - **Given** a valid `AttributedPayload` with all required fields (`title`, `ingredients`, `instructions`, `visibility`, `attribution`)
    - **When** `persistRecipe(attributedPayload)` is invoked
    - **Then** the function writes a `RecipeEntity` to PostgreSQL conforming to the 001 schema, returns the entity with a non-null `id` and `createdAt` timestamp, and no `PersistenceError` is thrown

#### Test Case: STP-007-B (Instagram Source Deletion Edge Case)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that when an Instagram post is deleted after import, the `RecipeEntity` is preserved and the attribution note is updated to indicate the source is no longer available (REQ-015).

- **System Scenario: STS-007-B1**
    - **Given** a `RecipeEntity` with `attribution.platform: "instagram"` and `attribution.sourceUrl` pointing to a now-deleted Instagram post
    - **When** a source-deletion event triggers an update call to SYS-007 with `sourceDeleted: true`
    - **Then** the `RecipeEntity` is retained in the database, `attribution.sourceAvailable` is set to `false`, and `attribution.deletionNote` is populated with a human-readable message

#### Test Case: STP-007-C (Persistence Failure Propagation)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that `persistRecipe()` throws `PersistenceError` on database write failure and that no partial record is committed.

- **System Scenario: STS-007-C1**
    - **Given** the PostgreSQL connection is unavailable when `persistRecipe(attributedPayload)` is invoked
    - **When** the database write fails
    - **Then** the function throws `PersistenceError`, the transaction is rolled back, and no partial `RecipeEntity` row exists in the database

---

### Component Verification: SYS-008 (Auth Enforcement Middleware)

**Parent Requirements**: REQ-IF-004

#### Test Case: STP-008-A (JWT Validation — Authenticated Request Pass-Through)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that SYS-008 validates a well-formed Clerk session token and allows the request to proceed to SYS-009 (REQ-IF-004).

- **System Scenario: STS-008-A1**
    - **Given** an inbound HTTP request to `POST /import/url` with a valid, non-expired Clerk session token in the `Authorization: Bearer` header
    - **When** SYS-008 processes the request
    - **Then** the token is verified networklessly against the public `CLERK_JWT_KEY` (with `azp` checked against `CLERK_AUTHORIZED_PARTIES`), the request is forwarded to SYS-009 with the decoded user identity, and no 401 response is returned

#### Test Case: STP-008-B (Unauthenticated Request Rejection)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that SYS-008 rejects requests with missing, malformed, or expired JWTs with HTTP 401 before any import logic executes (REQ-IF-004).

- **System Scenario: STS-008-B1**
    - **Given** an inbound HTTP request to `POST /import/url` with no `Authorization` header
    - **When** SYS-008 processes the request
    - **Then** SYS-008 returns HTTP 401 immediately, and SYS-009 receives no invocation

- **System Scenario: STS-008-B2**
    - **Given** an inbound HTTP request to `POST /import/instagram` with an expired Clerk session token
    - **When** SYS-008 processes the request
    - **Then** SYS-008 returns HTTP 401 with an `invalid_token` error code, and SYS-009 receives no invocation

- **System Scenario: STS-008-B3**
    - **Given** an inbound HTTP request to `POST /import/photo` with a malformed JWT (invalid signature)
    - **When** SYS-008 processes the request
    - **Then** SYS-008 returns HTTP 401 with an `invalid_token` error code, and SYS-009 receives no invocation

---

### Component Verification: SYS-009 (Import Orchestrator)

**Parent Requirements**: REQ-001, REQ-002, REQ-009, REQ-NF-001, REQ-NF-002, REQ-NF-004, REQ-NF-005

#### Test Case: STP-009-A (End-to-End URL Import Orchestration)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `POST /import/url` orchestrates the full pipeline — paywall check → extraction → deduplication → attribution/visibility → persistence — and returns a `RecipeEntity` on success.

- **System Scenario: STS-009-A1**
    - **Given** an authenticated `POST /import/url` request with a valid, non-paywalled, non-duplicate public recipe URL
    - **When** SYS-009 processes the request
    - **Then** SYS-009 invokes `checkPaywall()` → `extractFromUrl()` → `checkDuplicate()` → `applyAttributionVisibility()` → `persistRecipe()` in sequence, and returns HTTP 200 with the persisted `RecipeEntity`

#### Test Case: STP-009-B (End-to-End Instagram Import Orchestration)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `POST /import/instagram` orchestrates the full pipeline for Instagram imports and returns a `RecipeEntity` on success.

- **System Scenario: STS-009-B1**
    - **Given** an authenticated `POST /import/instagram` request with a valid Instagram post URL containing recipe caption text
    - **When** SYS-009 processes the request
    - **Then** SYS-009 invokes `checkPaywall()` → `extractFromInstagram()` → `checkDuplicate()` → `applyAttributionVisibility()` → `persistRecipe()` in sequence, and returns HTTP 200 with the persisted `RecipeEntity`

#### Test Case: STP-009-C (End-to-End Physical Copy Import Orchestration)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `POST /import/photo` orchestrates the OCR pipeline and returns an `OcrDraftPayload` for user review, and that `POST /import/photo/save` persists the corrected payload.

- **System Scenario: STS-009-C1**
    - **Given** an authenticated `POST /import/photo` request with a valid image `multipart/form-data` payload
    - **When** SYS-009 processes the request
    - **Then** SYS-009 invokes `extractFromPhoto()` and returns HTTP 200 with an `OcrDraftPayload` containing `rawText` and `status: PENDING_REVIEW`

- **System Scenario: STS-009-C2**
    - **Given** an authenticated `POST /import/photo/save` request with a corrected `OcrDraftPayload`
    - **When** SYS-009 processes the request
    - **Then** SYS-009 invokes `applyAttributionVisibility()` → `persistRecipe()` and returns HTTP 200 with the persisted `RecipeEntity` with `visibility: PRIVATE`

#### Test Case: STP-009-D (Paywall Hard-Fail Stops Pipeline)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that a `PaywallBlockedError` from SYS-006 causes SYS-009 to abort the pipeline immediately without invoking any extractor or persistence component.

- **System Scenario: STS-009-D1**
    - **Given** an authenticated `POST /import/url` request with a URL from a blocked domain
    - **When** `checkPaywall()` throws `PaywallBlockedError`
    - **Then** SYS-009 returns HTTP 422 with the paywall explanation, and `extractFromUrl()`, `checkDuplicate()`, `applyAttributionVisibility()`, and `persistRecipe()` are never invoked

#### Test Case: STP-009-E (Duplicate Found — Surface Existing Recipe)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that when SYS-005 detects a duplicate, SYS-009 returns the existing recipe and a clone offer instead of creating a new record.

- **System Scenario: STS-009-E1**
    - **Given** an authenticated `POST /import/url` request with a `sourceUrl` that matches an existing public `RecipeEntity`
    - **When** `checkDuplicate()` returns `{ isDuplicate: true, existingRecipeId: "<id>" }`
    - **Then** SYS-009 returns HTTP 200 with a `DuplicateFoundResult` containing the existing `RecipeEntity` and a `cloneOffered: true` flag, and `persistRecipe()` is never invoked

#### Test Case: STP-009-F (Attribution Hard-Fail Stops Pipeline)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that an `AttributionError` from SYS-004 causes SYS-009 to abort without persisting a recipe.

- **System Scenario: STS-009-F1**
    - **Given** an authenticated `POST /import/url` request where `applyAttributionVisibility()` throws `AttributionError`
    - **When** SYS-009 processes the request
    - **Then** SYS-009 returns HTTP 422 with the attribution error detail, and `persistRecipe()` is never invoked

---

## Coverage Summary

| Metric                        | Count |
| ----------------------------- | ----- |
| Total System Components (SYS) | 9     |
| Total Test Cases (STP)        | 22    |
| Total System Scenarios (STS)  | 38    |
| Components with ≥1 STP        | 9 / 9 |
| ISO 29119 Techniques Used     | 4     |

## SYS → STP Coverage Matrix

| SYS ID  | Component Name                | Test Cases                                                       |
| ------- | ----------------------------- | ---------------------------------------------------------------- |
| SYS-001 | Web URL Extractor             | STP-001-A, STP-001-B, STP-001-C                                  |
| SYS-002 | Instagram oEmbed Adapter      | STP-002-A, STP-002-B, STP-002-C                                  |
| SYS-003 | OCR Physical Copy Pipeline    | STP-003-A, STP-003-B, STP-003-C                                  |
| SYS-004 | Attribution & Visibility Gate | STP-004-A, STP-004-B, STP-004-C, STP-004-D                       |
| SYS-005 | Deduplication Guard           | STP-005-A, STP-005-B                                             |
| SYS-006 | Paywall Blocklist Enforcer    | STP-006-A, STP-006-B                                             |
| SYS-007 | Recipe Persistence Adapter    | STP-007-A, STP-007-B, STP-007-C                                  |
| SYS-008 | Auth Enforcement Middleware   | STP-008-A, STP-008-B                                             |
| SYS-009 | Import Orchestrator           | STP-009-A, STP-009-B, STP-009-C, STP-009-D, STP-009-E, STP-009-F |
