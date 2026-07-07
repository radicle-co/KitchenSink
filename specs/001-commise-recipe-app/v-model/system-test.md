# System Test Plan: Commise - Recipe Management Core

**Feature Branch**: `001-commise-recipe-app`
**Created**: 2026-04-30
**Status**: Draft
**Source**: `specs/001-commise-recipe-app/v-model/system-design.md`

## Overview

This document defines the System Test Plan for Commise - Recipe Management Core. Every system component in `system-design.md` has one or more Test Cases (STP), and every Test Case has one or more executable System Scenarios (STS) in technical BDD format (Given/When/Then).

System tests verify **architectural behavior**, not user journeys. Language is technical and component-oriented.

## ID Schema

- **System Test Case**: `STP-{NNN}-{X}` — where NNN matches the parent SYS, X is a letter suffix (A, B, C...)
- **System Test Scenario**: `STS-{NNN}-{X}{#}` — nested under the parent STP, with numeric suffix (1, 2, 3...)
- Example: `STS-001-A1` → Scenario 1 of Test Case A verifying SYS-001

## ISO 29119 Test Techniques

Each test case identifies its technique by name:

- **Specification-Based Testing** — Verifies API contracts and specification conformance from the Interface View (with Equivalence Partitioning used as the primary input/output class validation technique where applicable)
- **Boundary Value Analysis** — Tests data limits from the Data Design View
- **Equivalence Partitioning** — Tests representative data classes
- **Decision Table Testing** — Systematically verifies multi-condition policy combinations and expected outcomes
- **State Transition Testing** — Verifies valid/invalid transitions and terminal-state guards for defined lifecycle state machines
- **Error Guessing** — Exercises high-risk undocumented edge cases and defensive error paths beyond formal partitions
- **Performance Testing** — Verifies non-functional response-time behavior and load objectives under defined environments (ISO 29119-10). Applied via Analysis verification method for STP-NF-004-A, STP-NF-015-A. Executable performance test cases (STP-005-C) demonstrate the technique when executed programmatically.

## System Tests

### Component Verification: SYS-001 (Clerk Identity and Access Guard)

**Parent Requirements**: REQ-017, REQ-024, REQ-050b, REQ-052, REQ-IF-005a, REQ-IF-005b, REQ-IF-005c

#### Test Case: STP-001-A (JWT Validation and Authorization Contract)

**Technique**: Specification-Based Testing
**Target View**: Interface View
**Description**: Verifies that authenticated principal extraction, scope validation, and owner-authorization checks enforce endpoint contracts across protected API surfaces.

- **System Scenario: STS-001-A1**
    - **Given** a Clerk session token verifiable against the configured `CLERK_JWT_KEY` public key with unexpired `exp`, an allowed `azp` (`CLERK_AUTHORIZED_PARTIES`), and required scopes
    - **When** the guard processes `GET /v1/recipes/{id}` for a resource the principal can access
    - **Then** the request pipeline receives principal context (`userId`, tier, claims) and the endpoint continues with HTTP 200 response behavior

- **System Scenario: STS-001-A2**
    - **Given** a protected endpoint call with either a missing bearer token or a token lacking required scopes
    - **When** the guard validates identity and authorization claims
    - **Then** the guard returns HTTP 401 for missing/invalid tokens or HTTP 403 for insufficient scope, and downstream handlers are not executed

#### Test Case: STP-001-B (Identity Dependency Failure Isolation)

**Technique**: Error Guessing
**Target View**: Dependency View
**Description**: Verifies fail-closed behavior when token verification inputs are invalid (bad signature, disallowed `azp`, missing `CLERK_JWT_KEY`) and owner checks fail.

- **System Scenario: STS-001-B1**
    - **Given** the configured `CLERK_JWT_KEY` is missing or malformed so networkless signature verification cannot complete
    - **When** the guard attempts verification for an inbound token
    - **Then** the guard fails closed with HTTP 401 and no protected route logic runs

- **System Scenario: STS-001-B2**
    - **Given** a valid authenticated principal attempts `PATCH /v1/recipes/{id}` for a recipe owned by a different principal
    - **When** owner authorization is evaluated
    - **Then** the guard returns HTTP 403 and no recipe mutation SQL statements are issued

#### Test Case: STP-001-C (JWT High-Risk Error-Path Guesses)

**Technique**: Error Guessing
**Target View**: Dependency View
**Description**: Verifies JWT edge cases (clock skew, replay, missing/invalid `CLERK_JWT_KEY` configuration) as high-risk failure paths beyond formal partitions. Verification is networkless, so all failure paths fail closed with HTTP 401 (or a boot-time config error) — there is no remote JWKS-outage path.

- **System Scenario: STS-001-C1**
    - **Given** a bearer token with `nbf`/`exp` near validation boundaries and verifier clock skew relative to issuer time
    - **When** temporal claim validation executes
    - **Then** behavior is deterministic at skew-tolerance boundaries and fails closed outside configured tolerance

- **System Scenario: STS-001-C2**
    - **Given** a previously accepted bearer token is replayed for a protected action context
    - **When** guard validation and authorization checks execute for the replayed request
    - **Then** replay is rejected and no duplicate protected side effects are committed

- **System Scenario: STS-001-C3**
    - **Given** a bearer token presented to the guard while the configured `CLERK_JWT_KEY` is stale/mismatched relative to the Clerk signing key (e.g. mid key-rotation), so the local signature check cannot succeed
    - **When** networkless JWT signature verification executes
    - **Then** the guard fails closed with HTTP 401 and no protected route logic runs (no JWKS fetch is attempted)

---

### Component Verification: SYS-002 (Recipe Command Service)

**Parent Requirements**: REQ-001, REQ-002, REQ-004, REQ-005, REQ-006, REQ-007, REQ-010a, REQ-010b, REQ-021, REQ-025, REQ-026a, REQ-026b

#### Test Case: STP-002-A (Recipe Command API Contract)

**Technique**: Specification-Based Testing
**Target View**: Interface View
**Description**: Verifies create/update/delete/clone command behaviors, response contracts, and atomic metadata persistence semantics.

- **System Scenario: STS-002-A1**
    - **Given** a valid `CreateRecipeRequest` payload with title, ingredients, ordered steps, times, servings, and tags
    - **When** `POST /v1/recipes` is processed
    - **Then** the service commits metadata tables atomically, creates recipe version `1`, defaults visibility to `public`, and returns HTTP 201 with persisted fields

- **System Scenario: STS-002-A2**
    - **Given** an existing recipe and a valid update payload referencing the current version
    - **When** `PATCH /v1/recipes/{id}` is executed
    - **Then** the update increments version, persists mutation state, and response contracts conform to documented status codes

- **System Scenario: STS-002-A3**
    - **Given** an existing recipe eligible for owner deletion
    - **When** `DELETE /v1/recipes/{id}` is executed
    - **Then** delete applies tombstone semantics with HTTP 204 and command response contracts conform to documented status codes

#### Test Case: STP-002-B (Command Payload Boundary Enforcement)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies non-negative time fields, positive servings constraints, and rejection of boundary violations without partial writes.

- **System Scenario: STS-002-B1**
    - **Given** recipe command payloads with `prepTimeMinutes=0`, `cookTimeMinutes=0`, `totalTimeMinutes=0`, and `servings=1`
    - **When** create or update command validation executes
    - **Then** payload validation succeeds and metadata writes are committed

- **System Scenario: STS-002-B2**
    - **Given** recipe command payloads with negative time values or `servings=0`
    - **When** command validation executes
    - **Then** the service returns HTTP 400 with deterministic field errors and no recipe/version rows are created or updated

---

### Component Verification: SYS-003 (Visibility and Source Policy Engine)

**Parent Requirements**: REQ-022, REQ-023, REQ-027a, REQ-027b, REQ-028, REQ-050a, REQ-CN-001a, REQ-CN-001b, REQ-CN-003, REQ-CN-004a, REQ-CN-004b, REQ-CN-005

#### Test Case: STP-003-A (Visibility Policy Class Partitioning)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies visibility outcomes for premium/free tiers and source classifications (`public-source`, `paid-source`, `physical-copy`).

- **System Scenario: STS-003-A1**
    - **Given** three recipe classes: premium-owned standard recipe, free-tier owned standard recipe, and paid-source imported recipe
    - **When** policy evaluation processes requested visibility transitions to `private`
    - **Then** premium standard transition is allowed, free-tier transition is denied, and paid-source transition is denied regardless of tier

- **System Scenario: STS-003-A2**
    - **Given** a physical-copy imported recipe at creation and a subscription-lapsed account with pre-existing private recipes
    - **When** policy defaults and post-lapse transition checks are evaluated
    - **Then** physical-copy default visibility is `private`, existing private recipes remain unchanged after lapse, and new private transitions are denied until subscription renewal

#### Test Case: STP-003-B (Substantive Edit Classification Boundaries)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies exact field-boundary rules for substantive edits used by privacy unlock logic.

- **System Scenario: STS-003-B1**
    - **Given** a clone of a public-source imported recipe with no prior substantive edit
    - **When** an edit mutates at least one ingredient row or one instruction step
    - **Then** the policy engine classifies the change as substantive and marks unlock eligibility as true for premium accounts

- **System Scenario: STS-003-B2**
    - **Given** a clone of an imported recipe exists in the user's library with zero edits applied
    - **When** substantive-edit classification executes without any edit operations
    - **Then** substantive classification remains false and private-visibility unlock remains denied

- **System Scenario: STS-003-B3**
    - **Given** a clone of an imported recipe exists and edits are limited to metadata/photo fields (title, description, tags, photo attachments) with no ingredient/instruction mutations
    - **When** substantive-edit classification executes for metadata/photo-only edits
    - **Then** substantive classification remains false and private-visibility unlock remains denied

#### Test Case: STP-003-C (Visibility Policy Decision Matrix)

**Technique**: Decision Table Testing
**Target View**: Decomposition View
**Description**: Verifies the full multi-condition policy matrix for `private` visibility transitions across tier × source type × edit state.

- **System Scenario: STS-003-C1**
    - **Given** policy inputs `tier ∈ {premium, free, lapsed}`, `source ∈ {standard, public-source, paid-source, physical-copy}`, and `editState ∈ {non-substantive, substantive}`
    - **When** decision-table evaluation executes for requested transition to `private`
    - **Then** expected outcomes are:

        | Tier    | Source        | Edit State      | Outcome for `private` Transition |
        | ------- | ------------- | --------------- | -------------------------------- |
        | premium | standard      | non-substantive | Allowed                          |
        | premium | standard      | substantive     | Allowed                          |
        | premium | public-source | non-substantive | Denied                           |
        | premium | public-source | substantive     | Allowed                          |
        | premium | paid-source   | non-substantive | Denied                           |
        | premium | paid-source   | substantive     | Denied                           |
        | premium | physical-copy | non-substantive | Allowed                          |
        | premium | physical-copy | substantive     | Allowed                          |
        | free    | standard      | non-substantive | Denied                           |
        | free    | standard      | substantive     | Denied                           |
        | free    | public-source | non-substantive | Denied                           |
        | free    | public-source | substantive     | Denied                           |
        | free    | paid-source   | non-substantive | Denied                           |
        | free    | paid-source   | substantive     | Denied                           |
        | free    | physical-copy | non-substantive | Denied                           |
        | free    | physical-copy | substantive     | Denied                           |
        | lapsed  | standard      | non-substantive | Denied                           |
        | lapsed  | standard      | substantive     | Denied                           |
        | lapsed  | public-source | non-substantive | Denied                           |
        | lapsed  | public-source | substantive     | Denied                           |
        | lapsed  | paid-source   | non-substantive | Denied                           |
        | lapsed  | paid-source   | substantive     | Denied                           |
        | lapsed  | physical-copy | non-substantive | Denied                           |
        | lapsed  | physical-copy | substantive     | Denied                           |

---

### Component Verification: SYS-004 (Ingredient Catalog and Nutrition Resolver)

**Parent Requirements**: REQ-003a, REQ-003b, REQ-031, REQ-032, REQ-033, REQ-057

#### Test Case: STP-004-A (Ingredient Interface Resolution Contract)

**Technique**: Specification-Based Testing
**Target View**: Interface View
**Description**: Verifies ingredient search/autocomplete and freeform creation interfaces return expected contract fields and nutrition linkage semantics.

- **System Scenario: STS-004-A1**
    - **Given** ingredient catalog records indexed by normalized names and nutrition attributes per unit
    - **When** `GET /v1/ingredients/search?q=chick` is processed with `limit=10`
    - **Then** the response returns ranked ingredient suggestions with stable IDs, names, and linked nutrition metadata for matched records

- **System Scenario: STS-004-A2**
    - **Given** no catalog match for a submitted ingredient text
    - **When** `POST /v1/ingredients` receives freeform payload with optional manual macro values
    - **Then** the service creates a user-entered ingredient record with `isUserEntered=true`, stores provided manual nutrition values when present, and returns HTTP 201

#### Test Case: STP-004-B (Ingredient Data-Class Partitioning)

**Technique**: Equivalence Partitioning
**Target View**: Data Design View
**Description**: Verifies behavior classes for linked ingredients, freeform without manual nutrition, and freeform with manual nutrition.

- **System Scenario: STS-004-B1**
    - **Given** recipe ingredient payloads containing one linked ingredient and one unmatched freeform ingredient without manual macros
    - **When** nutrition resolution runs during recipe save
    - **Then** linked ingredient macros are resolved from catalog, freeform entry remains user-entered with nullable macro fields, and aggregation flags partial user-supplied nutrition

- **System Scenario: STS-004-B2**
    - **Given** an unmatched freeform ingredient containing explicit manual values for calories, protein, carbohydrate, and fat
    - **When** nutrition resolution executes
    - **Then** manual values are persisted and returned as the effective nutrition source for that ingredient class

---

### Component Verification: SYS-005 (Recipe Search and Filter Service)

**Parent Requirements**: REQ-018a, REQ-018b, REQ-029, REQ-030a, REQ-030b, REQ-030c, REQ-030d, REQ-030e, REQ-030f, REQ-NF-001, REQ-NF-002

#### Test Case: STP-005-A (Search API Contract and Tombstone Exclusion)

**Technique**: Specification-Based Testing
**Target View**: Interface View
**Description**: Verifies full-text/filter response contracts and exclusion of tombstoned recipes from all search/listing paths.

- **System Scenario: STS-005-A1**
    - **Given** recipe corpus includes active and tombstoned rows with tags, cuisine, dietary flags, ingredient links, and time fields
    - **When** `GET /v1/search/recipes` is executed with combined keyword and structured filter parameters
    - **Then** results include only active recipes, return `results/total/page/pageSize/facets/appliedFilters`, and preserve deterministic ordering for selected `sortBy`

- **System Scenario: STS-005-A2**
    - **Given** invalid filter payloads (for example non-UUID ingredient IDs or unsupported `sortBy` values)
    - **When** search request validation executes
    - **Then** the service returns HTTP 400 with structured field-level error details and executes no fallback broad query

#### Test Case: STP-005-B (Search Parameter and Latency Boundaries)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies pagination/filter boundary values only.

- **System Scenario: STS-005-B1**
    - **Given** valid search requests at pagination boundaries (`page=1`, `pageSize=1`, `pageSize=100`) and invalid overflow (`pageSize=101`)
    - **When** the service validates and executes queries
    - **Then** boundary-valid requests succeed with HTTP 200 and overflow requests fail with HTTP 400

#### Test Case: STP-005-C (Search Non-Functional Performance Envelope)

**Technique**: Performance Testing
**Target View**: Dependency View
**Description**: Verifies non-functional search performance with explicit dataset size, load profile, measurement method, and environment requirements (indexed schema and representative data volume).

- **System Scenario: STS-005-C1**
    - **Given** an indexed schema, representative dataset volume (minimum 20 recipes, with scale profile representative of production), and a defined sustained load profile in a fixed test environment
    - **When** search/filter traffic executes and both wall-clock latency and instrumented API p95 are measured
    - **Then** wall-clock response remains below 2.0 seconds and measured API p95 remains within the 500 ms target envelope

---

### Component Verification: SYS-006 (Photo Upload Validation and Attachment Service)

**Parent Requirements**: REQ-008, REQ-009, REQ-010a, REQ-010b, REQ-013, REQ-014, REQ-015, REQ-016

#### Test Case: STP-006-A (Photo Count and Size Boundary Controls)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies strict enforcement of maximum 10 photos per recipe and maximum 5 MB per file across upload URL and confirmation flows.

- **System Scenario: STS-006-A1**
    - **Given** a recipe with 9 existing photos and an upload request containing `fileSize=5242880`
    - **When** `POST /v1/recipes/{id}/photos/upload-url` is processed
    - **Then** the service returns HTTP 200 with a presigned URL and object key because both boundaries are valid

- **System Scenario: STS-006-A2**
    - **Given** either `fileSize=5242881` or a recipe already containing 10 photos
    - **When** upload URL creation or photo confirmation is requested
    - **Then** the service returns HTTP 400 with explicit boundary violation codes and no new photo reference is persisted

#### Test Case: STP-006-B (Per-File Validation and Retry Contract)

**Technique**: Specification-Based Testing
**Target View**: Interface View
**Description**: Verifies magic-byte validation, per-file error reporting, and independent retry behavior without metadata re-save.

- **System Scenario: STS-006-B1**
    - **Given** an uploaded object whose declared `contentType=image/jpeg` does not match inspected magic bytes
    - **When** `POST /v1/recipes/{id}/photos/confirm` validates object metadata and content signature
    - **Then** the service rejects confirmation with per-file reason details, marks retryability, and avoids persisting a valid recipe-photo reference for the failed object

- **System Scenario: STS-006-B2**
    - **Given** recipe metadata is already committed and one photo upload previously failed
    - **When** a retry path requests a new upload URL and submits a valid confirm payload for only the failed file
    - **Then** the retry succeeds independently with HTTP 201 and no metadata re-save operation is required

#### Test Case: STP-006-C (Upload/Confirm Concurrency Error-Path Guesses)

**Technique**: Error Guessing
**Target View**: Dependency View
**Description**: Verifies high-risk race conditions in upload/confirm flows, including partial multipart uploads and concurrent confirm calls for the same object key.

- **System Scenario: STS-006-C1**
    - **Given** a multipart upload with missing or incomplete parts where confirm is requested before object completeness is guaranteed
    - **When** `POST /v1/recipes/{id}/photos/confirm` validates staged object integrity
    - **Then** confirmation is rejected deterministically, retryability is preserved, and no finalized photo attachment is persisted

- **System Scenario: STS-006-C2**
    - **Given** concurrent confirm requests target the same uploaded object key for a recipe
    - **When** both confirmation paths race through idempotency and persistence checks
    - **Then** at most one confirm operation commits attachment finalization and duplicate-success side effects are prevented

---

### Component Verification: SYS-007 (Photo Processing Lambda)

**Parent Requirements**: REQ-008, REQ-014, REQ-016

#### Test Case: STP-007-A (Photo Processing Event Contract)

**Technique**: Specification-Based Testing
**Target View**: Interface View
**Description**: Verifies S3 event handling, derivative generation, and the `photo-processed` completion handoff for recipe photos. The processor Lambda is **S3-only and not VPC-attached** — it does **not** touch the database; on completion it emits an SQS `photo-processed` message, and the in-VPC **Fargate recipe API `photo-processed` consumer** performs the `recipe_photos` completion `UPDATE` (ADR-0004; FIXES D1).

- **System Scenario: STS-007-A1**
    - **Given** an S3 ObjectCreated event with bucket/key metadata for a confirmed recipe photo
    - **When** the Lambda handler retrieves the original and runs Sharp processing pipelines
    - **Then** derivative objects are written to expected prefixes and the Lambda emits an SQS `photo-processed` message carrying the derivative keys and dimensions (no direct DB write); the Fargate `photo-processed` consumer then transitions `recipe_photos.processing_status` to `complete` with populated dimensions

- **System Scenario: STS-007-A2**
    - **Given** a valid HEIC/HEIF source object in the allowed media set
    - **When** the processor executes format conversion and rendition generation
    - **Then** output objects are generated in supported delivery formats and the `photo-processed` message carries CDN-deliverable keys that the Fargate consumer persists to the `recipe_photos` record

#### Test Case: STP-007-B (Photo Processing Failure Behavior)

**Technique**: Error Guessing
**Target View**: Dependency View
**Description**: Verifies retry/failure semantics when object retrieval or transformation fails.

- **System Scenario: STS-007-B1**
    - **Given** the Lambda receives an event for an object key that cannot be decoded by Sharp
    - **When** transformation execution throws a processing exception
    - **Then** the Lambda surfaces a `failed` outcome via the `photo-processed` message (it performs no DB write itself), and the Fargate `photo-processed` consumer transitions the `recipe_photos` record to a failed/non-complete state with an explicit error reason, preserving no broken finalized attachment

- **System Scenario: STS-007-B2**
    - **Given** transient S3 read timeouts during source retrieval
    - **When** Lambda invocation retries under configured retry policy
    - **Then** processing remains retryable, no `photo-processed` success message is emitted, and the `recipe_photos` state does not transition to `complete` until a successful end-to-end run emits a success message consumed by the Fargate consumer

#### Test Case: STP-007-C (Photo Lifecycle State Machine Transition Guards)

**Technique**: State Transition Testing
**Target View**: Operational States
**Description**: Verifies valid transitions (`PHOTO_PENDING` → `PHOTO_PROCESSING` → `NORMAL` and `PHOTO_PENDING` → `PHOTO_FAILED`), invalid transition attempts, and terminal-state re-entry guards for photo lifecycle. The completion/failed DB transitions are applied by the Fargate `photo-processed` consumer (the processor Lambda only emits the `photo-processed` message).

- **System Scenario: STS-007-C1**
    - **Given** a photo is in `PHOTO_PENDING` with a valid staged object and a corresponding processing trigger event
    - **When** the processor consumes the event, completes derivative generation successfully, and emits `photo-processed`, and the Fargate consumer processes that message
    - **Then** state transitions `PHOTO_PENDING` → `PHOTO_PROCESSING` → `NORMAL` and the photo record is marked `complete`

- **System Scenario: STS-007-C2**
    - **Given** a photo is in `PHOTO_PENDING` and processing prerequisites are not satisfied (missing/invalid staged object)
    - **When** confirmation or completion is attempted before processing can start
    - **Then** the invalid transition is rejected, the record does not move to `complete`, and state moves to or remains in `PHOTO_FAILED` with explicit reason
    - **Note**: Scenario independence — STS-007-C2 requires a photo in `PHOTO_PENDING` state as fixture; it does not depend on the outcome of STS-007-C1 or STS-007-C3. Execute in isolated test environment.

- **System Scenario: STS-007-C3**
    - **Given** a photo is already in terminal `complete` state
    - **When** a duplicate or replayed `photo-processed` message arrives for the same photo key
    - **Then** the Fargate consumer's idempotency guard prevents terminal-state re-entry and no second processing side effects are applied

---

### Component Verification: SYS-008 (Recipe Versioning and Conflict Service)

**Parent Requirements**: REQ-035, REQ-042a, REQ-042b, REQ-043, REQ-046

#### Test Case: STP-008-A (Version and Conflict Response Contract)

**Technique**: Specification-Based Testing
**Target View**: Interface View
**Description**: Verifies optimistic concurrency checks, explicit conflict payloads, and deterministic version-write behavior.

- **System Scenario: STS-008-A1**
    - **Given** a recipe at server version `7` and an update payload with `expectedVersion=7`
    - **When** `PATCH /v1/recipes/{id}` executes
    - **Then** the mutation succeeds, a new recipe version row is created, and the resulting recipe version increments to `8`

- **System Scenario: STS-008-A2**
    - **Given** a recipe at server version `8` and an update payload with `expectedVersion=7`
    - **When** optimistic concurrency validation executes
    - **Then** the service returns HTTP 409 with `details.currentVersion=8` and `details.conflictingVersion=7` and no silent merge is applied

#### Test Case: STP-008-B (Version Retention Boundaries)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies retention boundary for latest 10 database versions and immutable historical snapshot semantics.

- **System Scenario: STS-008-B1**
    - **Given** a recipe with 12 pre-seeded version rows (versions `1..12`) established via deterministic seed fixtures
    - **When** `GET /v1/recipes/{id}/versions` is requested
    - **Then** exactly the most recent 10 versions (`3..12`) are returned from primary database storage
    - **Note**: Scenario independence — STS-008-B1 requires a recipe with ≥12 version rows as a fixture; it is independent of STS-008-A1 but shares the recipe fixture. Execute in isolated test environment.

- **System Scenario: STS-008-B2**
    - **Given** a restore request for historical version `5`
    - **When** `POST /v1/recipes/{id}/versions/5/restore` executes
    - **Then** a new current version is created from snapshot `5` while pre-existing version snapshots remain immutable

#### Test Case: STP-008-C (Conflict/Concurrency Error-Path Guesses)

**Technique**: Error Guessing
**Target View**: Dependency View
**Description**: Verifies defensive handling for high-risk edge conditions not fully covered by primary partitions (e.g., stale payload shape and replayed mutation intents).

- **System Scenario: STS-008-C1**
    - **Given** a conflict-prone update request where `expectedVersion` is omitted or non-numeric due to malformed client payload
    - **When** concurrency validation executes
    - **Then** request is rejected deterministically with HTTP 400 and no mutation/version side effects occur

- **System Scenario: STS-008-C2**
    - **Given** a client retries an update after receiving HTTP 409 but reuses stale conflict metadata from a previous attempt
    - **When** overwrite/merge follow-up submission is evaluated against current server version
    - **Then** stale replay is rejected with HTTP 409 and the latest server state remains authoritative until explicit valid resolution input is provided

---

### Component Verification: SYS-009 (Version Archive Queue Producer)

**Parent Requirements**: REQ-036, REQ-037, REQ-038, REQ-039

#### Test Case: STP-009-A (Archive Enqueue Interface Contract)

**Technique**: Specification-Based Testing
**Target View**: Interface View
**Description**: Verifies message payload contract and durable pending-archive persistence linked to recipe version saves.

- **System Scenario: STS-009-A1**
    - **Given** a committed recipe version row with serialized snapshot payload
    - **When** archive producer dispatches to SQS after transaction commit
    - **Then** the sent message contains `recipeVersionId` and correlation identifiers required by the worker contract

- **System Scenario: STS-009-A2**
    - **Given** archive producer emits a queue message for a new version
    - **When** persistence validation inspects the database
    - **Then** a matching `recipe_version_pending_archives` row exists referencing that version via the `recipe_version_id` FK (no duplicated `snapshot` column); the replay payload is the same-transaction `recipe_versions.snapshot`

#### Test Case: STP-009-B (Queue Producer Failure Decoupling)

**Technique**: Error Guessing
**Target View**: Dependency View
**Description**: Verifies save-path independence from SQS transient failures and replay-reenqueue behavior.

- **System Scenario: STS-009-B1**
    - **Given** recipe metadata and version rows are committed successfully
    - **When** SQS `SendMessage` fails due to transport or service unavailability
    - **Then** recipe save response remains successful and the `recipe_version_pending_archives` row (referencing `recipe_version_id`) remains, so the same-transaction `recipe_versions.snapshot` is available for replay

- **System Scenario: STS-009-B2**
    - **Given** pending-archive rows older than replay threshold with no successful enqueue
    - **When** replay sweeper executes re-enqueue logic
    - **Then** queue dispatch is retried using the pending row's `recipe_version_id` without modifying the referenced `recipe_versions.snapshot`

---

### Component Verification: SYS-010 (Version Archive Worker and Replay Engine)

**Parent Requirements**: REQ-036, REQ-038, REQ-039, REQ-040, REQ-NF-015

#### Test Case: STP-010-A (Archive Worker Processing Contract)

**Technique**: Specification-Based Testing
**Target View**: Interface View
**Description**: Verifies queue-consume, S3 archive write, and state-transition contract from pending row to archived state.

- **System Scenario: STS-010-A1**
    - **Given** an SQS message referencing a pending archive row with attempt count `0`
    - **When** the worker consumes the message and performs `PutObject` to `versions/{recipe_id}/v{n}.json`
    - **Then** the worker updates `recipe_versions.s3_key`, deletes the corresponding pending row, and acknowledges message completion

- **System Scenario: STS-010-A2**
    - **Given** a duplicate message for a version already marked archived and without a pending row
    - **When** the worker performs idempotency checks
    - **Then** processing completes without duplicate archival side effects and without recreating pending rows

#### Test Case: STP-010-B (Archive Worker Failure and Backlog Control)

**Technique**: Error Guessing
**Target View**: Dependency View
**Description**: Verifies retry/DLQ behaviors, pending-row durability, and backlog safety under dependency failures.

- **System Scenario: STS-010-B1**
    - **Given** `PutObject` to S3 fails for a consumed archive message
    - **When** worker error handling executes
    - **Then** pending row attempt counter increments, row remains replayable, and queue retry or DLQ routing occurs per policy

- **System Scenario: STS-010-B2**
    - **Given** S3 write succeeds but database transition update fails before pending-row delete
    - **When** worker transaction handling executes
    - **Then** pending row is retained to preserve replayability and subsequent reprocessing converges state without data loss

- **System Scenario: STS-010-B3**
    - **Given** an archive message has exhausted configured retries and is in `ARCHIVE_DEAD_LETTER`
    - **When** operator replay is initiated from DLQ back to main archive queue
    - **Then** state transitions `ARCHIVE_DEAD_LETTER` → `ARCHIVE_IN_FLIGHT`, and processing either completes with confirmed archive success or returns to dead-letter path with no duplicate-success side effects

#### Test Case: STP-010-C (Archive Lifecycle State Machine Transition Guards)

**Technique**: State Transition Testing
**Target View**: Operational States
**Description**: Verifies archive lifecycle transitions for success/failure/replay paths, invalid transition attempts, and terminal-state re-entry guards.

- **System Scenario: STS-010-C1**
    - **Given** an archive candidate is in `ARCHIVE_PENDING` with replayable pending payload
    - **When** worker processing begins and archive write completes successfully
    - **Then** state transitions `ARCHIVE_PENDING` → `ARCHIVE_IN_FLIGHT` → `NORMAL`

- **System Scenario: STS-010-C2**
    - **Given** an archive candidate is in `ARCHIVE_IN_FLIGHT`
    - **When** processing fails after retry budget is exhausted
    - **Then** state transitions `ARCHIVE_IN_FLIGHT` → `ARCHIVE_DEAD_LETTER`

- **System Scenario: STS-010-C3**
    - **Given** an archive candidate is in `ARCHIVE_DEAD_LETTER`
    - **When** operator replay is executed back to the main archive queue
    - **Then** state transitions `ARCHIVE_DEAD_LETTER` → `ARCHIVE_IN_FLIGHT`

- **System Scenario: STS-010-C4**
    - **Given** a version already archived in terminal `NORMAL`
    - **When** a transition attempt tries to re-enter `ARCHIVE_IN_FLIGHT` for duplicate archival
    - **Then** the invalid transition is rejected and duplicate archive side effects are prevented

- **System Scenario: STS-010-C5**
    - **Given** a version is in terminal `NORMAL` after successful archival
    - **When** replay/retry logic re-evaluates archival for the same version ID
    - **Then** terminal-state re-entry guards prevent duplicate archival and state remains `NORMAL`

---

### Component Verification: SYS-011 (Collection Management Service)

**Parent Requirements**: REQ-047, REQ-048, REQ-049, REQ-050a, REQ-050b, REQ-056, REQ-CN-001a, REQ-CN-001b

#### Test Case: STP-011-A (Collection CRUD and Membership Contract)

**Technique**: Specification-Based Testing
**Target View**: Interface View
**Description**: Verifies collection CRUD and membership endpoint contracts including many-to-many recipe membership semantics.

- **System Scenario: STS-011-A1**
    - **Given** authenticated ownership context and valid collection payloads
    - **When** `POST /v1/collections`, `PATCH /v1/collections/{id}`, and `POST /v1/collections/{id}/recipes` execute
    - **Then** collection rows are created/updated and membership rows are created with deterministic response bodies

- **System Scenario: STS-011-A2**
    - **Given** one recipe mapped into multiple collections and one collection selected for deletion
    - **When** `DELETE /v1/collections/{id}` executes
    - **Then** collection and membership rows for that collection are removed while recipe rows and other collection memberships remain intact (non-cascade invariant)

#### Test Case: STP-011-B (Collection Policy Class Partitioning)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies access and visibility policy classes for owner vs non-owner and premium vs free-tier contexts.

- **System Scenario: STS-011-B1**
    - **Given** collection owner contexts with premium and free-tier subscription states
    - **When** visibility transitions to `private` are requested on collections
    - **Then** premium-owner transition is accepted and free-tier transition is rejected

- **System Scenario: STS-011-B2**
    - **Given** non-owner principal context on a collection resource
    - **When** mutation operations are requested
    - **Then** service returns HTTP 403 for mutation attempts while public collection read remains allowed for authenticated principals

---

### Component Verification: SYS-012 (Collection Clone and Pull Reconcile Service)

**Parent Requirements**: REQ-051, REQ-052, REQ-053, REQ-054, REQ-055a, REQ-055b, REQ-055c

#### Test Case: STP-012-A (Clone and Source-Link Contract)

**Technique**: Specification-Based Testing
**Target View**: Interface View
**Description**: Verifies clone endpoint contract, snapshot semantics, and `sourceCollectionId` persistence.

- **System Scenario: STS-012-A1**
    - **Given** a public source collection with accessible and inaccessible recipe memberships relative to caller permissions
    - **When** `POST /v1/collections/{id}/clone` executes
    - **Then** cloned collection is created under caller ownership, `sourceCollectionId` references source, and inaccessible source recipes are excluded from clone membership

- **System Scenario: STS-012-A2**
    - **Given** a cloned collection persists with source linkage
    - **When** source collection membership changes after clone creation without pull invocation
    - **Then** clone membership remains unchanged, confirming snapshot-at-clone semantics

#### Test Case: STP-012-B (Pull Reconcile Partitioning Rules)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies reconcile classes for add/remove/protect behavior during explicit pull-from-source operations.

- **System Scenario: STS-012-B1**
    - **Given** cloned collection with source linkage and source collection gains new public recipes while losing access to others
    - **When** `POST /v1/collections/{id}/pull-from-source` executes
    - **Then** reconcile adds newly accessible source recipes and removes source-derived recipes that are no longer accessible

- **System Scenario: STS-012-B2**
    - **Given** cloned collection contains manually added memberships flagged with provenance `manual`
    - **When** pull reconciliation applies source diffs
    - **Then** manual memberships are not removed or overwritten by pull operations

---

### Component Verification: SYS-013 (GDPR Erasure Orchestrator)

**Parent Requirements**: REQ-019a, REQ-019b, REQ-019c, REQ-020a, REQ-020b, REQ-020c, REQ-IF-001a, REQ-IF-001b, REQ-IF-002, REQ-IF-003

#### Test Case: STP-013-A (Erasure API Idempotency Contract)

**Technique**: Specification-Based Testing
**Target View**: Interface View
**Description**: Verifies idempotent status-code contract for queued/running/completed/failed erasure job states.

- **System Scenario: STS-013-A1**
    - **Given** an account with an existing erasure job in `queued` or `running` state
    - **When** `POST /v1/account/erasure` is invoked repeatedly
    - **Then** endpoint returns HTTP 202 with existing job ID and does not enqueue a duplicate job

- **System Scenario: STS-013-A2**
    - **Given** terminal erasure states for an account
    - **When** `POST /v1/account/erasure` is invoked with most recent state `completed` or `failed`
    - **Then** endpoint returns HTTP 410 for completed state and returns HTTP 202 with a new job ID for failed state

#### Test Case: STP-013-B (Erasure Dependency Failure and Recovery)

**Technique**: Error Guessing
**Target View**: Dependency View
**Description**: Verifies hard-purge orchestration under partial storage/database failures and irreversible completion semantics.

- **System Scenario: STS-013-B1**
    - **Given** a tombstoned-recipe purge job where S3 object deletion fails for a subset of archive keys
    - **When** erasure orchestration executes purge steps
    - **Then** job does not transition to `completed`, failed keys remain retryable, and completion is withheld until full storage purge success

- **System Scenario: STS-013-B2**
    - **Given** an erasure job that reaches completed state after successful DB and S3 purges
    - **When** subsequent erasure requests are submitted
    - **Then** no new destructive operations execute and endpoint behavior remains terminal (HTTP 410)

#### Test Case: STP-013-C (Erasure Lifecycle Terminal-State Guards)

**Technique**: State Transition Testing
**Target View**: Operational States
**Description**: Verifies erasure state transitions and terminal re-request behavior with explicit side-effect invariants.

- **System Scenario: STS-013-C1**
    - **Given** an erasure job progresses through `ERASURE_REQUESTED` into `ERASURE_IN_PROGRESS`
    - **When** DB and S3 purge confirmation completes successfully
    - **Then** state transitions to terminal `ERASURE_COMPLETED` and completion ledger is persisted once

- **System Scenario: STS-013-C2**
    - **Given** an account whose latest erasure job is already in terminal `ERASURE_COMPLETED`
    - **When** `POST /v1/account/erasure` is invoked again
    - **Then** no new S3 delete calls, no new DB purge operations, and no new erasure job rows are created; state remains `ERASURE_COMPLETED` and API response is HTTP 410

#### Test Case: STP-013-D (Erasure Concurrency Error-Path Guesses)

**Technique**: Error Guessing
**Target View**: Dependency View
**Description**: Verifies high-risk concurrent erasure edges: erasure request during active session and concurrent erasure plus recipe creation.

- **System Scenario: STS-013-D1**
    - **Given** an account has an active authenticated session while erasure is requested
    - **When** erasure orchestration progresses from request to execution
    - **Then** destructive workflow remains deterministic and no post-terminal user-data reactivation occurs

- **System Scenario: STS-013-D2**
    - **Given** an erasure job is in progress while a concurrent recipe-create command is submitted for the same account
    - **When** persistence orchestration resolves the race between create and erasure operations
    - **Then** state converges deterministically without partial-resurrection inconsistencies across metadata and storage artifacts

---

### Component Verification: SYS-014 (Data Access and Persistence Layer)

**Parent Requirements**: REQ-003a, REQ-003b, REQ-016, REQ-018a, REQ-018b, REQ-019a, REQ-019b, REQ-019c, REQ-035, REQ-039, REQ-040, REQ-054, REQ-056, REQ-NF-002, REQ-NF-013a, REQ-NF-013b, REQ-NF-013c

#### Test Case: STP-014-A (Persistence Boundary and Retention Rules)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies tombstone filtering defaults, version retention boundaries, pending-archive durability, and deterministic seed behavior.

- **System Scenario: STS-014-A1**
    - **Given** active and tombstoned rows across recipes, collections, and search index projections
    - **When** repository list/search/detail read methods execute in standard mode
    - **Then** all queries enforce `deleted_at IS NULL` filtering by default and exclude tombstoned entities from normal read surfaces

- **System Scenario: STS-014-A2**
    - **Given** repeated seed execution against a clean schema and a schema already containing seeded data
    - **When** idempotent seed scripts run
    - **Then** stable primary IDs are preserved across runs and fixture-based assertions remain deterministic

#### Test Case: STP-014-B (Transactional Failure Integrity)

**Technique**: Error Guessing
**Target View**: Dependency View
**Description**: Verifies atomic rollback and replay-safe persistence behavior under SQL and connection failures.

- **System Scenario: STS-014-B1**
    - **Given** a multi-table recipe-save transaction where an inner write operation violates a constraint
    - **When** transaction execution fails mid-flight
    - **Then** all related writes are rolled back atomically and no partial recipe graph persists

- **System Scenario: STS-014-B2**
    - **Given** pending-archive delete/update transition attempts during transient database connection interruption
    - **When** persistence layer retries are triggered
    - **Then** pending rows are preserved until confirmed successful state transition and replay remains idempotent

---

### Component Verification: SYS-015 (Object Storage and CDN Subsystem)

**Parent Requirements**: REQ-008, REQ-009, REQ-019b, REQ-020b, REQ-036, REQ-038, REQ-040

#### Test Case: STP-015-A (Storage and Delivery Interface Contract)

**Technique**: Specification-Based Testing
**Target View**: Interface View
**Description**: Verifies presigned upload, archive object write, and CloudFront delivery contracts for recipe media and version artifacts.

- **System Scenario: STS-015-A1**
    - **Given** valid presigned upload metadata (`content-type`, size limit, object key prefix)
    - **When** client uploads photo bytes and confirmation flow completes
    - **Then** object is persisted under expected S3 path and CDN retrieval returns HTTPS media response for generated delivery URL

- **System Scenario: STS-015-A2**
    - **Given** archive worker writes version snapshot object to `versions/{recipe_id}/v{n}.json`
    - **When** object metadata is inspected
    - **Then** object key naming, retention behavior, and at-rest encryption policy are consistent with archive subsystem constraints

#### Test Case: STP-015-B (Storage Failure Propagation)

**Technique**: Error Guessing
**Target View**: Dependency View
**Description**: Verifies subsystem response to signature expiration, size policy violations, and upstream origin failures.

- **System Scenario: STS-015-B1**
    - **Given** an expired presigned URL or upload body that exceeds signed content-length range
    - **When** upload is attempted against S3
    - **Then** storage returns access/validation failure and no object is committed under target key

- **System Scenario: STS-015-B2**
    - **Given** CloudFront origin fetch failures caused by S3 unavailability
    - **When** delivery and dependent processing paths execute
    - **Then** failure signals propagate to operational logs/retry paths while database state transitions remain guarded by explicit success checks

---

### Component Verification: SYS-016 (Web Client Application (Next.js))

**Parent Requirements**: REQ-011, REQ-012, REQ-014, REQ-015, REQ-034, REQ-044, REQ-045, REQ-IF-004a, REQ-IF-004c, REQ-IF-005b, REQ-IF-005c, REQ-NF-003, REQ-NF-007, REQ-NF-008, REQ-NF-018

#### Test Case: STP-016-A (Web Client API and Auth Contract)

**Technique**: Specification-Based Testing
**Target View**: Interface View
**Description**: Verifies web client route protection, API base URL resolution, and conflict-resolution action wiring to backend contracts.

- **System Scenario: STS-016-A1**
    - **Given** web runtime with a Clerk session and `NEXT_PUBLIC_API_URL` unset
    - **When** recipe API client initializes and requests protected resources
    - **Then** base URL resolves to `http://localhost:4000`, bearer credentials are attached, and unauthenticated route access is blocked

- **System Scenario: STS-016-A2**
    - **Given** a recipe update receives HTTP 409 with `currentVersion` and `conflictingVersion`
    - **When** conflict module executes resolution actions (`keep-server`, `overwrite-local`, `merge-fields`)
    - **Then** generated follow-up API calls use deterministic payload shapes aligned to versioning endpoint contracts

#### Test Case: STP-016-B (Web Input-Class and Accessibility Partitions)

**Technique**: Equivalence Partitioning + Error Guessing
**Target View**: Decomposition View
**Description**: Verifies client-side file validation classes and accessibility invariants across upload and conflict components.

- **System Scenario: STS-016-B1**
    - **Given** three file classes from browser file input: allowed MIME and valid size, disallowed MIME, allowed MIME with oversize body
    - **When** pre-upload validation executes in recipe form module
    - **Then** valid class proceeds to upload-url request and invalid classes emit per-file error objects suitable for independent retry handling

- **System Scenario: STS-016-B2**
    - **Given** upload status and conflict status components rendered in web UI
    - **When** accessibility inspection runs using role/label selectors
    - **Then** each interactive control exposes accessible names and each status state is represented by text or icon in addition to color

---

### Component Verification: SYS-017 (Mobile Client Application (Expo/React Native))

**Parent Requirements**: REQ-011, REQ-012, REQ-014, REQ-015, REQ-034, REQ-044, REQ-045, REQ-IF-004b, REQ-IF-004c, REQ-IF-005b, REQ-IF-005c, REQ-NF-003, REQ-NF-007, REQ-NF-008, REQ-NF-019

#### Test Case: STP-017-A (Mobile API and Auth Contract Parity)

**Technique**: Specification-Based Testing
**Target View**: Interface View
**Description**: Verifies mobile API contract parity with web, authenticated access requirements, and environment-based API resolution.

- **System Scenario: STS-017-A1**
    - **Given** mobile runtime with `EXPO_PUBLIC_API_URL` unset and a valid Clerk session token
    - **When** API client bootstrap executes
    - **Then** base URL resolves to `http://localhost:4000`, protected endpoint calls carry identity tokens, and anonymous API access is blocked

- **System Scenario: STS-017-A2**
    - **Given** mobile recipe edit flow receives conflict response HTTP 409
    - **When** conflict-resolution module dispatches selected action type
    - **Then** mobile client issues follow-up requests matching backend conflict contract and preserves the same three action set as web

#### Test Case: STP-017-B (Mobile Validation and Accessibility Partitions)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies mobile media validation classes and accessibility parity constraints.

- **System Scenario: STS-017-B1**
    - **Given** photo picker outputs media entries spanning allowed MIME/size class and invalid MIME/size classes
    - **When** mobile pre-upload validation executes
    - **Then** valid entries proceed and invalid entries generate per-file error models enabling isolated retries

- **System Scenario: STS-017-B2**
    - **Given** mobile UI components for upload state, nutrition notice, and conflict controls
    - **When** accessibility assertions execute
    - **Then** controls expose stable accessible labels and status semantics are not conveyed by color alone

---

### Component Verification: SYS-018 (Configuration and Environment Resolution)

**Parent Requirements**: REQ-NF-018, REQ-NF-019, REQ-NF-020

#### Test Case: STP-018-A (Environment Boundary Resolution)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies defaults, overrides, and strict schema validation for environment-derived runtime configuration.

- **System Scenario: STS-018-A1**
    - **Given** web and mobile environment variables for API base URL are unset
    - **When** typed configuration loader resolves runtime values
    - **Then** both clients resolve to `http://localhost:4000` and local service ports remain `4000/3000/8081/5432/4566`

- **System Scenario: STS-018-A2**
    - **Given** malformed URL or invalid numeric port values in environment variables
    - **When** configuration schema parsing executes at startup
    - **Then** startup fails fast with typed validation errors and no partial runtime config is published

#### Test Case: STP-018-B (Runtime Configuration Class Partitioning)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies configuration classes for API service, web client, mobile client, and test/CI runtime.

- **System Scenario: STS-018-B1**
    - **Given** runtime class `api-service`
    - **When** config loader resolves environment map
    - **Then** only service-relevant keys are materialized and output object types match declared schema contract

- **System Scenario: STS-018-B2**
    - **Given** runtime classes `web-client`, `mobile-client`, and `ci-test`
    - **When** config loader executes for each class
    - **Then** each class resolves the expected key set and produces consistent endpoint/port values across local and CI profiles

---

### Component Verification: SYS-019 (Observability and Alerting)

**Parent Requirements**: REQ-041, REQ-NF-004, REQ-NF-015, REQ-NF-016, REQ-NF-017

#### Test Case: STP-019-A (Telemetry and Alarm Interface Contract)

**Technique**: Specification-Based Testing
**Target View**: Interface View
**Description**: Verifies archive failure metrics, backlog metrics, and CloudWatch alarm threshold wiring.

- **System Scenario: STS-019-A1**
    - **Given** archive worker processing emits success/failure outcomes and backlog measurements
    - **When** telemetry publisher writes metrics
    - **Then** metrics for failure count, pending row count, and oldest pending age are emitted with dimensions enabling queue/worker correlation

- **System Scenario: STS-019-A2**
    - **Given** backlog count exceeds 100 for more than 15 minutes or oldest pending row age exceeds 1 hour
    - **When** alarm evaluators execute on metric streams
    - **Then** configured alarms transition to ALARM state and notification routes are triggered

#### Test Case: STP-019-B (Monitoring Path Failure Containment)

**Technique**: Error Guessing
**Target View**: Dependency View
**Description**: Verifies system behavior when observability dependencies fail, ensuring no business-path coupling.

- **System Scenario: STS-019-B1**
    - **Given** telemetry publish operation fails due to CloudWatch API error
    - **When** worker completes archive handling for a queue message
    - **Then** monitoring error is logged and core archive processing path follows worker success/failure semantics without blocking commit decisions

- **System Scenario: STS-019-B2**
    - **Given** repeated archive failures produce queue retries and DLQ movement
    - **When** alert emission path is degraded
    - **Then** pending/archive state machine remains consistent and failure visibility is recoverable from persisted logs/metrics once telemetry path is restored

---

### Component Verification: SYS-020 (Quality, Test, and CI Governance)

**Parent Requirements**: REQ-CN-002, REQ-NF-005a, REQ-NF-005b, REQ-NF-006, REQ-NF-009, REQ-NF-010a, REQ-NF-010b, REQ-NF-011a, REQ-NF-011b, REQ-NF-011c, REQ-NF-012a, REQ-NF-012b, REQ-NF-013a, REQ-NF-013b, REQ-NF-013c, REQ-NF-014a, REQ-NF-014b, REQ-NF-014c

#### Test Case: STP-020-A (CI Gate and Toolchain Contract)

**Technique**: Specification-Based Testing
**Target View**: Interface View
**Description**: Verifies mandatory CI gates, strict TypeScript/JSDoc checks, and required test stages for merge eligibility.

- **System Scenario: STS-020-A1**
    - **Given** a pull request revision entering CI
    - **When** workflow executes quality gates
    - **Then** `typecheck`, `lint`, `format:check`, `test`, and `test:e2e` jobs run, and merge eligibility is denied if any required job fails

- **System Scenario: STS-020-A2**
    - **Given** source exports and strict typing rules under review
    - **When** static analysis executes
    - **Then** violations such as missing JSDoc on exports or prohibited non-test `any` usage fail governance checks

#### Test Case: STP-020-B (Test Strategy Class Partitioning and Scope Constraints)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies separation of unit/integration/E2E responsibilities, LocalStack requirements, deterministic seed usage, and explicit out-of-scope friend-system exclusion.

- **System Scenario: STS-020-B1**
    - **Given** test suites classified as unit/component, integration, web E2E, and mobile E2E
    - **When** governance rules evaluate suite configuration
    - **Then** unit/component tests use `make*` factories with mocked dependencies, integration tests use LocalStack-backed AWS emulation, and E2E suites use Playwright (`*.spec.ts`) and Maestro (`*.yaml`) with deterministic seeded IDs

- **System Scenario: STS-020-B2**
    - **Given** feature-scope conformance checks over API routes, schema artifacts, and client navigation maps
    - **When** out-of-scope constraint validation executes
    - **Then** friend-system capabilities (QR/friend-code/request flows) are absent from delivered artifacts and any detected addition fails governance checks

---

### Component Verification: SYS-021 (Home Widget Surface and Curation Pipeline)

**Parent Requirements**: REQ-058, REQ-059, REQ-060, REQ-061, REQ-062, REQ-063, REQ-064, REQ-065, REQ-IF-004c, REQ-IF-006

_Verifies US-0 / FR-046: the post-login Home **widget surface** — discovery by explicit startup registration, composition by `curateHomeWidgets(widgets, ctx)` (capability + subscription-tier gating, personalization ordering), and render via `React.lazy`/`next/dynamic` + Suspense + per-widget `ErrorBoundary` (unknown ids skipped). Design authority: `research/home-widget-architecture.md` (`## DECISION (2026-07-06)`). The Home widget contract (`HomeWidgetId`, `HomeWidgetDescriptor`, `curateHomeWidgets`) lives in `@commise/features-core`; the live recipe widget loads via `@commise/features-recipes/widget/{web|mobile}`. Per-user layout is persisted via `PATCH /v1/profiles/me`, **owned by the identity service (002) and consumed here**._

#### Test Case: STP-021-A (Widget Curation Capability-Gating Decision Matrix)

**Technique**: Decision Table Testing
**Target View**: Decomposition View
**Description**: Verifies the `curateHomeWidgets` capability-gating invariant across the multi-condition matrix of backing-service capability (live/absent) × subscription tier, and personalization ordering of the surviving widgets.

- **System Scenario: STS-021-A1**
    - **Given** a widget descriptor whose backing-service **capability is absent** (service not deployed) and a widget descriptor whose capability is present and tier requirement is satisfied
    - **When** `curateHomeWidgets(widgets, ctx)` evaluates the registered set for a user
    - **Then** the capability-gating invariant holds: the absent-capability widget is **excluded from the curated list entirely** (it is not returned as a hidden/empty entry), and the satisfied widget is included and ordered by its personalization weight

- **System Scenario: STS-021-A2**
    - **Given** curation inputs `capability ∈ {live, absent}` and `tier ∈ {premium, free}` applied to a registered widget carrying a `minTier` and a `capability`
    - **When** decision-table evaluation executes for inclusion in the curated Home list
    - **Then** expected outcomes are:

        | Capability | Tier    | `minTier` | Outcome for widget |
        | ---------- | ------- | --------- | ------------------ |
        | live       | premium | premium   | Included           |
        | live       | free    | premium   | Excluded           |
        | live       | premium | free      | Included           |
        | live       | free    | free      | Included           |
        | absent     | premium | premium   | Excluded           |
        | absent     | free    | free      | Excluded           |

#### Test Case: STP-021-B (Home Surface Composition and Render Contract)

**Technique**: Specification-Based Testing
**Target View**: Interface View
**Description**: Verifies the v1 recipe-only-live registration contract, absent-not-empty gated-widget behavior, unknown-id skip, and per-widget error isolation of the render chain.

- **System Scenario: STS-021-B1**
    - **Given** a v1 client build in which **only the recipe (recent-recipes) widget is registered** (the meal-plan/nutrition/shopping/AI-suggestion/resume-cooking widgets are not registered — their `@commise/features-*` packages backed by services 005–009 do not exist yet)
    - **When** the Home host runs discovery + `curateHomeWidgets` and renders the surface
    - **Then** exactly the recipe widget renders (its empty-state applies only because it is live), and every gated widget is **absent — not present as an empty or dead tile**

- **System Scenario: STS-021-B2**
    - **Given** an ordered widget-id list that includes (a) an id not present in the client render registry and (b) a registered widget whose lazy `load`/render throws
    - **When** the render chain maps ids through the registry and mounts each via `React.lazy`/`next/dynamic` + Suspense + per-widget `ErrorBoundary`
    - **Then** the unknown id is skipped and the throwing widget is contained by its `ErrorBoundary` (renders nothing), while all other widgets still render — a single widget never breaks the page

#### Test Case: STP-021-C (Capability Emergence State Transition)

**Technique**: State Transition Testing
**Target View**: Operational States
**Description**: Verifies that a gated widget auto-appears when its backing service deploys (capability transitions absent → present) with no client change, using the AI-suggestion widget backed by service **005** as the representative case.

- **System Scenario: STS-021-C1**
    - **Given** the AI-suggestion widget descriptor is registered with `capability='ai-suggestions'` while service 005 is **not deployed** (capability absent), so `curateHomeWidgets` excludes it and the Home surface renders without it
    - **When** service 005 deploys and the capability flag transitions **absent → present**, and the same user next views Home (no client redeploy)
    - **Then** `curateHomeWidgets` now includes the AI-suggestion widget and it renders one AI-generated recipe suggestion; the transition is one-directional for this scenario and no other widget's presence changes

#### Test Case: STP-021-D (Nudge Suppression and Cross-Platform Parity Partitions)

**Technique**: Equivalence Partitioning + Error Guessing
**Target View**: Decomposition View
**Description**: Verifies the once-per-session subscription-nudge suppression class and the cross-platform live-widget parity invariant (FR-044a).

- **System Scenario: STS-021-D1**
    - **Given** a free-tier user on the Home surface who taps one or more premium-gated entry points within a single session
    - **When** the first and subsequent premium-gated taps are handled
    - **Then** the subscription upgrade nudge appears on the first tap and is suppressed for the remainder of the session (component-state suppression, no backend call) — at most once per session regardless of tap count

- **System Scenario: STS-021-D2**
    - **Given** the Home surface composed on web (`next/dynamic` client host) and on mobile (`React.lazy` host) for the same user context
    - **When** the curated live-widget set is compared across platforms
    - **Then** every **live** widget (the recipe widget in v1) is present on both web and mobile behind one widget id with per-platform `.native.tsx` implementations; no live widget is absent on either platform

---

## Coverage Summary

| Metric                         | Count          |
| ------------------------------ | -------------- |
| Total System Components (SYS)  | 21             |
| Total Test Cases (STP)         | 53             |
| Total Scenarios (STS)          | 110            |
| Components with ≥1 STP         | 21 / 21 (100%) |
| Test Cases with ≥1 STS         | 53 / 53 (100%) |
| **Overall Coverage (SYS→STP)** | **100%**       |

### STS Index (Grouped by STP)

| STP       | STS IDs                                                    |
| --------- | ---------------------------------------------------------- |
| STP-001-A | STS-001-A1, STS-001-A2                                     |
| STP-001-B | STS-001-B1, STS-001-B2                                     |
| STP-001-C | STS-001-C1, STS-001-C2, STS-001-C3                         |
| STP-002-A | STS-002-A1, STS-002-A2, STS-002-A3                         |
| STP-002-B | STS-002-B1, STS-002-B2                                     |
| STP-003-A | STS-003-A1, STS-003-A2                                     |
| STP-003-B | STS-003-B1, STS-003-B2, STS-003-B3                         |
| STP-003-C | STS-003-C1                                                 |
| STP-004-A | STS-004-A1, STS-004-A2                                     |
| STP-004-B | STS-004-B1, STS-004-B2                                     |
| STP-005-A | STS-005-A1, STS-005-A2                                     |
| STP-005-B | STS-005-B1                                                 |
| STP-005-C | STS-005-C1                                                 |
| STP-006-A | STS-006-A1, STS-006-A2                                     |
| STP-006-B | STS-006-B1, STS-006-B2                                     |
| STP-006-C | STS-006-C1, STS-006-C2                                     |
| STP-007-A | STS-007-A1, STS-007-A2                                     |
| STP-007-B | STS-007-B1, STS-007-B2                                     |
| STP-007-C | STS-007-C1, STS-007-C2, STS-007-C3                         |
| STP-008-A | STS-008-A1, STS-008-A2                                     |
| STP-008-B | STS-008-B1, STS-008-B2                                     |
| STP-008-C | STS-008-C1, STS-008-C2                                     |
| STP-009-A | STS-009-A1, STS-009-A2                                     |
| STP-009-B | STS-009-B1, STS-009-B2                                     |
| STP-010-A | STS-010-A1, STS-010-A2                                     |
| STP-010-B | STS-010-B1, STS-010-B2, STS-010-B3                         |
| STP-010-C | STS-010-C1, STS-010-C2, STS-010-C3, STS-010-C4, STS-010-C5 |
| STP-011-A | STS-011-A1, STS-011-A2                                     |
| STP-011-B | STS-011-B1, STS-011-B2                                     |
| STP-012-A | STS-012-A1, STS-012-A2                                     |
| STP-012-B | STS-012-B1, STS-012-B2                                     |
| STP-013-A | STS-013-A1, STS-013-A2                                     |
| STP-013-B | STS-013-B1, STS-013-B2                                     |
| STP-013-C | STS-013-C1, STS-013-C2                                     |
| STP-013-D | STS-013-D1, STS-013-D2                                     |
| STP-014-A | STS-014-A1, STS-014-A2                                     |
| STP-014-B | STS-014-B1, STS-014-B2                                     |
| STP-015-A | STS-015-A1, STS-015-A2                                     |
| STP-015-B | STS-015-B1, STS-015-B2                                     |
| STP-016-A | STS-016-A1, STS-016-A2                                     |
| STP-016-B | STS-016-B1, STS-016-B2                                     |
| STP-017-A | STS-017-A1, STS-017-A2                                     |
| STP-017-B | STS-017-B1, STS-017-B2                                     |
| STP-018-A | STS-018-A1, STS-018-A2                                     |
| STP-018-B | STS-018-B1, STS-018-B2                                     |
| STP-019-A | STS-019-A1, STS-019-A2                                     |
| STP-019-B | STS-019-B1, STS-019-B2                                     |
| STP-020-A | STS-020-A1, STS-020-A2                                     |
| STP-020-B | STS-020-B1, STS-020-B2                                     |
| STP-021-A | STS-021-A1, STS-021-A2                                     |
| STP-021-B | STS-021-B1, STS-021-B2                                     |
| STP-021-C | STS-021-C1                                                 |
| STP-021-D | STS-021-D1, STS-021-D2                                     |

## Uncovered Components

None — full coverage achieved.

## Peer-Review Remediation Log

| Finding ID  | Action Taken                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRF-STP-001 | Remapped affected technique declarations from `Interface Contract Testing` to `Specification-Based Testing` in the ISO techniques section and test cases `STP-001-A`, `STP-002-A`, `STP-004-A`, `STP-005-A`, `STP-006-B`, `STP-007-A`, `STP-008-A`, `STP-009-A`, `STP-010-A`, `STP-011-A`, `STP-012-A`, `STP-013-A`, `STP-015-A`, `STP-016-A`, `STP-017-A`, `STP-019-A`, and `STP-020-A`.               |
| PRF-STP-002 | Remapped affected technique declarations from `Fault Injection` to `Error Guessing` in `STP-001-B`, `STP-007-B`, `STP-009-B`, `STP-010-B`, `STP-013-B`, `STP-014-B`, `STP-015-B`, and `STP-019-B`.                                                                                                                                                                                                      |
| PRF-STP-003 | Added `STP-010-C` (State Transition Testing) with `STS-010-C1..C5` covering success path, failure path, DLQ replay, invalid transition on `NORMAL`, and terminal-state re-entry guard.                                                                                                                                                                                                                  |
| PRF-STP-004 | Split compound `STS-003-B2` into atomic cases: updated `STS-003-B2` (clone exists with zero edits) and added `STS-003-B3` (metadata/photo-only edits).                                                                                                                                                                                                                                                  |
| PRF-STP-005 | Extracted latency/load scenario to new `STP-005-C` (`Performance Testing`) with explicit non-functional conditions; retained `STP-005-B` as boundary-only coverage.                                                                                                                                                                                                                                     |
| PRF-STP-006 | Added `STP-003-C` using `Decision Table Testing` with explicit tier × source × edit-state matrix outcomes for `private` transition decisions.                                                                                                                                                                                                                                                           |
| PRF-STP-007 | Added Error Guessing cases for additional high-risk components: `STP-001-C` (JWT edge cases), `STP-006-C` (upload/confirm race conditions), and `STP-013-D` (erasure/session concurrency).                                                                                                                                                                                                              |
| PRF-STP-008 | Clarified `STS-008-B1` Given clause to deterministic seeded setup: recipe with 12 pre-seeded version rows (`1..12`).                                                                                                                                                                                                                                                                                    |
| PRF-STP-009 | Added flat `STS Index (Grouped by STP)` under Coverage Summary so scenario totals are independently verifiable from document structure.                                                                                                                                                                                                                                                                 |
| PRF-STP-010 | Updated `STP-016-B` technique from `Equivalence Partitioning` to `Equivalence Partitioning + Error Guessing` to cover accessibility partition (STS-016-B2) as error-guessing target. Added scenario independence notes to STS-007-C2 and STS-008-B1. Updated Performance Testing technique description to document Analysis verification for STP-NF-004-A, STP-NF-015-A, and executable case STP-005-C. |
| FIX2-STP-001 (D3) | Added `SYS-021` (Home Widget Surface and Curation Pipeline) with `STP-021-A..D` / `STS-021-A1..D2` covering US-0 / FR-046: capability-gating invariant + decision matrix (`STP-021-A`), recipe-only-live registration with gated widgets **absent not empty** and unknown-id/ErrorBoundary render isolation (`STP-021-B`), AI-suggestion capability-emergence on service **005** deploy (`STP-021-C`), and once-per-session nudge + cross-platform live-widget parity (`STP-021-D`). Coverage counts updated 20→21 SYS, 49→53 STP, 103→110 STS. |
| FIX2-STP-002 (D1) | Reworked `SYS-007` (Photo Processing Lambda) scenarios so the processor is **S3-only / not VPC-attached** and emits an SQS `photo-processed` message; the `recipe_photos` completion/failed `UPDATE` is performed by the in-VPC **Fargate `photo-processed` consumer** (STS-007-A1/A2, B1/B2, C1, C3). |
| FIX2-STP-003 (D6) | Reworded `STS-009-A2/B1/B2` to the pending-archive **FK design**: `recipe_version_pending_archives` references the version via `recipe_version_id` with **no duplicated `snapshot` column** — the replay payload is the same-transaction `recipe_versions.snapshot`. |
| FIX2-STP-004 (D5/C4) | Normalized canonical values: freeform ingredient flag `userEntered=true` → `isUserEntered=true` (D5 separate boolean) in STS-004-A2; unified the recipe id path param to `{id}` (C4) in STS-006/008 endpoints; aligned the archive S3 key to `versions/{recipe_id}/v{n}.json`. |
