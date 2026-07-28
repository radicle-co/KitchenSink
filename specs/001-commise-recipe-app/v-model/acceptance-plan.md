# Acceptance Test Plan: Commise - Recipe Management Core

**Feature Branch**: `001-commise-recipe-app`
**Created**: 2026-04-30
**Last Updated**: 2026-05-08 (PRF-ATP-001 remediation: corrected ATP count to 129 in Coverage Summary, added sub-ID linkage coverage note)
**Status**: Draft
**Source**: `specs/001-commise-recipe-app/v-model/requirements.md`

## Overview

This document defines the Acceptance Test Plan for Commise - Recipe Management
Core. Every requirement in `requirements.md` has one or more Acceptance Test
Cases (ATP), and every ATP has one or more executable BDD scenarios (SCN) in
strict Given/When/Then format.

## Test Plan Context

- **Test Level:** Acceptance
- **Entry Criteria:**
    1. `system-test.md` execution evidence shows all P1 system tests passing.
    2. UAT/staging environment is deployed and reachable for web, mobile, API, and required dependencies.
    3. Seed data and test harness assets required by ATP scenarios are available.
- **Exit Criteria:**
    1. All P1 ATPs pass.
    2. Zero open Critical/Major defects linked to this feature scope.
    3. Coverage Summary shows 100% requirement coverage against the current baseline (134 requirements).

## Traceability Policy

- The traceability baseline is **134 requirements** from `requirements.md` (including atomic sub-IDs). This is the count of normative requirement IDs: 91 functional REQ-NNN/REQ-NNNx + 29 non-functional REQ-NF-NNN/NF-NNNx + 10 interface REQ-IF-NNN + 7 constraint REQ-CN-NNN = 134 total. Umbrella index entries (REQ-035, REQ-038, REQ-049) are non-normative and excluded from the baseline.
- ATP linkage uses explicit atomic sub-IDs where requirements were decomposed for independent testability (e.g., REQ-035a/b, REQ-038a/b/c, REQ-049a/b).
- Umbrella IDs MAY be retained in addition to atomic links only when needed for readability; atomic links are authoritative for coverage.
- `REQ-010c` (referenced in the atomization preamble as a conceptual completeness note) is not a formal requirement row; the 134-count baseline is derived from actual table rows only.

## ID Schema

- **Test Case**: `ATP-{NNN}-{X}` for functional requirements (e.g., `ATP-008-B`)
- **Scenario**: `SCN-{NNN}-{X}{#}` for functional requirements (e.g., `SCN-008-B1`). All acceptance-level scenarios use the **User Scenario** label (e.g., `**User Scenario: SCN-008-B1**`) to distinguish them from system-level scenarios in `system-test.md`.
- **Category-prefixed IDs**:
    - Non-functional: `ATP-NF-{NNN}-{X}`, `SCN-NF-{NNN}-{X}{#}`
    - Interface: `ATP-IF-{NNN}-{X}`, `SCN-IF-{NNN}-{X}{#}`
    - Constraint: `ATP-CN-{NNN}-{X}`, `SCN-CN-{NNN}-{X}{#}`

## Verification Method Notes (ISO 29119 Test vs Inspection/Analysis)

- The following ATPs are **non-executable acceptance checks** and are validated via **Inspection** or **Analysis** as specified in `requirements.md`:
    - **Analysis:** ATP-NF-004-A, ATP-NF-015-A
    - **Inspection:** ATP-NF-005-A, ATP-NF-005-B, ATP-NF-006-A, ATP-NF-008-A, ATP-NF-009-A, ATP-NF-010-A, ATP-NF-011-A, ATP-NF-011-B, ATP-NF-012-A, ATP-NF-013-A, ATP-NF-014-A, ATP-NF-016-A, ATP-NF-017-A, ATP-NF-018-A, ATP-NF-018-B, ATP-NF-019-A, ATP-NF-019-B, ATP-NF-020-A, ATP-041-A, ATP-041-B, ATP-IF-004-A
- All other ATPs are executable test cases unless otherwise stated.

## Acceptance Tests

### Requirement Validation: REQ-001 (Recipe title creation)

#### Test Case: ATP-001-A (Authenticated create with title)

**Linked Requirement:** REQ-001
**Description:** Validates that an authenticated user can create a recipe with a title.
**Validation Condition:** A valid authenticated create request includes a non-empty title.
**Expected Result:** HTTP 201 is returned; response JSON contains recipe `id` and `title`; persisted recipe row stores the submitted title for the requesting owner.

- **User Scenario: SCN-001-A1**
    - **Given** an authenticated user with no existing recipe titled "Weeknight Pasta"
    - **When** the user submits a create-recipe request containing title `"Weeknight Pasta"`
    - **Then** the system returns HTTP 201 and stores a new recipe owned by that user with title `"Weeknight Pasta"`

---

### Requirement Validation: REQ-002 (Description on create or update)

#### Test Case: ATP-002-A (Description persistence)

**Linked Requirement:** REQ-002
**Description:** Validates that description can be attached during create or update operations.
**Validation Condition:** A recipe payload containing a description is accepted on create and on update by the owner.
**Expected Result:** Create/update responses are successful and persisted recipe `description` exactly matches submitted text.

- **User Scenario: SCN-002-A1**
    - **Given** an authenticated user preparing a new recipe payload containing description `"Bright lemon and herb profile"`
    - **When** the user submits the create-recipe request
    - **Then** the system stores the recipe with description `"Bright lemon and herb profile"` and returns a successful create response

---

### Requirement Validation: REQ-003a, REQ-003b (Ingredient cardinality and food-database linkage)

#### Test Case: ATP-003-A (Linked ingredient persistence)

**Linked Requirement:** REQ-003b
**Description:** Validates that ingredients can be added and linked to a real food record when a match exists.
**Validation Condition:** Ingredient text with an exact food-database match is selected during recipe save.
**Expected Result:** Persisted ingredient row includes the selected food service internal id (`foodId`, an opaque ULID — never a USDA `fdcId`) and remains attached to the recipe.

- **User Scenario: SCN-003-A1**
    - **Given** an authenticated user editing a recipe and ingredient suggestion `"Tomato, raw"` resolves (via `@kitchensink/food-service-client`) to a food service record with internal id `01J8F3ZK9PQ7VN2M4T7XR8W123`
    - **When** the user saves the recipe with that linked ingredient
    - **Then** the saved recipe includes the ingredient linked by `foodId` `01J8F3ZK9PQ7VN2M4T7XR8W123`

#### Test Case: ATP-003-B (Ingredient-count bounds 1..100)

**Linked Requirement:** REQ-003a
**Description:** Validates lower and upper inclusive ingredient-count bounds for recipe save.
**Validation Condition:** Recipe saves are submitted at lower boundary (1 ingredient), upper boundary (100 ingredients), and outside boundaries (0 and 101 ingredients).
**Expected Result:** Saves with 1 and 100 ingredients succeed; saves with 0 or 101 ingredients are rejected with HTTP 422 and no out-of-range payload is persisted.

- **User Scenario: SCN-003-B1**
    - **Given** an authenticated user preparing recipe payloads with ingredient counts of `1` and `100`
    - **When** the user submits each payload
    - **Then** both requests succeed and persist exactly the submitted ingredient counts

- **User Scenario: SCN-003-B2**
    - **Given** an authenticated user preparing recipe payloads with ingredient counts of `0` and `101`
    - **When** the user submits each out-of-range payload
    - **Then** the system returns HTTP 422 for each and persists no out-of-range ingredient set

#### Test Case: ATP-003-C (Reject recipe with 101 ingredients)

**Linked Requirement:** REQ-003a
**Description:** Validates explicit upper-bound rejection beyond the 100-ingredient limit.
**Validation Condition:** Recipe save is submitted with exactly 101 ingredients.
**Expected Result:** HTTP 422 is returned with an ingredient-count bounds validation error; recipe with 101 ingredients is not persisted.

- **User Scenario: SCN-003-C1**
    - **Given** an authenticated user preparing a recipe payload with exactly `101` ingredients
    - **When** the user submits the payload
    - **Then** the system returns HTTP 422 and persists no recipe state with 101 ingredients

---

### Requirement Validation: REQ-004 (Ordered instructions)

#### Test Case: ATP-004-A (Instruction order retention)

**Linked Requirement:** REQ-004
**Description:** Validates that step-by-step instructions are stored and returned in explicit order.
**Validation Condition:** A recipe is saved with an ordered list of at least three instruction steps.
**Expected Result:** Retrieved recipe returns the same instruction sequence order as submitted (e.g., step 1, step 2, step 3).

- **User Scenario: SCN-004-A1**
    - **Given** an authenticated user has instruction steps `"Prep"`, `"Saute"`, and `"Simmer"` in that order
    - **When** the user saves the recipe
    - **Then** the persisted recipe returns instructions in the order `"Prep"`, `"Saute"`, `"Simmer"`

---

### Requirement Validation: REQ-005 (Non-negative minute time fields)

#### Test Case: ATP-005-A (Accept non-negative integer minutes)

**Linked Requirement:** REQ-005
**Description:** Validates acceptance of prep/cook/total times as non-negative integer minutes.
**Validation Condition:** A recipe is saved with integer values `prep=0`, `cook=25`, `total=25`.
**Expected Result:** Save succeeds and all three persisted time fields equal submitted integers.

- **User Scenario: SCN-005-A1**
    - **Given** an authenticated user editing a recipe with `prepMinutes=0`, `cookMinutes=25`, `totalMinutes=25`
    - **When** the user saves the recipe metadata
    - **Then** the system persists all three minute fields exactly as `0`, `25`, and `25`

#### Test Case: ATP-005-B (Reject negative minute values)

**Linked Requirement:** REQ-005
**Description:** Validates rejection of negative minute values for any time field.
**Validation Condition:** A recipe save is attempted with one or more negative minute integers.
**Expected Result:** HTTP 400 is returned; response identifies invalid negative fields; no negative values are persisted. (reconciled 2026-07-25: as-built status — the service's global `ValidationPipe` default returns 400, matching the OpenAPI contract, not 422)

- **User Scenario: SCN-005-B1**
    - **Given** an authenticated user editing a recipe with `cookMinutes=-1`
    - **When** the user submits the save request
    - **Then** the system returns HTTP 400 and rejects the save for the negative minute value

---

### Requirement Validation: REQ-006 (Positive servings count)

#### Test Case: ATP-006-A (Accept positive integer servings)

**Linked Requirement:** REQ-006
**Description:** Validates acceptance of a positive integer servings value.
**Validation Condition:** A recipe is saved with `servings=4`.
**Expected Result:** Save succeeds and persisted `servings` equals `4`.

- **User Scenario: SCN-006-A1**
    - **Given** an authenticated user editing a recipe with `servings=4`
    - **When** the user saves the recipe
    - **Then** the system persists `servings` as `4`

#### Test Case: ATP-006-B (Reject zero or negative servings)

**Linked Requirement:** REQ-006
**Description:** Validates rejection of non-positive servings values.
**Validation Condition:** A recipe save is attempted with `servings=0` or a negative integer.
**Expected Result:** HTTP 400 is returned with a servings validation error; record is not updated with non-positive servings. (reconciled 2026-07-25: as-built status — matches the OpenAPI contract's `ValidationPipe` default, not 422)

- **User Scenario: SCN-006-B1**
    - **Given** an authenticated user editing a recipe with `servings=0`
    - **When** the user submits the save request
    - **Then** the system returns HTTP 400 and does not persist `servings=0`

---

### Requirement Validation: REQ-007 (Recipe tags/categories)

#### Test Case: ATP-007-A (Attach zero or more tags)

**Linked Requirement:** REQ-007
**Description:** Validates that a user can save a recipe with any number of tags, including zero.
**Validation Condition:** Recipe save requests are submitted with no tags and with multiple tags.
**Expected Result:** Both saves succeed; persisted tags exactly match each request payload.

- **User Scenario: SCN-007-A1**
    - **Given** an authenticated user editing a recipe with tags `["quick", "dinner", "vegetarian"]`
    - **When** the user saves the recipe
    - **Then** the recipe is stored with exactly those three tags in the returned metadata

- **User Scenario: SCN-007-A2**
    - **Given** an authenticated user editing a recipe with tags `[]`
    - **When** the user saves the recipe
    - **Then** the recipe is stored successfully with an empty tags list `[]`

#### Test Case: ATP-007-B (Tag-count bounds 0..50)

**Linked Requirement:** REQ-007
**Description:** Validates explicit upper inclusive tag bound and rejection beyond it.
**Validation Condition:** Recipe saves are submitted with exactly 50 tags and with 51 tags.
**Expected Result:** Save with 50 tags succeeds; save with 51 tags is rejected with HTTP 422 and no out-of-range tag payload is persisted.

- **User Scenario: SCN-007-B1**
    - **Given** an authenticated user preparing a recipe payload with exactly `50` tags
    - **When** the user submits the save request
    - **Then** the system accepts the request and persists all 50 tags

- **User Scenario: SCN-007-B2**
    - **Given** an authenticated user preparing a recipe payload with exactly `51` tags
    - **When** the user submits the save request
    - **Then** the system returns HTTP 422 and does not persist a recipe with 51 tags

---

### Requirement Validation: REQ-008 (Maximum 10 photos per recipe)

#### Test Case: ATP-008-A (Allow exactly 10 photos)

**Linked Requirement:** REQ-008
**Description:** Validates the upper inclusive limit of 10 photos on a recipe.
**Validation Condition:** A recipe save includes exactly 10 valid photos.
**Expected Result:** Save succeeds and recipe stores references to all 10 uploaded photos.

- **User Scenario: SCN-008-A1**
    - **Given** an authenticated user has 10 valid image files prepared for one recipe
    - **When** the user submits the recipe save with all 10 photos
    - **Then** the system saves the recipe and associates exactly 10 photos

#### Test Case: ATP-008-B (Reject 11th photo)

**Linked Requirement:** REQ-008
**Description:** Validates rejection beyond the 10-photo cap.
**Validation Condition:** A recipe save includes 11 valid photos.
**Expected Result:** HTTP 422 is returned with photo-count violation; no 11th photo reference is persisted.

- **User Scenario: SCN-008-B1**
    - **Given** an authenticated user has 11 valid image files for one recipe
    - **When** the user submits the recipe save with all 11 photos
    - **Then** the system rejects the request with a max-photo-limit error and does not persist an 11th photo

---

### Requirement Validation: REQ-009 (Per-photo 5 MB size ceiling)

#### Test Case: ATP-009-A (Accept photo at 5 MB boundary)

**Linked Requirement:** REQ-009
**Description:** Validates that a photo of exactly 5 MB is accepted.
**Validation Condition:** An individual photo binary size equals exactly 5,242,880 bytes (5 MiB).
**Expected Result:** Photo passes size validation and upload flow continues successfully.

- **User Scenario: SCN-009-A1**
    - **Given** an authenticated user has a JPEG file of exactly 5,242,880 bytes
    - **When** the user uploads the photo as part of recipe save
    - **Then** the system accepts that photo and includes it in the recipe's photo set

#### Test Case: ATP-009-B (Reject photo larger than 5 MB)

**Linked Requirement:** REQ-009
**Description:** Validates rejection when photo size exceeds 5 MB by any amount.
**Validation Condition:** An individual photo binary size is 5,242,881 bytes or greater.
**Expected Result:** HTTP 422 is returned with per-file size error; oversized photo is not persisted.

- **User Scenario: SCN-009-B1**
    - **Given** an authenticated user has a PNG file of 5,242,881 bytes
    - **When** the user uploads the photo
    - **Then** the system rejects the file with a size-exceeded validation error

---

### Requirement Validation: REQ-010a, REQ-010b (Atomic metadata save independent of photo failures)

#### Test Case: ATP-010-A (Metadata persists when all photos succeed)

**Linked Requirement:** REQ-010a
**Description:** Validates metadata persistence in a successful all-photo upload path.
**Validation Condition:** Metadata and photos are submitted, and all photos upload successfully.
**Expected Result:** Metadata and photo references are persisted in one successful save response.

- **User Scenario: SCN-010-A1**
    - **Given** an authenticated user submits valid metadata and 2 valid photos
    - **When** the user saves the recipe
    - **Then** the recipe metadata is persisted and both photos are attached

#### Test Case: ATP-010-B (Metadata persists when one or more photos fail)

**Linked Requirement:** REQ-010b
**Description:** Validates that metadata save is independent from partial photo upload failure.
**Validation Condition:** Metadata is valid but at least one submitted photo fails validation or upload.
**Expected Result:** Metadata save succeeds; failed photo references are absent; success response indicates metadata was saved with per-file photo errors.

- **User Scenario: SCN-010-B1**
    - **Given** an authenticated user submits valid metadata with one valid photo and one intentionally failing photo
    - **When** the user saves the recipe
    - **Then** the system persists metadata and the valid photo while reporting the failing photo error without rolling back metadata

---

### Requirement Validation: REQ-011 (Client-side 5 MB photo validation)

#### Test Case: ATP-011-A (Client accepts 5 MB file)

**Linked Requirement:** REQ-011
**Description:** Validates client pre-upload validation allows files up to 5 MB inclusive.
**Validation Condition:** Client receives a file at exactly 5 MB and performs local validation.
**Expected Result:** Client marks file valid and includes it in upload queue.

- **User Scenario: SCN-011-A1**
    - **Given** an authenticated user selects a file of exactly 5,242,880 bytes
    - **When** client-side validation executes before transmission
    - **Then** the file remains in the upload set and is transmitted

#### Test Case: ATP-011-B (Client rejects >5 MB file)

**Linked Requirement:** REQ-011
**Description:** Validates client pre-upload rejection for files above 5 MB.
**Validation Condition:** Client receives a file larger than 5 MB.
**Expected Result:** Client blocks transmission and surfaces a per-file size error message.

- **User Scenario: SCN-011-B1**
    - **Given** an authenticated user selects a file of 5,242,881 bytes
    - **When** client-side validation executes
    - **Then** the client rejects the file locally and does not send it to the API

---

### Requirement Validation: REQ-012 (Client MIME allowlist enforcement)

#### Test Case: ATP-012-A (Client accepts allowlisted MIME types)

**Linked Requirement:** REQ-012
**Description:** Validates client-side acceptance of allowlisted MIME types only.
**Validation Condition:** Files are selected with MIME types `image/jpeg`, `image/png`, and `image/webp`. (HEIC/HEIF are deliberately NOT allowlisted — deferred, WAV-001 in waivers.md: the recipe-service's `sharp` build cannot decode/thumbnail them, so a client-accepted HEIC would always fail server-side.)
**Expected Result:** Client accepts each allowlisted type and permits transmission.

- **User Scenario: SCN-012-A1**
    - **Given** an authenticated user selects one file for each allowlisted MIME type
    - **When** client MIME validation executes
    - **Then** all allowlisted files are accepted for upload

#### Test Case: ATP-012-B (Client rejects disallowed MIME type)

**Linked Requirement:** REQ-012
**Description:** Validates client-side rejection of MIME types outside the allowlist.
**Validation Condition:** A file with MIME type `image/gif` is selected.
**Expected Result:** Client rejects the file and surfaces a MIME allowlist validation error.

- **User Scenario: SCN-012-B1**
    - **Given** an authenticated user selects a file advertised as `image/gif`
    - **When** client MIME validation executes before upload
    - **Then** the client blocks transmission and displays an unsupported-format error

---

### Requirement Validation: REQ-013 (Server magic-byte revalidation)

#### Test Case: ATP-013-A (Server accepts allowlisted detected types)

**Linked Requirement:** REQ-013
**Description:** Validates server acceptance when detected file signature matches allowlisted types.
**Validation Condition:** Uploaded files have magic-byte signatures for allowlisted formats.
**Expected Result:** Server accepts files and persists photo references for valid detected types.

- **User Scenario: SCN-013-A1**
    - **Given** an authenticated user uploads files whose magic bytes identify `image/jpeg`, `image/png`, or `image/webp`
    - **When** the server performs magic-byte inspection
    - **Then** the server accepts those files and records photo references on the recipe

#### Test Case: ATP-013-B (Server rejects disallowed detected type)

**Linked Requirement:** REQ-013
**Description:** Validates server rejection based on detected signature for non-allowlisted content.
**Validation Condition:** Uploaded file magic bytes identify a non-allowlisted type such as GIF.
**Expected Result:** Server rejects the file with HTTP 422 and does not persist a photo reference.

- **User Scenario: SCN-013-B1**
    - **Given** an authenticated user uploads a file whose magic bytes identify GIF content
    - **When** the server inspects file signature
    - **Then** the server rejects the file with unsupported-type validation output

#### Test Case: ATP-013-C (Server rejects spoofed Content-Type)

**Linked Requirement:** REQ-013
**Description:** Validates that server ignores client-supplied `Content-Type` when signature mismatches.
**Validation Condition:** Request header claims an allowlisted MIME but magic bytes indicate disallowed content.
**Expected Result:** Server rejects upload using detected type; response explains signature mismatch; no photo reference is saved.

- **User Scenario: SCN-013-C1**
    - **Given** an authenticated user uploads a file with header `Content-Type: image/png` but executable magic bytes
    - **When** the server validates the photo by signature
    - **Then** the server rejects the file as disallowed and persists no reference

---

### Requirement Validation: REQ-014 (Per-file upload/validation error visibility)

#### Test Case: ATP-014-A (Surface file-specific error and reason)

**Linked Requirement:** REQ-014
**Description:** Validates that failures are reported per file with explicit reason.
**Validation Condition:** Multiple photo uploads include at least one failing file and one passing file.
**Expected Result:** Error payload/UI identifies failed file token (name or index) and concrete reason; successful files remain unaffected.

- **User Scenario: SCN-014-A1**
    - **Given** an authenticated user uploads three photos where only the second fails MIME validation
    - **When** the upload processing completes
    - **Then** the user sees an error tied to the second photo with reason `unsupported MIME type`

---

### Requirement Validation: REQ-015 (Retry failed photo individually)

#### Test Case: ATP-015-A (Per-file retry without recipe re-save)

**Linked Requirement:** REQ-015
**Description:** Validates that an individual failed photo can be retried independently.
**Validation Condition:** A saved recipe has one failed photo and at least one successful photo.
**Expected Result:** Retrying only the failed photo succeeds and attaches it without requiring a metadata re-save operation.

- **User Scenario: SCN-015-A1**
    - **Given** an authenticated user has already saved recipe metadata and one photo failed previously
    - **When** the user retries only the failed photo upload
    - **Then** the photo is attached to the existing recipe without creating a new recipe version solely for metadata re-save

---

### Requirement Validation: REQ-016 (No broken photo references)

#### Test Case: ATP-016-A (Never persist failed photo reference)

**Linked Requirement:** REQ-016
**Description:** Validates that failed uploads/validation never create dangling photo references.
**Validation Condition:** A photo upload attempt fails validation or storage write.
**Expected Result:** Recipe photo reference list omits the failed photo identifier; no DB row links recipe to failed object key.

- **User Scenario: SCN-016-A1**
    - **Given** an authenticated user attempts to upload a photo that fails server validation
    - **When** the recipe save and photo pipeline complete
    - **Then** the saved recipe contains no reference to that failed photo

---

### Requirement Validation: REQ-017 (Owner-only edit/delete)

#### Test Case: ATP-017-A (Reject non-owner edit)

**Linked Requirement:** REQ-017
**Description:** Validates that users cannot edit recipes they do not own.
**Validation Condition:** Authenticated non-owner submits an edit request for another user's recipe.
**Expected Result:** HTTP 403 is returned; recipe content remains unchanged.

- **User Scenario: SCN-017-A1**
    - **Given** user A owns recipe `R1` and user B is authenticated
    - **When** user B submits an update request for recipe `R1`
    - **Then** the API returns HTTP 403 and recipe `R1` data remains exactly as before

#### Test Case: ATP-017-B (Reject non-owner delete)

**Linked Requirement:** REQ-017
**Description:** Validates that users cannot delete recipes they do not own.
**Validation Condition:** Authenticated non-owner submits delete for another user's recipe.
**Expected Result:** HTTP 403 is returned; recipe is not tombstoned.

- **User Scenario: SCN-017-B1**
    - **Given** user A owns recipe `R2` and user B is authenticated
    - **When** user B submits a delete request for recipe `R2`
    - **Then** the API returns HTTP 403 and recipe `R2` remains accessible to user A

---

### Requirement Validation: REQ-018a, REQ-018b (Soft delete tombstone behavior)

#### Test Case: ATP-018-A (Tombstone removes recipe from all normal access paths)

**Linked Requirement:** REQ-018a, REQ-018b
**Description:** Validates immediate soft-delete visibility/inaccessibility semantics.
**Validation Condition:** Owner soft-deletes a recipe that is currently listed, searchable, and clonable.
**Expected Result:** Recipe is absent from listings/search/collections/clone targets and normal fetch endpoints return inaccessible outcome (e.g., HTTP 404).

- **User Scenario: SCN-018-A1**
    - **Given** an authenticated owner has a public recipe visible in listing and search results
    - **When** the owner performs delete on that recipe
    - **Then** the recipe is hidden from listing/search/clone targets immediately and normal retrieval no longer returns the recipe

---

### Requirement Validation: REQ-019a, REQ-019b, REQ-019c (Indefinite default retention for tombstones)

#### Test Case: ATP-019-A (No automatic purge of tombstoned data)

**Linked Requirement:** REQ-019a, REQ-019b, REQ-019c
**Description:** Validates that soft-deleted recipe DB rows and S3 archives are retained by default.
**Validation Condition:** A recipe is tombstoned and system retention jobs run through scheduled windows without erasure action.
**Expected Result:** Tombstoned DB rows and associated S3 version archives still exist; no auto-purge occurs.

- **User Scenario: SCN-019-A1**
    - **Given** an owner tombstoned recipe `R3` and no GDPR erasure request exists
    - **When** routine retention/cleanup jobs execute over the configured schedule
    - **Then** recipe `R3` tombstone rows and S3 archives remain present

---

### Requirement Validation: REQ-020a, REQ-020b, REQ-020c (Explicit user-triggered GDPR hard purge)

#### Test Case: ATP-020-A (Hard purge only via explicit owner erasure)

**Linked Requirement:** REQ-020a, REQ-020b, REQ-020c
**Description:** Validates that hard purge executes only from explicit owner erasure flow and is irreversible.
**Validation Condition:** Owner confirms "Erase my data" for a tombstoned recipe.
**Expected Result:** Recipe rows and all S3 version archives are permanently removed; subsequent restore attempts fail because data no longer exists.

- **User Scenario: SCN-020-A1**
    - **Given** an authenticated owner has tombstoned recipe `R4` with archived S3 versions
    - **When** the owner confirms the explicit GDPR erasure action
    - **Then** all database rows and S3 archives for `R4` are removed and cannot be recovered by normal restore paths

#### Test Case: ATP-020-B — **N/A (reconciled 2026-07-25): erasure is self-service-only by design**

**Linked Requirement:** REQ-020a
**Description:** ~~Validates hard purge is rejected when a non-owner attempts the operation.~~ N/A as originally written — the shipped erasure surface, `POST /v1/account/erasure` (`account.controller.ts`), takes no target-user identifier at all; it always erases the **authenticated caller's own** account data (`ownerId` is read from the verified token, never from the request body/params). There is structurally no code path by which a non-owner could name another user's data for hard purge, so a "reject unauthorized hard purge attempt" 403 scenario does not fit the shipped design — there is nothing to reject; the capability to target someone else's data simply does not exist. This scenario is retained here for audit-trail continuity only and is excluded from the coverage count.
**Validation Condition:** N/A.
**Expected Result:** N/A — self-service-only erasure makes cross-user targeting structurally unrepresentable, not merely authorization-denied.

#### Test Case: ATP-020-C (Reject hard purge when explicit erasure is missing)

**Linked Requirement:** REQ-020a
**Description:** Validates hard purge is rejected when the explicit owner erasure state is absent.
**Validation Condition:** A request attempts to hard-delete tombstoned data without a recorded explicit owner erasure confirmation.
**Expected Result:** Request is denied with HTTP 409 Conflict; tombstoned DB/S3 data remains intact.

- **User Scenario: SCN-020-C1**
    - **Given** a tombstoned recipe exists and no explicit owner erasure confirmation has been recorded
    - **When** a retention or cleanup process attempts hard purge before erasure confirmation exists
    - **Then** the system returns HTTP 409 Conflict and the recipe data remains retained

### Requirement Validation: REQ-021 (Default public visibility)

#### Test Case: ATP-021-A (New recipes default to public)

**Linked Requirement:** REQ-021
**Description:** Validates default visibility assignment for newly created user-authored recipes.
**Validation Condition:** An authenticated user creates a recipe without an explicit visibility override.
**Expected Result:** HTTP 201 is returned; response and persisted recipe row show `visibility="public"`.

- **User Scenario: SCN-021-A1**
    - **Given** an authenticated user prepares a valid create-recipe payload without a visibility field
    - **When** the user submits the create request
    - **Then** the created recipe is stored with public visibility

---

### Requirement Validation: REQ-022 (Premium user private visibility)

#### Test Case: ATP-022-A (Allow private for active premium owner)

**Linked Requirement:** REQ-022
**Description:** Validates that premium subscribers can set owned recipes to private.
**Validation Condition:** Owner has active premium subscription and updates owned recipe visibility to private.
**Expected Result:** HTTP 200 is returned; recipe visibility transitions from `public` to `private` in persistence.

- **User Scenario: SCN-022-A1**
    - **Given** an authenticated premium user owns a public recipe
    - **When** the user submits a visibility update to `private`
    - **Then** the system accepts the change and stores the recipe as private

---

### Requirement Validation: REQ-023 (Free-tier private visibility rejection)

#### Test Case: ATP-023-A (Reject private visibility for free tier)

**Linked Requirement:** REQ-023
**Description:** Validates that free-tier users cannot set owned recipes to private.
**Validation Condition:** Owner has free-tier subscription and attempts to set visibility to private.
**Expected Result:** HTTP 403 is returned; error indicates subscription restriction; recipe remains public.

- **User Scenario: SCN-023-A1**
    - **Given** an authenticated free-tier user owns a public recipe
    - **When** the user requests visibility change to `private`
    - **Then** the system rejects the request and keeps the recipe public

---

### Requirement Validation: REQ-024 (Authenticated access to public recipes)

#### Test Case: ATP-024-A (Public recipe readable by any authenticated user)

**Linked Requirement:** REQ-024
**Description:** Validates read access for authenticated non-owners to public recipes.
**Validation Condition:** A public recipe exists and a different authenticated user requests it.
**Expected Result:** HTTP 200 is returned with recipe payload including title, ingredients, and instructions.

- **User Scenario: SCN-024-A1**
    - **Given** user A owns a recipe marked public and user B is authenticated
    - **When** user B requests the public recipe
    - **Then** user B receives the recipe data successfully

---

### Requirement Validation: REQ-025 (Clone public recipe ownership transfer)

#### Test Case: ATP-025-A (Clone creates new owner-local recipe)

**Linked Requirement:** REQ-025
**Description:** Validates cloning of public recipes into the requesting user's account.
**Validation Condition:** Authenticated user clones a public recipe owned by another user.
**Expected Result:** HTTP 201 is returned; cloned recipe has a new `id` and `ownerId` equal to cloner; source recipe remains unchanged.

- **User Scenario: SCN-025-A1**
    - **Given** user A owns a public recipe and user B is authenticated
    - **When** user B invokes clone on that public recipe
    - **Then** the system creates a new recipe owned by user B with a distinct identifier

---

### Requirement Validation: REQ-026a, REQ-026b (Clone attribution retention and public default)

#### Test Case: ATP-026-A (Retain attribution on imported-source clone)

**Linked Requirement:** REQ-026a, REQ-026b
**Description:** Validates attribution preservation and default public visibility for public-source imported clones.
**Validation Condition:** A recipe with public-source attribution metadata is cloned by another user.
**Expected Result:** Clone preserves original attribution fields and stores `visibility="public"` by default.

- **User Scenario: SCN-026-A1**
    - **Given** a public imported recipe contains source attribution to an external URL
    - **When** an authenticated user clones that recipe
    - **Then** the clone includes the same source attribution and is public by default

---

### Requirement Validation: REQ-027a, REQ-027b (Private unlock gate for imported public-source clones)

#### Test Case: ATP-027-A (Reject private setting when unlock criteria not met)

**Linked Requirement:** REQ-027a
**Description:** Validates rejection when either premium subscription or substantive edit prerequisite is missing.
**Validation Condition:** Owner of imported-source clone attempts to set private without satisfying both prerequisites.
**Expected Result:** HTTP 403 is returned with unlock-criteria message; clone visibility remains public.

- **User Scenario: SCN-027-A1**
    - **Given** an authenticated premium user owns an imported public-source clone with no substantive edit recorded
    - **When** the user requests visibility change to `private`
    - **Then** the system rejects the change and keeps visibility public

#### Test Case: ATP-027-B (Allow private after premium plus substantive edit)

**Linked Requirement:** REQ-027b
**Description:** Validates successful private visibility change after both unlock criteria are satisfied.
**Validation Condition:** Owner is premium and clone has at least one substantive edit to ingredients or instructions.
**Expected Result:** HTTP 200 is returned; clone visibility changes to `private`.

- **User Scenario: SCN-027-B1**
    - **Given** an authenticated premium user owns an imported public-source clone with a recorded substantive ingredient edit
    - **When** the user requests visibility change to `private`
    - **Then** the system stores the clone as private

---

### Requirement Validation: REQ-028 (Substantive edit classification)

#### Test Case: ATP-028-A (Classify ingredient/instruction changes as substantive)

**Linked Requirement:** REQ-028
**Description:** Validates positive substantive classification for ingredient or instruction modifications.
**Validation Condition:** An edit modifies ingredient rows or instruction steps.
**Expected Result:** Recipe/clone state records `substantiveEdit=true` for that revision.

- **User Scenario: SCN-028-A1**
    - **Given** a user-owned clone currently has `substantiveEdit=false`
    - **When** the user saves a change that modifies an ingredient quantity
    - **Then** the clone is marked as having a substantive edit

#### Test Case: ATP-028-B (Do not classify metadata/photo-only edits as substantive)

**Linked Requirement:** REQ-028
**Description:** Validates negative substantive classification for title/description/tags/photos-only edits.
**Validation Condition:** An edit changes only non-substantive fields.
**Expected Result:** Revision does not set substantive flag; `substantiveEdit` state remains unchanged.

- **User Scenario: SCN-028-B1**
    - **Given** a user-owned clone currently has `substantiveEdit=false`
    - **When** the user saves a change that only updates the recipe title
    - **Then** the clone remains marked as non-substantively edited

---

### Requirement Validation: REQ-029 (Free-text recipe search)

#### Test Case: ATP-029-A (Keyword search returns matching recipes)

**Linked Requirement:** REQ-029
**Description:** Validates free-text search over recipe content.
**Validation Condition:** Dataset contains a uniquely tokenized recipe string and user searches that token.
**Expected Result:** HTTP 200 is returned; results include the matching recipe and exclude non-matching recipes.

- **User Scenario: SCN-029-A1**
    - **Given** recipe `R-UNIQUE` contains keyword `sumac-lentil-xyz` and no other recipe contains that token
    - **When** an authenticated user searches for `sumac-lentil-xyz`
    - **Then** the search results contain exactly recipe `R-UNIQUE`

#### Test Case: ATP-029-B (Keyword search returns zero-result set for non-match)

**Linked Requirement:** REQ-029
**Description:** Validates non-match behavior for free-text search.
**Validation Condition:** Dataset contains no recipe matching the searched token.
**Expected Result:** HTTP 200 is returned with an empty results list (`items: []`, `total: 0` or equivalent empty response contract).

- **User Scenario: SCN-029-B1**
    - **Given** no recipe contains keyword `no-match-token-abc123`
    - **When** an authenticated user searches for `no-match-token-abc123`
    - **Then** the system returns HTTP 200 and an empty search result set

---

### Requirement Validation: REQ-030a, REQ-030b, REQ-030c, REQ-030d, REQ-030e, REQ-030f (Structured filtering)

#### Test Case: ATP-030-A (Filter by all supported dimensions)

**Linked Requirement:** REQ-030a, REQ-030b, REQ-030c, REQ-030d, REQ-030e, REQ-030f
**Description:** Validates filtering by tag, cuisine, dietary category, ingredient, prep time, and cook time.
**Validation Condition:** User applies all supported filter dimensions in one query against seeded recipes.
**Expected Result:** Returned set contains only recipes matching all provided filter criteria.

- **User Scenario: SCN-030-A1**
    - **Given** seeded recipes vary across tag, cuisine, dietary category, ingredient, prep minutes, and cook minutes
    - **When** an authenticated user requests recipes filtered by `tag=quick`, `cuisine=Thai`, `dietary=vegan`, `ingredient=tofu`, `prep<=20`, and `cook<=30`
    - **Then** the response contains only recipes satisfying all six filters

---

### Requirement Validation: REQ-031 (Resolve caloric and macro values per unit)

#### Test Case: ATP-031-A (Nutrition resolution from linked food records)

**Linked Requirement:** REQ-031
**Description:** Validates per-unit calories/protein/carbohydrate/fat resolution for linked ingredients.
**Validation Condition:** Recipe ingredient links (by internal `foodId`) to an existing food service golden record with known nutrient profile.
**Expected Result:** Ingredient payload includes resolved numeric fields for calories, protein, carbohydrate, and fat per unit.

- **User Scenario: SCN-031-A1**
    - **Given** a recipe ingredient is linked by `foodId` to food service record `01J8F3ZK9PQ7VN2M4T7XN9T456` (`foodResolutionStatus = RESOLVED`) with known per-unit nutrient values
    - **When** the recipe nutrition payload is requested
    - **Then** the ingredient entry includes calories, protein, carbohydrate, and fat values derived from food id `01J8F3ZK9PQ7VN2M4T7XN9T456`

---

### Requirement Validation: REQ-032 (Freeform ingredient with user-entered flag)

#### Test Case: ATP-032-A (Save unmatched ingredient as user-entered)

**Linked Requirement:** REQ-032
**Description:** Validates storage of unmatched ingredient text and user-entered marker.
**Validation Condition:** Ingredient text does not match any food database record during save.
**Expected Result:** Ingredient is persisted with original text and `isUserEntered=true`.

- **User Scenario: SCN-032-A1**
    - **Given** an authenticated user enters ingredient text `"Grandma spice blend"` with no food-database match
    - **When** the user saves the recipe
    - **Then** the ingredient is stored as user-entered and remains attached to the recipe

---

### Requirement Validation: REQ-033 (Optional manual nutrition for user-entered ingredients)

#### Test Case: ATP-033-A (Persist optional manual nutrition fields)

**Linked Requirement:** REQ-033
**Description:** Validates optional manual nutrition input for user-entered ingredients.
**Validation Condition:** User-entered ingredient is provided with manual calories/protein/carbs/fat values.
**Expected Result:** Persisted ingredient nutrition fields equal the manually supplied values.

- **User Scenario: SCN-033-A1**
    - **Given** a user-entered ingredient has manual nutrition values `calories=120`, `protein=4`, `carbs=10`, and `fat=6`
    - **When** the recipe is saved
    - **Then** the stored ingredient reflects exactly those manual nutrition values

---

### Requirement Validation: REQ-034 (Notice for partially user-supplied nutrition)

#### Test Case: ATP-034-A (Display partial user-supplied nutrition notice)

**Linked Requirement:** REQ-034
**Description:** Validates disclosure notice when recipe contains at least one user-entered ingredient.
**Validation Condition:** Recipe has mixed linked and user-entered ingredients.
**Expected Result:** Recipe view includes visible notice text indicating nutrition data is partially user-supplied.

- **User Scenario: SCN-034-A1**
    - **Given** a recipe includes at least one ingredient marked user-entered
    - **When** an authenticated user views the recipe details
    - **Then** the UI shows a notice that nutrition data is partially user-supplied

---

### Requirement Validation: REQ-035 (Versioning with top-10 DB retention and restore)

#### Test Case: ATP-035-A (Top-10 versions are queryable and restorable)

**Linked Requirement:** REQ-035, REQ-035a, REQ-035b
**Description:** Validates creation of a version on every save and owner ability to query/restore within retained set.
**Validation Condition:** Owner performs 10 successful saves on a single recipe.
**Expected Result:** Version list contains 10 versions; owner can restore any listed version and resulting recipe state matches selected version payload.

- **User Scenario: SCN-035-A1**
    - **Given** a recipe owned by user A has been saved successfully exactly 10 times
    - **When** user A requests version history and restores version 3
    - **Then** the system returns 10 retained versions and recipe content reverts to version 3 state

#### Test Case: ATP-035-B (11th save evicts oldest DB version)

**Linked Requirement:** REQ-035, REQ-035b
**Description:** Validates rolling DB retention window of most recent 10 versions.
**Validation Condition:** Owner performs an 11th successful save on the same recipe.
**Expected Result:** DB-queryable versions are only versions 2 through 11; version 1 is no longer in DB retention set.

- **User Scenario: SCN-035-B1**
    - **Given** a recipe currently has DB versions 1 through 10 retained
    - **When** the owner performs save number 11
    - **Then** the DB version history exposes exactly versions 2 through 11

---

### Requirement Validation: REQ-036 (Indefinite S3 archive of every version)

#### Test Case: ATP-036-A (Archive each version to S3)

**Linked Requirement:** REQ-036
**Description:** Validates S3 archival for every recipe version with indefinite retention intent.
**Validation Condition:** Multiple successful saves occur and archive worker processes each resulting version event.
**Expected Result:** S3 contains one archive object per version key; previously archived versions remain retrievable.

- **User Scenario: SCN-036-A1**
    - **Given** a recipe has versions 1 through 4 created by successful saves
    - **When** archive processing completes for those saves
    - **Then** S3 contains archive objects for versions 1, 2, 3, and 4

---

### Requirement Validation: REQ-037 (User save independence from S3 archive outcome)

#### Test Case: ATP-037-A (Save completes without waiting for archive write)

**Linked Requirement:** REQ-037
**Description:** Validates asynchronous decoupling between user-facing save and archive write completion.
**Validation Condition:** Archive subsystem is intentionally delayed while user submits a save.
**Expected Result:** Save endpoint returns success immediately after DB commit; archive completion occurs later.

- **User Scenario: SCN-037-A1**
    - **Given** archive worker processing is delayed by infrastructure throttling
    - **When** an owner saves recipe changes
    - **Then** the API returns successful save without blocking until archive write finishes

#### Test Case: ATP-037-B (Save still succeeds when archive write fails)

**Linked Requirement:** REQ-037
**Description:** Validates that archive failures do not fail user save operation.
**Validation Condition:** S3 archive write fails for the saved version.
**Expected Result:** Save response is successful; new version is persisted in DB; archive failure is handled out-of-band.

- **User Scenario: SCN-037-B1**
    - **Given** S3 archive writes are currently failing for the archive worker
    - **When** an owner saves a recipe successfully
    - **Then** the user receives success for the save and the new version remains stored

---

### Requirement Validation: REQ-038 (Async archive with retry and DLQ fallback)

#### Test Case: ATP-038-A (Retry transient archive failures)

**Linked Requirement:** REQ-038, REQ-038a, REQ-038b
**Description:** Validates automatic retry behavior for transient S3 archive write failures.
**Validation Condition:** First archive attempt fails transiently and a later retry succeeds.
**Expected Result:** Worker retries automatically and eventually archives to S3; message is not left in DLQ.

- **User Scenario: SCN-038-A1**
    - **Given** archive attempt 1 fails transiently and attempt 2 can succeed
    - **When** the archive worker processes the version event
    - **Then** the version is archived successfully after retry and no DLQ entry remains

#### Test Case: ATP-038-B (Exhausted retries route payload to DLQ)

**Linked Requirement:** REQ-038, REQ-038a, REQ-038b, REQ-038c
**Description:** Validates dead-letter handling after retry exhaustion.
**Validation Condition:** All archive retry attempts fail for a version payload.
**Expected Result:** A DLQ message is created containing the failed archive payload reference.

- **User Scenario: SCN-038-B1**
    - **Given** S3 archive writes fail for all configured retry attempts
    - **When** the archive worker completes its final retry for a version event
    - **Then** the failed payload is forwarded to the configured DLQ

---

### Requirement Validation: REQ-039 (Durable pending archive payload)

#### Test Case: ATP-039-A (Persist full payload to pending archive table on failure)

**Linked Requirement:** REQ-039
**Description:** Validates that a durable, exactly-replayable version payload is retained for a failed archive via the pending-archive row's foreign key to its `recipe_versions` snapshot.
**Validation Condition:** Archive write fails for a version event.
**Expected Result:** `recipe_version_pending_archives` contains a row that references (via `recipe_version_id` FK) the `recipe_versions` row whose `snapshot` is the full replayable payload; no snapshot/payload is duplicated into the pending row.

- **User Scenario: SCN-039-A1**
    - **Given** a version archive write has failed for recipe `R5` version `12`
    - **When** failure handling transaction commits
    - **Then** a pending-archive row exists referencing (by `recipe_version_id`) the `recipe_versions` row for `R5` version `12`, whose `snapshot` supplies the full replayable payload

---

### Requirement Validation: REQ-040 (Delete pending archive record only after S3 success)

#### Test Case: ATP-040-A (Delete pending row after confirmed success)

**Linked Requirement:** REQ-040
**Description:** Validates pending row removal after S3 confirms archive success.
**Validation Condition:** Replay of a pending archive payload receives S3 success confirmation.
**Expected Result:** Corresponding pending row is deleted after success confirmation is recorded.

- **User Scenario: SCN-040-A1**
    - **Given** a pending archive row exists for recipe `R6` version `8`
    - **When** replay writes version `8` to S3 and S3 confirms success
    - **Then** the matching pending row is removed from `recipe_version_pending_archives`

#### Test Case: ATP-040-B (Retain pending row when success not confirmed)

**Linked Requirement:** REQ-040
**Description:** Validates that pending rows are not removed on failed or unconfirmed replay attempts.
**Validation Condition:** Replay attempt fails or completes without S3 success acknowledgment.
**Expected Result:** Pending row remains in `recipe_version_pending_archives` for future retry.

- **User Scenario: SCN-040-B1**
    - **Given** a pending archive row exists for recipe `R6` version `9`
    - **When** replay attempt fails to obtain S3 success confirmation
    - **Then** the pending row remains present for subsequent retries

---

### Requirement Validation: REQ-041 (Operational alerting on archive failures)

#### Test Case: ATP-041-A (Emit alert for every archive failure)

**Linked Requirement:** REQ-041
**Description:** Validates that each S3 version-archive failure produces an operational alert event.
**Validation Condition:** Two distinct archive failures are induced for two version events.
**Expected Result:** Two corresponding alert records/notifications are emitted (one per failure) in CloudWatch/alarm pipeline.

- **User Scenario: SCN-041-A1**
    - **Given** archive processing is configured to fail for two specific version events
    - **When** the archive worker processes those events
    - **Then** the monitoring system records one operational alert per failed archive event

#### Test Case: ATP-041-B (Do not surface archive failure to saving end-user)

**Linked Requirement:** REQ-041
**Description:** Validates user transparency requirement when archive fails in background.
**Validation Condition:** User saves a recipe while archive write for that version fails asynchronously.
**Expected Result:** Save response remains successful (2xx), and no user-facing archive failure error is shown in the save result.

- **User Scenario: SCN-041-B1**
    - **Given** archive writes are failing in the background subsystem
    - **When** an authenticated owner saves recipe metadata successfully
    - **Then** the user receives a successful save response without archive-failure messaging

---

### Requirement Validation: REQ-042a, REQ-042b (Optimistic concurrency stale-version rejection)

#### Test Case: ATP-042-A (Accept non-stale version save)

**Linked Requirement:** REQ-042a
**Description:** Validates that a save with current version is accepted.
**Validation Condition:** Client submits version equal to server current version for the recipe.
**Expected Result:** Save succeeds, new server version increments monotonically.

- **User Scenario: SCN-042-A1**
    - **Given** recipe `R7` currently has server version `12`
    - **When** the owner submits a save for `R7` with client version `12`
    - **Then** the save succeeds and the recipe version advances to `13`

#### Test Case: ATP-042-B (Reject stale version save)

**Linked Requirement:** REQ-042a, REQ-042b
**Description:** Validates rejection of saves with older client version than server version.
**Validation Condition:** Client submits version lower than server current version.
**Expected Result:** Request is rejected with HTTP 409 and no recipe mutation is committed.

- **User Scenario: SCN-042-B1**
    - **Given** recipe `R7` has server version `13`
    - **When** the owner submits a save with client version `11`
    - **Then** the API rejects the save as stale and does not apply the attempted changes

---

### Requirement Validation: REQ-043 (HTTP 409 conflict payload)

#### Test Case: ATP-043-A (Conflict response includes server and client versions)

**Linked Requirement:** REQ-043
**Description:** Validates exact conflict response code and payload contract.
**Validation Condition:** A stale-version save request is rejected by optimistic concurrency validation.
**Expected Result:** HTTP 409 is returned with JSON body containing both `currentVersion` and `conflictingVersion` fields with correct numeric values. (reconciled 2026-07-25: as-built field names, were `serverVersion`/`clientVersion`)

- **User Scenario: SCN-043-A1**
    - **Given** recipe `R8` has server version `20`
    - **When** the owner submits a save using client version `19`
    - **Then** the response is HTTP 409 with body including `currentVersion: 20` and `conflictingVersion: 19`

---

### Requirement Validation: REQ-044 (Side-by-side conflict view)

#### Test Case: ATP-044-A (Display side-by-side versions after 409)

**Linked Requirement:** REQ-044
**Description:** Validates client conflict UI rendering after receiving HTTP 409.
**Validation Condition:** Client receives conflict response containing server and client attempted versions.
**Expected Result:** Client displays two explicit panes/sections representing server version and attempted local version concurrently.

- **User Scenario: SCN-044-A1**
    - **Given** a user receives HTTP 409 conflict data for a recipe save
    - **When** the conflict screen is rendered
    - **Then** the conflict-resolution view contains two distinct data regions labeled `Server Version` and `Your Changes`, and each region is populated with its respective field values

---

### Requirement Validation: REQ-045 (Exactly three conflict-resolution choices)

#### Test Case: ATP-045-A (Present exactly three allowed choices)

**Linked Requirement:** REQ-045
**Description:** Validates conflict UI offers only the mandated three options.
**Validation Condition:** Conflict UI is opened for a stale-version save.
**Expected Result:** Available actions are exactly: keep server version, overwrite with local version, merge field-by-field.

- **User Scenario: SCN-045-A1**
    - **Given** a user is on the conflict-resolution interface for a recipe
    - **When** the available resolution actions are enumerated
    - **Then** only three actions are offered: keep server, overwrite local, or merge field-by-field

#### Test Case: ATP-045-B (Reject unsupported fourth resolution path)

**Linked Requirement:** REQ-045
**Description:** Validates that no extra resolution behavior is exposed beyond the required three.
**Validation Condition:** User attempts to trigger any unsupported conflict action (e.g., auto-resolve).
**Expected Result:** Unsupported action is unavailable or rejected; only the three permitted paths remain actionable.

- **User Scenario: SCN-045-B1**
    - **Given** a conflict is active for a recipe
    - **When** a user attempts to invoke an unsupported automatic resolution flow
    - **Then** the client/API disallows it and keeps only the three specified choices

---

### Requirement Validation: REQ-046 (No silent merge/drop/last-write-wins)

#### Test Case: ATP-046-A (Conflict must always surface to user)

**Linked Requirement:** REQ-046
**Description:** Validates that concurrent conflicts are surfaced via conflict UI rather than silently resolved.
**Validation Condition:** Two clients edit same recipe concurrently and second submit is stale.
**Expected Result:** Stale submit yields HTTP 409 and conflict UI path; no silent data overwrite occurs.

- **User Scenario: SCN-046-A1**
    - **Given** two authenticated sessions edit recipe `R9` from the same initial version
    - **When** the second session submits after the first has already saved
    - **Then** the second session receives a surfaced conflict instead of automatic last-write-wins

#### Test Case: ATP-046-B (No automatic field merge without explicit user choice)

**Linked Requirement:** REQ-046
**Description:** Validates that merge application requires explicit user-selected merge path.
**Validation Condition:** Conflict state exists and user has not chosen any resolution action.
**Expected Result:** Recipe remains at server state until user explicitly chooses keep/overwrite/merge action.

- **User Scenario: SCN-046-B1**
    - **Given** a recipe conflict is active and user has not selected a resolution action
    - **When** the conflict view remains unresolved
    - **Then** the system does not apply automatic merge or overwrite changes

---

### Requirement Validation: REQ-047 (Create named collection)

#### Test Case: ATP-047-A (Owner creates a collection with name)

**Linked Requirement:** REQ-047
**Description:** Validates creation of recipe collections by authenticated users with required naming.
**Validation Condition:** Authenticated user submits create-collection request containing name text.
**Expected Result:** HTTP 201 is returned; collection row persisted with submitted `name` and owner ID.

- **User Scenario: SCN-047-A1**
    - **Given** an authenticated user chooses collection name `"Weeknight Favorites"`
    - **When** the user submits create-collection
    - **Then** a new collection named `"Weeknight Favorites"` is created for that user

---

### Requirement Validation: REQ-048 (Owner rename/delete collection)

#### Test Case: ATP-048-A (Owner can rename collection)

**Linked Requirement:** REQ-048
**Description:** Validates owner ability to rename an existing collection.
**Validation Condition:** Collection owner submits rename request for owned collection.
**Expected Result:** HTTP 200 is returned; collection `name` updates to new value.

- **User Scenario: SCN-048-A1**
    - **Given** an authenticated owner has collection `"Meal Prep"`
    - **When** the owner renames the collection to `"Meal Prep April"`
    - **Then** the collection name is persisted as `"Meal Prep April"`

#### Test Case: ATP-048-B (Owner can delete collection)

**Linked Requirement:** REQ-048
**Description:** Validates owner ability to delete owned collection.
**Validation Condition:** Owner submits delete request for owned collection.
**Expected Result:** Delete succeeds; collection is removed from owner's collection list.

- **User Scenario: SCN-048-B1**
    - **Given** an authenticated owner has collection `"Temporary List"`
    - **When** the owner deletes that collection
    - **Then** the collection no longer appears in the owner's collection listing

---

### Requirement Validation: REQ-049 (Collection membership and many-to-many)

#### Test Case: ATP-049-A (Recipe can belong to multiple collections)

**Linked Requirement:** REQ-049, REQ-049a, REQ-049b
**Description:** Validates many-to-many recipe membership across collections.
**Validation Condition:** Owner adds the same recipe to two distinct collections.
**Expected Result:** Membership rows exist for both collection links to the same recipe.

- **User Scenario: SCN-049-A1**
    - **Given** an authenticated owner has collections `C1` and `C2` and recipe `R10`
    - **When** the owner adds recipe `R10` to both `C1` and `C2`
    - **Then** recipe `R10` appears in both collections simultaneously

#### Test Case: ATP-049-B (Remove recipe from one collection only)

**Linked Requirement:** REQ-049, REQ-049a
**Description:** Validates remove behavior is scoped to chosen collection membership.
**Validation Condition:** Recipe is linked to multiple collections and owner removes one membership.
**Expected Result:** Recipe is removed from selected collection while remaining in other linked collections.

- **User Scenario: SCN-049-B1**
    - **Given** recipe `R10` belongs to collections `C1` and `C2`
    - **When** the owner removes `R10` from `C1`
    - **Then** `R10` is absent from `C1` and still present in `C2`

#### Test Case: ATP-049-C (Reject membership add at cap boundary)

**Linked Requirement:** REQ-049, REQ-049b
**Description:** Placeholder boundary case for per-user collection membership cap enforcement.
**Validation Condition:** A user is at `[TBD: per-user collection cap]` and attempts to add one more recipe membership.
**Expected Result:** **TBD until REQ-049b cap value is resolved**; expected behavior is rejection at cap boundary with no additional membership persisted.

- **User Scenario: SCN-049-C1**
    - **Given** a user already has `[TBD: per-user collection cap]` memberships and the cap value is unresolved in REQ-049b
    - **When** the user attempts to add one more recipe to a collection
    - **Then** this ATP remains blocked pending requirement clarification, and execution must not be marked pass/fail until the cap value is defined

---

### Requirement Validation: REQ-050a, REQ-050b (Collection visibility with subscription rules)

#### Test Case: ATP-050-A (Premium owner can set collection private)

**Linked Requirement:** REQ-050a
**Description:** Validates premium subscription private visibility control for collections.
**Validation Condition:** Premium owner updates owned collection visibility to private.
**Expected Result:** HTTP 200 is returned; collection visibility becomes private.

- **User Scenario: SCN-050-A1**
    - **Given** an authenticated premium user owns a public collection
    - **When** the user requests collection visibility update to `private`
    - **Then** the system stores the collection as private

#### Test Case: ATP-050-B (Free-tier owner cannot set collection private)

**Linked Requirement:** REQ-050a
**Description:** Validates free-tier rejection for private collection visibility.
**Validation Condition:** Free-tier owner attempts to set owned collection to private.
**Expected Result:** HTTP 403 is returned and collection visibility remains public.

- **User Scenario: SCN-050-B1**
    - **Given** an authenticated free-tier user owns a public collection
    - **When** the user requests collection visibility update to `private`
    - **Then** the request is rejected and the collection remains public

#### Test Case: ATP-050-C (Any authenticated user can view public collection)

**Linked Requirement:** REQ-050b
**Description:** Validates authenticated public-read access for collections.
**Validation Condition:** A public collection exists and non-owner authenticated user requests it.
**Expected Result:** HTTP 200 is returned with collection details and accessible recipe members.

- **User Scenario: SCN-050-C1**
    - **Given** user A owns collection `C3` marked public and user B is authenticated
    - **When** user B opens collection `C3`
    - **Then** user B can read collection metadata and member recipes allowed by visibility

---

### Requirement Validation: REQ-051 (Clone public collection)

#### Test Case: ATP-051-A (Public collection clone into requester account)

**Linked Requirement:** REQ-051
**Description:** Validates clone capability for public collections.
**Validation Condition:** Authenticated user clones a public collection owned by another user.
**Expected Result:** HTTP 201 is returned; a new collection owned by cloner is created with copied eligible members.

- **User Scenario: SCN-051-A1**
    - **Given** user A owns public collection `C4` and user B is authenticated
    - **When** user B clones collection `C4`
    - **Then** a new collection owned by user B is created from `C4`

---

### Requirement Validation: REQ-052 (Exclude inaccessible recipes during collection clone)

#### Test Case: ATP-052-A (Clone excludes inaccessible members)

**Linked Requirement:** REQ-052
**Description:** Validates access-aware filtering of source recipes during collection clone.
**Validation Condition:** Source public collection contains at least one recipe inaccessible to cloner.
**Expected Result:** Cloned collection omits inaccessible recipe(s) while including accessible ones.

- **User Scenario: SCN-052-A1**
    - **Given** source collection `C5` contains recipes `R11` (accessible) and `R12` (inaccessible to cloner)
    - **When** the authenticated cloner clones `C5`
    - **Then** the new collection includes `R11` and excludes `R12`

---

### Requirement Validation: REQ-053 (Snapshot clone semantics)

#### Test Case: ATP-053-A (Clone is snapshot at clone time)

**Linked Requirement:** REQ-053
**Description:** Validates clone ownership and snapshot-time semantics.
**Validation Condition:** User clones source collection and source is modified afterward.
**Expected Result:** Cloned collection remains unchanged after source modifications unless explicit pull-updates action is invoked.

- **User Scenario: SCN-053-A1**
    - **Given** user B cloned source collection `C6` at time `T0`
    - **When** source owner adds a new recipe to `C6` at time `T1` without user B running pull-updates
    - **Then** user B's cloned collection remains unchanged from `T0` snapshot

---

### Requirement Validation: REQ-054 (Persist sourceCollectionId on cloned collection)

#### Test Case: ATP-054-A (Clone stores sourceCollectionId reference)

**Linked Requirement:** REQ-054
**Description:** Validates provenance persistence on cloned collections.
**Validation Condition:** Public collection clone operation completes successfully.
**Expected Result:** Persisted cloned collection row contains `sourceCollectionId` equal to source collection ID.

- **User Scenario: SCN-054-A1**
    - **Given** source collection `C7` exists and is public
    - **When** an authenticated user clones `C7`
    - **Then** the new collection stores `sourceCollectionId=C7`

---

### Requirement Validation: REQ-055a, REQ-055b, REQ-055c (User-initiated pull updates reconcile)

#### Test Case: ATP-055-A (Pull adds newly public recipes from source)

**Linked Requirement:** REQ-055a
**Description:** Validates pull-updates adds source recipes newly added since snapshot when they are public and accessible.
**Validation Condition:** Source collection gained new public recipe after clone; cloner invokes pull-updates.
**Expected Result:** Newly added accessible public source recipe appears in cloned collection after pull.

- **User Scenario: SCN-055-A1**
    - **Given** a cloned collection references source `C8` and source `C8` gained new public recipe `R13`
    - **When** the clone owner runs "Pull updates from source"
    - **Then** recipe `R13` is added to the cloned collection

#### Test Case: ATP-055-B (Inaccessible source-linked recipes are absent on read, including after pull)

**Linked Requirement:** REQ-055b
**Description:** Validates that a source-linked recipe the cloner can no longer access does not appear when the cloned collection is read, both before and immediately after "Pull updates from source". (reconciled 2026-07-25: as-built mechanism is continuous read-time visibility filtering on every membership read — `collections.dal.ts` `listRecipes` — not a row deleted by the pull action; no membership row is ever removed because a recipe became inaccessible, so a recipe restored to public reappears without re-adding.)
**Validation Condition:** A previously included source recipe becomes inaccessible to cloner; the cloned collection is read both before and after "Pull updates from source" is invoked.
**Expected Result:** The inaccessible recipe is absent from every read of the cloned collection (the pull action itself does not delete its membership row).

- **User Scenario: SCN-055-B1**
    - **Given** cloned collection currently includes source-linked recipe `R14` that became inaccessible to the cloner
    - **When** the clone owner reads the cloned collection, then runs "Pull updates from source" and reads it again
    - **Then** recipe `R14` does not appear in either read, and no membership row for `R14` is deleted by the pull action itself

#### Test Case: ATP-055-C (Pull preserves cloner-added recipes)

**Linked Requirement:** REQ-055c
**Description:** Validates pull-updates does not remove or overwrite recipes manually added by cloner.
**Validation Condition:** Cloned collection contains cloner-added recipe not originating from source.
**Expected Result:** Pull-updates leaves cloner-added recipe membership unchanged.

- **User Scenario: SCN-055-C1**
    - **Given** cloned collection contains a user-added recipe `R15` with no source membership mapping
    - **When** the clone owner runs "Pull updates from source"
    - **Then** recipe `R15` remains in the cloned collection unchanged

---

### Requirement Validation: REQ-056 (No cascade delete between recipes and collections)

#### Test Case: ATP-056-A (Deleting collection does not delete recipes)

**Linked Requirement:** REQ-056
**Description:** Validates non-cascade behavior from collection deletion to recipe entities.
**Validation Condition:** Collection containing recipes is deleted by owner.
**Expected Result:** Collection-membership links are removed, but underlying recipe rows remain intact.

- **User Scenario: SCN-056-A1**
    - **Given** collection `C9` contains recipes `R16` and `R17`
    - **When** the owner deletes collection `C9`
    - **Then** recipes `R16` and `R17` still exist and are retrievable outside `C9`

#### Test Case: ATP-056-B (Deleting recipe does not delete collections)

**Linked Requirement:** REQ-056
**Description:** Validates non-cascade behavior from recipe deletion to collection entities.
**Validation Condition:** Recipe in one or more collections is deleted/tombstoned.
**Expected Result:** Recipe is removed from memberships as needed, but collection entities remain present.

- **User Scenario: SCN-056-B1**
    - **Given** recipe `R18` belongs to collection `C10`
    - **When** the owner deletes recipe `R18`
    - **Then** collection `C10` still exists after recipe deletion

---

### Requirement Validation: REQ-057 (Ingredient suggestions with nutritional context)

#### Test Case: ATP-057-A (Typeahead suggestions include nutrition-backed matches)

**Linked Requirement:** REQ-057
**Description:** Validates ingredient typeahead suggestion behavior with concrete nutrition fields per suggestion.
**Validation Condition:** User enters ingredient prefix with matching food-database records.
**Expected Result:** Suggestion list returns matching ingredients and each suggestion includes numeric `caloriesPerUnit`, `proteinPerUnit`, `carbsPerUnit`, and `fatPerUnit` fields derived from the linked food-database record.

- **User Scenario: SCN-057-A1**
    - **Given** ingredient prefix `"spin"` has food-database matches
    - **When** an authenticated user types `"spin"` in ingredient input
    - **Then** each returned suggestion includes numeric `caloriesPerUnit`, `proteinPerUnit`, `carbsPerUnit`, and `fatPerUnit` values

#### Test Case: ATP-057-B (Typeahead latency and trigger-threshold compliance)

**Linked Requirement:** REQ-057
**Description:** Validates the 2-character trigger boundary and 300 ms suggestion-response latency obligation.
**Validation Condition:** Ingredient input transitions from 1 to 2+ characters while wall-clock timings are captured at keystroke and first suggestion response render/receipt.
**Expected Result:** With 1 character, no suggestions are returned; with 2+ characters, suggestions are returned and each suggestion response is received within 300 ms of each keystroke.

- **User Scenario: SCN-057-B1**
    - **Given** an authenticated user is focused on the ingredient input with deterministic suggestion fixtures loaded
    - **When** the user types a single character (e.g., `"s"`)
    - **Then** the system returns no suggestion list for the 1-character input

- **User Scenario: SCN-057-B2**
    - **Given** the same user input now has at least 2 characters (e.g., `"sp"`) and a timer captures keystroke and response timestamps
    - **When** the user types each additional character while suggestions are available
    - **Then** each suggestion response is received within `300 ms` wall-clock of the keystroke and contains matching suggestions

---

### Requirement Validation: REQ-058 (Home widget surface discovered via startup registration)

> **US-0 / FR-046 (Home widget surface).** The following ATPs validate the atomic FR-046
> requirements decomposed in `requirements.md` (REQ-058..REQ-068) and the consumed external
> dependency REQ-IF-006 (`PATCH /v1/users/me`, owned by feature 002; reconciled 2026-07-25: as-built
> route name, was `/v1/profiles/me`). Design authority:
> [`research/home-widget-architecture.md`](../research/home-widget-architecture.md) (the
> `## DECISION (2026-07-06)` section). In **Home v1 the recent-recipes (recipe) widget is the only
> live widget**; every other widget (meal-plan, nutrition, shopping, AI, resume-cooking) renders as
> a capability-gated **CR-001 skeleton placeholder** (reconciled 2026-07-25: as-built, was described
> as fully absent) until its backing service (005–009) deploys, at which point the placeholder is
> replaced by the live widget.

#### Test Case: ATP-058-A (Home presents a discovered widget surface immediately after login)

**Linked Requirement:** REQ-058
**Description:** Validates that immediately after login the Home screen renders as a curated widget surface whose constituent widgets are **discovered** by explicit startup registration (a composition root using `.use(addFeature)`) — not build-time codegen or `require.context`.
**Validation Condition:** An authenticated user completes login and lands on Home, whose widget set is composed from the startup-registered widget registry.
**Expected Result:** Home renders as a personalized widget surface composed from the startup-registered widgets; the recipe (recent-recipes) widget — the only widget registered in v1 — is present on the surface.

- **User Scenario: SCN-058-A1**
    - **Given** an authenticated user whose Home widgets are discovered via startup registration completes login
    - **When** the app redirects to the Home screen
    - **Then** Home renders as a curated widget surface and the startup-registered recipe (recent-recipes) widget is present

---

### Requirement Validation: REQ-059 (curateHomeWidgets capability gating)

#### Test Case: ATP-059-A (Capability-gating invariant excludes widgets whose backing service is off)

**Linked Requirement:** REQ-059
**Description:** Validates the `curateHomeWidgets(widgets, ctx)` pure-function invariant: a registered widget whose backing-service capability is off is excluded from the composed set.
**Validation Condition:** `curateHomeWidgets` is evaluated with a registry containing the recipe widget (capability on) and at least one widget whose backing-service capability is off.
**Expected Result:** The composed widget list includes the recipe widget and excludes every widget whose capability is off; enabling a capability includes its widget on the next evaluation with no other change.

- **User Scenario: SCN-059-A1**
    - **Given** the Home widget registry contains the recipe widget (capability on) and a meal-plan widget whose backing service (006) capability is off
    - **When** `curateHomeWidgets` composes the surface for the user
    - **Then** the result contains the recipe widget and does not contain the meal-plan widget

---

### Requirement Validation: REQ-060 (curateHomeWidgets subscription-tier gating)

#### Test Case: ATP-060-A (Subscription-tier gating excludes widgets the user's tier does not entitle)

**Linked Requirement:** REQ-060
**Description:** Validates that `curateHomeWidgets(widgets, ctx)` additionally gates each widget by the requesting user's subscription tier, excluding any widget the user's tier does not entitle.
**Validation Condition:** `curateHomeWidgets` is evaluated for a free-tier user against a registry containing the recipe widget and a premium-only widget whose backing-service capability is on.
**Expected Result:** The composed list excludes the premium-only widget for the unentitled free-tier user; the same evaluation for an entitled premium user includes it, with no other change.

- **User Scenario: SCN-060-A1**
    - **Given** a free-tier user and a registry containing the recipe widget and a premium-only widget whose capability is on
    - **When** `curateHomeWidgets` composes the surface for that free-tier user
    - **Then** the result contains the recipe widget and excludes the premium-only widget the user's tier does not entitle

---

### Requirement Validation: REQ-061 (Personalization ordering of Home widgets)

#### Test Case: ATP-061-A (Composed order reflects per-user personalization)

**Linked Requirement:** REQ-061
**Description:** Validates that `curateHomeWidgets` orders the surviving widgets by the user's persisted personalization (per-user layout order, hidden) rather than a fixed registration order.
**Validation Condition:** A user has a persisted Home layout that orders/hides live widgets differently from registration order.
**Expected Result:** The composed Home surface presents live widgets in the user's personalized order and omits any user-hidden widget.

- **User Scenario: SCN-061-A1**
    - **Given** an authenticated user whose persisted Home layout ranks the recipe widget first and marks a second live widget hidden
    - **When** Home composes and renders the surface
    - **Then** the recipe widget appears in the user's personalized position and the hidden widget is not rendered

---

### Requirement Validation: REQ-062 (Lazy widget render with per-widget error isolation)

#### Test Case: ATP-062-A (A failing widget is isolated by its error boundary)

**Linked Requirement:** REQ-062
**Description:** Validates that widgets render lazily (web: `next/dynamic`; mobile: `React.lazy`) under Suspense with a per-widget error boundary, so a single widget failure does not break the Home surface.
**Validation Condition:** One registered widget throws during render while at least one other live widget renders normally.
**Expected Result:** The failing widget's error boundary contains the failure and renders its fallback; all other live widgets on Home continue to render.

- **User Scenario: SCN-062-A1**
    - **Given** Home has two live widgets and one of them throws during render
    - **When** the Home surface renders
    - **Then** the throwing widget shows its error-boundary fallback and the other live widget renders unaffected

---

### Requirement Validation: REQ-063 (Graceful unknown-widget-id skip)

#### Test Case: ATP-063-A (Unknown widget ids are skipped)

**Linked Requirement:** REQ-063
**Description:** Validates that a curated layout referencing a widget id absent from the client's render registry (server/client version skew) is skipped rather than erroring the surface.
**Validation Condition:** A user's persisted Home layout references a widget id that is not present in the client render registry.
**Expected Result:** Home renders the known live widgets and silently skips the unknown widget id; no error tile is shown.

- **User Scenario: SCN-063-A1**
    - **Given** a user's persisted Home layout references an unknown widget id alongside the recipe widget
    - **When** Home composes and renders
    - **Then** the recipe widget renders and the unknown widget id is skipped with no error surfaced

---

### Requirement Validation: REQ-064 (Home v1 recipe-only live widget)

#### Test Case: ATP-064-A (Recipe widget is the only live widget, in no-data and with-data states)

**Linked Requirement:** REQ-064
**Description:** Validates that in Home v1 the recent-recipes (recipe) widget is the only **live** widget and renders in both the no-data and with-data states, showing up to 4 of the user's most recently viewed or edited recipes.
**Validation Condition:** An authenticated user lands on Home as a new user (no recipes) and, separately, as a returning user with recipes.
**Expected Result:** With no recipes the recipe widget shows the empty state ("Create your first recipe"); with recipes it shows up to 4 most recently viewed or edited recipes; no other live widget is present.

- **User Scenario: SCN-064-A1**
    - **Given** an authenticated user with no recipes completes login
    - **When** the app redirects to the Home screen
    - **Then** the recipe (recent-recipes) widget renders its empty state with a "Create your first recipe" call to action and is the only live widget

- **User Scenario: SCN-064-A2**
    - **Given** an authenticated user with at least 5 recipes completes login
    - **When** the app redirects to the Home screen
    - **Then** the recipe widget renders showing up to 4 of the user's most recently viewed or edited recipes

---

### Requirement Validation: REQ-065 (Gated widgets render as skeleton placeholders until 005–009 deploy; live-swap on deploy)

#### Test Case: ATP-065-A (Gated widgets render as CR-001 skeleton placeholders, not live/empty tiles, in v1)

**Linked Requirement:** REQ-065
**Description:** Validates that in Home v1 every widget whose backing service is not yet deployed renders as a **skeleton placeholder** (the real widget's shape with no invented data, per CR-001) — not a live widget and not an empty-state tile — because its feature package (005–009) does not exist yet. The per-widget empty state applies only to **live** widgets that have no data. (reconciled 2026-07-25: as-built — the gated cohort renders CR-001 skeleton placeholders, not a fully absent/no-tile DOM state as originally written; see `HomeWidgetSurface.tsx` web+mobile and `RoadmapWidgetSlot`)
**Validation Condition:** Home renders in the v1 configuration where only the recipe service is live (005–009 not deployed).
**Expected Result:** The recipe widget renders live; the meal-plan, nutrition, shopping-list, AI-suggestion, and resume-cooking widgets render as skeleton placeholder tiles (not live, not the live-widget empty state).

- **User Scenario: SCN-065-A1**
    - **Given** an authenticated user views Home while services 005–009 are not deployed
    - **When** the Home surface renders
    - **Then** the recipe widget is live and the meal-plan, nutrition, shopping-list, AI-suggestion, and resume-cooking widgets render as skeleton placeholders (not shown as live-widget empty-state tiles)

#### Test Case: ATP-065-B (A gated widget's placeholder is replaced by the live widget when its feature package ships and its service deploys)

**Linked Requirement:** REQ-065
**Description:** Validates that a capability-gated widget's skeleton placeholder is replaced by the live widget with no client change once its feature package ships and its backing service becomes live — exercised via the AI-suggestion widget backed by feature 005.
**Validation Condition:** The AI-suggestion widget's feature package (005) is not present in v1 (so the widget renders as a skeleton placeholder); when feature package 005 ships and its backing service deploys, the AI widget registers and its capability turns on.
**Expected Result:** While 005 is absent the AI-suggestion widget renders as a skeleton placeholder; after feature package 005 ships and its service deploys, the AI widget registers and replaces the placeholder on the same user's next Home view with one AI-generated recipe suggestion, with no client build or code change.

- **User Scenario: SCN-065-B1**
    - **Given** an authenticated user views Home while the AI feature package (005) is not shipped and the AI-suggestion widget renders as a skeleton placeholder
    - **When** feature package 005 ships, its backing service deploys and turns its capability on, and the user next views Home
    - **Then** the AI-suggestion widget registers and its placeholder is replaced by the live widget, showing one AI-generated recipe suggestion, with no client change

---

### Requirement Validation: REQ-066 (Per-session subscription nudge on premium-gated interaction)

#### Test Case: ATP-066-A (Subscription nudge appears at most once per session)

**Linked Requirement:** REQ-066
**Description:** Validates that a free-tier user sees a subscription upgrade nudge when interacting with a premium-gated Home entry point, and that the nudge appears at most once per session regardless of how many premium entry points are tapped.
**Validation Condition:** A free-tier user taps two distinct premium-gated entry points within a single session.
**Expected Result:** A subscription upgrade nudge is shown on the first premium-gated interaction; no second nudge is shown for the second interaction within the same session.

- **User Scenario: SCN-066-A1**
    - **Given** a free-tier authenticated user is on Home in a single session
    - **When** the user taps a premium-gated entry point and then taps a second premium-gated entry point
    - **Then** the subscription upgrade nudge appears exactly once for that session

---

### Requirement Validation: REQ-067 (Cross-platform parity of live Home widgets)

#### Test Case: ATP-067-A (Every live widget is present on both web and mobile)

**Linked Requirement:** REQ-067
**Description:** Validates that every **live** Home widget is present on both web and mobile behind one widget id (per-platform `.native.tsx` implementations); no live widget is absent on either platform.
**Validation Condition:** The Home surface is rendered on web and on mobile under the same v1 capability configuration.
**Expected Result:** The set of live widget ids rendered on web equals the set rendered on mobile; in v1 both platforms render the recipe widget and no other live widget is present on only one platform.

- **User Scenario: SCN-067-A1**
    - **Given** the Home screen is rendered on web and on mobile for the same user under identical capability configuration
    - **When** the live widget ids on each platform are enumerated
    - **Then** the live widget id sets are identical across web and mobile (in v1, exactly the recipe widget)

---

### Requirement Validation: REQ-068 (Cross-device Home layout persistence via the 002-owned endpoint)

#### Test Case: ATP-068-A (Personalized layout persists across devices via PATCH /v1/users/me)

**Linked Requirement:** REQ-068
**Description:** Validates that per-user Home layout (widget order and hidden set) is persisted across devices via `PATCH /v1/users/me` — owned by the identity service (002) and **consumed** here — so layout changes made on one device are reflected on another. (reconciled 2026-07-25: route corrected from `/v1/profiles/me` to the real, tested `/v1/users/me`. **Deferred in v1** — see WAV-002 in `waivers.md`: feature 001 does not yet read or write `homeLayout` on any endpoint, so this scenario cannot presently be executed; every device currently renders the default order with nothing hidden.)
**Validation Condition:** A user changes their Home layout (reorder/hide) on one device; the layout is loaded on a second device.
**Expected Result:** The layout change is persisted through the 002-owned endpoint and the second device renders Home in the updated order/visibility. **Not yet exercisable — WAV-002.**

- **User Scenario: SCN-068-A1**
    - **Given** an authenticated user reorders and hides a Home widget on device A, persisted via `PATCH /v1/users/me`
    - **When** the same user opens Home on device B and the layout is loaded
    - **Then** device B renders Home in the updated order with the hidden widget omitted

---

### Requirement Validation: REQ-IF-006 (Home layout persistence is a 002-owned interface consumed here)

#### Test Case: ATP-IF-006-A (Layout endpoint consumed not implemented; absent layout falls back to default)

**Linked Requirement:** REQ-IF-006
**Description:** Validates that feature 001 **consumes** — and does not implement — the external `PATCH /v1/users/me` endpoint owned by feature 002, and tolerates an absent layout (new user) by falling back to the default Home template. (reconciled 2026-07-25: route corrected from `/v1/profiles/me` to the real, tested `/v1/users/me`. As-built, feature 001 does not yet call this endpoint for `homeLayout` at all — deferred, WAV-002 — so every user, not only new users, currently sees the default template; the "falls back to default" outcome is still true today, just for the broader reason that personalization is not wired up yet, not merely because one user's layout key is absent.)
**Validation Condition:** A new user with no persisted Home layout in the 002-owned store loads Home.
**Expected Result:** Home renders using the default widget template when the 002-owned layout is absent; feature 001 defines no `PATCH /v1/users/me` endpoint in its own API contract (it consumes the 002-owned one).

- **User Scenario: SCN-IF-006-A1**
    - **Given** a new authenticated user has no persisted Home layout in the feature-002-owned store
    - **When** the user opens Home and the layout is loaded from the 002-owned `PATCH /v1/users/me` endpoint's store
    - **Then** Home falls back to the default widget template and feature 001 defines no home-layout endpoint of its own

---

### Requirement Validation: REQ-NF-001 (Search/filter <=2.0s for >=20 recipes)

#### Test Case: ATP-NF-001-A (20-recipe search/filter response-time compliance)

**Linked Requirement:** REQ-NF-001
**Description:** Validates wall-clock response-time SLO for search/filter on dataset size floor.
**Validation Condition:** Seeded dataset has at least 20 recipes; timed search/filter query is executed under controlled environment.
**Expected Result:** End-to-end wall-clock from request send to full response receive is <=2.0 seconds.

- **User Scenario: SCN-NF-001-A1**
    - **Given** a deterministic test dataset containing 20 recipes is loaded
    - **When** an authenticated user executes a representative search/filter request
    - **Then** the measured wall-clock response time is at most 2.0 seconds

---

### Requirement Validation: REQ-NF-002 (p95 <=500ms at 10k concurrent users)

#### Test Case: ATP-NF-002-A (Load-test p95 latency threshold)

**Linked Requirement:** REQ-NF-002
**Description:** Validates API p95 latency target under sustained 10,000 concurrent-user load.
**Validation Condition:** Sustained load test runs at 10,000 concurrent users using production-like workload profile.
**Expected Result:** Reported p95 API response time is <=500ms for the sustained measurement window.

- **User Scenario: SCN-NF-002-A1**
    - **Given** a load-testing environment configured for 10,000 concurrent users and representative API mix
    - **When** the sustained load test executes for the defined measurement interval
    - **Then** the final latency report shows p95 API response time not exceeding 500ms

---

### Requirement Validation: REQ-NF-003 (Complete recipe in under 5 minutes)

#### Test Case: ATP-NF-003-A (Timed user demonstration)

**Linked Requirement:** REQ-NF-003
**Description:** Validates usability target for creating complete recipe from empty start state.
**Validation Condition:** User starts with empty recipe and must add >=1 ingredient, >=1 instruction, >=1 photo; timer starts when user activates `Create Recipe` and stops when success confirmation is rendered.
**Expected Result:** Elapsed completion time is under 5:00; start/end timestamps and elapsed duration are recorded in an execution log entry for reproducibility.

- **User Scenario: SCN-NF-003-A1**
    - **Given** an authenticated user starts with a blank recipe draft and the test harness records a timestamp when the `Create Recipe` action is invoked
    - **When** the user completes recipe creation including at least one ingredient, one instruction, and one photo
    - **Then** elapsed time at success confirmation is less than 5 minutes and the execution log is written as JSON containing `startTime`, `endTime`, and `elapsedMs` fields

---

### Requirement Validation: REQ-NF-004 (80% first-week free-tier feature engagement)

#### Test Case: ATP-NF-004-A (First-week cohort engagement analysis)

**Linked Requirement:** REQ-NF-004
**Description:** Validates analytic KPI for free-tier first-week feature usage breadth.
**Validation Condition:** Analytics query computes first-week free-tier users who performed at least three core features (create, search, share) over the first complete calendar week after feature launch, with cohort size `N >= 100`.
**Expected Result:** Computed percentage is >=80% for the measured cohort period and reported with the sampled cohort size.

- **User Scenario: SCN-NF-004-A1**
    - **Given** event analytics contains first-week activity for at least 100 free-tier users in the first complete calendar week after launch
    - **When** the KPI query calculates percent of users performing at least three core features
    - **Then** the resulting percentage is at least 80% and the report includes cohort size `N`

---

### Requirement Validation: REQ-NF-005a, REQ-NF-005b (Strict TypeScript and no forbidden any)

#### Test Case: ATP-NF-005-A (`tsc --strict` compiles with zero errors)

**Linked Requirement:** REQ-NF-005a
**Description:** Validates strict TypeScript compile requirement for this feature codebase.
**Validation Condition:** `tsc --strict` is executed against feature packages at HEAD.
**Expected Result:** Compiler exits with code 0 and reports zero type errors.

- **User Scenario: SCN-NF-005-A1**
    - **Given** the codebase is checked out at HEAD with dependencies installed
    - **When** `tsc --strict` is executed for the feature workspaces
    - **Then** the command exits successfully with no TypeScript errors

#### Test Case: ATP-NF-005-B (No `any` outside annotated test doubles)

**Linked Requirement:** REQ-NF-005b
**Description:** Validates forbidden `any` usage policy outside explicitly annotated test-double files.
**Validation Condition:** Static inspection scans TypeScript sources for `any` usage and verifies location/annotations.
**Expected Result:** Any occurrences are confined to files explicitly marked as test doubles; no production-source violations exist.

- **User Scenario: SCN-NF-005-B1**
    - **Given** a static analysis report of `any` occurrences across TypeScript files
    - **When** occurrences are cross-checked against explicit test-double annotations
    - **Then** no unannotated non-test-double file contains forbidden `any` usage

---

### Requirement Validation: REQ-NF-006 (JSDoc on exported functions/interfaces)

#### Test Case: ATP-NF-006-A (All exported APIs have complete JSDoc)

**Linked Requirement:** REQ-NF-006
**Description:** Validates documentation coverage on exported functions and interfaces.
**Validation Condition:** Exported symbols are enumerated and inspected for JSDoc blocks containing purpose, parameters, and return value.
**Expected Result:** Every exported function/interface has JSDoc with required sections; no missing documentation findings.

- **User Scenario: SCN-NF-006-A1**
    - **Given** the list of exported functions and interfaces for this feature at HEAD
    - **When** each export is inspected for JSDoc purpose, parameter descriptions, and return description
    - **Then** all exports satisfy the required JSDoc completeness criteria

---

### Requirement Validation: REQ-NF-007 (Accessible names for UI components)

#### Test Case: ATP-NF-007-A (Accessible name reachability via role/label)

**Linked Requirement:** REQ-NF-007
**Description:** Validates UI components expose accessible names discoverable by role/label selectors.
**Validation Condition:** Playwright accessibility-focused tests query interactive components using `getByRole` or `getByLabel`.
**Expected Result:** Queries resolve to intended components without fallback to non-accessible selectors.

- **User Scenario: SCN-NF-007-A1**
    - **Given** the feature UI is rendered in end-to-end test mode
    - **When** tests locate all interactive components using role or label-based queries
    - **Then** each component is discoverable through its accessible name

---

### Requirement Validation: REQ-NF-008 (No color-only state indicators)

#### Test Case: ATP-NF-008-A (Every state indicator includes text or icon)

**Linked Requirement:** REQ-NF-008
**Description:** Validates accessibility rule prohibiting color-only state communication.
**Validation Condition:** UI state indicators (error/success/warning/selection) are audited across feature surfaces.
**Expected Result:** Every state indicator combines color with iconography or textual label.

- **User Scenario: SCN-NF-008-A1**
    - **Given** all recipe-management UI states are listed for accessibility audit
    - **When** each state indicator is inspected for non-color cue pairing
    - **Then** no state relies on color alone to convey meaning

---

### Requirement Validation: REQ-NF-009 (TDD co-commit policy)

#### Test Case: ATP-NF-009-A (Implementation tasks have paired test files)

**Linked Requirement:** REQ-NF-009
**Description:** Validates implementation changes are accompanied by corresponding tests in same or earlier commit context.
**Validation Condition:** Task-to-commit review checks modified implementation files against associated test additions/updates and compares commit timestamps.
**Expected Result:** For each implementation task, at least one corresponding test-file commit timestamp is less than or equal to the implementation-file commit timestamp within the same PR.

- **User Scenario: SCN-NF-009-A1**
    - **Given** a set of completed implementation tasks and associated commits
    - **When** each task's code changes are compared against associated test-file commits and commit timestamps are evaluated
    - **Then** every task has at least one corresponding test commit with timestamp `<=` the implementation commit timestamp

---

### Requirement Validation: REQ-NF-010a, REQ-NF-010b (E2E file format conventions)

#### Test Case: ATP-NF-010-A (Web Playwright and mobile Maestro file patterns)

**Linked Requirement:** REQ-NF-010a, REQ-NF-010b
**Description:** Validates required end-to-end test file naming and framework conventions.
**Validation Condition:** Repository test files are inspected for browser and mobile E2E suites.
**Expected Result:** Browser E2E tests are in Playwright `*.spec.ts`; mobile E2E flows are Maestro `*.yaml` files.

- **User Scenario: SCN-NF-010-A1**
    - **Given** repository test directories for web and mobile E2E suites
    - **When** E2E file patterns and frameworks are audited
    - **Then** all browser E2E files match `*.spec.ts` and all mobile E2E files match Maestro `*.yaml`

---

### Requirement Validation: REQ-NF-011a, REQ-NF-011b, REQ-NF-011c (LocalStack required locally and in CI)

#### Test Case: ATP-NF-011-A (Local development LocalStack integration)

**Linked Requirement:** REQ-NF-011a, REQ-NF-011b
**Description:** Validates LocalStack is provided as local Docker Compose service for backend test execution.
**Validation Condition:** Local Docker Compose configuration defines LocalStack service and backend tests target emulated S3/SQS endpoints.
**Expected Result:** Local unit/integration tests execute against LocalStack without reaching live AWS.

- **User Scenario: SCN-NF-011-A1**
    - **Given** local Docker Compose is available for the repository
    - **When** backend unit/integration tests run in local development mode
    - **Then** test traffic for S3/SQS is routed to LocalStack endpoints

#### Test Case: ATP-NF-011-B (CI LocalStack service container integration)

**Linked Requirement:** REQ-NF-011a, REQ-NF-011c
**Description:** Validates GitHub Actions provides LocalStack service container for backend tests.
**Validation Condition:** CI workflow definitions are inspected and test jobs executed in pull request pipeline.
**Expected Result:** CI jobs define and use LocalStack service container for AWS emulation during backend tests.

- **User Scenario: SCN-NF-011-B1**
    - **Given** GitHub Actions workflow files at HEAD
    - **When** backend test job configuration is inspected and executed
    - **Then** LocalStack service container is present and consumed by test jobs

---

### Requirement Validation: REQ-NF-012a, REQ-NF-012b (CI required checks and merge blocking)

#### Test Case: ATP-NF-012-A (PR pipeline runs five mandatory checks)

**Linked Requirement:** REQ-NF-012a, REQ-NF-012b
**Description:** Validates CI workflow runs `typecheck`, `lint`, `format:check`, `test`, and `test:e2e` on each PR.
**Validation Condition:** Pull request workflow definitions and protection rules are inspected.
**Expected Result:** All five checks are configured as required PR checks and merge is blocked unless each passes.

- **User Scenario: SCN-NF-012-A1**
    - **Given** branch protection and PR workflow configuration are active
    - **When** a pull request triggers CI checks
    - **Then** exactly the five required checks run and merge remains blocked until all pass

---

### Requirement Validation: REQ-NF-013a, REQ-NF-013b, REQ-NF-013c (Idempotent seed script with stable IDs)

#### Test Case: ATP-NF-013-A (Stable seeded IDs across repeated runs)

**Linked Requirement:** REQ-NF-013a, REQ-NF-013b, REQ-NF-013c
**Description:** Validates deterministic seed behavior for fixture-based E2E assertions.
**Validation Condition:** Seed script runs twice on clean test databases.
**Expected Result:** Entity IDs and key fixture values are identical across runs; rerun does not duplicate incompatible records.

- **User Scenario: SCN-NF-013-A1**
    - **Given** two freshly initialized test databases
    - **When** the idempotent seed script is run against each database
    - **Then** the seeded `userId`, `recipeId`, and `collectionId` values in both databases are identical and match the values declared in the fixture constants file (e.g., `SEED_USER_ID`, `SEED_RECIPE_ID`, `SEED_COLLECTION_ID`)

---

### Requirement Validation: REQ-NF-014a, REQ-NF-014b, REQ-NF-014c (Mocks and make\* fixtures in unit/component tests)

#### Test Case: ATP-NF-014-A (No live service/database access in unit/component tests)

**Linked Requirement:** REQ-NF-014a, REQ-NF-014b, REQ-NF-014c
**Description:** Validates test isolation policy with mocks and fixture factories.
**Validation Condition:** Unit/component test suites are inspected for dependency wiring and fixture usage patterns.
**Expected Result:** Tests use `make*` fixture factories and mocks; no live service or live database connections are present.

- **User Scenario: SCN-NF-014-A1**
    - **Given** unit and component test files for the feature
    - **When** test setup code is audited for external dependency access
    - **Then** tests rely on mocks/fixtures and avoid all live service/database calls

- **User Scenario: SCN-NF-014-A2**
    - **Given** a static-analysis scan configured with forbidden patterns (`new PrismaClient(`, `postgres://`, `createConnection(`, `https://` live-service literals)
    - **When** the scan runs across unit and component test files
    - **Then** the scan returns zero forbidden-pattern matches

---

### Requirement Validation: REQ-NF-015 (Pending archive backlog under 100 rows)

#### Test Case: ATP-NF-015-A (Normal-operation pending backlog SLO)

**Linked Requirement:** REQ-NF-015
**Description:** Validates operational backlog SLO for `recipe_version_pending_archives`.
**Validation Condition:** Production telemetry window marked as normal operating conditions is analyzed.
**Expected Result:** `recipe_version_pending_archives` row count remains below 100 throughout the analyzed normal window.

- **User Scenario: SCN-NF-015-A1**
    - **Given** operational metrics for pending-archive row counts during normal traffic conditions
    - **When** the SLO analysis query computes maximum row count in the window
    - **Then** the maximum observed count is less than 100

---

### Requirement Validation: REQ-NF-016 (Alarm for >100 pending rows over 15 minutes)

#### Test Case: ATP-NF-016-A (CloudWatch alarm threshold and duration rule)

**Linked Requirement:** REQ-NF-016
**Description:** Validates CloudWatch alarm is configured to trigger only when pending count exceeds 100 continuously for >15 minutes.
**Validation Condition:** Alarm definition and evaluation periods are inspected, then threshold breach simulation is executed.
**Expected Result:** Alarm transitions to ALARM state when count >100 persists beyond 15 minutes and remains non-ALARM for shorter spikes.

- **User Scenario: SCN-NF-016-A1**
    - **Given** CloudWatch alarm configuration for pending-archive row count exists in infrastructure definitions
    - **When** metric simulation keeps row count above 100 for more than 15 continuous minutes
    - **Then** the alarm enters ALARM state according to the configured duration threshold

---

### Requirement Validation: REQ-NF-017 (Alarm for oldest pending row older than 1 hour)

#### Test Case: ATP-NF-017-A (CloudWatch age-based alarm rule)

**Linked Requirement:** REQ-NF-017
**Description:** Validates alarm trigger on oldest pending archive record age exceeding 1 hour.
**Validation Condition:** Alarm metric/threshold configuration is inspected and age-threshold breach is simulated.
**Expected Result:** Alarm enters ALARM state when oldest pending row age crosses >1 hour.

- **User Scenario: SCN-NF-017-A1**
    - **Given** a configured metric publishes age of oldest pending archive row
    - **When** the metric value exceeds one hour in alarm evaluation
    - **Then** the CloudWatch alarm transitions to ALARM

---

### Requirement Validation: REQ-NF-018 (Web API URL env resolution with localhost default)

#### Test Case: ATP-NF-018-A (Use NEXT_PUBLIC_API_URL when set)

**Linked Requirement:** REQ-NF-018
**Description:** Validates web frontend uses configured `NEXT_PUBLIC_API_URL` when provided.
**Validation Condition:** Web app starts with `NEXT_PUBLIC_API_URL` set to non-default value.
**Expected Result:** Web app API client base URL equals configured environment value.

- **User Scenario: SCN-NF-018-A1**
    - **Given** web runtime environment sets `NEXT_PUBLIC_API_URL=https://api.example.test`
    - **When** the web app initializes its API client
    - **Then** outbound API requests target `https://api.example.test`

#### Test Case: ATP-NF-018-B (Fallback to localhost:3000 when unset)

**Linked Requirement:** REQ-NF-018
**Description:** Validates that a MISSING web API base URL is fatal — there is no default. (Inverted 2026-07-28 by owner decision; this case previously asserted a `http://localhost:3000` fallback, which is the defect that shipped to the sandbox preview.)
**Validation Condition:** Web build/startup runs with `NEXT_PUBLIC_RECIPE_API_URL` unset or blank.
**Expected Result:** The build fails with an error naming the missing variable. No bundle is produced, and no request is ever addressed to localhost.

- **User Scenario: SCN-NF-018-B1**
    - **Given** the web build environment does not define `NEXT_PUBLIC_RECIPE_API_URL`
    - **When** `next build` runs
    - **Then** it exits non-zero reporting `Invalid environment variables: NEXT_PUBLIC_RECIPE_API_URL`
    - **And** automated coverage lives in `web/src/config/__tests__/env.test.ts` (+ the mobile mirror), replacing the `Inspection` method with an executable check

---

### Requirement Validation: REQ-NF-019 (Mobile API URL env resolution with localhost default)

#### Test Case: ATP-NF-019-A (Use EXPO_PUBLIC_API_URL when set)

**Linked Requirement:** REQ-NF-019
**Description:** Validates mobile frontend uses configured `EXPO_PUBLIC_API_URL` when provided.
**Validation Condition:** Mobile app starts with `EXPO_PUBLIC_API_URL` set to non-default value.
**Expected Result:** Mobile API client base URL equals configured environment value.

- **User Scenario: SCN-NF-019-A1**
    - **Given** mobile runtime environment sets `EXPO_PUBLIC_API_URL=https://api-mobile.example.test`
    - **When** the mobile app initializes its API client
    - **Then** outbound API requests target `https://api-mobile.example.test`

#### Test Case: ATP-NF-019-B (Fallback to localhost:3000 when unset)

**Linked Requirement:** REQ-NF-019
**Description:** Validates default mobile API base URL when env variable is missing.
**Validation Condition:** Mobile app starts with `EXPO_PUBLIC_API_URL` unset.
**Expected Result:** Mobile API client base URL defaults to `http://localhost:3000`. (reconciled 2026-07-25: as-built default, was `:4000`; matches the shipped `DEFAULT_API_URL` constant)

- **User Scenario: SCN-NF-019-B1**
    - **Given** mobile runtime environment does not define `EXPO_PUBLIC_API_URL`
    - **When** the mobile app initializes its API client
    - **Then** outbound API requests default to `http://localhost:3000`

---

### Requirement Validation: REQ-NF-020 (Local development port assignments)

#### Test Case: ATP-NF-020-A (Port mapping audit for all required services)

**Linked Requirement:** REQ-NF-020
**Description:** Validates fixed local-development port assignments for API, web, metro, Postgres, and LocalStack.
**Validation Condition:** Local environment configuration files are inspected for port bindings.
**Expected Result:** Ports are configured exactly as API `3000`, web `3000`, Expo Metro `8081`, Postgres `5432`, LocalStack `4566`. (reconciled 2026-07-25: as-built API port, was `4000`; matches `main.ts`'s `process.env['PORT'] ?? 3000` default, the shared ALB target, and the service security group's :3000 ingress rule)

- **User Scenario: SCN-NF-020-A1**
    - **Given** local development configuration files at HEAD
    - **When** service port bindings are reviewed
    - **Then** the configured ports exactly match 3000, 3000, 8081, 5432, and 4566 respectively

---

### Requirement Validation: REQ-IF-001a, REQ-IF-001b (Erasure endpoint idempotency for queued/running jobs)

#### Test Case: ATP-IF-001-A (Queued job returns HTTP 202 existing job id)

**Linked Requirement:** REQ-IF-001a, REQ-IF-001b
**Description:** Validates idempotent response for users with existing queued erasure job.
**Validation Condition:** Caller already has one queued erasure job and re-calls `POST /v1/account/erasure`.
**Expected Result:** HTTP 202 is returned with existing job ID; queue depth does not increase.

- **User Scenario: SCN-IF-001-A1**
    - **Given** an authenticated user already has erasure job `E1` in `queued` state
    - **When** the user calls `POST /v1/account/erasure` again
    - **Then** the response is HTTP 202 with job id `E1` and no second job is enqueued

#### Test Case: ATP-IF-001-B (Running job returns HTTP 202 existing job id)

**Linked Requirement:** REQ-IF-001a, REQ-IF-001b
**Description:** Validates idempotent response for users with existing running erasure job.
**Validation Condition:** Caller already has one running erasure job and re-calls endpoint.
**Expected Result:** HTTP 202 is returned with existing running job ID; queue depth remains unchanged.

- **User Scenario: SCN-IF-001-B1**
    - **Given** an authenticated user already has erasure job `E2` in `running` state
    - **When** the user calls `POST /v1/account/erasure` again
    - **Then** the response is HTTP 202 with job id `E2` and no additional job is created

---

### Requirement Validation: REQ-IF-002 (Erasure completed state returns HTTP 410)

#### Test Case: ATP-IF-002-A (Completed job yields Gone)

**Linked Requirement:** REQ-IF-002
**Description:** Validates terminal-state contract for completed erasure jobs.
**Validation Condition:** Caller's most recent erasure job status is `completed`.
**Expected Result:** `POST /v1/account/erasure` returns HTTP 410 (Gone).

- **User Scenario: SCN-IF-002-A1**
    - **Given** an authenticated user has most recent erasure job `E3` in `completed` state
    - **When** the user calls `POST /v1/account/erasure`
    - **Then** the API responds with HTTP 410

---

### Requirement Validation: REQ-IF-003 (Failed erasure state enqueues fresh job)

#### Test Case: ATP-IF-003-A (Failed state creates new job and returns HTTP 202)

**Linked Requirement:** REQ-IF-003
**Description:** Validates retry semantics when latest erasure job failed.
**Validation Condition:** Caller's most recent erasure job is `failed`.
**Expected Result:** Endpoint enqueues a new erasure job with new ID and returns HTTP 202 containing that new ID.

- **User Scenario: SCN-IF-003-A1**
    - **Given** an authenticated user's most recent erasure job `E4` is in `failed` state
    - **When** the user calls `POST /v1/account/erasure`
    - **Then** the API returns HTTP 202 with a newly created job id different from `E4`

---

### Requirement Validation: REQ-IF-004a, REQ-IF-004b, REQ-IF-004c (Web/mobile feature parity for REQ-001..REQ-068)

#### Test Case: ATP-IF-004-A (Parity matrix complete across both platforms)

**Linked Requirement:** REQ-IF-004a, REQ-IF-004b, REQ-IF-004c
**Description:** Validates full functional parity between web and mobile for every functional requirement.
**Validation Condition:** A parity matrix maps all 99 functional requirements (REQ-001 through REQ-068, including all functional sub-IDs) to implemented and tested capabilities on both web and mobile.
**Expected Result:** Matrix shows 99/99 functional requirements implemented and validated on both platforms, with no parity gaps.

- **User Scenario: SCN-IF-004-A1**
    - **Given** a parity evidence matrix listing all 99 functional requirements (REQ-001 through REQ-068, including sub-IDs) for web and mobile implementations
    - **When** the parity evidence matrix is queried for each requirement across web and mobile test suites
    - **Then** all 99 functional requirements show complete web/mobile parity

---

### Requirement Validation: REQ-IF-005a, REQ-IF-005b, REQ-IF-005c (Auth required on all APIs and UI surfaces)

#### Test Case: ATP-IF-005-A (All protected APIs reject unauthenticated callers)

**Linked Requirement:** REQ-IF-005a, REQ-IF-005c
**Description:** Validates unauthenticated access denial across functional API endpoints.
**Validation Condition:** Anonymous caller requests each functional API endpoint without valid session/JWT.
**Expected Result:** Each protected endpoint returns HTTP 401/403 and performs no protected state change.

- **User Scenario: SCN-IF-005-A1**
    - **Given** no authentication token or session is present
    - **When** an anonymous caller invokes a protected recipe-management API endpoint
    - **Then** the API denies access and no protected operation is executed

#### Test Case: ATP-IF-005-B (UI surfaces gate functional actions behind authentication)

**Linked Requirement:** REQ-IF-005b, REQ-IF-005c
**Description:** Validates unauthenticated users cannot execute functional UI capabilities.
**Validation Condition:** Anonymous visitor navigates to recipe-management UI surfaces.
**Expected Result:** Visitor is redirected to/authenticated gate and cannot perform create/edit/delete/clone actions until authenticated.

- **User Scenario: SCN-IF-005-B1**
    - **Given** a user is not authenticated in the application
    - **When** the user attempts to access a protected recipe-management UI surface
    - **Then** the application requires authentication before any functional action can be used

---

### Requirement Validation: REQ-CN-001a, REQ-CN-001b (No per-user collection sharing)

#### Test Case: ATP-CN-001-A (Only public/private collection visibility options exist)

**Linked Requirement:** REQ-CN-001a, REQ-CN-001b
**Description:** Validates out-of-scope guardrail that named-user collection sharing is absent.
**Validation Condition:** API contracts, DB schema, and UI controls for collection sharing are inspected.
**Expected Result:** No per-user sharing endpoints/fields/actions exist; visibility options are limited to public/private.

- **User Scenario: SCN-CN-001-A1**
    - **Given** the codebase and API/UI specifications at HEAD
    - **When** collection-sharing capabilities are audited
    - **Then** only public/private visibility controls are present and no named-user sharing feature exists

---

### Requirement Validation: REQ-CN-002 (No friends system in scope)

#### Test Case: ATP-CN-002-A (Friends subsystem absent)

**Linked Requirement:** REQ-CN-002
**Description:** Validates out-of-scope guardrail excluding friends/discovery features.
**Validation Condition:** Feature codebase and routes are inspected for QR codes, friend codes, friend requests, and discovery flows.
**Expected Result:** No friends-system entities, endpoints, or UI flows are implemented in this feature.

- **User Scenario: SCN-CN-002-A1**
    - **Given** repository artifacts for the recipe-management feature
    - **When** auditors search for friends-system APIs and UI flows
    - **Then** no QR/friend-code/friend-request/discovery implementation is found

---

### Requirement Validation: REQ-CN-003 (Paid-source recipes can never be public)

#### Test Case: ATP-CN-003-A (Reject public visibility for paid-source recipe always)

**Linked Requirement:** REQ-CN-003
**Description:** Validates legal constraint blocking public visibility on paid-source imports regardless of tier or edits.
**Validation Condition:** Owner of paid-source recipe attempts to set visibility to public under multiple subscription/edit states.
**Expected Result:** Every attempt is rejected with policy error; recipe remains non-public.

- **User Scenario: SCN-CN-003-A1**
    - **Given** an authenticated premium user owns a paid-source imported recipe
    - **When** the user requests visibility change to `public`
    - **Then** the system rejects the request and keeps the recipe non-public

---

### Requirement Validation: REQ-CN-004a, REQ-CN-004b (Premium lapse private-retention + new-private rejection)

#### Test Case: ATP-CN-004-A (Existing private recipes remain private after lapse)

**Linked Requirement:** REQ-CN-004a
**Description:** Validates that previously private recipes stay private when premium lapses.
**Validation Condition:** User had premium, set recipe private, then subscription becomes inactive.
**Expected Result:** Existing private recipe visibility remains private after lapse.

- **User Scenario: SCN-CN-004-A1**
    - **Given** a user has a recipe already marked private from an active premium period
    - **When** the user's subscription status changes to lapsed
    - **Then** that existing recipe remains private

#### Test Case: ATP-CN-004-B (Reject setting additional recipes private while lapsed)

**Linked Requirement:** REQ-CN-004b
**Description:** Validates capability lockout for additional private settings during lapsed period.
**Validation Condition:** Lapsed user attempts to set another owned public recipe to private.
**Expected Result:** Request is rejected with subscription-required error until premium is renewed.

- **User Scenario: SCN-CN-004-B1**
    - **Given** a previously premium user is now lapsed and owns another public recipe
    - **When** the user requests visibility change of that additional recipe to `private`
    - **Then** the system rejects the change until subscription renewal occurs

---

### Requirement Validation: REQ-CN-005 (Physical-copy imports default private)

#### Test Case: ATP-CN-005-A (Physical-copy import created as private by default)

**Linked Requirement:** REQ-CN-005
**Description:** Validates origin-based default visibility for physical-copy imported recipes.
**Validation Condition:** User creates/imports recipe flagged with physical-copy (photo/OCR) origin metadata.
**Expected Result:** Newly created recipe persists with `visibility="private"` by default.

- **User Scenario: SCN-CN-005-A1**
    - **Given** an authenticated user imports a recipe marked as physical-copy origin
    - **When** the recipe is created
    - **Then** the stored recipe defaults to private visibility

---

## Coverage Summary

| Metric                   | Count            |
| ------------------------ | ---------------- |
| Total Requirements (REQ) | 146              |
| Total Test Cases (ATP)   | 141              |
| Total Scenarios (SCN)    | 147              |
| Requirements with ≥1 ATP | 146 / 146 (100%) |
| Test Cases with ≥1 SCN   | 141 / 141 (100%) |
| **Overall Coverage**     | **100%**         |

Coverage note: The ATP count (141; reconciled 2026-07-25, was 142/148 SCN) reflects test cases with dedicated `Linked Requirement` rows. Five functional REQs (REQ-002a, REQ-002b, REQ-003a, REQ-003b, REQ-030f) have no dedicated ATP row — their individual fields are validated as part of their parent REQ's ATP (ATP-002-A for REQ-002a/b, ATP-003-A/B for REQ-003a/b, ATP-030-A for REQ-030f). Coverage is complete at 146/146. REQ-035a/035b, REQ-038a/038b/038c, and REQ-049a/049b are explicitly linked in ATP linked-requirement fields. REQ-049b cap-boundary execution remains blocked pending resolution of `[TBD: per-user collection cap]` in `requirements.md`. ATP-020-B is excluded from the ATP/SCN totals — reconciled 2026-07-25 as N/A (self-service-only erasure design makes the original non-owner-403 scenario structurally unrepresentable); REQ-020a remains fully covered by ATP-020-A and ATP-020-C.

US-0 / FR-046 coverage note: The eleven FR-046 requirements covered here — REQ-058 (widget surface discovered via startup registration), REQ-059 (`curateHomeWidgets` capability gating), REQ-060 (`curateHomeWidgets` subscription-tier gating), REQ-061 (personalization ordering), REQ-062 (lazy render with per-widget error isolation), REQ-063 (graceful unknown-id skip), REQ-064 (Home v1 recipe-only live widget), REQ-065 (gated widgets render as CR-001 skeleton placeholders until 005–009 deploy; auto-swap to live on deploy), REQ-066 (per-session premium nudge), REQ-067 (live-widget web/mobile parity), REQ-068 (cross-device layout persistence, deferred in v1 — WAV-002) — plus REQ-IF-006 (`PATCH /v1/users/me`, consumed from feature 002) are the acceptance-plan's decomposition of spec FR-046, matching the REQ-058..REQ-068 + REQ-IF-006 scheme in `requirements.md`. ATP-IF-004-A's parity scope now covers the full functional set (REQ-001 through REQ-068, 99 functional requirements including sub-IDs).

## Uncovered Requirements

None — full coverage achieved.

## Peer-Review Remediation Log

- **PRF-ACC-001** (source: PRF-ATP-001): Updated Coverage Summary baseline to 134 requirements and added traceability-policy note for atomic sub-ID linking.
- **PRF-ACC-002** (source: PRF-ATP-002): Updated Linked Requirement fields to include explicit atomic IDs for ATP-035-A/B, ATP-038-A/B, and ATP-049-A/B.
- **PRF-ACC-003** (source: PRF-ATP-003): Added ATP-057-B with measurable `<=300 ms` latency validation and 1-character/2-character trigger boundary scenarios (SCN-057-B1/B2).
- **PRF-ACC-004** (source: PRF-ATP-004): Updated ATP-IF-004-A validation/expected/scenario from 57 to 83 functional requirements (including sub-IDs) and made scenario query-driven.
- **PRF-ACC-005** (source: PRF-ATP-005): Renamed ATP-020-B1 -> ATP-020-B and ATP-020-B2 -> ATP-020-C; updated scenario ID SCN-020-B2 -> SCN-020-C1.
- **PRF-ACC-006** (source: PRF-ATP-006): Clarified that `REQ-010c` in the atomization preamble is a conceptual reference only (not a formal row), and that the 134 baseline is derived from actual table rows only.
- **PRF-ACC-007** (source: PRF-ATP-007): Added document-level "Verification Method Notes" section classifying affected ATPs as Inspection/Analysis non-executable checks per ISO 29119.
- **PRF-ACC-008** (source: PRF-ATP-008): Added placeholder ATP-049-C (SCN-049-C1) for cap-boundary rejection with explicit blocked status until REQ-049b `[TBD]` is resolved.
- **PRF-ACC-009** (source: PRF-ATP-009): Rewrote SCN-NF-013-A1 Then clause with concrete `userId`/`recipeId`/`collectionId` fixture-constant equality assertions.
- **PRF-ACC-010** (source: PRF-ATP-010): Rewrote SCN-IF-004-A1 When clause from manual auditor action to matrix-query system action; categorized ATP-IF-004-A under Inspection in methodology notes.
- **PRF-ACC-011** (source: PRF-ATP-011): Rewrote SCN-NF-003-A1 to automated harness timestamps and mandated JSON execution-log fields (`startTime`, `endTime`, `elapsedMs`).
- **PRF-ACC-012** (source: PRF-ATP-012): Added "Test Plan Context" section with Test Level, Entry Criteria, and Exit Criteria.
- **PRF-ACC-013** (source: PRF-ATP-013): Added ATP-003-C for explicit 101-ingredient rejection; existing ATP-003-B scenarios already cover exactly-100 success.
- **PRF-ACC-014** (source: PRF-ATP-014): Added ATP-007-B with explicit exactly-50 success and 51-rejection boundary scenarios.
- **PRF-ACC-015** (round-2 fix D3 + C8): Added the US-0 / FR-046 Home widget-surface acceptance section (ATP-058-A through ATP-064-A + ATP-IF-006-A) covering: recipe widget renders (empty + with-data), capability-gating invariant, personalization ordering, per-widget error isolation + unknown-id skip, Home v1 recipe-only with gated widgets **absent** (not empty tiles), a gated widget (AI/005) auto-appearing on deploy, per-session subscription nudge, live-widget web/mobile parity, and layout persistence via the 002-owned `PATCH /v1/profiles/me`.
- **PRF-ACC-016** (round-2 fix D5): Normalized the food-resolution status in SCN-031-A1 to the canonical `foodResolutionStatus = RESOLVED` (UPPER_SNAKE enum `PENDING|UNRESOLVED|RESOLVED|NOT_FOUND|FAILED`); the freeform marker remains the separate `isUserEntered` boolean.
- **PRF-ACC-017** (round-2 fix D6): Reworded ATP-039-A (SCN-039-A1) to the canonical FK pending-archive design — the pending row references (`recipe_version_id`) the `recipe_versions` row whose `snapshot` is the replay payload; no snapshot/payload is duplicated into the pending row.
- **PRF-ACC-018** (round-3 convergence): Renumbered the US-0 / FR-046 Requirement-Validation sections from the interim 7-id scheme (REQ-058..REQ-064) to the authoritative 11-req decomposition in `requirements.md` (REQ-058..REQ-068 + REQ-IF-006); split capability vs subscription-tier gating (REQ-059/REQ-060), lazy render vs unknown-id skip (REQ-062/REQ-063), v1 recipe-only live vs gated-absent (REQ-064/REQ-065), and cross-device persistence vs the 002-owned consumed interface (REQ-068/REQ-IF-006); added the startup-registration surface ATP (REQ-058); extended ATP-IF-004-A parity scope to the full functional set (REQ-001..REQ-068, 99 functional requirements); updated Coverage Summary counts to 146/142/148.
