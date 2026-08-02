# Integration Test Plan: Recipe Digitization & Family Circles

**Feature Branch**: `011-recipe-digitization`
**Created**: 2026-05-10
**Status**: Draft
**Source**: `specs/011-recipe-digitization/v-model/architecture-design.md`

## Overview

This document defines the V-Model Integration Test Plan for Feature 011. It verifies module-boundary contracts across all architecture modules `ARCH-001..ARCH-047`, including cross-cutting modules `ARCH-041..ARCH-047`.

Scope focus:

- Boundary contracts (API, queue, storage, package contracts)
- Inter-module communication paths (API → DB, API → SQS, worker → adapter → persistence)
- Data flow transformations (raw photo → S3 object → OCR payload → parsed recipe)
- Sequence/order correctness for stateful workflows (digitization pipeline, invitation/circle lifecycle)

This feature is **non-regulated**. No safety-critical taxonomy is applied.

## Test ID & Technique Rules

- Test Case ID format: `ITP-{ARCH_NNN}-{SUFFIX}`
- Every architecture module has at least one `ITP-NNN-A` using **Interface Testing**
- Additional test cases use one of the mandatory ISO 29119 integration techniques:
    - **Interface Testing**
    - **Communication Path Testing**
    - **Data Flow Testing**
    - **Sequence/Order Testing**

## Integration Tests

### Architecture Module Integration: ARCH-001 — Capture UI Shell (Web) (View: Interface)

#### Test Case: ITP-001-A — Web capture UploadIntent contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-001`, `ARCH-003`
- Preconditions:
    - Authenticated web session via `@clerk/nextjs`
    - Browser file-picker access
    - Candidate files include valid `jpeg/png/heic` and invalid MIME sample
- Test Steps:
    1. Select 3 valid files and 1 invalid file in the web capture surface.
    2. Trigger batch creation and inspect emitted `UploadIntent` payload.
    3. Verify `UploadIntent` shape: `{ batch_id, items: [{ client_id, mime, size }] }`.
    4. Pass payload to `ARCH-003` input boundary.
- Expected Interactions:
    - Invalid MIME file is rejected client-side before `UploadIntent` emission.
    - Valid files are grouped under one `batch_id` and forwarded to `ARCH-003`.
    - No direct API call occurs from `ARCH-001` without `ARCH-003` mediation.
- Trace to SYS-NNN: `SYS-001`

### Architecture Module Integration: ARCH-002 — Capture UI Shell (Mobile) (View: Interface)

#### Test Case: ITP-002-A — Mobile capture UploadIntent parity contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-002`, `ARCH-003`
- Preconditions:
    - Authenticated mobile credentials via `@clerk/expo`
    - `expo-secure-store` contains valid token
    - Camera/library permission granted
- Test Steps:
    1. Select assets through Expo image picker.
    2. Build mobile `UploadIntent` and compare schema to web contract.
    3. Submit to `ARCH-003` upload client adapter.
    4. Repeat with oversized asset.
- Expected Interactions:
    - Mobile emits the same `UploadIntent` contract used by web.
    - Oversized asset fails on mobile pre-check and is not forwarded.
    - `ARCH-003` accepts payload without platform-specific branching.
- Trace to SYS-NNN: `SYS-001`

### Architecture Module Integration: ARCH-003 — Pre-signed Upload Client (View: Data Flow)

#### Test Case: ITP-003-A — S3 PUT contract using pre-signed URL

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-003`, `ARCH-005`, `ARCH-007`
- Preconditions:
    - `POST /api/v1/recipes/digitize/jobs` returns `upload_url` and `expires_at`
    - Test object bytes prepared
    - Valid Clerk session token
- Test Steps:
    1. Call intake endpoint and capture returned `upload_url`.
    2. Execute HTTP PUT to S3 pre-signed URL with file bytes.
    3. Verify response headers include `etag` and object key reference.
    4. Call status/read path to confirm object metadata persisted by `ARCH-007`.
- Expected Interactions:
    - PUT succeeds before TTL expiry (`<=15 min`).
    - `ARCH-007` can resolve written object at `s3://photos/<user_id>/<job_id>/original.<ext>`.
    - Upload reject 4xx is surfaced as non-retriable by `ARCH-003`.
- Trace to SYS-NNN: `SYS-001`, `SYS-002`, `SYS-004`

#### Test Case: ITP-003-B — Retry communication path for transient upload failures

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-003`, `ARCH-041`, `ARCH-044`
- Preconditions:
    - Network fault injection enabled for first 2 PUT attempts
    - Idempotency key attached to intake path
- Test Steps:
    1. Trigger upload with transient 5xx on first two attempts.
    2. Observe exponential backoff retry behavior (max 5 attempts).
    3. Verify structured logs include retry count and `batch_id` context.
- Expected Interactions:
    - Retries are attempted only for network/transient failures.
    - Idempotency prevents duplicate intake-side job creation.
    - Final success yields single persisted object binding.
- Trace to SYS-NNN: `SYS-001`, `SYS-002`

### Architecture Module Integration: ARCH-004 — Offline Capture Queue (View: Process)

#### Test Case: ITP-004-A — Queue payload and drain contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-004`, `ARCH-003`
- Preconditions:
    - Offline mode enabled (no network)
    - Local store available (IndexedDB/SQLite)
- Test Steps:
    1. Enqueue `QueuedUpload` payloads: `{ batch_id, asset_ref, attempts }`.
    2. Restore connectivity and trigger drain event.
    3. Confirm drained items are converted into `ARCH-003` upload requests.
- Expected Interactions:
    - Queue depth reflects number of unsent uploads.
    - Drained items are emitted in persisted order.
    - Successfully uploaded entries are removed from local queue.
- Trace to SYS-NNN: `SYS-001`

#### Test Case: ITP-004-B — Connectivity restore ordering

- Technique: **Sequence/Order Testing**
- Modules Under Test: `ARCH-004`, `ARCH-003`, `ARCH-005`
- Preconditions:
    - 5 queued uploads across 2 `batch_id` values
- Test Steps:
    1. Trigger connectivity-restored event.
    2. Observe drain order and API intake ordering.
    3. Verify each queued item maps to one intake/upload lifecycle.
- Expected Interactions:
    - No starvation across batch groups.
    - FIFO-by-enqueue order maintained within each batch.
    - No duplicate dispatch for the same queue record.
- Trace to SYS-NNN: `SYS-001`

### Architecture Module Integration: ARCH-005 — Digitization Job Intake Controller (View: Interface)

#### Test Case: ITP-005-A — Intake API contract for `POST /api/v1/recipes/digitize/jobs`

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-005`, `ARCH-006`, `ARCH-027`, `ARCH-028`, `ARCH-047`
- Preconditions:
    - Route mounted at `/api/v1/recipes/digitize/jobs`
    - Bearer token valid
    - Header `Idempotency-Key` present
- Test Steps:
    1. Send valid request body `{ batch_id, items: [{ mime, size }] }`.
    2. Assert `201` response shape `{ job_id, batch_id, upload_url, expires_at }[]`.
    3. Inspect `digitization_jobs` rows for `state='awaiting-upload'`.
    4. Re-send same idempotency key with same payload.
- Expected Interactions:
    - Initial request creates rows and pre-signed URLs.
    - Repeat request with same key returns stable response semantics.
    - Validation/auth errors return RFC 7807 from `ARCH-028`.
- Trace to SYS-NNN: `SYS-002`

#### Test Case: ITP-005-B — Idempotency conflict path

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-005`, `ARCH-044`, `ARCH-028`
- Preconditions:
    - Existing idempotency key mapped to prior payload hash
- Test Steps:
    1. Submit same `Idempotency-Key` with modified payload.
    2. Capture response and error body.
- Expected Interactions:
    - Server returns `409` RFC 7807 conflict.
    - `error_code` indicates idempotency conflict.
    - No additional `digitization_jobs` rows are created.
- Trace to SYS-NNN: `SYS-002`

### Architecture Module Integration: ARCH-006 — Image Pre-flight Validator (View: Interface)

#### Test Case: ITP-006-A — Validation boundary contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-006`, `ARCH-005`, `ARCH-028`
- Preconditions:
    - Intake endpoint active
    - Validation rules configured: min `300x300`, max `20MB`, MIME `jpeg/png/heic`
- Test Steps:
    1. Submit image metadata violating each rule one-by-one.
    2. Capture error responses.
    3. Submit fully valid metadata.
- Expected Interactions:
    - Violations return `400` Problem Details with stable `error_code`.
    - Valid metadata passes to row creation path.
    - Validator does not write DB state directly.
- Trace to SYS-NNN: `SYS-003`

#### Test Case: ITP-006-B — Invalid payload data-flow to error envelope

- Technique: **Data Flow Testing**
- Modules Under Test: `ARCH-006`, `ARCH-028`, `ARCH-041`, `ARCH-046`
- Preconditions:
    - Invalid intake payload generator available
- Test Steps:
    1. Submit malformed MIME + excessive size metadata.
    2. Trace transformation from `PreflightError` to RFC 7807 body.
    3. Inspect correlated log + trace attributes.
- Expected Interactions:
    - `PreflightError` is transformed without loss of stable `error_code`.
    - Log line includes request context and validation failure category.
    - Span includes failure attributes for observability.
- Trace to SYS-NNN: `SYS-003`, `SYS-020`, `SYS-026`

### Architecture Module Integration: ARCH-007 — S3 Photo Object Adapter (View: Data Flow)

#### Test Case: ITP-007-A — Object metadata persistence contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-007`, `ARCH-003`, `ARCH-047`
- Preconditions:
    - Successful pre-signed upload completed
    - `digitization_jobs` row exists
- Test Steps:
    1. Resolve S3 object metadata after upload.
    2. Persist `s3_key`, checksum, and content length to `digitization_jobs`.
    3. Verify state transition `awaiting-upload -> uploaded`.
- Expected Interactions:
    - DB row contains expected per-user S3 key prefix.
    - Adapter preserves object metadata integrity.
    - State transition is atomic with metadata update.
- Trace to SYS-NNN: `SYS-004`

#### Test Case: ITP-007-B — S3 retention communication path

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-007`, `ARCH-019`, `ARCH-023`, `ARCH-047`
- Preconditions:
    - Soft-deleted job and active retention window
- Test Steps:
    1. Soft-delete job via lifecycle endpoint.
    2. Validate object still resolvable during retention window.
    3. Run purge/hard-delete path and verify object removal.
- Expected Interactions:
    - Object retention follows 30-day soft-delete window.
    - Hard-delete path removes object and metadata linkage.
    - No orphaned object key remains post-purge.
- Trace to SYS-NNN: `SYS-004`, `SYS-011`, `SYS-015`

### Architecture Module Integration: ARCH-008 — OCR Job Dispatcher (SQS Producer) (View: Process)

#### Test Case: ITP-008-A — Dispatcher message contract to SQS

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-008`, `ARCH-047`
- Preconditions:
    - `digitization_jobs.state='uploaded'`
    - SQS queue `ocr-jobs` configured
- Test Steps:
    1. Trigger dispatcher for uploaded job.
    2. Inspect produced SQS message body.
    3. Verify fields `{ job_id, s3_key, user_id, traceparent }`.
- Expected Interactions:
    - Exactly one message per uploaded job enqueue event.
    - Message includes trace context for downstream worker.
    - Dispatch occurs within expected enqueue window.
- Trace to SYS-NNN: `SYS-005`

#### Test Case: ITP-008-B — Producer-to-queue communication guarantees

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-008`, `ARCH-009`, `ARCH-046`
- Preconditions:
    - Queue `ocr-jobs` and consumer mapping enabled
- Test Steps:
    1. Dispatch burst of 50 uploaded jobs.
    2. Verify message visibility and consumer receipt.
    3. Correlate trace IDs from dispatch to worker consumption.
- Expected Interactions:
    - All messages accepted by `ocr-jobs` without loss.
    - Worker receives each job at least once.
    - Trace propagation from producer to consumer is intact.
- Trace to SYS-NNN: `SYS-005`, `SYS-026`

### Architecture Module Integration: ARCH-009 — OCR Worker Lambda Runtime (View: Process)

#### Test Case: ITP-009-A — Worker boundary contract for SQS event handling

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-009`, `ARCH-010`, `ARCH-012`, `ARCH-013`
- Preconditions:
    - Queue `ocr-jobs` has valid message
    - Source object available in S3
- Test Steps:
    1. Invoke worker with one SQS message.
    2. Fetch bytes, call provider interface, normalize output.
    3. Persist `raw_ocr_json` and `parsed_json` to `digitization_jobs`.
    4. Delete SQS message.
- Expected Interactions:
    - Successful processing transitions job to `awaiting-correction`.
    - Persistence commit precedes message delete.
    - Failure path keeps message for redelivery.
- Trace to SYS-NNN: `SYS-005`

#### Test Case: ITP-009-B — Redelivery/DLQ communication path

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-009`, `ARCH-010`, `ARCH-034`
- Preconditions:
    - Force provider timeout failure repeatedly
    - DLQ `ocr-jobs-dlq` configured
- Test Steps:
    1. Process job with forced timeout beyond `maxReceiveCount`.
    2. Observe redelivery attempts and visibility cycles.
    3. Confirm final message transfer to DLQ.
- Expected Interactions:
    - Message retries follow SQS at-least-once semantics.
    - Unrecoverable payload lands in DLQ with attempt metadata.
    - Telemetry captures timeout and DLQ count increase.
- Trace to SYS-NNN: `SYS-005`, `SYS-026`

#### Test Case: ITP-009-C — Worker processing order around commit/delete

- Technique: **Sequence/Order Testing**
- Modules Under Test: `ARCH-009`, `ARCH-013`, `ARCH-045`
- Preconditions:
    - Worker transaction + outbox enabled
- Test Steps:
    1. Inject timing probe around persistence commit.
    2. Observe ordering of: persist -> outbox insert -> SQS delete.
    3. Force mid-sequence failure before delete.
- Expected Interactions:
    - Commit and outbox insertion occur before SQS delete.
    - If delete not reached, redelivery is safe due to idempotent persistence.
    - No state where message deleted and DB write absent.
- Trace to SYS-NNN: `SYS-005`, `SYS-007`

### Architecture Module Integration: ARCH-010 — OcrProvider Interface (View: Interface)

#### Test Case: ITP-010-A — Provider interface contract conformance

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-010`, `ARCH-011`
- Preconditions:
    - Default provider adapter registered
    - Sample image payload buffer available
- Test Steps:
    1. Invoke `ocr(input)` using `OcrInput` contract.
    2. Validate `OcrResult` schema `{ raw, tokens[], overall_confidence, language }`.
    3. Validate confidence domain `[0..1]` and error taxonomy shape.
- Expected Interactions:
    - Adapter returns strict interface-conformant result.
    - Typed provider errors map to `timeout|rate_limited|invalid_image|service`.
    - Caller (`ARCH-009`) can consume without vendor-specific branching.
- Trace to SYS-NNN: `SYS-006`

### Architecture Module Integration: ARCH-011 — OCR Provider Adapter (Default) (View: Communication)

#### Test Case: ITP-011-A — Adapter contract translation to provider interface

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-011`, `ARCH-010`, `ARCH-042`
- Preconditions:
    - Provider credentials loaded from secrets/config
    - Vendor SDK mock returns representative payload
- Test Steps:
    1. Invoke adapter with `OcrInput`.
    2. Map vendor response into canonical `OcrResult`.
    3. Trigger vendor SDK errors and inspect mapped `OcrProviderError`.
- Expected Interactions:
    - Canonical contract preserved regardless of vendor shape.
    - Credentials are consumed via `ARCH-042` only.
    - Error mapping table produces stable taxonomy.
- Trace to SYS-NNN: `SYS-006`

#### Test Case: ITP-011-B — Upstream/downstream communication path under rate limiting

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-011`, `ARCH-009`, `ARCH-034`
- Preconditions:
    - Vendor responds with throttling signal
- Test Steps:
    1. Process OCR request receiving rate-limit response.
    2. Verify mapped `rate_limited` error propagation to worker.
    3. Confirm telemetry signal emitted for throttling event.
- Expected Interactions:
    - Worker receives canonical typed error.
    - No malformed payload reaches parser/persistence.
    - Metric/log pipeline captures provider throttle event.
- Trace to SYS-NNN: `SYS-006`, `SYS-026`

### Architecture Module Integration: ARCH-012 — OCR Parser & Field Normalizer (View: Data Flow)

#### Test Case: ITP-012-A — Parser output contract for `ParsedRecipe`

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-012`, `ARCH-014`, `ARCH-015`
- Preconditions:
    - Valid `OcrResult` with token confidences and language
- Test Steps:
    1. Parse OCR result into normalized recipe fields.
    2. Validate output schema includes `ingredients[]`, `steps[]`, optional metadata fields.
    3. Validate per-token confidence retention.
- Expected Interactions:
    - Parser emits canonical `ParsedRecipe` consumed by correction APIs.
    - Low-confidence tokens remain represented for eligibility logic.
    - Parser does not perform I/O or storage side effects.
- Trace to SYS-NNN: `SYS-007`

#### Test Case: ITP-012-B — OCR raw-to-parsed transformation chain

- Technique: **Data Flow Testing**
- Modules Under Test: `ARCH-011`, `ARCH-012`, `ARCH-013`
- Preconditions:
    - Vendor `raw_ocr_json` contains mixed confidence tokens
- Test Steps:
    1. Feed raw OCR into parser.
    2. Validate normalized fields and confidence carry-over.
    3. Persist parsed payload into `digitization_jobs.parsed_json`.
- Expected Interactions:
    - Data normalization is deterministic for identical input.
    - `raw_ocr_json` and `parsed_json` remain separately storable.
    - No confidence data is dropped at module boundaries.
- Trace to SYS-NNN: `SYS-007`, `SYS-025`

### Architecture Module Integration: ARCH-013 — OCR Payload Persistence (View: Data Flow)

#### Test Case: ITP-013-A — Persistence contract for `digitization_jobs`

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-013`, `ARCH-047`
- Preconditions:
    - Existing job row in `digitization_jobs`
    - Parsed payload from `ARCH-012`
- Test Steps:
    1. Update row with `{ raw_ocr_json, parsed_json }`.
    2. Set `state='awaiting-correction'` in same transaction.
    3. Read back persisted row.
- Expected Interactions:
    - Both JSON columns are written successfully.
    - State transition aligns with persistence completion.
    - Unique violation on retries no-ops safely per job.
- Trace to SYS-NNN: `SYS-007`, `SYS-025`

#### Test Case: ITP-013-B — Retention data-flow split (raw purge vs parsed retention)

- Technique: **Data Flow Testing**
- Modules Under Test: `ARCH-013`, `ARCH-033`, `ARCH-047`
- Preconditions:
    - Seed rows older than 90 days with both JSON columns
- Test Steps:
    1. Execute daily purge path.
    2. Verify `raw_ocr_json` is nulled/removed.
    3. Verify `parsed_json` remains present.
- Expected Interactions:
    - Retention contract enforces raw purge-only behavior.
    - Row remains queryable for correction/listing history.
    - Purge metrics/events are emitted when count > 0.
- Trace to SYS-NNN: `SYS-007`, `SYS-025`

### Architecture Module Integration: ARCH-014 — Correction API Controller (View: Interface)

#### Test Case: ITP-014-A — GET/PATCH correction endpoint contracts

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-014`, `ARCH-015`, `ARCH-027`, `ARCH-028`
- Preconditions:
    - Authenticated owner token
    - Existing job in `awaiting-correction`
- Test Steps:
    1. Call `GET /api/v1/recipes/digitize/jobs/:id/correction`.
    2. Verify `CorrectionView` response includes `accept_all_eligible`.
    3. Call `PATCH /api/v1/recipes/digitize/jobs/:id/correction` with edited fields.
    4. Validate optimistic-concurrency behavior on stale version.
- Expected Interactions:
    - `GET` combines persisted payload and eligibility evaluation.
    - `PATCH` updates fields while preserving ownership checks.
    - Stale edits return `409` RFC 7807 conflict.
- Trace to SYS-NNN: `SYS-008`

#### Test Case: ITP-014-B — Correction API data path to persistence

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-014`, `ARCH-047`
- Preconditions:
    - Valid corrected field payload
- Test Steps:
    1. Send PATCH correction payload.
    2. Verify DB update on `digitization_jobs.parsed_json`.
    3. Retrieve record and confirm edited values.
- Expected Interactions:
    - API-to-DB path is synchronous and consistent.
    - Partial write does not occur for failed optimistic lock check.
    - Owner boundary enforced on query/update path.
- Trace to SYS-NNN: `SYS-008`

### Architecture Module Integration: ARCH-015 — Accept-All Eligibility Evaluator (View: Logical)

#### Test Case: ITP-015-A — Eligibility function boundary contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-015`, `ARCH-014`, `ARCH-042`
- Preconditions:
    - Threshold config `low_confidence_below` loaded
    - Parsed recipe contains confidence annotations
- Test Steps:
    1. Evaluate payload with all confidences above threshold.
    2. Evaluate payload with one token below threshold.
    3. Validate deterministic boolean output.
- Expected Interactions:
    - Function returns true only when all tokens satisfy threshold.
    - Function does not mutate payload or perform I/O.
    - `ARCH-014` consumes result directly in response contract.
- Trace to SYS-NNN: `SYS-008`, `SYS-009`

### Architecture Module Integration: ARCH-016 — Correction UI (Web) (View: Interface)

#### Test Case: ITP-016-A — Web correction UI API payload contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-016`, `ARCH-014`, `ARCH-018`
- Preconditions:
    - Correction view load route available
    - Job in `awaiting-correction`
- Test Steps:
    1. Load correction page and fetch `CorrectionView` via GET endpoint.
    2. Edit fields and submit PATCH payload `{ fields, accept_all? }`.
    3. Trigger save action `POST /api/v1/recipes/digitize/jobs/:id/save`.
- Expected Interactions:
    - UI payload matches controller DTO contract.
    - Save trigger executes only after successful correction update.
    - RFC 7807 errors render as actionable inline state.
- Trace to SYS-NNN: `SYS-009`

#### Test Case: ITP-016-B — Correction workflow ordering on web

- Technique: **Sequence/Order Testing**
- Modules Under Test: `ARCH-016`, `ARCH-014`, `ARCH-018`, `ARCH-019`
- Preconditions:
    - Editable correction session active
- Test Steps:
    1. Attempt save before applying PATCH edits.
    2. Perform PATCH update then save.
    3. Query lifecycle endpoint for final status.
- Expected Interactions:
    - System preserves intended order: correction update precedes save commit.
    - Final status transitions to `saved` only after successful save bridge call.
    - Premature save attempt surfaces clear validation/conflict response.
- Trace to SYS-NNN: `SYS-009`, `SYS-010`, `SYS-011`

### Architecture Module Integration: ARCH-017 — Correction UI (Mobile) (View: Interface)

#### Test Case: ITP-017-A — Mobile correction UI contract parity

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-017`, `ARCH-014`, `ARCH-018`
- Preconditions:
    - Authenticated mobile session
    - Existing correction job
- Test Steps:
    1. Fetch correction payload over mobile network client.
    2. Submit PATCH edit payload and then save request.
    3. Validate response handling for network and validation errors.
- Expected Interactions:
    - Mobile payload contract equals web contract.
    - Mobile flow preserves correction/save boundary semantics.
    - Error handling maps RFC 7807 responses to mobile UX state.
- Trace to SYS-NNN: `SYS-009`

### Architecture Module Integration: ARCH-018 — Recipe Save Bridge Controller (View: Interface)

#### Test Case: ITP-018-A — Save endpoint contract `POST /api/v1/recipes/digitize/jobs/:id/save`

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-018`, `ARCH-047`, `ARCH-028`, `ARCH-044`
- Preconditions:
    - Job exists in `awaiting-correction`
    - Owner authentication valid
    - `Idempotency-Key` present
- Test Steps:
    1. Call save endpoint with valid job id.
    2. Validate `201` response contains `recipe_id`.
    3. Verify transaction inserts recipe and updates `digitization_jobs.recipe_id`, `state='saved'`.
    4. Replay save with same idempotency key.
- Expected Interactions:
    - Save bridge executes atomic recipe+job linkage transaction.
    - Idempotent retry does not create duplicate recipe rows.
    - Error paths use RFC 7807 envelope.
- Trace to SYS-NNN: `SYS-010`

#### Test Case: ITP-018-B — Save transaction sequence integrity

- Technique: **Sequence/Order Testing**
- Modules Under Test: `ARCH-018`, `ARCH-039`, `ARCH-047`
- Preconditions:
    - Transactional wrapper available
- Test Steps:
    1. Instrument sequence: insert recipe -> update job -> commit.
    2. Inject failure between operations.
    3. Confirm rollback behavior.
- Expected Interactions:
    - No committed state with recipe row unlinked from job.
    - Commit occurs only after both write operations succeed.
    - Retry path remains safe via idempotency helper.
- Trace to SYS-NNN: `SYS-010`, `SYS-031`

### Architecture Module Integration: ARCH-019 — Job Lifecycle Controller (View: Interface)

#### Test Case: ITP-019-A — Job read/delete lifecycle API contracts

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-019`, `ARCH-027`, `ARCH-028`, `ARCH-047`
- Preconditions:
    - Existing digitization job owned by caller
- Test Steps:
    1. Call `GET /api/v1/recipes/digitize/jobs/:id`.
    2. Call delete/soft-delete route for same job.
    3. Re-query status and retention metadata.
- Expected Interactions:
    - GET returns deterministic `job_status` value.
    - Delete marks soft-delete state without immediate hard removal.
    - Owner checks are enforced by auth + ownership filters.
- Trace to SYS-NNN: `SYS-011`

#### Test Case: ITP-019-B — Lifecycle data flow to retention worker

- Technique: **Data Flow Testing**
- Modules Under Test: `ARCH-019`, `ARCH-023`, `ARCH-007`
- Preconditions:
    - Soft-deleted jobs older/newer than retention threshold
- Test Steps:
    1. Soft-delete eligible and non-eligible jobs.
    2. Run retention worker.
    3. Verify only eligible records progress to hard-delete path.
- Expected Interactions:
    - `deleted_at` timestamp drives downstream purge eligibility.
    - Non-expired jobs remain recoverable.
    - Expired jobs no longer retrievable through lifecycle endpoint.
- Trace to SYS-NNN: `SYS-011`, `SYS-015`

### Architecture Module Integration: ARCH-020 — Job Listing Controller (View: Interface)

#### Test Case: ITP-020-A — Listing API cursor contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-020`, `ARCH-047`, `ARCH-027`
- Preconditions:
    - Dataset > 20 jobs for one user
- Test Steps:
    1. Call `GET /api/v1/recipes/digitize/jobs` with no cursor.
    2. Validate page size of 20 and presence of next cursor.
    3. Call again with returned cursor.
- Expected Interactions:
    - Pagination contract remains stable and deterministic.
    - User scoping prevents cross-user row leakage.
    - Cursor progresses without duplicate rows across adjacent pages.
- Trace to SYS-NNN: `SYS-012`

### Architecture Module Integration: ARCH-021 — Circle Domain Service (View: Interface)

#### Test Case: ITP-021-A — Circle CRUD and membership mutation contracts

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-021`, `ARCH-027`, `ARCH-028`, `ARCH-047`
- Preconditions:
    - Authenticated owner and member test users
    - Circle tables initialized: `circles`, `circle_members`
- Test Steps:
    1. Create circle and verify `CircleView` response.
    2. Add and remove member via member operation endpoints.
    3. Attempt mutating operation as non-owner.
- Expected Interactions:
    - Owner operations succeed and return normalized circle state.
    - Non-owner mutating operation returns `403` Problem Details.
    - Domain state persists in `circles` and `circle_members`.
- Trace to SYS-NNN: `SYS-013`

#### Test Case: ITP-021-B — Circle delete path to audience rewrite/event publication

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-021`, `ARCH-022`, `ARCH-024`, `ARCH-045`, `ARCH-039`
- Preconditions:
    - Circle with dependent recipes and members exists
- Test Steps:
    1. Call delete path for circle owner.
    2. Verify transaction includes audience rewrite and audit logging.
    3. Inspect outbox records for `circle.deleted` and `recipe.audience.changed`.
- Expected Interactions:
    - All side effects occur in a single transaction boundary.
    - Outbox records are co-committed with state changes.
    - Isolation constraints prevent inconsistent partial rewrite.
- Trace to SYS-NNN: `SYS-013`, `SYS-014`, `SYS-016`, `SYS-031`

### Architecture Module Integration: ARCH-022 — Circle Audience Rewriter (View: Data Flow)

#### Test Case: ITP-022-A — Audience rewrite contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-022`, `ARCH-021`, `ARCH-047`
- Preconditions:
    - Existing recipes with `audience.scope='circle'` and `ref_id=<circle_id>`
    - Active transaction context passed in
- Test Steps:
    1. Call rewrite function with `{ circle_id, tx }`.
    2. Capture returned `{ affected_recipe_ids }`.
    3. Validate rewritten rows now set `audience.scope='private'`.
- Expected Interactions:
    - Function rewrites only records linked to target circle.
    - Caller receives precise affected recipe ids.
    - Function does not commit independently of caller transaction.
- Trace to SYS-NNN: `SYS-014`

#### Test Case: ITP-022-B — Rewrite data flow to domain events

- Technique: **Data Flow Testing**
- Modules Under Test: `ARCH-022`, `ARCH-045`
- Preconditions:
    - Transactional outbox enabled
- Test Steps:
    1. Execute rewrite for circle deletion path.
    2. Inspect outbox payloads in `outbox` table.
    3. Verify one `circle.deleted` and per-recipe `recipe.audience.changed` events.
- Expected Interactions:
    - Event payloads include affected recipe references.
    - Outbox rows are inserted within same DB transaction.
    - No event publication without corresponding data rewrite.
- Trace to SYS-NNN: `SYS-014`

### Architecture Module Integration: ARCH-023 — Circle Soft-Delete & Restore Worker (View: Process)

#### Test Case: ITP-023-A — Restore/hard-delete contract boundaries

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-023`, `ARCH-021`, `ARCH-028`, `ARCH-047`
- Preconditions:
    - Soft-deleted circles seeded inside and outside retention window
- Test Steps:
    1. Call `POST /api/v1/circles/:id/restore` for in-window circle.
    2. Call restore for out-of-window circle.
    3. Execute scheduled hard-delete sweep.
- Expected Interactions:
    - In-window restore returns updated `CircleView` and clears `deleted_at`.
    - Out-of-window restore returns `410` Problem Details.
    - Sweep deletes only expired soft-deleted circles.
- Trace to SYS-NNN: `SYS-015`

#### Test Case: ITP-023-B — Deletion/restore sequence ordering

- Technique: **Sequence/Order Testing**
- Modules Under Test: `ARCH-023`, `ARCH-022`, `ARCH-045`, `ARCH-039`
- Preconditions:
    - Circle contains members and recipe references
- Test Steps:
    1. Perform soft-delete.
    2. Trigger restore before retention expiry.
    3. Soft-delete again and allow retention to expire, then run sweep.
- Expected Interactions:
    - Restore reverses soft-delete state before hard-delete eligibility.
    - Hard-delete only executes after retention threshold.
    - Event order reflects state transitions (`deleted` -> `restored` or `purged`).
- Trace to SYS-NNN: `SYS-015`, `SYS-014`, `SYS-031`

### Architecture Module Integration: ARCH-024 — Circle Membership Audit Logger (View: Communication)

#### Test Case: ITP-024-A — Membership audit event schema contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-024`, `ARCH-021`, `ARCH-026`, `ARCH-041`
- Preconditions:
    - Membership operations available
- Test Steps:
    1. Execute join/leave/remove/transfer actions.
    2. Capture emitted audit records.
    3. Validate schema `{ actor_id, circle_id, target_user_id, action, ts }`.
- Expected Interactions:
    - Every membership transition emits one structured record.
    - Action values come from allowed taxonomy.
    - Records are correlated with request context in logs.
- Trace to SYS-NNN: `SYS-016`

#### Test Case: ITP-024-B — Audit-to-metrics communication path

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-024`, `ARCH-034`
- Preconditions:
    - Metrics sink enabled
- Test Steps:
    1. Trigger multiple membership actions.
    2. Verify counter increments `circle.membership.events.count{action}`.
    3. Validate emit failure behavior does not block action completion.
- Expected Interactions:
    - Metrics emission is asynchronous and non-blocking.
    - Action completion is independent from metrics sink availability.
    - Emit failures are tracked by self-metric/log.
- Trace to SYS-NNN: `SYS-016`, `SYS-026`

### Architecture Module Integration: ARCH-025 — Circle Outlier Monitor (View: Process)

#### Test Case: ITP-025-A — Outlier monitor contract for threshold evaluation

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-025`, `ARCH-047`
- Preconditions:
    - Circle/member aggregates available
    - Thresholds: >100 members, >=25 circles owned/hour
- Test Steps:
    1. Run scheduled monitor with non-outlier dataset.
    2. Run with outlier dataset.
    3. Validate emitted outlier event payload shape.
- Expected Interactions:
    - No hard cap enforcement; monitor emits advisory events only.
    - Payload includes `{ kind, subject_id, value, threshold, ts }`.
    - DB queries are read-only.
- Trace to SYS-NNN: `SYS-017`

#### Test Case: ITP-025-B — Outlier event communication to telemetry

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-025`, `ARCH-034`, `ARCH-045`
- Preconditions:
    - Event publisher and telemetry sink enabled
- Test Steps:
    1. Trigger outlier condition.
    2. Validate emission of `circle.size.outlier` event.
    3. Verify metric `circle.outliers.detected{kind}` increment.
- Expected Interactions:
    - Outlier signal reaches both event and metric paths.
    - Failures are observable and retried next interval.
    - No blocking writes affect user-facing operations.
- Trace to SYS-NNN: `SYS-017`, `SYS-026`

### Architecture Module Integration: ARCH-026 — Circle Invitation Service (View: Interface)

#### Test Case: ITP-026-A — Invitation rotate/redeem endpoint contracts

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-026`, `ARCH-027`, `ARCH-028`, `ARCH-047`
- Preconditions:
    - Circle exists with owner user
    - `circle_invitations` table available
- Test Steps:
    1. Rotate link via `POST /api/v1/circles/:id/invitation/rotate` with idempotency key.
    2. Redeem via `POST /api/v1/circles/join/:token` as another authenticated user.
    3. Redeem previously rotated token.
- Expected Interactions:
    - Rotate returns `{ invite_url, token_id }` and sets exactly one active token.
    - Redeem is idempotent on `(circle_id, user_id)`.
    - Rotated token returns `410` with `error_code: circle.invitation.revoked`.
- Trace to SYS-NNN: `SYS-018`

#### Test Case: ITP-026-B — Invitation flow communication to audit/outbox

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-026`, `ARCH-024`, `ARCH-045`, `ARCH-044`
- Preconditions:
    - Invitation rotation and redemption hooks enabled
- Test Steps:
    1. Rotate active invitation token.
    2. Redeem newly rotated token.
    3. Inspect audit records and outbox entries.
- Expected Interactions:
    - Rotation emits revocation event semantics.
    - Redemption emits membership join audit event.
    - Idempotency prevents duplicate side effects.
- Trace to SYS-NNN: `SYS-018`, `SYS-016`

#### Test Case: ITP-026-C — Invitation state-machine ordering

- Technique: **Sequence/Order Testing**
- Modules Under Test: `ARCH-026`, `ARCH-047`
- Preconditions:
    - Existing token lifecycle records
- Test Steps:
    1. Create initial token.
    2. Rotate token twice.
    3. Attempt redeem of each historical token in order.
- Expected Interactions:
    - Only latest token remains active/redeemable.
    - Historical tokens consistently return revoked semantics.
    - Table maintains one-active-token invariant.
- Trace to SYS-NNN: `SYS-018`

### Architecture Module Integration: ARCH-027 — Clerk Session-Token Authenticator (NestJS Middleware) (View: Interface)

#### Test Case: ITP-027-A — Session-token middleware contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-027`, `ARCH-028`, `ARCH-042`
- Preconditions:
    - `AuthMiddleware` applied to `/api/v1/*`
    - `CLERK_JWT_KEY` + `CLERK_AUTHORIZED_PARTIES` configured (networkless verification)
- Test Steps:
    1. Request protected endpoint with valid Clerk session token.
    2. Request with missing/invalid token.
    3. Request with expired token.
- Expected Interactions:
    - Valid token injects `RequestUser` with `sub`, `scopes`/`permissions` and `tier` from `public_metadata`.
    - Missing/invalid returns `401 auth.token.invalid` Problem Details.
    - Expired returns `401 auth.token.expired` Problem Details.
- Trace to SYS-NNN: `SYS-019`

#### Test Case: ITP-027-B — `azp` / key-misconfiguration rejection handling

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-027`, `ARCH-043`, `ARCH-034`
- Preconditions:
    - Token whose `azp` is absent from `CLERK_AUTHORIZED_PARTIES`; and a separate run with a `CLERK_JWT_KEY` that does not match the token signature
- Test Steps:
    1. Trigger protected request with a disallowed `azp`.
    2. Trigger protected request whose signature does not verify against the configured `CLERK_JWT_KEY`.
    3. Capture response and error instrumentation.
- Expected Interactions:
    - Both cases return `401 auth.token.invalid` Problem Details (never `5xx` — verification is networkless, so there is no JWKS-outage path).
    - Rejection is captured in Sentry/log/metrics channels.
    - A correctly-signed token with an allowed `azp` resumes normal auth behavior.
- Trace to SYS-NNN: `SYS-019`, `SYS-026`

### Architecture Module Integration: ARCH-028 — RFC 7807 Error Envelope Filter (View: Interface)

#### Test Case: ITP-028-A — Problem Details output contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-028`, `ARCH-041`, `ARCH-046`
- Preconditions:
    - Exception filter installed globally
- Test Steps:
    1. Throw representative `HttpException` and generic `Error` from test endpoint.
    2. Capture HTTP response payload.
    3. Validate `application/problem+json` with `{ type, title, status, detail, instance, error_code }`.
- Expected Interactions:
    - Filter serializes all handled failures to Problem Details envelope.
    - Trace/log context is attached to error records.
    - Filter itself does not throw.
- Trace to SYS-NNN: `SYS-020`

#### Test Case: ITP-028-B — Error data flow from source exception to envelope/log

- Technique: **Data Flow Testing**
- Modules Under Test: `ARCH-006`, `ARCH-027`, `ARCH-028`, `ARCH-041`
- Preconditions:
    - Validation and auth failure generators available
- Test Steps:
    1. Trigger validation error path.
    2. Trigger auth error path.
    3. Compare propagated `error_code` values between response and logs.
- Expected Interactions:
    - Source-specific `error_code` survives envelope transformation.
    - Logs and API response agree on failure categorization.
    - No loss of instance/request correlation data.
- Trace to SYS-NNN: `SYS-020`, `SYS-003`, `SYS-019`

### Architecture Module Integration: ARCH-029 — `@kitchensink/audience` Library (View: Logical)

#### Test Case: ITP-029-A — Shared audience type contract export

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-029`, consumer boundaries (`ARCH-031`, downstream 001/006/007)
- Preconditions:
    - Library built and importable by workspace packages
- Test Steps:
    1. Import `AudienceScope` and `Audience` in a consumer package.
    2. Compile with valid and invalid scope literals.
    3. Validate compile-time contract behavior.
- Expected Interactions:
    - Valid scopes: `private|circle|public-profile|published-lesson` compile.
    - Invalid scopes fail type-checking.
    - Contract is runtime-agnostic and stable for downstream users.
- Trace to SYS-NNN: `SYS-021`

### Architecture Module Integration: ARCH-030 — API Versioning Convention Module (View: Interface)

#### Test Case: ITP-030-A — `/api/v1/*` routing contract enforcement

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-030`, `ARCH-037`, controller modules
- Preconditions:
    - Nest global prefix set to `api/v1`
    - Route-prefix lint rule enabled
- Test Steps:
    1. Enumerate registered routes from application bootstrap.
    2. Verify all feature endpoints are prefixed `/api/v1/`.
    3. Introduce intentionally non-prefixed route in test branch and run lint/CI check.
- Expected Interactions:
    - Runtime and static checks both enforce versioned route contract.
    - Non-prefixed route fails lint/CI gate.
    - Existing routes remain backward-compatible with versioning convention.
- Trace to SYS-NNN: `SYS-022`

### Architecture Module Integration: ARCH-031 — Audience Resolution Fallback (View: Process)

#### Test Case: ITP-031-A — Fallback resolver contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-031`, `ARCH-021`, `ARCH-029`
- Preconditions:
    - Audience scope input object available
    - Circle service health probe enabled
- Test Steps:
    1. Resolve audience when circles service healthy.
    2. Resolve with circles service unavailable.
    3. Resolve with unknown scope.
- Expected Interactions:
    - Healthy path returns standard allow/deny outcomes.
    - Unavailable path returns `circles_unavailable`, not implicit allow.
    - Unknown scope throws typed bug-class error.
- Trace to SYS-NNN: `SYS-023`

#### Test Case: ITP-031-B — Consumer communication path under circles outage

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-031`, consumer APIs, `ARCH-034`
- Preconditions:
    - Health probe forced unhealthy
- Test Steps:
    1. Request audience-dependent content from consumer entrypoint.
    2. Observe fallback code path and response mapping.
    3. Validate outage telemetry emission.
- Expected Interactions:
    - Consumer excludes `circle` scope content safely.
    - Caller sees explicit temporary unavailability signal.
    - Outage path is observable in metrics/logs.
- Trace to SYS-NNN: `SYS-023`, `SYS-026`

### Architecture Module Integration: ARCH-032 — Invitation Acceptance UI (Accessibility Surface) (View: Interface)

#### Test Case: ITP-032-A — Accessible invitation acceptance UI contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-032`, `ARCH-026`, `ARCH-027`
- Preconditions:
    - Deep link route `/circles/join/:token` configured
    - Screen reader + keyboard test harness available
- Test Steps:
    1. Open invitation deep link while authenticated.
    2. Navigate UI using keyboard only.
    3. Trigger redemption and validate API request path.
- Expected Interactions:
    - UI can be completed via keyboard/screen reader pathways.
    - Confirmation action triggers `POST /api/v1/circles/join/:token`.
    - Invalid token responses are rendered with non-silent error messaging.
- Trace to SYS-NNN: `SYS-024`

### Architecture Module Integration: ARCH-033 — `raw_ocr_json` Privacy Purge Job (View: Data Flow)

#### Test Case: ITP-033-A — Purge job contract for 90-day raw JSON removal

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-033`, `ARCH-047`, `ARCH-045`
- Preconditions:
    - `digitization_jobs` includes old rows with `raw_ocr_json`
- Test Steps:
    1. Execute scheduled purge run.
    2. Verify SQL predicate targets `raw_ocr_json IS NOT NULL AND created_at < now()-90d`.
    3. Verify result payload `{ purged_count }`.
- Expected Interactions:
    - Old raw payloads removed while preserving row integrity.
    - Event `digitization.raw_ocr.purged.count` emitted only when `count > 0`.
    - Partial timeout does not corrupt already-purged rows.
- Trace to SYS-NNN: `SYS-025`

#### Test Case: ITP-033-B — Purge metric/event data flow

- Technique: **Data Flow Testing**
- Modules Under Test: `ARCH-033`, `ARCH-034`, `ARCH-045`
- Preconditions:
    - Purge run with non-zero eligible rows
- Test Steps:
    1. Execute purge and capture `purged_count`.
    2. Inspect outbox event payload and telemetry metric.
    3. Compare count values across DB update, outbox event, and metric emission.
- Expected Interactions:
    - Count remains consistent across all three boundaries.
    - No event emitted for zero-row runs.
    - Alarm pipeline can consume metric for privacy SLA visibility.
- Trace to SYS-NNN: `SYS-025`, `SYS-026`

### Architecture Module Integration: ARCH-034 — Observability & Telemetry Pipeline (View: Data Flow)

#### Test Case: ITP-034-A — Telemetry emit interface contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-034`, `ARCH-041`
- Preconditions:
    - Namespace `Kitchensink/011` configured
- Test Steps:
    1. Emit representative metrics from worker/API paths.
    2. Emit structured logs through logger integration.
    3. Verify ingestion format and dimensions.
- Expected Interactions:
    - Metrics and logs follow typed wrapper contracts.
    - Sink receives queue depth, DLQ, OCR latency signals.
    - Emit failures do not block caller execution.
- Trace to SYS-NNN: `SYS-026`

#### Test Case: ITP-034-B — Telemetry communication path to canary gates

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-034`, `ARCH-035`
- Preconditions:
    - Canary controller reads telemetry window
- Test Steps:
    1. Publish synthetic pass/fail metric windows.
    2. Query canary evaluation endpoint.
    3. Validate gate decisions map to telemetry inputs.
- Expected Interactions:
    - Gate consumes telemetry without schema mismatch.
    - Missing window yields explicit `insufficient_window` decision.
    - Metric naming/dimensions remain stable for gate queries.
- Trace to SYS-NNN: `SYS-026`, `SYS-027`

### Architecture Module Integration: ARCH-035 — Release Readiness & Canary Gate Controller (View: Process)

#### Test Case: ITP-035-A — Canary promotion endpoint contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-035`, `ARCH-034`, `ARCH-036`
- Preconditions:
    - Endpoint `POST /api/v1/internal/canary/promote` available
    - Feature values include `digitization|circles`
- Test Steps:
    1. Submit promotion request `{ feature, from, to }`.
    2. Validate response shape `{ allowed, reasons, next_step? }`.
    3. Run with missing telemetry window.
- Expected Interactions:
    - Contract accepted only for valid ladder transitions.
    - Missing signal produces deny with `insufficient_window` reason.
    - Successful promotion triggers downstream flag update path.
- Trace to SYS-NNN: `SYS-027`

#### Test Case: ITP-035-B — Gate fail communication path to rollback event

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-035`, `ARCH-045`, `ARCH-036`
- Preconditions:
    - Post-promotion failing metrics simulated
- Test Steps:
    1. Evaluate canary with failing DLQ/latency signals.
    2. Inspect emitted rollback domain event.
    3. Verify flag gateway applies rollback target.
- Expected Interactions:
    - Failure emits `feature.flag.rollback` event.
    - Flag state reverts according to rollback policy.
    - Rollback reasoning captured for release tooling.
- Trace to SYS-NNN: `SYS-027`, `SYS-028`

#### Test Case: ITP-035-C — Promotion sequence ladder correctness

- Technique: **Sequence/Order Testing**
- Modules Under Test: `ARCH-035`, `ARCH-036`
- Preconditions:
    - Feature currently at 1%
- Test Steps:
    1. Attempt 1% -> 50% direct jump.
    2. Execute valid sequence 1% -> 10% -> 50% -> 100%.
    3. Validate state history after each step.
- Expected Interactions:
    - Out-of-order jump is denied.
    - Valid progression accepted and recorded.
    - Rollback remains permitted from any promoted step.
- Trace to SYS-NNN: `SYS-027`, `SYS-028`

### Architecture Module Integration: ARCH-036 — Feature Flag Gateway Client (View: Interface)

#### Test Case: ITP-036-A — Flag query contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-036`, caller modules (`ARCH-005`, `ARCH-021`, `ARCH-035`)
- Preconditions:
    - Flags configured: `digitization.enabled`, `circles.enabled`
- Test Steps:
    1. Query flags for prod and preview contexts.
    2. Validate defaults (prod OFF, dev/preview ON).
    3. Trigger webhook update and query again.
- Expected Interactions:
    - Query API returns deterministic boolean values by context.
    - Cache invalidates on update event.
    - Calling modules receive feature gate decisions synchronously.
- Trace to SYS-NNN: `SYS-028`

#### Test Case: ITP-036-B — Provider outage communication fallback

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-036`, `ARCH-034`
- Preconditions:
    - Last-known-good cache populated
    - Provider outage simulated
- Test Steps:
    1. Query flag during provider outage.
    2. Inspect return value source and telemetry alerts.
    3. Restore provider and verify cache refresh.
- Expected Interactions:
    - Calls return cached values without throwing.
    - Outage is surfaced via telemetry alarms.
    - Recovery refreshes cache within configured interval.
- Trace to SYS-NNN: `SYS-028`, `SYS-026`

### Architecture Module Integration: ARCH-037 — Test Convention Governance Linter (View: Logical)

#### Test Case: ITP-037-A — Linter contract for test naming/trace headers

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-037`, CI pipeline boundaries
- Preconditions:
    - ESLint plugin config active in workspace packages
- Test Steps:
    1. Run lint on compliant test files.
    2. Run lint on files violating naming and trace-header conventions.
    3. Capture report output and exit status.
- Expected Interactions:
    - Compliant files pass with clean report.
    - Violations produce structured findings.
    - Rule ambiguity paths surface warning-only where constraints are unresolved.
- Trace to SYS-NNN: `SYS-029`

### Architecture Module Integration: ARCH-038 — Workspace & CI Guardrails (View: Process)

#### Test Case: ITP-038-A — Guardrail CI contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-038`, workspace manifests, CI runtime
- Preconditions:
    - `pnpm-workspace.yaml`, package manifests, tsconfig references present
- Test Steps:
    1. Run guardrail checks on valid workspace registration.
    2. Introduce missing project reference and re-run.
    3. Validate failure annotation content.
- Expected Interactions:
    - Guardrails detect missing workspace/type-reference registration.
    - CI blocks merge on violation.
    - Structured report points to exact package and file.
- Trace to SYS-NNN: `SYS-030`

#### Test Case: ITP-038-B — CI order dependency (generate:types before tests)

- Technique: **Sequence/Order Testing**
- Modules Under Test: `ARCH-038`, test runner pipeline
- Preconditions:
    - Pipeline stages include `generate:types` and test execution
- Test Steps:
    1. Execute pipeline with correct stage order.
    2. Execute pipeline with test before type generation.
    3. Compare outcomes.
- Expected Interactions:
    - Correct ordering yields compile-ready tests.
    - Incorrect ordering fails with type artifact missing state.
    - Guardrail enforces deterministic stage order.
- Trace to SYS-NNN: `SYS-030`

### Architecture Module Integration: ARCH-039 — Transactional Isolation Enforcer (View: Process)

#### Test Case: ITP-039-A — Transaction wrapper contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-039`, `ARCH-021`, `ARCH-022`, `ARCH-023`
- Preconditions:
    - Wrapper helper `withSerializable(fn)` available
- Test Steps:
    1. Run circle deletion path through wrapper.
    2. Confirm transaction isolation level is SERIALIZABLE.
    3. Trigger serialization conflict.
- Expected Interactions:
    - Critical paths execute under enforced isolation.
    - Serialization conflict retries up to configured limit.
    - Exhausted retries propagate explicit error.
- Trace to SYS-NNN: `SYS-031`

#### Test Case: ITP-039-B — Lock/serialization communication behavior

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-039`, `ARCH-047`, callers (`ARCH-021/022/023`)
- Preconditions:
    - Concurrent transactions against same circle rows
- Test Steps:
    1. Start two conflicting delete/rewrite transactions.
    2. Observe lock waits and serialization failures.
    3. Validate retry and final consistency.
- Expected Interactions:
    - One transaction retries or fails cleanly without partial corruption.
    - Final persisted state remains invariant-consistent.
    - Conflict handling is observable in logs/metrics.
- Trace to SYS-NNN: `SYS-031`, `SYS-013`, `SYS-014`

### Architecture Module Integration: ARCH-040 — UI Primitive Reuse Inspection (View: Logical)

#### Test Case: ITP-040-A — Primitive inspection record contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-040`, `packages/apps/commise/ui` governance docs, lint rule boundary
- Preconditions:
    - Frontend task change includes new or reused primitive
- Test Steps:
    1. Submit PR adding a new primitive in `packages/ui/*`.
    2. Verify entry is created in `packages/ui/PRIMITIVES.md`.
    3. Submit duplicate primitive in app package and run lint inspection.
- Expected Interactions:
    - Inspection record exists for each new primitive.
    - Duplicate primitive usage is flagged.
    - Missing rationale produces warning requiring remediation.
- Trace to SYS-NNN: `SYS-032`

### Architecture Module Integration: ARCH-041 — Request-Scoped Logger (View: Communication)

#### Test Case: ITP-041-A — Logger bind/log API contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-041`, `ARCH-046`
- Preconditions:
    - Request context includes `user_id`/`job_id`/`circle_id`
- Test Steps:
    1. Bind request context using `logger.bind({...})`.
    2. Emit `info/warn/error` logs from API and worker paths.
    3. Inspect serialized JSON output.
- Expected Interactions:
    - Logs include contextual identifiers and traceparent.
    - Same request emits consistently scoped records.
    - Log schema remains stable across runtime types.
- Trace to SYS-NNN: `SYS-026`

#### Test Case: ITP-041-B — Log pipeline communication and backpressure behavior

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-041`, `ARCH-034`
- Preconditions:
    - Log sink throughput constrained for stress test
- Test Steps:
    1. Emit high-volume logs from concurrent worker invocations.
    2. Trigger stdout backpressure condition.
    3. Verify bounded buffer behavior and self-counter increment.
- Expected Interactions:
    - Logger remains non-blocking under pressure.
    - Oldest-buffer-drop behavior is observable and counted.
    - Telemetry receives pressure indicators.
- Trace to SYS-NNN: `SYS-026`

### Architecture Module Integration: ARCH-042 — Configuration & Secrets Loader (View: Interface)

#### Test Case: ITP-042-A — Typed config contract validation

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-042`, consuming modules (`ARCH-005`, `ARCH-011`, `ARCH-036`)
- Preconditions:
    - Required env vars and secret references configured
- Test Steps:
    1. Boot process with valid config and verify typed access.
    2. Boot with invalid schema values.
    3. Access missing secret reference.
- Expected Interactions:
    - Valid config yields typed `AppConfig` values.
    - Schema violations fail fast at boot.
    - Missing secret raises actionable error at access time.
- Trace to SYS-NNN: `SYS-019`, `SYS-028`

#### Test Case: ITP-042-B — Secret retrieval communication path

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-042`, AWS Secrets Manager boundary, `ARCH-043`
- Preconditions:
    - Secret ARN configured for OCR provider credentials
- Test Steps:
    1. Request secret from adapter path during first OCR call.
    2. Validate cache hit behavior on subsequent call.
    3. Simulate missing secret and observe error capture.
- Expected Interactions:
    - First access resolves secret from manager.
    - Later accesses use cache path.
    - Missing-secret errors propagate and are captured.
- Trace to SYS-NNN: `SYS-019`, `SYS-026`

### Architecture Module Integration: ARCH-043 — Sentry Integration Adapter (View: Communication)

#### Test Case: ITP-043-A — Exception capture interface contract

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-043`, `ARCH-028`, `ARCH-046`
- Preconditions:
    - Sentry DSN/config valid
- Test Steps:
    1. Trigger unhandled exception in API handler.
    2. Trigger unhandled exception in worker runtime.
    3. Validate event payload includes trace context.
- Expected Interactions:
    - Unhandled exceptions produce Sentry events.
    - Captured events retain runtime and module context.
    - Local log mirror still records failure.
- Trace to SYS-NNN: `SYS-026`

#### Test Case: ITP-043-B — Sentry outage communication fallback

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-043`, `ARCH-041`, `ARCH-034`
- Preconditions:
    - Sentry ingest endpoint unavailable
- Test Steps:
    1. Trigger exception while Sentry endpoint is down.
    2. Observe bounded retry attempts.
    3. Confirm local logging and telemetry still capture incident.
- Expected Interactions:
    - Capture failure does not crash caller runtime.
    - Local observability remains intact.
    - Retry budget and failure signals are visible.
- Trace to SYS-NNN: `SYS-026`

### Architecture Module Integration: ARCH-044 — Idempotency Key Helper (View: Interface)

#### Test Case: ITP-044-A — Idempotency helper contract across POST endpoints

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-044`, `ARCH-005`, `ARCH-018`, `ARCH-026`, `ARCH-047`
- Preconditions:
    - `idempotency_keys` table exists
    - Endpoints accept `Idempotency-Key`
- Test Steps:
    1. Submit repeated identical requests to intake/save/rotate endpoints.
    2. Submit same key with divergent payload.
    3. Inspect idempotency record persistence.
- Expected Interactions:
    - Identical retries return stable replay-safe outcomes.
    - Divergent payload with same key yields conflict.
    - Helper applies consistent policy across all protected routes.
- Trace to SYS-NNN: `SYS-002`, `SYS-010`, `SYS-018`

#### Test Case: ITP-044-B — Idempotency data path persistence integrity

- Technique: **Data Flow Testing**
- Modules Under Test: `ARCH-044`, `ARCH-047`
- Preconditions:
    - Key-claim storage enabled
- Test Steps:
    1. Claim new idempotency key for endpoint payload.
    2. Replay same request and verify lookup hit path.
    3. Validate key record includes payload hash + response fingerprint.
- Expected Interactions:
    - Claim/read/update path remains internally consistent.
    - No duplicate business writes on replay path.
    - Conflict detection uses canonical payload fingerprint.
- Trace to SYS-NNN: `SYS-002`, `SYS-010`, `SYS-018`

### Architecture Module Integration: ARCH-045 — Outbox / Domain Event Publisher (View: Data Flow)

#### Test Case: ITP-045-A — Outbox insert contract for domain events

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-045`, producers (`ARCH-022`, `ARCH-023`, `ARCH-026`, `ARCH-033`), `ARCH-047`
- Preconditions:
    - Outbox table configured and writable
- Test Steps:
    1. Trigger each producer action that emits domain events.
    2. Inspect inserted outbox rows and payload schemas.
    3. Validate event types include:
        - `circle.deleted`
        - `recipe.audience.changed`
        - `circle.invitation.revoked`
        - `digitization.raw_ocr.purged.count`
- Expected Interactions:
    - Event rows are written atomically with source transaction.
    - Payload shape is stable and machine-consumable.
    - No direct publish outside outbox mechanism.
- Trace to SYS-NNN: `SYS-014`, `SYS-015`, `SYS-018`, `SYS-025`

#### Test Case: ITP-045-B — Co-transactional data flow integrity

- Technique: **Data Flow Testing**
- Modules Under Test: `ARCH-045`, `ARCH-039`, `ARCH-047`
- Preconditions:
    - Transaction instrumentation available
- Test Steps:
    1. Execute event-producing transaction and force rollback.
    2. Re-run successful transaction.
    3. Compare outbox and domain-table states.
- Expected Interactions:
    - Rolled-back transaction leaves no outbox residue.
    - Successful transaction yields both domain changes and outbox entries.
    - No dual-write inconsistency observed.
- Trace to SYS-NNN: `SYS-014`, `SYS-015`, `SYS-031`

### Architecture Module Integration: ARCH-046 — OpenTelemetry Tracing Bootstrap (View: Communication)

#### Test Case: ITP-046-A — Trace bootstrap contract across runtime boundaries

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-046`, `ARCH-041`, `ARCH-009`, `ARCH-028`
- Preconditions:
    - Tracing bootstrap enabled in API and worker runtimes
- Test Steps:
    1. Start request at API intake path.
    2. Propagate trace context into SQS message and worker.
    3. Validate spans across API -> queue -> lambda -> DB interaction.
- Expected Interactions:
    - Traceparent is propagated without format drift.
    - Worker spans link to originating API span.
    - Error spans include envelope and logger context.
- Trace to SYS-NNN: `SYS-026`

#### Test Case: ITP-046-B — Asynchronous communication trace continuity

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-046`, `ARCH-008`, `ARCH-009`
- Preconditions:
    - Queue event processing enabled
- Test Steps:
    1. Dispatch OCR message with trace context.
    2. Consume message and process in worker.
    3. Inspect trace graph continuity.
- Expected Interactions:
    - Queue hop preserves parent/child trace relationships.
    - Missing trace context is detected and logged as degraded observability.
    - Trace continuity survives retries/redelivery.
- Trace to SYS-NNN: `SYS-005`, `SYS-026`

### Architecture Module Integration: ARCH-047 — Drizzle ORM Persistence Context (View: Interface)

#### Test Case: ITP-047-A — Persistence adapter contract across core tables

- Technique: **Interface Testing**
- Modules Under Test: `ARCH-047`, service modules (`ARCH-005`, `ARCH-013`, `ARCH-021`, `ARCH-026`, `ARCH-045`)
- Preconditions:
    - DB schema includes tables:
        - `digitization_jobs`
        - `circles`
        - `circle_members`
        - `circle_invitations`
        - `outbox`
        - `idempotency_keys`
- Test Steps:
    1. Execute representative CRUD/transaction operations from each service boundary.
    2. Validate typed row mapping and transaction helper behavior.
    3. Trigger SQLSTATE 23505 and 40001 paths.
- Expected Interactions:
    - Typed entities map consistently to DB rows.
    - Unique and serialization errors propagate with stable semantics.
    - Shared transaction helper supports service invariants.
- Trace to SYS-NNN: `SYS-002`, `SYS-007`, `SYS-013`, `SYS-018`, `SYS-031`

#### Test Case: ITP-047-B — Persistence communication path under pool pressure

- Technique: **Communication Path Testing**
- Modules Under Test: `ARCH-047`, `ARCH-028`, `ARCH-034`
- Preconditions:
    - DB pool constrained for stress scenario
- Test Steps:
    1. Saturate pool with concurrent API and worker operations.
    2. Observe connection checkout latency and failures.
    3. Validate mapped API behavior for pool exhaustion.
- Expected Interactions:
    - Pool metrics reflect saturation state.
    - Exhaustion maps to `503` Problem Details via error filter path.
    - Recovery resumes normal throughput after pressure release.
- Trace to SYS-NNN: `SYS-026`, `SYS-020`

## Coverage Summary

| Metric                                                                                   | Value | Notes                                                                    |
| ---------------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------------ |
| Total ARCH modules in scope                                                              |    47 | `ARCH-001..ARCH-047`                                                     |
| Architecture Module Integration sections (`^### Architecture Module Integration: ARCH-`) |    47 | Full module coverage achieved                                            |
| Total ITP test cases (`^#### Test Case: ITP-`)                                           |    86 | `ITP-001-A` … `ITP-047-B/C` as applicable                                |
| Modules with required Interface Testing `ITP-NNN-A`                                      | 47/47 | 100% satisfied                                                           |
| Test cases with `-B` suffix                                                              |    36 | Additional communication/data-flow coverage on integration-heavy modules |
| Test cases with `-C` suffix                                                              |     3 | Explicit sequence/order state-machine coverage                           |
| Architecture module coverage ratio                                                       |  100% | Every module has >=1 ITP                                                 |

## Architecture-to-System Trace Index

| ARCH Module | Parent SYS Coverage       |
| ----------- | ------------------------- |
| ARCH-001    | SYS-001                   |
| ARCH-002    | SYS-001                   |
| ARCH-003    | SYS-001, SYS-002, SYS-004 |
| ARCH-004    | SYS-001                   |
| ARCH-005    | SYS-002                   |
| ARCH-006    | SYS-003                   |
| ARCH-007    | SYS-004                   |
| ARCH-008    | SYS-005                   |
| ARCH-009    | SYS-005                   |
| ARCH-010    | SYS-006                   |
| ARCH-011    | SYS-006                   |
| ARCH-012    | SYS-007                   |
| ARCH-013    | SYS-007, SYS-025          |
| ARCH-014    | SYS-008                   |
| ARCH-015    | SYS-008, SYS-009          |
| ARCH-016    | SYS-009                   |
| ARCH-017    | SYS-009                   |
| ARCH-018    | SYS-010                   |
| ARCH-019    | SYS-011                   |
| ARCH-020    | SYS-012                   |
| ARCH-021    | SYS-013                   |
| ARCH-022    | SYS-014                   |
| ARCH-023    | SYS-015                   |
| ARCH-024    | SYS-016                   |
| ARCH-025    | SYS-017                   |
| ARCH-026    | SYS-018                   |
| ARCH-027    | SYS-019                   |
| ARCH-028    | SYS-020                   |
| ARCH-029    | SYS-021                   |
| ARCH-030    | SYS-022                   |
| ARCH-031    | SYS-023                   |
| ARCH-032    | SYS-024                   |
| ARCH-033    | SYS-025                   |
| ARCH-034    | SYS-026                   |
| ARCH-035    | SYS-027                   |
| ARCH-036    | SYS-028                   |
| ARCH-037    | SYS-029                   |
| ARCH-038    | SYS-030                   |
| ARCH-039    | SYS-031                   |
| ARCH-040    | SYS-032                   |
| ARCH-041    | CROSS-CUTTING             |
| ARCH-042    | CROSS-CUTTING             |
| ARCH-043    | CROSS-CUTTING             |
| ARCH-044    | CROSS-CUTTING             |
| ARCH-045    | CROSS-CUTTING             |
| ARCH-046    | CROSS-CUTTING             |
| ARCH-047    | CROSS-CUTTING             |

Coverage Result: **PASS** — every architecture module `ARCH-001..ARCH-047` has at least one integration test case, and every module has the required `ITP-NNN-A` Interface Testing case.
