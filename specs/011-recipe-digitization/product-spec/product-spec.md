# Product Specification: Recipe Digitization & Family Circles

**Feature**: `011-recipe-digitization`
**Version**: 0.1 (bootstrap)
**Date**: 2026-05-09
**Status**: Awaiting revalidation

---

## Problem Statement

Decades of family recipes exist only on paper — index cards, handwritten journals, clipped magazine pages. They're fragile, unsearchable, and locked to whoever physically holds them. Sage wants to preserve them digitally and share them with her family. No current recipe app makes this easy: OCR tools dump raw text, recipe apps require manual entry, and sharing models are either single-user or fully public.

This feature closes that gap with a photo-to-recipe pipeline and a private, invite-based sharing primitive (`Circle`).

---

## Vision

When 011 ships, any user can point their phone at a handwritten index card, a dog-eared cookbook page, or a faded printed clipping and receive a fully structured, editable recipe in under 60 seconds. P10 Sage can clear a box of family cards in an afternoon rather than a weekend, confident that the OCR pipeline catches the hard parts and the correction UI surfaces only what needs her attention. P3 Riley opens the app to find those recipes already waiting in her family Circle, ready to pull into a meal plan. P8 Alex can queue an entire professional cookbook chapter and let the SQS-backed pipeline work through it while he preps service. The result is a living family archive — accurate, searchable, and privately shared — that no paper box can match.

---

## Personas

### Primary — P10 Sage (Heritage Archivist)

Sage is digitizing a lifetime of family recipes. She photographs cards and cookbook pages, corrects OCR errors, and shares the results with her family Circle. She values accuracy over speed and will spend time on correction if the app respects her effort.

**Must Have**: reliable OCR on printed and handwritten text; correction UI that shows the original photo; Circle creation and invite.

**Should Have**: bulk import queue; confidence indicators on low-quality tokens; "accept all" for clean scans.

**Won't Have (this release)**: automatic recipe tagging, nutrition auto-fill from digitized ingredients.

### Secondary — P3 Riley (Family Meal Planner)

Riley receives Circle invitations from Sage and browses the family archive to plan meals. She doesn't digitize but depends on the Circle join flow being frictionless.

**Must Have**: one-tap Circle invite acceptance; browsable Circle recipe collection.

**Should Have**: Circle recipes surfaced in her meal planning (006) ingredient picker.

### Tertiary — P8 Alex (Commise Power User)

Alex uses Circles for team sharing (catering crew, kitchen brigade). He pushes bulk imports and expects the queue to handle volume without manual babysitting.

**Must Have**: bulk import queue; Circle management (add/remove members, rename).

**Should Have**: API pagination on Circle recipe lists; SQS-backed async OCR so the UI doesn't block.

---

## User Stories

### Must Have

| ID     | Story                                                                                                               | Persona            |
| ------ | ------------------------------------------------------------------------------------------------------------------- | ------------------ |
| US-001 | As Sage, I can photograph a recipe card so the app extracts the title, ingredients, and steps automatically.        | P10 Sage           |
| US-002 | As Sage, I can review and correct the parsed output side-by-side with the original photo before saving.             | P10 Sage           |
| US-003 | As Sage, I can create a named Circle and invite family members by email or username.                                | P10 Sage           |
| US-004 | As Riley, I can accept a Circle invitation with one tap and immediately browse shared recipes.                      | P3 Riley           |
| US-005 | As Sage, I can share a saved recipe to one or more of my Circles.                                                   | P10 Sage           |
| US-006 | As a Circle member, I can view recipes shared to my Circle but cannot edit them unless the owner grants permission. | P3 Riley / P8 Alex |

### Should Have

| ID     | Story                                                                                                      | Persona  |
| ------ | ---------------------------------------------------------------------------------------------------------- | -------- |
| US-007 | As Sage, I can queue multiple photos and work through corrections one at a time.                           | P10 Sage |
| US-008 | As Sage, I can see which tokens the OCR flagged as low-confidence so I know where to focus my corrections. | P10 Sage |
| US-009 | As Sage, I can tap "Accept all" when the OCR result looks clean, skipping field-by-field review.           | P10 Sage |
| US-010 | As Alex, I can remove a member from a Circle I own.                                                        | P8 Alex  |
| US-011 | As Alex, I can rename a Circle I own.                                                                      | P8 Alex  |

### Won't Have (this release)

- Automatic nutrition data population from digitized ingredients (requires 003 integration; deferred).
- Public sharing of digitized recipes (requires 012 `@handle` pages; deferred).
- AI-assisted recipe cleanup or ingredient normalization (requires 005; deferred).

---

## Epics

### Epic E-001: Capture & Ingestion

Users can submit one or more recipe photos — via camera or file upload — and the app creates a tracked digitization job for each image.

- US-001 (photograph a recipe card and trigger extraction)
- US-007 (queue multiple photos for batch processing)

### Epic E-002: OCR & Structured Parsing

The pipeline extracts raw text from each photo and normalises it into canonical `Recipe` fields (title, ingredients, steps, yield, timing), flagging low-confidence tokens for human review.

- US-001 (automatic extraction of title, ingredients, steps)
- US-008 (low-confidence token indicators)

### Epic E-003: Review & Correction

Users see the original photo alongside the parsed output and can correct any field before committing the recipe to their library.

- US-002 (side-by-side correction UI)
- US-008 (confidence indicators guide correction focus)
- US-009 (accept-all shortcut for clean scans)

### Epic E-004: Circle Sharing

Owners create named Circles, invite members, and share saved recipes. Members browse and view shared recipes without edit rights unless explicitly granted.

- US-003 (create a Circle and invite by email or username)
- US-004 (one-tap invitation acceptance)
- US-005 (share a recipe to one or more Circles)
- US-006 (Circle members can view but not edit)
- US-010 (remove a member from an owned Circle)
- US-011 (rename an owned Circle)

### Epic E-005: Archive & Versioning

Each digitization job retains the original photo and OCR artefacts in S3 so users can revisit the source image and audit the correction history.

- US-002 (original photo visible during correction)
- US-007 (queue-based job tracking across sessions)

### Epic E-006: Accessibility & Inclusive UX

All digitization and Circle flows meet WCAG 2.1 AA standards, with large-text support, screen-reader-compatible correction fields, and keyboard-navigable job queues.

- US-002 (correction UI must expose accessible field names)
- US-004 (invite acceptance must be operable without a pointer)

---

## Functional Requirements

### Capture

- **FR-001**: The system MUST accept a JPEG, PNG, or HEIC image up to 20 MB via a pre-signed S3 PUT URL returned by `POST /api/v1/recipes/digitize/jobs` (supports US-001).
- **FR-002**: The system MUST support camera capture on mobile (iOS and Android) and file-picker upload on web without requiring a separate native plugin (supports US-001).
- **FR-003**: The system MUST allow a user to submit up to 20 photos in a single session, creating one `DigitizationJob` per photo (supports US-007).
- **FR-004**: The system MUST reject images below 300 × 300 px or above 20 MB with a descriptive error message before the S3 upload begins (supports US-001).
- **FR-005**: The system MUST support multi-page submissions where each page is treated as a separate job linked by a shared `batch_id` (supports US-007).

### OCR & Parsing

- **FR-006**: The system MUST invoke an OCR provider (AWS Textract or equivalent) on each uploaded photo within 30 seconds of the S3 upload completing (supports US-001).
- **FR-007**: The system MUST parse OCR output into canonical `Recipe` fields: `title`, `ingredients[]`, `steps[]`, `yield`, `prep_time`, `cook_time` (supports US-001).
- **FR-008**: The system MUST attach a per-token confidence score (0.0–1.0) to every extracted ingredient and step, sourced from the OCR provider's confidence data (supports US-008).
- **FR-009**: The system MUST flag any token with confidence below 0.75 as low-confidence and surface it visually in the correction UI (supports US-008).
- **FR-010**: The system MUST detect the primary language of the extracted text and store it as `language_code` (BCP-47) on the `DigitizationJob` (supports US-001).
- **FR-011**: The system MUST handle handwritten text using a handwriting-capable OCR mode; printed and handwritten text may appear on the same image (supports US-001).
- **FR-012**: When OCR quality is too low to extract any structured field, the system MUST transition the job to `awaiting-correction` with a `low_quality` flag rather than silently discarding it (supports US-002).
- **FR-013**: The system MUST enqueue OCR processing via SQS so that the API response to the upload request is non-blocking; the client polls `GET /api/v1/recipes/digitize/jobs/:id` for status (supports US-007).

### Review & Correction

- **FR-014**: The correction screen MUST display the original photo and all parsed fields simultaneously without requiring the user to toggle between views (supports US-002).
- **FR-015**: Every parsed field MUST be individually editable inline; changes MUST be submitted via `PATCH /api/v1/recipes/digitize/jobs/:id/correction` (supports US-002).
- **FR-016**: The system MUST provide an "Accept all" action that saves the parsed output as-is when no low-confidence tokens are present (supports US-009).
- **FR-017**: Low-confidence tokens MUST be visually distinguished (e.g. underline or highlight) and MUST be individually confirmable or overridable (supports US-008).
- **FR-018**: The system MUST preserve the original photo in S3 after the job is saved or discarded, retaining it for the archive (supports US-002).

### Storage & Archive

- **FR-019**: All uploaded photos MUST be stored in S3 under a per-user prefix; CloudFront MUST serve photo assets to the correction UI and recipe detail view (supports US-002).
- **FR-020**: The `DigitizationJob` record MUST store `raw_ocr_json` (provider response) and `parsed_json` (normalised fields) separately so the original OCR output is auditable (supports US-002).
- **FR-021**: On `POST /api/v1/recipes/digitize/jobs/:id/save`, the system MUST create a `Recipe` entity (owned by 001) and link it to the job via `recipe_id` (supports US-001).
- **FR-022**: Discarded jobs (`DELETE /api/v1/recipes/digitize/jobs/:id`) MUST soft-delete the job record; the S3 photo object MUST be retained for a configurable retention period (default: 30 days) (supports US-007).

### Accessibility

- **FR-023**: All correction-screen form fields MUST have accessible labels queryable via `getByRole` or `getByLabelText` in automated tests (supports US-002).
- **FR-024**: The job queue list MUST be keyboard-navigable and operable without a pointer device (supports US-007).
- **FR-025**: Low-confidence token indicators MUST not rely on colour alone; a text label or icon with an accessible name MUST accompany any colour cue (supports US-008).
- **FR-026**: The Circle invitation acceptance flow MUST be completable using only a screen reader and keyboard on both web and mobile (supports US-004).

### API

- **FR-027**: All digitization endpoints MUST be prefixed `/api/v1/recipes/digitize/*` and require a valid Clerk session token (supports US-001, US-002, US-007).
- **FR-028**: `GET /api/v1/recipes/digitize/jobs` MUST support cursor-based pagination with a default page size of 20 (supports US-007).
- **FR-029**: The API MUST return a `job_status` field on every job response with one of: `pending`, `processing`, `awaiting-correction`, `saved`, `discarded` (supports US-001, US-002).
- **FR-030**: The API MUST return structured error responses (RFC 7807 Problem Details) for all 4xx and 5xx responses, including a machine-readable `error_code` (supports US-001).

---

## Audience Model (S-004)

This feature defines and implements the `circle` audience scope. The full S-004 model:

| Scope              | Visibility        | Indexable | Owner   |
| ------------------ | ----------------- | --------- | ------- |
| `private`          | Owner only        | no        | 001     |
| `circle`           | Circle members    | no        | **011** |
| `public-profile`   | Anyone with URL   | yes       | 012     |
| `published-lesson` | Enrolled learners | yes       | 013     |

The `audience` field shape on shareable entities: `{ scope: AudienceScope, ref_id?: string, price_cents?: number }`.

For `circle` scope, `ref_id` is the `Circle.id`. The `@kitchensink/audience` package exports the `AudienceScope` enum and the `Audience` type. Features 001, 006, and 007 import from this package — they do not redefine the type.

---

## API Surface

All paths under `/api/v1/` (S-001). Auth required on all endpoints (002).

### Digitization Jobs

| Method   | Path                                       | Description                                                  |
| -------- | ------------------------------------------ | ------------------------------------------------------------ |
| `POST`   | `/api/v1/digitization/jobs`                | Create a job; returns pre-signed S3 PUT URL for photo upload |
| `GET`    | `/api/v1/digitization/jobs`                | List the authenticated user's jobs (paginated)               |
| `GET`    | `/api/v1/digitization/jobs/:id`            | Get job status and parsed result                             |
| `PATCH`  | `/api/v1/digitization/jobs/:id/correction` | Submit corrected fields                                      |
| `POST`   | `/api/v1/digitization/jobs/:id/save`       | Save corrected job as a `Recipe`; returns `recipe_id`        |
| `DELETE` | `/api/v1/digitization/jobs/:id`            | Discard a job                                                |

### Circles

| Method   | Path                                        | Description                              |
| -------- | ------------------------------------------- | ---------------------------------------- |
| `POST`   | `/api/v1/circles`                           | Create a Circle                          |
| `GET`    | `/api/v1/circles`                           | List Circles the user owns or belongs to |
| `GET`    | `/api/v1/circles/:id`                       | Get Circle details and member list       |
| `PATCH`  | `/api/v1/circles/:id`                       | Rename a Circle (owner only)             |
| `DELETE` | `/api/v1/circles/:id`                       | Delete a Circle (owner only)             |
| `POST`   | `/api/v1/circles/:id/invitations`           | Invite a user by email or username       |
| `POST`   | `/api/v1/circles/invitations/:token/accept` | Accept an invitation (authenticated)     |
| `DELETE` | `/api/v1/circles/:id/members/:userId`       | Remove a member (owner only)             |

---

## Data Model

```
circles
  id            uuid PK
  owner_user_id uuid NOT NULL  -- FK → Clerk sub
  name          text NOT NULL
  created_at    timestamptz NOT NULL DEFAULT now()

circle_members
  circle_id     uuid NOT NULL  -- FK → circles.id
  user_id       uuid NOT NULL  -- FK → Clerk sub
  role          text NOT NULL  -- 'owner' | 'member'
  invited_at    timestamptz NOT NULL
  accepted_at   timestamptz
  PRIMARY KEY (circle_id, user_id)

circle_invitations
  id            uuid PK
  circle_id     uuid NOT NULL  -- FK → circles.id
  inviter_user_id uuid NOT NULL
  invitee_email text NOT NULL
  token         text NOT NULL UNIQUE
  expires_at    timestamptz NOT NULL
  accepted_at   timestamptz

digitization_jobs
  id            uuid PK
  user_id       uuid NOT NULL
  s3_key        text NOT NULL
  state         text NOT NULL  -- 'pending'|'processing'|'awaiting-correction'|'saved'|'discarded'
  raw_ocr_json  jsonb
  parsed_json   jsonb
  recipe_id     uuid           -- FK → recipes.id (set on save)
  created_at    timestamptz NOT NULL DEFAULT now()
  updated_at    timestamptz NOT NULL DEFAULT now()
```

---

## Internal Stakeholders

- **Operations Engineer**: monitors OCR Lambda error rates and Textract cost per job.
- **Support/Admin Operator**: handles Circle membership disputes and invitation delivery failures.

---

## Success Metrics

| Metric                                                     | Target                  |
| ---------------------------------------------------------- | ----------------------- |
| OCR parse quality (title + 3+ ingredients, no correction)  | ≥ 70% of submissions    |
| Median import-to-save time                                 | < 3 minutes             |
| Circle invite acceptance rate (within 48 h)                | > 60%                   |
| Recipes digitized per active Sage-archetype user per month | ≥ 5                     |
| Circle-shared recipes with ≥ 2 non-owner views             | ≥ 50% of shared recipes |

---

## Open Questions

- **Q-001**: Which OCR provider should be the primary implementation — AWS Textract, Google Cloud Vision, or a hybrid that routes handwriting to one and printed text to the other? — _Textract is already in the stack (per AGENTS.md); Google Vision may outperform on cursive handwriting. Owner: Engineering Lead. Decision needed before FR-006 implementation._
- **Q-002**: Should OCR usage be gated by subscription tier, or is it available to all users with a monthly job cap? — _Monetisation gating belongs to 010; 011 needs to know whether to check an entitlement flag before enqueuing. Owner: Product + 010 team. Blocking FR-013._
- **Q-003**: What is the minimum acceptable handwriting recognition accuracy threshold before we ship? — _SC-001 targets 70% parse quality on all submissions, but handwritten cards may need a separate, lower threshold with a clearer user expectation. Owner: Product + QA. Affects FR-011 and FR-012._
- **Q-004**: Which languages must be supported at launch, and what is the roadmap for additional languages? — _FR-010 stores `language_code` but the OCR provider's language support varies. Latin-script languages (EN, ES, FR, DE) are likely safe; CJK and RTL scripts need explicit provider validation. Owner: Engineering + Localisation._
- **Q-005**: What is the retention policy for S3 photo objects and `raw_ocr_json` after a job is discarded or saved? — _FR-022 defaults to 30 days for discarded jobs, but saved-job photos may need indefinite retention for the archive use case. Owner: Operations + Legal. Affects storage cost projections._
- **Q-006**: When does 011 hand off Circle membership data to 012 creator profiles, and what is the integration contract? — _012 owns `@handle` public pages; if a Circle owner later publishes recipes publicly, 012 needs to know Circle membership. Timing and API contract undefined. Owner: 011 + 012 leads._
- **Q-007**: How will accessibility validation be certified — automated axe-core checks only, or manual screen-reader testing on iOS VoiceOver and Android TalkBack? — _FR-023 through FR-026 define requirements; the acceptance bar for "WCAG 2.1 AA" needs a concrete test protocol. Owner: QA + Accessibility._
- **Q-008**: Should mobile (Expo) and web have full feature parity at launch, or is the mobile experience limited to camera capture while web supports file upload and bulk queue management? — _P10 Sage is a smartphone user; P8 Alex may prefer web for bulk imports. A phased parity plan would affect Epic E-001 and E-003 scope. Owner: Product._
- **Q-009**: What SQS queue configuration (visibility timeout, DLQ retry count, alarm thresholds) is required for the OCR job queue, and who owns the runbook? — _NFR-001 requires OCR within 10 s on a cold Lambda; queue depth alarms and DLQ handling need an agreed runbook before production. Owner: Operations Engineer._
