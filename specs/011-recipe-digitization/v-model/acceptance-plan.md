# Acceptance Test Plan: Recipe Digitization & Family Circles

**Feature Branch**: `011-recipe-digitization`
**Created**: 2026-05-10
**Status**: Draft
**Source**: `specs/011-recipe-digitization/v-model/requirements.md`

## Overview

This document defines the Acceptance Test Plan for Recipe Digitization & Family Circles. Every requirement
in `requirements.md` has one or more Test Cases (ATP), and every Test Case has one or
more executable User Scenarios (SCN) in BDD format (Given/When/Then).

## ID Schema

- **Test Case**: `ATP-{NNN}-{X}` — where NNN matches the parent REQ, X is a letter suffix (A, B, C...)
- **Scenario**: `SCN-{NNN}-{X}{#}` — nested under the parent ATP, with numeric suffix (1, 2, 3...)
- Example: `SCN-001-A1` → Scenario 1 of Test Case A validating REQ-001

## Acceptance Tests

### Requirement Validation: REQ-001 (Accepted upload MIME types and size cap)

#### Test Case: ATP-001-A (Mint pre-signed PUT URL for valid image upload)

**Description:** Validates via **Test** that `POST /api/v1/recipes/digitize/jobs` returns an upload target for `image/jpeg`, `image/png`, or `image/heic` payloads up to 20 MB.

- **User Scenario: SCN-001-A1**
    - **Given** an authenticated user submits `POST /api/v1/recipes/digitize/jobs` with `content_type=image/jpeg` and `content_length=4194304`
    - **When** the API validates upload metadata and mints an S3 pre-signed PUT URL
    - **Then** the response is `201`, contains `upload_url`, `job_id`, and an `expires_at` timestamp for the same `job_id`

#### Test Case: ATP-001-B (Reject unsupported MIME type)

**Description:** Validates via **Test** that unsupported upload content types are rejected before URL minting.

- **User Scenario: SCN-001-B1**
    - **Given** an authenticated user submits `POST /api/v1/recipes/digitize/jobs` with `content_type=image/gif` and `content_length=1048576`
    - **When** MIME-type validation executes
    - **Then** the API returns `400` RFC 7807 with `error_code="digitization.image.unsupported_type"` and no `upload_url`

---

### Requirement Validation: REQ-002 (Cross-platform camera and file-picker capture)

#### Test Case: ATP-002-A (Capture works on iOS/Android and web)

**Description:** Validates via **Demonstration** that mobile camera capture and web file-picker capture both start digitization without native plugin installation.

- **User Scenario: SCN-002-A1**
    - **Given** the iOS app, Android app, and web client are installed with standard project dependencies only
    - **When** each client captures or selects a photo and starts a digitization upload
    - **Then** all three clients reach upload initiation and receive a valid `job_id` without adding any separate capture plugin package

#### Test Case: ATP-002-B (Capture permission denial is handled)

**Description:** Validates via **Demonstration** that permission-related capture failures are surfaced with user-visible guidance.

- **User Scenario: SCN-002-B1**
    - **Given** camera permission is denied on mobile and blocked in browser settings
    - **When** the user taps the capture control
    - **Then** the UI shows a capture-permission error state and offers fallback file selection where available

---

### Requirement Validation: REQ-003 (Session photo limit and one job per photo)

#### Test Case: ATP-003-A (Create 20 jobs for 20 uploaded photos)

**Description:** Validates via **Test** that each submitted photo in a single session creates a unique `DigitizationJob`.

- **User Scenario: SCN-003-A1**
    - **Given** an authenticated session selects exactly 20 valid images
    - **When** the client submits batch metadata to `POST /api/v1/recipes/digitize/jobs`
    - **Then** the API returns 20 distinct `job_id` values and associates each with one source photo

#### Test Case: ATP-003-B (Reject 21st photo in same session)

**Description:** Validates via **Test** that the batch submission limit is enforced.

- **User Scenario: SCN-003-B1**
    - **Given** an authenticated session attempts to submit 21 images in one digitization batch
    - **When** server-side session photo-count validation runs
    - **Then** the API returns `400` with `error_code="digitization.batch.photo_limit_exceeded"`

---

### Requirement Validation: REQ-004 (Client-visible pre-upload image validation)

#### Test Case: ATP-004-A (Accept image within dimension and size bounds)

**Description:** Validates via **Test** that valid dimensions (`>=300x300`) and size (`<=20 MB`) pass validation before S3 upload.

- **User Scenario: SCN-004-A1**
    - **Given** the user selects a `1200x1600` PNG image of `5 MB`
    - **When** pre-upload validator runs in the digitization client
    - **Then** upload proceeds and no validation error is shown

#### Test Case: ATP-004-B (Reject undersized image before upload)

**Description:** Validates via **Test** that invalid dimensions are rejected with descriptive feedback.

- **User Scenario: SCN-004-B1**
    - **Given** the user selects a `240x240` image
    - **When** pre-upload validation executes
    - **Then** the UI blocks upload and shows `Image must be at least 300×300 pixels` with `error_code="digitization.image.invalid_dimensions"`

---

### Requirement Validation: REQ-005 (Shared batch_id for multi-page submissions)

#### Test Case: ATP-005-A (Assign common batch_id to multi-photo submission)

**Description:** Validates via **Test** that related jobs from one multi-page import share the same `batch_id`.

- **User Scenario: SCN-005-A1**
    - **Given** a user submits 4 cookbook page photos in one session
    - **When** jobs are created
    - **Then** all returned job records contain the same `batch_id` and unique `job_id` values

#### Test Case: ATP-005-B (Different sessions do not reuse batch_id)

**Description:** Validates via **Test** that grouping identity is isolated by submission event.

- **User Scenario: SCN-005-B1**
    - **Given** the same user submits one batch now and another batch 10 minutes later
    - **When** the second batch jobs are created
    - **Then** the second batch uses a different `batch_id` from the first

---

### Requirement Validation: REQ-006 (OCR invocation within 30 seconds)

#### Test Case: ATP-006-A (Trigger OCR processing within SLA)

**Description:** Validates via **Test** that OCR provider invocation starts within 30 seconds after S3 upload completion.

- **User Scenario: SCN-006-A1**
    - **Given** a successful S3 PUT completion event for a digitization object
    - **When** queue orchestration enqueues and dispatches OCR work
    - **Then** provider invocation timestamp is within 30 seconds of upload completion timestamp

#### Test Case: ATP-006-B (SLA breach emits timeout error path)

**Description:** Validates via **Test** that delayed invocation breaches are detectable and surfaced.

- **User Scenario: SCN-006-B1**
    - **Given** a controlled queue delay pushes OCR start beyond 30 seconds
    - **When** SLA monitor evaluates invocation latency
    - **Then** the job is marked with `error_code="digitization.ocr.invocation_timeout"` and operational alerting is emitted

---

### Requirement Validation: REQ-007 (Parsed output field normalization)

#### Test Case: ATP-007-A (Populate all required parsed recipe fields)

**Description:** Validates via **Test** that OCR parsing emits `title`, `ingredients[]`, `steps[]`, `yield`, `prep_time`, and `cook_time`.

- **User Scenario: SCN-007-A1**
    - **Given** OCR text containing title, ingredient lines, steps, yield, and time values
    - **When** parser transforms OCR output into `parsed_json`
    - **Then** all six normalized fields are present with non-null values or explicit empty arrays where applicable

#### Test Case: ATP-007-B (Malformed OCR text still returns schema)

**Description:** Validates via **Test** that parser keeps schema contract even with incomplete OCR content.

- **User Scenario: SCN-007-B1**
    - **Given** OCR output that includes only title and fragmented lines
    - **When** parsing executes
    - **Then** `parsed_json` still includes all required keys and marks missing values as empty or null per contract

---

### Requirement Validation: REQ-008 (Handwriting recognition OCR path)

#### Test Case: ATP-008-A (Route handwritten image to handwriting-capable OCR)

**Description:** Validates via **Test** that handwritten recipe images are processed by the handwriting-recognition path.

- **User Scenario: SCN-008-A1**
    - **Given** an uploaded image tagged by classifier as handwritten content
    - **When** OCR dispatch selects provider mode
    - **Then** the job executes the handwriting-enabled OCR path and returns extracted tokens

#### Test Case: ATP-008-B (Fallback error if handwriting path unavailable)

**Description:** Validates via **Test** that provider/path unavailability returns a concrete failure state.

- **User Scenario: SCN-008-B1**
    - **Given** handwriting OCR mode is disabled in provider configuration
    - **When** a handwritten image job is processed
    - **Then** the job transitions to failed with `error_code="digitization.ocr.handwriting_unavailable"`

---

### Requirement Validation: REQ-009 (Per-token confidence emission)

#### Test Case: ATP-009-A (Emit confidence for each OCR token)

**Description:** Validates via **Test** that every parsed token has confidence metadata.

- **User Scenario: SCN-009-A1**
    - **Given** an OCR result containing 180 recognized tokens
    - **When** parse output is generated
    - **Then** each token entry includes a numeric `confidence` value in the expected range

#### Test Case: ATP-009-B (Reject token payload without confidence)

**Description:** Validates via **Test** that missing confidence fields fail parsing contract checks.

- **User Scenario: SCN-009-B1**
    - **Given** provider output where token confidence is missing for a subset of tokens
    - **When** parser validation runs
    - **Then** the system returns `error_code="digitization.ocr.confidence_missing"` and does not publish incomplete token data

---

### Requirement Validation: REQ-010 (Capture OCR language_code)

#### Test Case: ATP-010-A (Persist language_code in digitization result)

**Description:** Validates via **Test** that OCR language identification is recorded per job.

- **User Scenario: SCN-010-A1**
    - **Given** OCR provider returns language `en-US` for a processed image
    - **When** digitization result is persisted
    - **Then** job data includes `language_code="en-US"`

#### Test Case: ATP-010-B (Unknown language is explicit)

**Description:** Validates via **Test** that unknown-language responses remain explicit and machine-readable.

- **User Scenario: SCN-010-B1**
    - **Given** provider cannot confidently determine language
    - **When** result persistence occurs
    - **Then** the job stores `language_code="und"` and does not omit the field

---

### Requirement Validation: REQ-011 (Low-confidence token surfacing)

#### Test Case: ATP-011-A (Display low-confidence tokens in correction UX)

**Description:** Validates via **Demonstration** that low-confidence OCR tokens are visibly surfaced in correction flow.

- **User Scenario: SCN-011-A1**
    - **Given** a correction screen for a job containing tokens below the confidence threshold
    - **When** the user opens the token review area
    - **Then** low-confidence tokens are listed/highlighted for targeted correction

#### Test Case: ATP-011-B (No low-confidence tokens shows neutral state)

**Description:** Validates via **Demonstration** that the UI avoids false warnings when all token confidence is high.

- **User Scenario: SCN-011-B1**
    - **Given** a job where all token confidences exceed threshold
    - **When** the correction screen loads
    - **Then** no low-confidence warning panel is displayed

---

### Requirement Validation: REQ-012 (Confidence data in parsed_json)

#### Test Case: ATP-012-A (Include confidence fields in correction payload)

**Description:** Validates via **Test** that `parsed_json` returned for correction contains confidence metadata.

- **User Scenario: SCN-012-A1**
    - **Given** an existing job in `awaiting-correction`
    - **When** the client requests `GET /api/v1/recipes/digitize/jobs/:id`
    - **Then** response `parsed_json` includes token values and corresponding confidence entries

#### Test Case: ATP-012-B (Correction payload without confidence is rejected)

**Description:** Validates via **Test** that confidence omission is prevented for correction consumers.

- **User Scenario: SCN-012-B1**
    - **Given** a regression build that drops `confidence` from `parsed_json`
    - **When** API contract tests execute
    - **Then** test fails with contract mismatch `error_code="digitization.contract.parsed_confidence_required"`

---

### Requirement Validation: REQ-013 (Asynchronous OCR + status endpoint)

#### Test Case: ATP-013-A (Non-blocking create and poll status)

**Description:** Validates via **Test** that job creation is asynchronous and state is retrievable at `GET /api/v1/recipes/digitize/jobs/:id`.

- **User Scenario: SCN-013-A1**
    - **Given** a user starts digitization and uploads a valid photo
    - **When** `POST /api/v1/recipes/digitize/jobs` returns
    - **Then** response is immediate with `job_status="pending"`, and subsequent `GET /api/v1/recipes/digitize/jobs/:id` shows status progression

#### Test Case: ATP-013-B (Missing job id returns not found problem details)

**Description:** Validates via **Test** error behavior for invalid status polling target.

- **User Scenario: SCN-013-B1**
    - **Given** an authenticated user polls `GET /api/v1/recipes/digitize/jobs/00000000-0000-0000-0000-000000000000`
    - **When** no matching job exists
    - **Then** API returns `404` Problem Details with `error_code="digitization.job.not_found"`

---

### Requirement Validation: REQ-014 (Correction screen shows photo and parsed fields together)

#### Test Case: ATP-014-A (Dual-pane correction presentation)

**Description:** Validates via **Demonstration** that original image and parsed content are concurrently visible.

- **User Scenario: SCN-014-A1**
    - **Given** a job in `awaiting-correction`
    - **When** the user opens the correction route
    - **Then** the screen shows original photo preview and editable parsed fields in the same view without navigation away

#### Test Case: ATP-014-B (Photo load failure keeps parsed fields accessible)

**Description:** Validates via **Demonstration** resilient behavior when image retrieval fails.

- **User Scenario: SCN-014-B1**
    - **Given** CloudFront image URL for the job returns `403`
    - **When** correction screen loads
    - **Then** parsed fields still render and the photo pane shows a retry/error placeholder

---

### Requirement Validation: REQ-015 (Inline correction persistence endpoint)

#### Test Case: ATP-015-A (Persist inline edits via PATCH correction endpoint)

**Description:** Validates via **Test** that edits are saved through `PATCH /api/v1/recipes/digitize/jobs/:id/correction`.

- **User Scenario: SCN-015-A1**
    - **Given** a job with editable `title` and `ingredients[]`
    - **When** client sends `PATCH /api/v1/recipes/digitize/jobs/:id/correction` with modified fields
    - **Then** API returns `200` and subsequent `GET` reflects updated corrected values

#### Test Case: ATP-015-B (Reject patch with invalid correction schema)

**Description:** Validates via **Test** that malformed correction payloads are rejected.

- **User Scenario: SCN-015-B1**
    - **Given** client submits `PATCH` with `ingredients` as a string instead of array
    - **When** request validation runs
    - **Then** API returns `400` Problem Details with `error_code="digitization.correction.invalid_payload"`

---

### Requirement Validation: REQ-016 (Accept-all action for high-confidence jobs)

#### Test Case: ATP-016-A (Enable Accept all when no low-confidence tokens)

**Description:** Validates via **Demonstration** that Accept-all is available only for all-high-confidence results.

- **User Scenario: SCN-016-A1**
    - **Given** a parsed job where every token confidence exceeds review threshold
    - **When** user opens correction screen
    - **Then** `Accept all` control is enabled and applying it finalizes token confirmations in one action

#### Test Case: ATP-016-B (Disable Accept all when low-confidence exists)

**Description:** Validates via **Demonstration** that Accept-all is not incorrectly offered when review is required.

- **User Scenario: SCN-016-B1**
    - **Given** a parsed job containing at least one low-confidence token
    - **When** correction controls render
    - **Then** `Accept all` is disabled or hidden and user is directed to token-level review

---

### Requirement Validation: REQ-017 (Low-confidence visual distinction and token confirmation)

#### Test Case: ATP-017-A (Allow token-level confirmation)

**Description:** Validates via **Demonstration** that each low-confidence token can be individually confirmed.

- **User Scenario: SCN-017-A1**
    - **Given** three low-confidence tokens are flagged in a job
    - **When** user confirms one specific token
    - **Then** only that token switches to confirmed state and others remain pending

#### Test Case: ATP-017-B (Visual distinction remains after edits)

**Description:** Validates via **Demonstration** that low-confidence highlighting persists until token confirmation.

- **User Scenario: SCN-017-B1**
    - **Given** a low-confidence token text is edited but not confirmed
    - **When** focus leaves the field
    - **Then** token remains visually marked as requiring confirmation

---

### Requirement Validation: REQ-018 (Retain original photo after save/discard)

#### Test Case: ATP-018-A (Photo remains in S3 after save)

**Description:** Validates via **Test** archival retention of source image after `POST /.../jobs/:id/save`.

- **User Scenario: SCN-018-A1**
    - **Given** a job with a stored source image in S3
    - **When** user saves the digitized recipe via `POST /api/v1/recipes/digitize/jobs/:id/save`
    - **Then** the original S3 object still exists at the job’s object key

#### Test Case: ATP-018-B (Photo remains in S3 after discard)

**Description:** Validates via **Test** archival retention after discard action.

- **User Scenario: SCN-018-B1**
    - **Given** a job with an existing source image object
    - **When** user discards the job with `DELETE /api/v1/recipes/digitize/jobs/:id`
    - **Then** job is soft-deleted but source S3 object is retained for archival policy window

---

### Requirement Validation: REQ-019 (Per-user S3 prefix and CloudFront serving)

#### Test Case: ATP-019-A (Store upload under user-scoped prefix)

**Description:** Validates via **Test** that object keys are partitioned by user identifier.

- **User Scenario: SCN-019-A1**
    - **Given** user `user_2u123` uploads a photo for job creation
    - **When** object key is generated
    - **Then** S3 key begins with `users/user_2u123/digitization/` and is not shared with other users

#### Test Case: ATP-019-B (CloudFront URL access denied for non-owner)

**Description:** Validates via **Test** that user-partitioned assets are not leaked across users.

- **User Scenario: SCN-019-B1**
    - **Given** user B obtains user A’s CloudFront image URL
    - **When** user B requests the image
    - **Then** access is denied (`403`) and no image bytes are returned

---

### Requirement Validation: REQ-020 (Separate raw_ocr_json and parsed_json fields)

#### Test Case: ATP-020-A (Persist OCR raw and parsed payload separately)

**Description:** Validates via **Inspection** that `DigitizationJob` model has distinct storage fields for raw OCR and parsed output.

- **User Scenario: SCN-020-A1**
    - **Given** database schema and ORM model definitions for `digitization_jobs`
    - **When** field definitions are inspected
    - **Then** `raw_ocr_json` and `parsed_json` exist as separate fields with independent lifecycle handling

#### Test Case: ATP-020-B (Reject merge regression into single payload column)

**Description:** Validates via **Inspection** that a schema change collapsing both payloads into one field is detected.

- **User Scenario: SCN-020-B1**
    - **Given** a migration proposal replacing both columns with one `ocr_json`
    - **When** acceptance inspection checks schema against REQ-020
    - **Then** the change is marked non-compliant and blocked

---

### Requirement Validation: REQ-021 (Create Recipe and set recipe_id linkage)

#### Test Case: ATP-021-A (Save endpoint creates recipe record)

**Description:** Validates via **Test** that save operation materializes a `Recipe` and links it back to the job.

- **User Scenario: SCN-021-A1**
    - **Given** a corrected job in `awaiting-correction`
    - **When** user submits `POST /api/v1/recipes/digitize/jobs/:id/save`
    - **Then** a new `Recipe` row is created and job now contains non-null `recipe_id`

#### Test Case: ATP-021-B (Prevent duplicate save creation)

**Description:** Validates via **Test** that repeated save calls do not create duplicate recipes.

- **User Scenario: SCN-021-B1**
    - **Given** a job already saved once with `recipe_id` assigned
    - **When** client repeats `POST /api/v1/recipes/digitize/jobs/:id/save`
    - **Then** API returns idempotent response and does not create a second recipe row

---

### Requirement Validation: REQ-022 (Soft-delete job with 30-day photo retention)

#### Test Case: ATP-022-A (Soft-delete job state and preserve object)

**Description:** Validates via **Test** discard semantics for job record and source object retention.

- **User Scenario: SCN-022-A1**
    - **Given** an existing digitization job with status `awaiting-correction`
    - **When** user calls `DELETE /api/v1/recipes/digitize/jobs/:id`
    - **Then** job transitions to soft-deleted/`discarded`, and source image remains available for retention window

#### Test Case: ATP-022-B (Retention worker removes object after 30 days)

**Description:** Validates via **Test** that retention expiry is enforced after default window.

- **User Scenario: SCN-022-B1**
    - **Given** a discarded job whose deletion timestamp is older than 30 days
    - **When** retention cleanup worker runs
    - **Then** associated S3 object is removed and cleanup audit is recorded

---

### Requirement Validation: REQ-023 (Accessible correction field labels)

#### Test Case: ATP-023-A (All fields expose accessible label bindings)

**Description:** Validates via **Test** that correction form controls are discoverable by role/label selectors.

- **User Scenario: SCN-023-A1**
    - **Given** the correction screen is rendered in automated UI test
    - **When** selectors query fields by accessible label (e.g., `Title`, `Ingredients`, `Steps`)
    - **Then** each control is found and operable via role/label queries

#### Test Case: ATP-023-B (Missing aria-label is blocked)

**Description:** Validates via **Test** that unlabeled controls fail accessibility test gate.

- **User Scenario: SCN-023-B1**
    - **Given** a regression where `prep_time` input lacks an accessible label
    - **When** CI accessibility tests execute
    - **Then** test fails with selector/label assertion and release gate is blocked

---

### Requirement Validation: REQ-024 (Keyboard-only navigable job queue)

#### Test Case: ATP-024-A (Full queue interaction via keyboard)

**Description:** Validates via **Demonstration** that job list, filters, and actions are usable without pointer input.

- **User Scenario: SCN-024-A1**
    - **Given** a queue with at least 10 jobs across statuses
    - **When** user navigates with Tab/Shift+Tab/Enter/Space only
    - **Then** user can focus rows, open details, and trigger allowed actions without mouse/touch

#### Test Case: ATP-024-B (Focus trap or unreachable action is non-compliant)

**Description:** Validates via **Demonstration** failure handling for keyboard navigation regressions.

- **User Scenario: SCN-024-B1**
    - **Given** a build where action menu items are not reachable by keyboard
    - **When** keyboard walkthrough is performed
    - **Then** acceptance demonstration fails with unreachable-control defect

---

### Requirement Validation: REQ-025 (Low-confidence indicator not color-only)

#### Test Case: ATP-025-A (Low-confidence marker includes icon/label and color)

**Description:** Validates via **Inspection** that low-confidence UI uses redundant cues.

- **User Scenario: SCN-025-A1**
    - **Given** design system implementation of token confidence badges
    - **When** component markup/styles are inspected
    - **Then** low-confidence state includes textual label/icon in addition to color treatment

#### Test Case: ATP-025-B (Color-only state is rejected)

**Description:** Validates via **Inspection** that purely chromatic indication is not accepted.

- **User Scenario: SCN-025-B1**
    - **Given** a candidate UI change removes icon and text from low-confidence badge
    - **When** accessibility inspection is executed
    - **Then** change is rejected as non-compliant with REQ-025

---

### Requirement Validation: REQ-026 (Accessible circle invitation acceptance)

#### Test Case: ATP-026-A (Web invitation acceptance with screen reader and keyboard)

**Description:** Validates via **Demonstration** accessible invitation acceptance on web.

- **User Scenario: SCN-026-A1**
    - **Given** an authenticated invited user opens `/circles/join/:token` on web with screen reader enabled
    - **When** user navigates to and activates `Join Circle` using keyboard controls
    - **Then** join succeeds and confirmation is announced by assistive technology

#### Test Case: ATP-026-B (Mobile invitation acceptance remains accessible)

**Description:** Validates via **Demonstration** equivalent accessibility on mobile VoiceOver/TalkBack flows.

- **User Scenario: SCN-026-B1**
    - **Given** an authenticated invited user opens the invitation deep link in mobile app
    - **When** user completes join using screen reader gestures and keyboard accessory navigation
    - **Then** membership is created and success feedback is accessible

---

### Requirement Validation: REQ-027 (Clerk session-token auth on all 011 endpoints)

#### Test Case: ATP-027-A (Authorized request succeeds with valid session token)

**Description:** Validates via **Test** that 011 routes require and accept valid Clerk session tokens.

- **User Scenario: SCN-027-A1**
    - **Given** a valid Clerk session token with an allowed `azp` and the required `public_metadata` scopes
    - **When** client calls `GET /api/v1/recipes/digitize/jobs/:id`
    - **Then** endpoint authorizes request and returns job response data

#### Test Case: ATP-027-B (Missing token denied)

**Description:** Validates via **Test** that unauthenticated requests are denied consistently.

- **User Scenario: SCN-027-B1**
    - **Given** no `Authorization` header
    - **When** client calls `POST /api/v1/recipes/digitize/jobs`
    - **Then** API returns `401` Problem Details with `error_code="auth.bearer.required"`

---

### Requirement Validation: REQ-028 (Cursor pagination for job list, page size 20)

#### Test Case: ATP-028-A (Return first page with max 20 jobs and cursor)

**Description:** Validates via **Test** cursor pagination contract on `GET .../jobs`.

- **User Scenario: SCN-028-A1**
    - **Given** user owns 47 digitization jobs
    - **When** client calls `GET /api/v1/recipes/digitize/jobs`
    - **Then** response contains 20 jobs and a `next_cursor`

#### Test Case: ATP-028-B (Invalid cursor returns structured error)

**Description:** Validates via **Test** error handling for malformed cursor values.

- **User Scenario: SCN-028-B1**
    - **Given** client calls `GET /api/v1/recipes/digitize/jobs?cursor=not-base64`
    - **When** cursor parser runs
    - **Then** API returns `400` with `error_code="pagination.cursor.invalid"`

---

### Requirement Validation: REQ-029 (job_status included in all digitization responses)

#### Test Case: ATP-029-A (Responses include allowed job_status values)

**Description:** Validates via **Test** that all digitization payloads carry legal `job_status` enum values.

- **User Scenario: SCN-029-A1**
    - **Given** jobs spanning states `pending`, `processing`, `awaiting-correction`, `saved`, and `discarded`
    - **When** client retrieves each via list and detail endpoints
    - **Then** every payload includes `job_status` and value is one of the five allowed statuses

#### Test Case: ATP-029-B (Unknown status value is rejected by contract tests)

**Description:** Validates via **Test** that unauthorized status strings are not emitted.

- **User Scenario: SCN-029-B1**
    - **Given** a regression emits `job_status="complete"`
    - **When** API schema contract tests run
    - **Then** test fails and deployment is blocked

---

### Requirement Validation: REQ-030 (RFC 7807 + machine-readable error_code)

#### Test Case: ATP-030-A (4xx errors follow Problem Details schema)

**Description:** Validates via **Test** standardized error envelope for client-visible API failures.

- **User Scenario: SCN-030-A1**
    - **Given** client sends invalid payload to `PATCH /api/v1/recipes/digitize/jobs/:id/correction`
    - **When** validation fails
    - **Then** response is RFC 7807 object with `type`, `title`, `status`, `detail`, and `error_code`

#### Test Case: ATP-030-B (5xx response also includes error_code)

**Description:** Validates via **Test** server-error envelope consistency.

- **User Scenario: SCN-030-B1**
    - **Given** an induced internal exception in digitization save path
    - **When** API returns `500`
    - **Then** response body is Problem Details and contains machine-readable `error_code`

---

### Requirement Validation: REQ-031 (Single active invitation link and owner-only rotation)

#### Test Case: ATP-031-A (Owner rotates link; exactly one active token remains)

**Description:** Validates via **Test** invitation lifecycle and owner authorization using `POST /api/v1/circles/:id/invitation/rotate`.

- **User Scenario: SCN-031-A1**
    - **Given** a Circle with active invitation token `tok_old` and authenticated owner
    - **When** owner calls `POST /api/v1/circles/:id/invitation/rotate`
    - **Then** response returns new token `tok_new`, `tok_old` is revoked, and only one token is active

#### Test Case: ATP-031-B (Non-owner cannot rotate invitation)

**Description:** Validates via **Test** access control on invitation rotation endpoint.

- **User Scenario: SCN-031-B1**
    - **Given** an authenticated circle member who is not owner
    - **When** member calls `POST /api/v1/circles/:id/invitation/rotate`
    - **Then** API returns `403` with `error_code="circle.invitation.rotate.forbidden"`

---

### Requirement Validation: REQ-032 (Join endpoint semantics including revoked-token 410)

#### Test Case: ATP-032-A (Join by token for authenticated non-member succeeds)

**Description:** Validates via **Test** success and idempotent semantics for `POST /api/v1/circles/join/:token`.

- **User Scenario: SCN-032-A1**
    - **Given** authenticated user is not currently a member and token is active
    - **When** user calls `POST /api/v1/circles/join/:token`
    - **Then** API returns success and creates membership for that Circle

#### Test Case: ATP-032-B (Rotated token returns 410 revoked code)

**Description:** Validates via **Test** revoked-token behavior exactly as specified.

- **User Scenario: SCN-032-B1**
    - **Given** token was invalidated by invitation rotation
    - **When** client calls `POST /api/v1/circles/join/:token`
    - **Then** API returns `410` Problem Details with `error_code="circle.invitation.revoked"`

---

### Requirement Validation: REQ-033 (Transactional circle deletion with audience rewrite and events)

#### Test Case: ATP-033-A (Owner deletion rewrites audiences and emits events)

**Description:** Validates via **Test** that circle deletion executes owner-only transactional rewrite and event emission.

- **User Scenario: SCN-033-A1**
    - **Given** owner deletes a Circle referenced by 3 recipes with `audience.scope="circle"`
    - **When** deletion transaction executes
    - **Then** all 3 recipes are rewritten to `audience.scope="private"`, one `circle.deleted` event is emitted, and three `recipe.audience.changed` events are emitted

#### Test Case: ATP-033-B (Transactional rollback on event persistence failure)

**Description:** Validates via **Test** that partial rewrites are not committed if transactional unit fails.

- **User Scenario: SCN-033-B1**
    - **Given** event-store write for `circle.deleted` is forced to fail mid-transaction
    - **When** circle deletion runs
    - **Then** recipe audience rewrites are rolled back and Circle remains undeleted

---

### Requirement Validation: REQ-034 (No hard caps; outlier warning events)

#### Test Case: ATP-034-A (Allow member count above soft threshold)

**Description:** Validates via **Test** that no hard cap prevents growth beyond monitoring thresholds.

- **User Scenario: SCN-034-A1**
    - **Given** a Circle already has 100 members
    - **When** owner invites and user 101 joins successfully
    - **Then** membership is allowed and `circle.size.outlier` warning event is emitted

#### Test Case: ATP-034-B (Outlier warning emitted when user owns many circles)

**Description:** Validates via **Test** that owner-circle-count outliers are monitored without blocking creation.

- **User Scenario: SCN-034-B1**
    - **Given** a user already owns 25 circles
    - **When** user creates another circle
    - **Then** creation succeeds and monitoring emits `circle.size.outlier` for owner-count threshold

---

### Requirement Validation: REQ-035 (Owner deletion transfer or soft-delete with audit)

#### Test Case: ATP-035-A (Transfer ownership to oldest eligible member)

**Description:** Validates via **Test** owner account deletion transfer semantics and audit event emission.

- **User Scenario: SCN-035-A1**
    - **Given** Circle has owner and two eligible members where member A joined before member B
    - **When** owner account deletion flow runs
    - **Then** member A becomes owner and ownership transfer audit event is emitted

#### Test Case: ATP-035-B (No eligible members triggers soft-delete path)

**Description:** Validates via **Test** fallback behavior when transfer is impossible.

- **User Scenario: SCN-035-B1**
    - **Given** Circle has no non-owner eligible members
    - **When** owner account deletion runs
    - **Then** Circle enters configured soft-delete behavior with promotion/audit trail recorded

---

### Requirement Validation: REQ-036 (90-day raw_ocr_json purge; parsed_json retention)

#### Test Case: ATP-036-A (Purge raw_ocr_json after 90 days regardless of state)

**Description:** Validates via **Test** retention enforcement independent of job status.

- **User Scenario: SCN-036-A1**
    - **Given** jobs older than 90 days in `pending`, `saved`, and `discarded` states contain `raw_ocr_json`
    - **When** purge process executes
    - **Then** `raw_ocr_json` is removed for all eligible jobs

#### Test Case: ATP-036-B (parsed_json remains after purge)

**Description:** Validates via **Test** that parsed recipe data is retained after raw purge.

- **User Scenario: SCN-036-B1**
    - **Given** a job older than 90 days with populated `parsed_json`
    - **When** raw purge completes
    - **Then** `parsed_json` remains available and unchanged

---

### Requirement Validation: REQ-037 (Provider-agnostic OcrProvider interface)

#### Test Case: ATP-037-A (Interface includes required contract fields)

**Description:** Validates via **Inspection** that `OcrProvider` defines input shape, token/overall confidence schema, language output, error taxonomy, and timeout contract.

- **User Scenario: SCN-037-A1**
    - **Given** source interface definition for OCR abstraction
    - **When** maintainers inspect exported types and method signatures
    - **Then** the interface explicitly includes all required contract elements from REQ-037

#### Test Case: ATP-037-B (Provider implementation missing taxonomy is rejected)

**Description:** Validates via **Inspection** that incomplete provider adapters do not pass acceptance.

- **User Scenario: SCN-037-B1**
    - **Given** a new provider adapter omits required error taxonomy mapping
    - **When** interface compliance inspection is executed
    - **Then** adapter is rejected as non-conformant until taxonomy fields are implemented

---

### Requirement Validation: REQ-038 (CI guardrails for workspace and TS references)

#### Test Case: ATP-038-A (CI passes with complete workspace registration)

**Description:** Validates via **Test** CI checks for `packages/services/*` and `packages/shared/*` workspace + TS reference completeness.

- **User Scenario: SCN-038-A1**
    - **Given** all package directories are registered at root workspace config and included in TS project references
    - **When** CI validation job runs
    - **Then** workspace drift check passes

#### Test Case: ATP-038-B (CI fails on unregistered package)

**Description:** Validates via **Test** that missing registration causes immediate pipeline failure.

- **User Scenario: SCN-038-B1**
    - **Given** a new directory `packages/shared/new-contract` exists but is not in root workspace config
    - **When** CI guardrail script executes
    - **Then** CI fails with non-zero exit and reports missing workspace/TS reference linkage

---

### Requirement Validation: REQ-039 (Transactional isolation/locking for critical circle paths)

#### Test Case: ATP-039-A (Deletion flow acquires required transaction isolation/locks)

**Description:** Validates via **Test** that Circle deletion/owner-deletion use SERIALIZABLE or REPEATABLE READ + `SELECT ... FOR UPDATE`.

- **User Scenario: SCN-039-A1**
    - **Given** concurrent deletion and membership-modification requests target the same Circle
    - **When** transaction instrumentation captures executed SQL and isolation level
    - **Then** the flow uses allowed isolation and locking strategy, preventing race-corrupted outcomes

#### Test Case: ATP-039-B (Non-locking implementation is rejected)

**Description:** Validates via **Test** that weaker/no-locking behavior fails acceptance checks.

- **User Scenario: SCN-039-B1**
    - **Given** a regression removes `FOR UPDATE` from critical row reads
    - **When** concurrent stress test executes
    - **Then** race anomalies appear and acceptance test fails

---

### Requirement Validation: REQ-040 (Offline failure copy, local queue persistence, reconnect retry)

#### Test Case: ATP-040-A (Offline upload queued and retried with idempotency key)

**Description:** Validates via **Demonstration** offline UX and retry semantics for upload/queue flow.

- **User Scenario: SCN-040-A1**
    - **Given** device is offline and user selects a valid recipe photo
    - **When** upload is attempted then connectivity returns
    - **Then** UI shows explicit offline copy, stores queued-local item, and retries automatically using the same idempotency key

#### Test Case: ATP-040-B (Duplicate reconnect retries do not create duplicate jobs)

**Description:** Validates via **Demonstration** idempotency behavior under unstable reconnect conditions.

- **User Scenario: SCN-040-B1**
    - **Given** repeated network flaps trigger multiple retry attempts for one queued upload
    - **When** retries execute after reconnect
    - **Then** only one `DigitizationJob` is created for that idempotency key

---

### Requirement Validation: REQ-041 (UI primitive reuse evaluation and rationale documentation)

#### Test Case: ATP-041-A (Task artifacts show packages/ui primitive evaluation)

**Description:** Validates via **Inspection** that implementation tasks T057–T067 evaluate `packages/apps/commise/ui` primitives first.

- **User Scenario: SCN-041-A1**
    - **Given** implementation notes and task artifacts for T057–T067
    - **When** reviewers inspect decision records
    - **Then** each applicable UI change references existing primitive evaluation outcome

#### Test Case: ATP-041-B (New primitive without rationale is non-compliant)

**Description:** Validates via **Inspection** that undocumented primitive additions are blocked.

- **User Scenario: SCN-041-B1**
    - **Given** a PR adds a new `packages/apps/commise/ui` primitive component
    - **When** acceptance inspection checks designated index/process artifacts
    - **Then** PR is flagged until rationale documentation is added

---

### Requirement Validation: REQ-042 (Circle soft-delete lifecycle, restore, hard-delete worker)

#### Test Case: ATP-042-A (Soft-delete and restore endpoint behavior)

**Description:** Validates via **Test** 30-day soft-delete lifecycle and restore support.

- **User Scenario: SCN-042-A1**
    - **Given** a Circle is soft-deleted with retention expiry set 30 days ahead
    - **When** owner calls restore endpoint before expiry
    - **Then** Circle returns to active state and transition audit events are emitted

#### Test Case: ATP-042-B (Hard-delete worker removes expired soft-deleted circles)

**Description:** Validates via **Test** hard-delete background processing after retention expiry.

- **User Scenario: SCN-042-B1**
    - **Given** a soft-deleted Circle has passed 30-day retention cutoff
    - **When** hard-delete worker runs
    - **Then** Circle is permanently removed and hard-delete transition event is emitted

---

### Requirement Validation: REQ-043 (Feature flags and environment defaults)

#### Test Case: ATP-043-A (Prod defaults OFF, dev/preview defaults ON)

**Description:** Validates via **Test** environment-specific defaults for `digitization.enabled` and `circles.enabled` across API and UI entry points.

- **User Scenario: SCN-043-A1**
    - **Given** three environments: production, preview, and local development
    - **When** flags are read at app/API startup
    - **Then** production defaults both flags OFF while preview/dev defaults both ON

#### Test Case: ATP-043-B (Disabled flags block route/UI access)

**Description:** Validates via **Test** gating behavior when feature flags are disabled.

- **User Scenario: SCN-043-B1**
    - **Given** `digitization.enabled=false` in production
    - **When** user tries digitization entry UI and `POST /api/v1/recipes/digitize/jobs`
    - **Then** UI hides entry and API returns feature-disabled problem with `error_code="feature.disabled.digitization"`

---

### Requirement Validation: REQ-044 (Canary gates and rollback runbook criteria)

#### Test Case: ATP-044-A (Canary promotion follows 1→10→50→100 sequence)

**Description:** Validates via **Demonstration** release-readiness gate procedure with explicit promotion checkpoints.

- **User Scenario: SCN-044-A1**
    - **Given** release candidate and monitoring dashboards are prepared
    - **When** canary rollout is executed
    - **Then** promotion only advances in order `1%`, `10%`, `50%`, `100%` after gate checks pass at each stage

#### Test Case: ATP-044-B (Rollback triggered when gate metric breaches threshold)

**Description:** Validates via **Demonstration** rollback runbook activation tied to OCR latency/DLQ/accessibility metrics.

- **User Scenario: SCN-044-B1**
    - **Given** canary at `10%` with DLQ health alarm in ALARM state
    - **When** release gate evaluation runs
    - **Then** rollout halts and rollback steps are executed per runbook criteria

---

### Requirement Validation: REQ-045 (OCR p95 cold-start latency <=10s for 4MB)

#### Test Case: ATP-045-A (Latency analysis meets p95 target)

**Description:** Validates via **Analysis** that measured p95 cold-start latency for 4 MB input is 10 seconds or less.

- **User Scenario: SCN-045-A1**
    - **Given** a benchmark run of cold starts using 4 MB recipe images
    - **When** latency distribution is analyzed for p95
    - **Then** computed p95 value is `<= 10.0s`

#### Test Case: ATP-045-B (Analysis flags p95 regression)

**Description:** Validates via **Analysis** that exceeding target latency fails acceptance.

- **User Scenario: SCN-045-B1**
    - **Given** benchmark data where p95 is `11.4s`
    - **When** analysis report is evaluated against REQ-045
    - **Then** requirement status is failed and release cannot pass performance gate

---

### Requirement Validation: REQ-046 (Pre-signed upload path; no API binary proxy)

#### Test Case: ATP-046-A (Image upload uses S3 pre-signed PUT only)

**Description:** Validates via **Test** that clients upload binaries directly to S3.

- **User Scenario: SCN-046-A1**
    - **Given** client creates a digitization job via API
    - **When** upload occurs
    - **Then** binary data is sent to the returned S3 pre-signed PUT URL and not through API request body

#### Test Case: ATP-046-B (API rejects direct multipart image proxy attempt)

**Description:** Validates via **Test** that server handlers do not accept proxied image binaries.

- **User Scenario: SCN-046-B1**
    - **Given** client posts multipart image bytes directly to `/api/v1/recipes/digitize/jobs`
    - **When** endpoint receives unsupported binary payload
    - **Then** API returns `415` with `error_code="digitization.upload.direct_binary_not_supported"`

---

### Requirement Validation: REQ-047 (Audit logs for circle membership state changes)

#### Test Case: ATP-047-A (Emit structured audit event on member join)

**Description:** Validates via **Test** that membership creation emits required fields.

- **User Scenario: SCN-047-A1**
    - **Given** an authenticated user joins a circle via valid token
    - **When** membership state changes from non-member to member
    - **Then** audit log event includes `actor`, `circle`, `target_user`, and `action="member_joined"`

#### Test Case: ATP-047-B (Emit structured audit event on member removal)

**Description:** Validates via **Test** that removal changes are also fully auditable.

- **User Scenario: SCN-047-B1**
    - **Given** a circle owner removes a member
    - **When** membership state changes from member to removed
    - **Then** audit event includes `actor`, `circle`, `target_user`, and `action="member_removed"`

---

### Requirement Validation: REQ-048 (WCAG 2.1 AA with zero critical/serious CI violations)

#### Test Case: ATP-048-A (CI accessibility checks report zero critical/serious issues)

**Description:** Validates via **Test** automated accessibility gating for correction and circle-access surfaces.

- **User Scenario: SCN-048-A1**
    - **Given** CI runs accessibility scans for correction flow and circle invitation/join views
    - **When** scan results are aggregated
    - **Then** critical and serious violation counts are both zero

#### Test Case: ATP-048-B (Serious violation blocks acceptance)

**Description:** Validates via **Test** that CI gate prevents regressions.

- **User Scenario: SCN-048-B1**
    - **Given** a serious contrast violation is introduced on correction token badge
    - **When** CI accessibility suite runs
    - **Then** pipeline fails and requirement is marked unmet

---

### Requirement Validation: REQ-049 (API versioning and Node 24 runtime target)

#### Test Case: ATP-049-A (Routes conform to /api/v1/\* and runtime is Node 24.x)

**Description:** Validates via **Inspection** that API routing and runtime target conform to platform conventions.

- **User Scenario: SCN-049-A1**
    - **Given** API route definitions and deployment/runtime config files
    - **When** reviewers inspect route prefixes and runtime declarations
    - **Then** endpoints use `/api/v1/*` and runtime target is Node `24.x`

#### Test Case: ATP-049-B (Non-v1 route or runtime mismatch is rejected)

**Description:** Validates via **Inspection** that convention drift is blocked.

- **User Scenario: SCN-049-B1**
    - **Given** a new endpoint is added at `/api/recipes/digitize/jobs` or runtime set to Node 22
    - **When** standards inspection runs
    - **Then** change is flagged non-compliant with REQ-049

---

### Requirement Validation: REQ-050 (Queue scale and queue/DLQ alarms)

#### Test Case: ATP-050-A (Support >=20 concurrent jobs per user without blocking UI)

**Description:** Validates via **Test** concurrency behavior and client responsiveness for bulk imports.

- **User Scenario: SCN-050-A1**
    - **Given** one user submits 20 images in quick succession
    - **When** jobs are queued and processed
    - **Then** UI remains responsive and all 20 jobs transition through asynchronous states without blocking request thread

#### Test Case: ATP-050-B (Queue depth/DLQ alarm triggers on fault)

**Description:** Validates via **Test** operational alarm behavior for queue health degradation.

- **User Scenario: SCN-050-B1**
    - **Given** OCR consumer failures drive messages into DLQ and queue depth rises above alarm threshold
    - **When** CloudWatch alarm evaluation runs
    - **Then** queue depth and DLQ alarms enter ALARM state

---

### Requirement Validation: REQ-051 (Outlier detection within 1 hour)

#### Test Case: ATP-051-A (Detect Circle member-count outlier <=1 hour)

**Description:** Validates via **Test** monitoring latency for member-count threshold crossing.

- **User Scenario: SCN-051-A1**
    - **Given** a Circle grows from 100 to 101 members at time `T0`
    - **When** outlier detector runs
    - **Then** outlier event/alert is emitted by `T0 + 1 hour`

#### Test Case: ATP-051-B (Detect owner-circle-count outlier <=1 hour)

**Description:** Validates via **Test** monitoring latency for owner circle-count threshold.

- **User Scenario: SCN-051-B1**
    - **Given** a user reaches 25 owned circles at time `T0`
    - **When** monitoring pipeline evaluates ownership outliers
    - **Then** alert for owner-circle-count outlier appears within 1 hour

---

### Requirement Validation: REQ-052 (Daily raw_ocr purge metric emission)

#### Test Case: ATP-052-A (Daily job purges eligible raw_ocr and emits metric count)

**Description:** Validates via **Test** daily purge execution and metric publication when eligible rows exist.

- **User Scenario: SCN-052-A1**
    - **Given** 42 jobs contain `raw_ocr_json` older than 90 days
    - **When** daily purge process runs
    - **Then** all 42 raw payloads are purged and metric `digitization.raw_ocr.purged.count=42` is emitted

#### Test Case: ATP-052-B (No eligible records does not emit misleading positive count)

**Description:** Validates via **Test** metric correctness when nothing is eligible.

- **User Scenario: SCN-052-B1**
    - **Given** there are zero eligible old `raw_ocr_json` rows
    - **When** daily purge process runs
    - **Then** no positive purge-count metric is emitted for that run

---

### Requirement Validation: REQ-053 (shared-audience exports required types)

#### Test Case: ATP-053-A (AudienceScope exports all required literal values)

**Description:** Validates via **Test** that `@kitchensink/audience` publishes required `AudienceScope` members.

- **User Scenario: SCN-053-A1**
    - **Given** consumer package imports `AudienceScope` from `@kitchensink/audience`
    - **When** compile-time and runtime contract tests evaluate enum/object values
    - **Then** values include `private`, `circle`, `public-profile`, and `published-lesson`

#### Test Case: ATP-053-B (Audience type missing optional fields fails contract test)

**Description:** Validates via **Test** required type-shape contract for optional `ref_id` and `price_cents`.

- **User Scenario: SCN-053-B1**
    - **Given** a package version where `Audience` omits `ref_id`
    - **When** consumer contract tests compile and run
    - **Then** test fails due to interface mismatch with REQ-053

---

### Requirement Validation: REQ-054 (circles-api service contract surface)

#### Test Case: ATP-054-A (Public API exposes listCirclesForUser/isMember/resolveAudience)

**Description:** Validates via **Test** that `@kitchensink/circles-service` exports required service contracts.

- **User Scenario: SCN-054-A1**
    - **Given** downstream consumer imports from `@kitchensink/circles-service`
    - **When** integration contract tests execute
    - **Then** `listCirclesForUser`, `isMember`, and `resolveAudience` are present and callable

#### Test Case: ATP-054-B (Removed contract symbol breaks acceptance)

**Description:** Validates via **Test** that accidental contract removal is caught.

- **User Scenario: SCN-054-B1**
    - **Given** a regression removes export `resolveAudience`
    - **When** consumer contract tests run
    - **Then** build fails with missing-export error and REQ-054 not satisfied

---

### Requirement Validation: REQ-055 (Safe audience-resolution degradation on circles outage)

#### Test Case: ATP-055-A (Exclude circle scope and show temporary unavailability)

**Description:** Validates via **Demonstration** fallback behavior when circles service is unavailable.

- **User Scenario: SCN-055-A1**
    - **Given** circles service dependency returns timeout/unavailable
    - **When** consumer requests audience resolution
    - **Then** response excludes `circle` scope and client receives temporary-unavailability path messaging

#### Test Case: ATP-055-B (Fallback never leaks circle-only data)

**Description:** Validates via **Demonstration** that outage fallback remains data-safe.

- **User Scenario: SCN-055-B1**
    - **Given** circles service remains unavailable during audience checks
    - **When** consumer requests recipe lists
    - **Then** no circle-restricted recipe is exposed to non-members during degraded mode

---

### Requirement Validation: REQ-056 (Canonical invitation persistence terminology)

#### Test Case: ATP-056-A (Artifacts use one canonical invitation table term)

**Description:** Validates via **Inspection** terminology consistency (`circle_invitations` vs `circle_invites`) across artifacts.

- **User Scenario: SCN-056-A1**
    - **Given** schema docs, migrations, ORM models, and API docs for circle invitations
    - **When** naming is inspected
    - **Then** one canonical term is used consistently with no mixed naming

#### Test Case: ATP-056-B (Mixed naming is flagged pre-implementation)

**Description:** Validates via **Inspection** that conflicting terminology is blocked.

- **User Scenario: SCN-056-B1**
    - **Given** migration defines `circle_invites` while model references `circle_invitations`
    - **When** acceptance inspection runs
    - **Then** inconsistency is reported and requirement remains unmet

---

### Requirement Validation: REQ-057 (Reusable invitation links and rotation semantics)

#### Test Case: ATP-057-A (Active link reusable until revoked)

**Description:** Validates via **Test** that same active token can be used by multiple invitees over time.

- **User Scenario: SCN-057-A1**
    - **Given** active invitation token exists for Circle C
    - **When** two invited users join at different times using the same token before rotation
    - **Then** both joins succeed without token expiration

#### Test Case: ATP-057-B (Revocation rotates token and invalidates old one)

**Description:** Validates via **Test** link revocation/rotation lifecycle.

- **User Scenario: SCN-057-B1**
    - **Given** owner revokes current invitation link
    - **When** old token is reused and new token is used
    - **Then** old token fails with `410 circle.invitation.revoked` and new token succeeds

---

### Requirement Validation: REQ-058 (Circle deletion reverts affected audiences to private)

#### Test Case: ATP-058-A (Delete circle rewrites all circle-scoped recipe audiences)

**Description:** Validates via **Test** clarification C-002 behavior for audience fallback.

- **User Scenario: SCN-058-A1**
    - **Given** Circle C is referenced by multiple recipes with `audience.scope="circle"`
    - **When** owner deletes Circle C
    - **Then** all affected recipes are rewritten to private audience semantics

#### Test Case: ATP-058-B (No unrelated recipe audiences are modified)

**Description:** Validates via **Test** rewrite scope accuracy during deletion.

- **User Scenario: SCN-058-B1**
    - **Given** recipes scoped to other circles and private/public scopes exist
    - **When** Circle C is deleted
    - **Then** only recipes referencing Circle C are rewritten

---

### Requirement Validation: REQ-059 (No hard caps; monitoring-only limit mechanism)

#### Test Case: ATP-059-A (System allows operations beyond soft thresholds)

**Description:** Validates via **Inspection** policy implementation: no hard member/circle limits in v1.

- **User Scenario: SCN-059-A1**
    - **Given** policy/config and service checks for circle creation and membership
    - **When** reviewers inspect enforcement logic
    - **Then** no hard reject threshold exists for member count or circle ownership

#### Test Case: ATP-059-B (Monitoring alerts configured for soft thresholds)

**Description:** Validates via **Inspection** that alerting, not enforcement, is the only limit mechanism.

- **User Scenario: SCN-059-B1**
    - **Given** observability configuration for outlier thresholds
    - **When** inspection reviews alarms/events
    - **Then** alerting rules exist and no blocking control is defined

---

### Requirement Validation: REQ-060 (Owner deletion transfer oldest eligible else soft-delete)

#### Test Case: ATP-060-A (Oldest eligible member gets ownership transfer)

**Description:** Validates via **Test** C-004 owner succession rule.

- **User Scenario: SCN-060-A1**
    - **Given** Circle members M1, M2 where M1 has oldest eligible membership timestamp
    - **When** owner account deletion is processed
    - **Then** ownership transfers to M1 and transfer event is logged

#### Test Case: ATP-060-B (No eligible member routes to soft-delete path)

**Description:** Validates via **Test** fallback path when succession cannot occur.

- **User Scenario: SCN-060-B1**
    - **Given** Circle has no eligible successor member
    - **When** owner account deletion occurs
    - **Then** Circle follows configured soft-delete flow with lifecycle events emitted

---

### Requirement Validation: REQ-061 (raw purge at 90 days; parsed retained for lifetime)

#### Test Case: ATP-061-A (Purge job removes only raw_ocr_json)

**Description:** Validates via **Test** data-minimization behavior for aged raw OCR payloads.

- **User Scenario: SCN-061-A1**
    - **Given** a job older than 90 days contains both `raw_ocr_json` and `parsed_json`
    - **When** purge process executes
    - **Then** `raw_ocr_json` becomes null/removed while `parsed_json` remains populated

#### Test Case: ATP-061-B (Recent raw_ocr_json is not purged early)

**Description:** Validates via **Test** that retention cutoff is not applied prematurely.

- **User Scenario: SCN-061-B1**
    - **Given** a job with `raw_ocr_json` age of 45 days
    - **When** daily purge runs
    - **Then** raw payload is retained and job is excluded from purge count

---

### Requirement Validation: REQ-062 (Integration/e2e file naming constitution compliance)

#### Test Case: ATP-062-A (Integration/e2e test filenames match Principle IV convention)

**Description:** Validates via **Inspection** that naming convention is followed across integration/e2e suites.

- **User Scenario: SCN-062-A1**
    - **Given** repository integration and e2e test directories
    - **When** file names are inspected against Constitution Principle IV naming pattern
    - **Then** all test files conform to required naming convention

#### Test Case: ATP-062-B (Misnamed test file is blocked)

**Description:** Validates via **Inspection** non-compliance handling for naming violations.

- **User Scenario: SCN-062-B1**
    - **Given** a new integration test file named `test1.tmp.ts`
    - **When** constitution compliance inspection runs
    - **Then** violation is reported and acceptance is blocked until renamed

---

### Requirement Validation: REQ-063 (Requirement-traceability headers in all test files)

#### Test Case: ATP-063-A (All tests include REQ trace header comment)

**Description:** Validates via **Inspection** that each test file includes header comment linking to requirement IDs.

- **User Scenario: SCN-063-A1**
    - **Given** unit, integration, and e2e test files in scope
    - **When** header blocks are inspected
    - **Then** each file includes requirement traceability comment entries

#### Test Case: ATP-063-B (Missing trace header fails acceptance inspection)

**Description:** Validates via **Inspection** enforcement for missing traceability metadata.

- **User Scenario: SCN-063-B1**
    - **Given** a new test file lacks requirement header comments
    - **When** constitutional inspection gate executes
    - **Then** file is flagged and requirement is considered unmet

---

### Requirement Validation: REQ-064 (Per-PR schema isolation guardrails)

#### Test Case: ATP-064-A (CI provisions isolated schema per PR and enforces guardrails)

**Description:** Validates via **Inspection** infrastructure/CI design for per-PR schema isolation.

- **User Scenario: SCN-064-A1**
    - **Given** CI pipeline configuration for pull-request test environments
    - **When** isolation strategy is inspected
    - **Then** each PR is assigned isolated schema resources with explicit guardrails preventing cross-PR collisions

#### Test Case: ATP-064-B (Shared schema configuration is rejected)

**Description:** Validates via **Inspection** that non-isolated CI schema plans are non-compliant.

- **User Scenario: SCN-064-B1**
    - **Given** a CI proposal uses one shared schema for all PR jobs
    - **When** governance inspection executes
    - **Then** proposal fails REQ-064 compliance review

---

### Requirement Validation: REQ-065 (generate:types must run before test tasks)

#### Test Case: ATP-065-A (Pipeline executes generate:types before unit/integration/e2e)

**Description:** Validates via **Test** CI execution ordering across test stages.

- **User Scenario: SCN-065-A1**
    - **Given** a pull request pipeline with type-generation and test jobs
    - **When** CI run executes full test workflow
    - **Then** `generate:types` step completes before any unit, integration, or e2e test command starts

#### Test Case: ATP-065-B (Out-of-order test execution is rejected)

**Description:** Validates via **Test** that tests cannot run prior to type generation.

- **User Scenario: SCN-065-B1**
    - **Given** CI configuration is modified so `npm test` starts before `generate:types`
    - **When** workflow validation runs
    - **Then** pipeline fails ordering check with `error_code="ci.order.generate_types_required"`

---

## Coverage Summary

| Metric                   | Count               |
| ------------------------ | ------------------- |
| Total Requirements (REQ) | 65                  |
| Total Test Cases (ATP)   | 130                 |
| Total Scenarios (SCN)    | 130                 |
| Requirements with ≥1 ATP | 65 / 65 (100.00%)   |
| Test Cases with ≥1 SCN   | 130 / 130 (100.00%) |
| **Overall Coverage**     | **100.00%**         |

## Uncovered Requirements

None — full coverage achieved.
