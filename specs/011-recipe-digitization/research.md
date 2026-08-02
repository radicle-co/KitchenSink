# Research: Recipe Digitization & Family Circles

**Feature**: `011-recipe-digitization`
**Date**: 2026-05-09
**Method**: Bootstrapped from cross-feature consistency report §9–§11 and portfolio-wide standards §8.

---

## Personas

### Primary — P10 Sage (Heritage Archivist)

Sage has a box of index cards, a few handwritten journals, and a stack of clipped magazine pages accumulated over decades. Her goal is to get them into the app before they deteriorate further, then share them with her adult children. She's comfortable with smartphones but not a power user. She'll tolerate a correction step if the app does most of the heavy lifting.

**Key needs**: reliable OCR on aged paper and faded ink; a simple correction UI that doesn't require re-typing everything; a way to share with family without making recipes public.

### Secondary — P3 Riley (Family Meal Planner)

Riley is Sage's daughter. She receives Circle invitations and browses the family recipe archive to plan weekly meals. She doesn't digitize recipes herself but benefits from Sage's work. She needs Circle membership to feel low-friction — one tap to accept, no account setup friction.

**Key needs**: easy Circle join flow; browsable family recipe collection; integration with her existing meal planning (006).

### Tertiary — P8 Alex (Commise Power User)

Alex uses the app daily across multiple features. He might digitize a few recipes from a professional cookbook, but his primary interest is the Circle primitive as a team-sharing mechanism (kitchen brigade, catering crew). He'll push the bulk import queue and expect it to handle 20+ photos without breaking.

**Key needs**: bulk import queue; Circle management for non-family groups; API reliability under load.

---

## Competitive Landscape

| Product                      | OCR approach                                           | Sharing model                 | Gaps vs. 011                             |
| ---------------------------- | ------------------------------------------------------ | ----------------------------- | ---------------------------------------- |
| **Paprika 3**                | Manual entry only; no OCR                              | iCloud sync (single user)     | No photo import, no group sharing        |
| **Whisk**                    | Web-URL import (structured); no photo OCR              | Household sharing (flat list) | No handwriting support, no named circles |
| **Cookmate**                 | Photo import via third-party OCR; correction UI exists | No sharing                    | Correction UX is clunky; no social layer |
| **Google Lens + copy-paste** | Excellent OCR including handwriting                    | None                          | No recipe normalization; pure text dump  |
| **RecipeKeeper**             | Photo import with basic OCR                            | Export only                   | No invite-based sharing                  |

**Opportunity**: No mainstream recipe app combines high-quality handwriting OCR with a structured normalization step and a named-circle sharing model. The correction UX is the differentiator — competitors either skip it (raw text dump) or make it painful (full re-entry).

---

## UX Patterns

### Photo Import Flow

1. Tap "Import from photo" on the recipe library screen.
2. Camera or photo library picker opens.
3. Upload triggers immediately; a progress indicator replaces the picker.
4. On OCR completion, the correction screen opens automatically.
5. Correction screen: left panel = original photo (pinch-to-zoom); right panel = parsed fields (title, yield, time, ingredients, steps).
6. Low-confidence tokens highlighted in amber; user taps to edit inline.
7. "Save Recipe" button commits to the `Recipe` entity. "Discard" deletes the job.

**Bulk mode**: a queue icon in the top-right shows pending jobs. Completing one job advances to the next automatically.

### Circle Management Flow

1. "Circles" tab in the sharing settings.
2. "New Circle" → name input → invite by email or username.
3. Invitees receive an in-app notification and email. One-tap accept.
4. Circle owner can add/remove members and rename the Circle.
5. When sharing a recipe, audience picker shows `Private`, named Circles the user belongs to, and (if 012 is enabled) `Public Profile`.

### Correction UX Principles

- Never force the user to re-type a field that was correctly parsed. Inline editing only.
- Confidence indicators are visual (color + icon), not just color, to satisfy NFR-004.
- "Accept all" button for high-confidence imports (e.g., clean printed text).
- Undo is available within the correction session; once saved, standard recipe edit applies.

---

## Codebase Analysis

No implementation exists yet. The following packages will be introduced:

| Package                             | Group          | Purpose                                                                                     |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| `@kitchensink/digitization-workers` | `digitization` | Lambda function: receives S3 key, runs OCR/handwriting recognition, returns structured JSON |
| `@kitchensink/digitization-service` | `digitization` | NestJS module: `DigitizationJob` CRUD, pre-signed URL generation, correction save           |
| `@kitchensink/circles-service`      | `circles`      | NestJS module: `Circle` entity, membership, invitations, audience resolution                |
| `@kitchensink/audience`             | `shared`       | Shared library: `AudienceScope` type, `{ scope, ref_id?, price_cents? }` shape (S-004)      |

The `Circle` entity and `@kitchensink/audience` are cross-feature primitives. Features 001, 006, and 007 will import from `@kitchensink/circles-service` and `@kitchensink/audience` respectively — they do not own these packages.

**Database tables** (PostgreSQL 16, Drizzle ORM):

- `circles` — `id`, `owner_user_id`, `name`, `created_at`
- `circle_members` — `circle_id`, `user_id`, `invited_at`, `accepted_at`, `role` (`owner` | `member`)
- `circle_invitations` — `id`, `circle_id`, `inviter_user_id`, `invitee_email`, `token`, `expires_at`, `accepted_at`
- `digitization_jobs` — `id`, `user_id`, `s3_key`, `state`, `raw_ocr_json`, `parsed_json`, `recipe_id` (nullable, set on save), `created_at`, `updated_at`

**S3 layout**: `digitization/{user_id}/{job_id}/original.{ext}` — separate prefix from recipe photos (`recipes/{recipe_id}/...`) owned by 001.

---

## Tech Stack

Inherits portfolio-wide standards (§8):

- **Runtime**: Node.js 24.x (S-003) — including the OCR Lambda.
- **API**: NestJS 11, paths under `/api/v1/*` (S-001).
- **Packages**: `@kitchensink/{group}-{name}` (S-002).
- **OCR**: AWS Textract (printed text + handwriting). Called from the `@kitchensink/digitization-workers` Lambda; results stored as JSON in `digitization_jobs.raw_ocr_json`.
- **Storage**: S3 for photo originals; pre-signed PUT URLs from the API (NFR-002).
- **Queue**: SQS for async OCR jobs (consistent with 001's version-archive queue pattern).
- **ORM**: Drizzle ORM + `pg` (node-postgres), consistent with 001.

---

## Metrics & ROI

| Metric                                                        | Target                      | Rationale                                                                |
| ------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| OCR parse quality (title + 3+ ingredients without correction) | ≥ 70% of submissions        | Below this, the correction burden exceeds manual entry                   |
| Median import-to-save time                                    | < 3 minutes                 | Benchmark from Cookmate user research                                    |
| Circle invite acceptance rate                                 | > 60% within 48 h           | Low acceptance = broken social loop                                      |
| Recipes digitized per active Sage-archetype user per month    | ≥ 5                         | Indicates the feature is part of a real workflow, not a one-time novelty |
| Circle-shared recipes viewed by non-owner members             | ≥ 2 views per shared recipe | Validates the sharing value, not just the digitization value             |
