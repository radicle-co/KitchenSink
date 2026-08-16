# Spec: Recipe Digitization & Family Circles

> **Product Forge Feature** | Generated: 2026-05-10
> Feature slug: `011-recipe-digitization` | SpecKit mode: v-model
>
> **Source artifacts:**
>
> - Product Spec: [product-spec/product-spec.md](./product-spec/product-spec.md)
> - Research: [research.md](./research.md)
> - Review log: [review.md](./review.md)

---

## Overview

### What We're Building

A photo-to-recipe pipeline that turns paper recipes (handwritten cards, cookbook pages, magazine clippings) into structured, editable `Recipe` entities, paired with a private invite-based sharing primitive (`Circle`) consumed by features 001 / 006 / 007.

### Why We're Building It

Decades of family recipes exist only on paper — fragile, unsearchable, and locked to whoever physically holds them. No mainstream recipe app combines high-quality handwriting OCR, structured normalisation, and a named-circle sharing model. 011 closes that gap and unlocks the heritage-archivist use case (P10 Sage) plus a reusable sharing primitive for the rest of the portfolio.

### Research Backing

- **Competitor analysis:** Cookmate has correction UX but no social layer; Google Lens has best-in-class handwriting OCR but no recipe normalisation. The differentiator is correction UX over a normalised schema. (See [research.md § Competitive Landscape](./research.md))
- **UX/UI patterns:** Side-by-side correction screen (left = original photo with pinch-to-zoom, right = parsed fields with inline editing). Low-confidence tokens highlighted in amber + icon (NFR-004). Bulk-mode queue advances automatically. (See [research.md § UX Patterns](./research.md))
- **Codebase analysis:** Three new packages: `@kitchensink/digitization-workers` (Lambda), `@kitchensink/digitization-service` (NestJS), `@kitchensink/circles-service` (NestJS), plus shared `@kitchensink/audience` consumed by 001 / 006 / 007. (See [research.md § Codebase Analysis](./research.md))

---

## Clarifications

### Session 2026-05-10 (`/speckit.clarify`)

| ID    | Topic                        | Decision                                                                                                                                                                                                                                                                                                                                                                                                                         | Encoded Into                                |
| ----- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| C-001 | Invitation token lifecycle   | **Reusable link per Circle, no expiry, owner-revocable.** One owner-issued URL per Circle; any authenticated user with the link can join until the owner revokes the link (which rotates it).                                                                                                                                                                                                                                    | FR-031, FR-032; US-003 AC; Risks            |
| C-002 | Circle deletion semantics    | **Revert to Private.** Deleting a Circle rewrites every recipe with `audience: { scope: 'circle', ref_id: <id> }` to `audience: { scope: 'private' }` and emits an audit event.                                                                                                                                                                                                                                                  | FR-033; Consumer Contract Fallback; NFR-003 |
| C-003 | Member / Circle caps at v1   | **No hard caps at v1.** Soft monitoring only — alert on outlier Circles (≥ 100 members) or outlier users (≥ 25 Circles). Caps revisited if abuse signals appear.                                                                                                                                                                                                                                                                 | FR-034; NFR-007; Risks                      |
| C-004 | Owner account deletion       | **Promote oldest non-owner member to owner; if no members, soft-delete the Circle.** Soft-deleted Circles follow C-002.                                                                                                                                                                                                                                                                                                          | FR-035; cross-ref 002 account-deletion flow |
| C-005 | `raw_ocr_json` PII retention | ⚠️ **Restated 2026-08-16 (amendment §A-3):** every in-flight artifact — image, `raw_ocr_json` and `parsed_json` alike — is reaped at **72 hours**, on ADR-0016's window. The original ruling ("purge `raw_ocr_json` after 90 days; retain `parsed_json` for the lifetime of the job") assumed a `digitization_jobs` row that no longer exists; the reaper is strictly stronger, so the data-minimisation intent is met a priori. | FR-036; NFR-008                             |

---

## Prerequisites

| Priority | Feature                                                     | Status     | Relationship | What's Needed                                                                                                                                                                                                                                                                                                                                |
| -------- | ----------------------------------------------------------- | ---------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | [002-user-auth](../002-user-auth/spec.md)                   | 🟢 done    | blocks       | Authenticated `user_id` on every digitization + circle endpoint; Clerk session token validation.                                                                                                                                                                                                                                             |
| P0       | [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | 🟢 done    | blocks       | `Recipe` entity (target of save) + S3 + CloudFront infra patterns + Drizzle/Pg conventions.                                                                                                                                                                                                                                                  |
| P1       | [004-recipe-importing](../004-recipe-importing/spec.md)     | ⏳ pending | **blocks**   | **011 lands AFTER 004 and adds the image branch to 004's import spine** ([ADR-0019](../../docs/architecture/decisions/0019-recipe-import-spine.md)). 011 does **not** create its own path to a saved recipe — it submits extracted candidates to 004's **bulk import processor** (`004-FR-047`). See "Ownership of the photo channel" below. |
| P1       | [010-monetisation](../010-subscriptions/spec.md)            | ⏳ pending | complements  | Optional entitlement check before enqueuing OCR (Q-002 deferred to implementation). 011 ships ungated if 010 is not yet live.                                                                                                                                                                                                                |

---

## Ownership of the photo channel _(added 2026-08-14 — owner ruling; normative source [ADR-0019](../../docs/architecture/decisions/0019-recipe-import-spine.md))_

**011 owns photo/OCR import outright.** Feature 004's `FR-012` and its `D-001` — which had committed
photo/OCR to 004 at launch on AWS Textract — are **superseded**. Both specs previously claimed this channel;
this section is the single place the boundary now lives.

**What 011 builds.**

1. **A dedicated image-processing service that owns NO database.** It accepts images, performs
   OCR/normalisation, and emits candidate recipe records. It is a **named exception** to
   [ADR-0017](../../docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md)'s
   "no new deployable" default, justified on that ADR's own flip criteria: the workload is CPU-shaped and
   bursty rather than request-shaped, it carries a vendor dependency the recipe service should not link, and
   it scales on a different axis from recipe CRUD.
    - Images in flight live in object storage. The durable record of the import belongs to the recipe
      service, exactly as for a URL import — so the image service can be redeployed or scaled to zero
      without owning data, and there is **one** authoritative record of an import rather than two to
      reconcile.
2. **The handoff.** Once images are processed, 011 submits the resulting candidates to **004's bulk import
   processor** (`004-FR-047`) with `sourceType = imported_physical`. Recipe creation, ingredient resolution
   into food entities, per-recipe outcome reporting and provenance enforcement are **004's shared path**;
   011 MUST NOT build a second one. This is what makes ingredients get "properly imported and linked" by the
   same code every other channel uses.
3. **The correction UI**, per-token confidence, handwriting support and multi-photo batches — the depth that
   justified moving this channel here rather than leaving it as 004's single sentence.

**What 011 inherits rather than re-derives.** 004's photo-specific _rules_ transfer with the channel and are
binding on 011 (004 § "Channel-ownership transfer"): the premium entitlement gate on `imported_physical`
(`004-FR-028`, D-014, enforced via the shared entitlement mechanism — never by importing the identity
service, ADR-0017 decision 3), the tighter per-photo/OCR sub-quota (`004-FR-022`), deletion of OCR
artifacts on draft expiry (`004-FR-018`), and the OCR vendor's classification as an untrusted third-party
boundary whose output is parsed with zod at the boundary (ADR-0015, `CODING_STANDARDS` §15-d).

**Status reporting is not optional.** 011's image branch is a producer on the import spine: it MUST emit the
same per-recipe status messages as every other channel (`004-FR-048`), and MUST honour the
placeholder/shell-status model (`004-FR-050`) so a client that connects mid-batch renders correct state from a
read. A 20-photo batch is exactly the case that motivated a bounded live view.

⛔ **Corrected 2026-08-16 — this sentence said "superseding, monotonically-sequenced", and the sequence half
cannot be built.** [ADR-0019](../../docs/architecture/decisions/0019-recipe-import-spine.md) §4 was amended:
selection per group is **consumer-side, most-recent-by-timestamp**, and the envelope carries **no sequence**.
See the [2026-08-16 amendment](#amendment-2026-08-16--on-device-first-ocr-the-escape-hatch-the-reaper-and-the-single-writer-invariant)
§A-4 for the single-writer-per-group invariant this makes 011 responsible for stating.

> ⚠️ **The "no database" rule governs the image-processing service only.** 011 also specifies **Family
> Circles**, an unrelated sharing primitive that genuinely requires persistence (circles, members, invite
> tokens). That is a separate deployable with its own tables. Do not collapse the two, and do not read this
> section as denying Circles a database.

## Goals

### Primary Goal

A user can photograph any paper recipe and receive a fully structured, editable `Recipe` in under 3 minutes (median), then share it privately with a named `Circle`.

### Secondary Goals

1. Define and ship the cross-feature `Circle` primitive + the `circle` audience scope (S-004) so 001 / 006 / 007 can reuse it without re-implementing sharing.
2. Provide a correction UX that respects user effort: inline editing, original photo always visible, low-confidence highlights, accept-all shortcut.
3. Support bulk import flows (≤ 20 photos / session) for power-user archive runs without blocking the API.

### Non-Goals (v1 scope)

- Web-URL imports, JSON-LD parsing, schema.org/Recipe adapters — owned by 004.
- Public profile pages, `@handle` routing — owned by 012.
- Video lessons, course enrollment — owned by 013.
- Subscription gating of digitization features — owned by 010.
- Automatic nutrition data fill — requires 003 integration; deferred.
- AI-assisted recipe cleanup or ingredient normalisation — requires 005; deferred.

---

## Users

### Primary Persona

**P10 Sage (Heritage Archivist)** — digitises a lifetime of paper recipes; values accuracy over speed; will tolerate a correction step if the app does the heavy lifting.
Key need: reliable OCR on printed + handwritten text + side-by-side correction UI + private family Circle.

### Secondary Personas

- **P3 Riley (Family Meal Planner)** — receives Circle invitations; one-tap accept; browses the family archive to plan meals (consumed by 006).
- **P8 Alex (Commise Power User)** — bulk-imports professional cookbook chapters; uses Circles for kitchen/catering team sharing; demands API reliability under load.

---

## User Stories

> Full user journey flows: see [product-spec/product-spec.md § User Stories / Epics](./product-spec/product-spec.md)

### Must Have (MVP)

- [ ] **US-001 (P0) — Photo Import of a Recipe Card.** As Sage, I photograph a printed recipe card; the app uploads, runs OCR, and presents a correction screen.
    - **AC:** Uploading a clear photo of a printed recipe card produces a non-empty `title`, ≥ 1 ingredient, ≥ 1 step. Correction screen renders the original image and all parsed fields as editable inputs.
- [ ] **US-002 (P0) — Side-by-side Correction.** As Sage, I review and correct the parsed output side-by-side with the original photo before saving.
    - **AC:** Original photo and parsed fields are visible simultaneously without toggling. Each field is individually editable inline; edits submit via `PATCH /api/v1/recipes/digitize/jobs/:id/correction`.
- [ ] **US-003 (P1) — Create a Circle and Invite Family.** As Sage, I create a named Circle, share its invite link, and watch invited members appear after they tap join.
    - **AC:** Create a Circle, retrieve its single active invitation link, share it with a second user, that user taps join and is added, and a recipe shared to the Circle is readable by them. A third user who never received the link cannot see the recipe. Owner can rotate the link, after which the previous link returns 410 (FR-031, FR-032, C-001).
- [ ] **US-004 (P1) — One-tap Invitation Acceptance.** As Riley, I open a Circle invite link and join with one tap, then immediately browse shared recipes.
    - **AC:** Joining via the invite link is completable using only a screen reader and keyboard on web and mobile (NFR-004). Repeated taps on the same link are idempotent (no duplicate membership). After join, the Circle's recipe list is browsable.
- [ ] **US-005 — Share a Recipe to Circles.** As Sage, I share a saved recipe to one or more of my Circles.
    - **AC:** Audience picker lists `Private` + every Circle the user belongs to. Selecting one or more Circles attaches `audience: { scope: 'circle', ref_id: <circle_id> }` to the recipe.
- [ ] **US-006 — Member Read-Only Access.** As a Circle member, I can view recipes shared to my Circle but cannot edit them unless the owner grants permission.
    - **AC:** Member tries to PATCH a Circle-shared recipe → 403. Owner can grant edit explicitly (out-of-scope hook left for future).

### Should Have

- [ ] **US-007 (P2) — Bulk Import from a Cookbook.** As Sage, I queue multiple photos and work through corrections one at a time.
    - **AC:** Uploading 3 photos in a session creates 3 separate jobs (linked by `batch_id`). Each can be corrected/saved independently. Queue surfaces remaining count.
- [ ] **US-008 — Low-confidence Token Highlighting.** As Sage, I see which tokens the OCR flagged as low-confidence so I know where to focus.
    - **AC:** Low-confidence tokens are visually distinguished by colour **and** an icon/label (NFR-004 / FR-025). Tap to edit inline.
- [ ] **US-009 — Accept-All for Clean Scans.** As Sage, I tap "Accept all" when the OCR result looks clean.
    - **AC:** "Accept all" is enabled only when no low-confidence tokens are present; tapping it commits the parsed output unchanged.
- [ ] **US-010 — Remove Circle Members.** As Alex, I remove a member from a Circle I own.
    - **AC:** `DELETE /api/v1/circles/:id/members/:userId` succeeds for the owner; non-owners get 403; the removed member loses read access on their next request.
- [ ] **US-011 — Rename a Circle.** As Alex, I rename a Circle I own.
    - **AC:** `PATCH /api/v1/circles/:id { name }` succeeds for owner only; the new name appears for all members.

### Could Have (Future)

- Automatic recipe tagging from digitised content (deferred — needs 005).
- Nutrition auto-fill from digitised ingredients (deferred — needs 003).
- Public sharing of digitised recipes via `@handle` (deferred — needs 012).

---

## Functional Requirements

> Authoritative list: [product-spec/product-spec.md § Functional Requirements](./product-spec/product-spec.md). Below is the bridge summary; every FR-NNN ID below traces to at least one user story.

### Capture (FR-001 … FR-005) — supports US-001, US-007

| ID     | Requirement                                                                                           | Priority | Source |
| ------ | ----------------------------------------------------------------------------------------------------- | -------- | ------ |
| FR-001 | Accept JPEG/PNG/HEIC up to 20 MB via pre-signed S3 PUT URL from `POST /api/v1/recipes/digitize/jobs`. | Must     | US-001 |
| FR-002 | Camera capture (iOS + Android) and web file-picker without a separate native plugin.                  | Must     | US-001 |
| FR-003 | Submit up to 20 photos per session, one `DigitizationJob` per photo.                                  | Must     | US-007 |
| FR-004 | Reject images < 300×300 px or > 20 MB with descriptive error before S3 upload.                        | Must     | US-001 |
| FR-005 | Multi-page submissions linked by shared `batch_id`.                                                   | Should   | US-007 |

### OCR & Parsing (FR-006 … FR-013) — supports US-001, US-007, US-008

| ID     | Requirement                                                                                             | Priority | Source         |
| ------ | ------------------------------------------------------------------------------------------------------- | -------- | -------------- |
| FR-006 | Invoke OCR provider (Textract default) within 30 s of S3 upload completing.                             | Must     | US-001         |
| FR-007 | Parse OCR output into `title`, `ingredients[]`, `steps[]`, `yield`, `prep_time`, `cook_time`.           | Must     | US-001         |
| FR-008 | Recognise handwritten source text via the OCR provider's handwriting path.                              | Must     | US-001, US-008 |
| FR-009 | Emit a per-token confidence score for every recognised token.                                           | Must     | US-001, US-008 |
| FR-010 | Capture the detected `language_code` of the source document.                                            | Must     | US-001, US-008 |
| FR-011 | Surface low-confidence tokens to the corrector in the side-by-side correction UI.                       | Must     | US-008         |
| FR-012 | Expose per-token confidence in the `parsed_json` payload returned by the digitize job API.              | Must     | US-008         |
| FR-013 | Async OCR via SQS — API response is non-blocking; client polls `GET /api/v1/recipes/digitize/jobs/:id`. | Must     | US-007         |

### Review & Correction (FR-014 … FR-018) — supports US-002, US-008, US-009

| ID     | Requirement                                                                                   | Priority | Source |
| ------ | --------------------------------------------------------------------------------------------- | -------- | ------ |
| FR-014 | Correction screen shows original photo + parsed fields simultaneously.                        | Must     | US-002 |
| FR-015 | Inline-editable fields; corrections via `PATCH /api/v1/recipes/digitize/jobs/:id/correction`. | Must     | US-002 |
| FR-016 | "Accept all" action for zero-low-confidence-token cases.                                      | Should   | US-009 |
| FR-017 | Low-confidence tokens visually distinguished + individually confirmable.                      | Must     | US-008 |
| FR-018 | Original photo retained in S3 after save / discard for archive.                               | Must     | US-002 |

### Storage & Archive (FR-019 … FR-022) — supports US-001, US-002, US-007

| ID      | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Priority | Source |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| FR-019  | S3 photos under per-user prefix; CloudFront serves to UI + recipe detail.                                                                                                                                                                                                                                                                                                                                                                                   | Must     | US-002 |
| FR-020  | `DigitizationJob` stores `raw_ocr_json` and `parsed_json` separately (auditable).                                                                                                                                                                                                                                                                                                                                                                           | Must     | US-002 |
| FR-021  | `POST /…/save` creates a `Recipe` (owned by 001) and links via `recipe_id`. The created recipe MUST be `{ scope: 'private' }` — see `FR-021a`.                                                                                                                                                                                                                                                                                                              | Must     | US-001 |
| FR-021a | **A recipe digitized from a photo MUST be created private.** Its source is not publicly and freely available (a cookbook page, recipe card, handwritten note, or screenshot), so it MUST NOT default to public. The owner MAY afterwards share it read-only to a Circle (`{ scope: 'circle', ref_id }`) or, if they hold the rights, publish it. The system MUST NOT auto-publish it under any condition. _(**DRAFT**, added 2026-08-02 per owner ruling.)_ | Must     | US-001 |
| FR-021b | **Attribution and source linking are required.** A digitized recipe MUST persist and display the provenance it was captured from — at minimum the capture method (photo) and any user-supplied source (book title, author, page, or URL). A recipe MUST NOT be publishable until a source attribution is present. _(**DRAFT**, added 2026-08-02 per owner ruling.)_                                                                                         | Must     | US-001 |
| FR-022  | `DELETE /…/jobs/:id` soft-deletes; S3 object retained 30 d default.                                                                                                                                                                                                                                                                                                                                                                                         | Should   | US-007 |

> ### Recipe visibility model (owner ruling, 2026-08-02)
>
> Canonical rule: [GR-014](../governance-rules.md#gr-014-audience-and-sharing-model). Summarised here
> because 011 owns the `Circle` primitive and the `circle` audience scope.
>
> **A recipe is either private or public. There is no third state** — no premium, paywalled, or
> purchasable recipe exists anywhere in the portfolio.
>
> - **Private** — owner only. MAY be shared with contacts **read-only** via a Circle
>   (`{ scope: 'circle', ref_id }`, member read-only access per US-006). Sharing is not selling.
> - **Public** — readable by any authenticated user (`001-FR-004`).
> - **Ingestion rule** — an ingested recipe is created `public` **only** when its source is publicly and
>   freely available **and not otherwise marked or licensed** against republication (paywall,
>   subscription, explicit reservation, or a licence forbidding redistribution or derivatives). Otherwise
>   it is created **private** (`FR-021a`), and MUST NOT be auto-published.
> - **Attribution** — source attribution and linking are **required in every case**, and are a
>   precondition of publishing (`FR-021b`; `004-FR-010` for web/Instagram imports).
>
> 001 owns the visibility field; 011 owns the Circle primitive and the `circle` scope.
>
> **Where 011 lands**: a photo-digitized recipe is `sourceType: 'imported_physical'`, which the shipped
> policy makes **private-only**. 011 MUST call `evaluateVisibility`
> (`packages/services/recipe-service/src/recipes/domain/visibilityPolicy.ts`) rather than deciding
> visibility itself — the same constraint `004-FR-011` carries. The "unless otherwise marked" carve-out
> never applies here: a cookbook page, recipe card, or handwritten note is not a publicly available source.

### Accessibility (FR-023 … FR-026) — supports US-002, US-004, US-007, US-008

| ID     | Requirement                                                                            | Priority | Source |
| ------ | -------------------------------------------------------------------------------------- | -------- | ------ |
| FR-023 | All correction-screen fields have accessible labels (`getByRole`/`getByLabelText`).    | Must     | US-002 |
| FR-024 | Job queue keyboard-navigable, pointer-free.                                            | Must     | US-007 |
| FR-025 | Low-confidence indicators use icon/label + colour (no colour-only).                    | Must     | US-008 |
| FR-026 | Circle invitation acceptance completable via screen reader + keyboard on web + mobile. | Must     | US-004 |

### API (FR-027 … FR-030) — supports US-001, US-002, US-007

| ID     | Requirement                                                                                                      | Priority | Source         |
| ------ | ---------------------------------------------------------------------------------------------------------------- | -------- | -------------- |
| FR-027 | All endpoints under `/api/v1/recipes/digitize/*`; Clerk session token required.                                  | Must     | US-001         |
| FR-028 | `GET …/jobs` cursor pagination, page size 20.                                                                    | Must     | US-007         |
| FR-029 | `job_status` field on every response (`pending` / `processing` / `awaiting-correction` / `saved` / `discarded`). | Must     | US-001, US-002 |
| FR-030 | RFC 7807 Problem Details for 4xx/5xx with machine-readable `error_code`.                                         | Must     | US-001         |

### Circle Lifecycle (FR-031 … FR-035) — supports US-003, US-004, US-005, US-010, US-011

| ID     | Requirement                                                                                                                                                                                                                                                                                                      | Priority | Source         |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------- |
| FR-031 | Each Circle has exactly one active **invitation link** (opaque token in URL). Owner-only `POST /api/v1/circles/:id/invitation/rotate` revokes the current link and issues a replacement. The link does **not** auto-expire.                                                                                      | Must     | C-001, US-003  |
| FR-032 | `POST /api/v1/circles/join/:token` accepts the link for any authenticated, non-member user; idempotent for existing members; returns 410 `error_code: circle.invitation.revoked` for rotated tokens.                                                                                                             | Must     | C-001, US-004  |
| FR-033 | `DELETE /api/v1/circles/:id` (owner-only) rewrites every `Recipe.audience` matching `{ scope: 'circle', ref_id: <id> }` to `{ scope: 'private' }` in a single transaction with the Circle soft-delete, then emits one `circle.deleted` audit event plus one `recipe.audience.changed` event per affected recipe. | Must     | C-002, NFR-003 |
| FR-034 | No hard cap on members per Circle or Circles per user at v1; emit a `circle.size.outlier` warning event when a Circle exceeds 100 members or a user owns ≥ 25 Circles.                                                                                                                                           | Should   | C-003          |
| FR-035 | When a user account is deleted (cross-feature with 002), for each Circle the user owns: promote the oldest non-owner member (by `joined_at`) to owner; if there are no other members, soft-delete the Circle per FR-033. Audit-log every promotion.                                                              | Must     | C-004, NFR-003 |

### Data Retention (FR-036) — supports compliance + privacy posture

| ID     | Requirement                                                                                                                                                                                                 | Priority | Source |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| FR-036 | Purge `digitization_jobs.raw_ocr_json` 90 days after job creation regardless of `job_status`; retain `parsed_json` for the lifetime of the job row. Purge job runs daily; emits a metric of records purged. | Must     | C-005  |

---

## Non-Functional Requirements

| Category              | Requirement                                                                                                                                                                         | Source                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Performance           | NFR-001 — OCR processing completes within 10 s for a 4 MB JPEG on cold Lambda.                                                                                                      | research/codebase + portfolio §8 |
| Performance           | NFR-002 — Photo uploads use pre-signed S3 PUT URLs; API never proxies binary payloads.                                                                                              | spec.md (legacy), S-002          |
| Security / Compliance | NFR-003 — Circle membership changes are audit-logged (S-004 compliance).                                                                                                            | S-004                            |
| Accessibility         | NFR-004 — All correction-screen UI exposes accessible names (`getByRole` / `getByLabel`); WCAG 2.1 AA.                                                                              | research/ux-patterns             |
| Conventions           | NFR-005 — API paths under `/api/v1/*` (S-001); Node 24.x runtime (S-003).                                                                                                           | portfolio §8                     |
| Scalability           | NFR-006 — SQS-backed OCR queue handles ≥ 20 concurrent jobs/user without UI block; queue depth + DLQ alarmed.                                                                       | research/tech-stack              |
| Scalability           | NFR-007 — Outlier alarm fires within 1 h of a Circle exceeding 100 members or a user owning ≥ 25 Circles (C-003 / FR-034).                                                          | C-003                            |
| Privacy               | NFR-008 — Daily purge job removes `raw_ocr_json` for jobs older than 90 days; metric `digitization.raw_ocr.purged.count` non-zero whenever eligible records exist (C-005 / FR-036). | C-005                            |

## NFR Measurement Contract

| NFR                           | How to Measure                                                                                                    | Signal / Query                                                                                                 | Threshold                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| NFR-001 (OCR latency)         | Lambda Duration metric on `digitization-ocr`; instrumented with cold/warm tag.                                    | CloudWatch metric `Duration` filtered by `cold=true` p95.                                                      | p95 ≤ 10 s for 4 MB inputs                   |
| NFR-002 (no proxied payloads) | Static check on API handlers + presence of `multipart/form-data` rejection in `digitization-api`.                 | Unit test asserting handler returns 400 for binary body; CI lint rule.                                         | 100% conformance                             |
| NFR-003 (audit log)           | Every `Circle` membership-change endpoint emits an audit log entry.                                               | Sentry/Logger structured event `circle.membership.changed` with `actor`, `circle_id`, `target_user`, `action`. | 1 entry per state change                     |
| NFR-004 (a11y)                | axe-core in CI for web; Detox + accessibility inspector for mobile; manual VoiceOver/TalkBack pass.               | axe-core 0 violations on correction + circle screens; manual checklist signed off.                             | 0 critical/serious violations                |
| NFR-005 (path/runtime)        | CI lint on routes; `engines.node` check in `package.json`.                                                        | grep for non-`/api/v1/` routes; `node -v`.                                                                     | 100% conformance                             |
| NFR-006 (queue scale)         | SQS `ApproximateNumberOfMessagesVisible` and DLQ depth; Lambda concurrency.                                       | CloudWatch alarms at ≥ 1000 backlog or any DLQ message.                                                        | DLQ = 0; backlog < 1000                      |
| NFR-007 (Circle outliers)     | Scheduled query against `circle_members` aggregate counts.                                                        | Alarm `circles.outlier.detected` when any Circle ≥ 100 members or any user ≥ 25 Circles owned.                 | Alarm fires within 1 h of breach             |
| NFR-008 (raw OCR purge)       | Daily Lambda/cron job sweeps `digitization_jobs` where `created_at < now() - 90d` and `raw_ocr_json IS NOT NULL`. | Metric `digitization.raw_ocr.purged.count`; structured log per run.                                            | 0 jobs older than 90 d retain `raw_ocr_json` |

---

## Technical Context

> Detailed analysis: [research.md § Codebase Analysis / Tech Stack](./research.md)

### Integration Points

- **Auth (002)** — every endpoint validates a Clerk session token; `user_id` derived from `sub`.
- **Recipe entity (001)** — `POST …/jobs/:id/save` writes a new `Recipe` row (owned by 001) and stores `recipe_id` on the job.
- **Sibling 004** — coordinate save semantics; 004 owns the structured/URL path; 011 owns the photo path.
- **Future 010** — optional entitlement check on enqueue (Q-002, deferred).

### Reusable Components

- S3 + CloudFront infra and pre-signed URL helpers from 001.
- Drizzle ORM + `pg` (node-postgres) conventions from 001.
- `@nestjs/config` Zod env loader and `class-validator` DTO patterns from 001.
- SQS queue+DLQ pattern from 001's version-archive queue.
- `@sentry/aws-serverless` + `@aws-lambda-powertools/logger` from 002 Lambdas.

### New Modules Required

| Package                             | Group        | Purpose                                                                                            |
| ----------------------------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| `@kitchensink/digitization-workers` | digitization | Lambda — receives S3 key, runs Textract OCR + handwriting, returns structured JSON.                |
| `@kitchensink/digitization-service` | digitization | NestJS module — `DigitizationJob` CRUD, pre-signed URL minting, correction save.                   |
| `@kitchensink/circles-service`      | circles      | NestJS module — `Circle` entity, members, invitations, audience resolution.                        |
| `@kitchensink/audience`             | shared       | Shared lib — exports `AudienceScope` enum + `Audience` shape (S-004). Imported by 001 / 006 / 007. |

### Data Model Impact

New tables (PostgreSQL 16, Drizzle): `circles`, `circle_members` (PK = `circle_id, user_id`), `circle_invitations`, `digitization_jobs`. S3 layout: `digitization/{user_id}/{job_id}/original.{ext}` (separate prefix from 001's `recipes/{recipe_id}/...`).

### Tech Stack Notes

- Node 24.x runtime (S-003) including the OCR Lambda.
- NestJS 11; paths under `/api/v1/*` (S-001).
- Drizzle ORM + `pg`; Sharp not required here (no image transformation; Textract takes the raw upload).
- AWS Textract default OCR provider; Q-001 (provider tradeoff) deferred to implementation.
- SQS for async OCR; DLQ + visibility timeout owned by ops (Q-009 deferred).

### Codebase Constraints

| Constraint                                                                                                  | Source         | Impact                                                                               |
| ----------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| Pre-signed S3 PUT for binary; API never proxies binary.                                                     | NFR-002, S-002 | API just mints the URL; client uploads direct to S3, then notifies via job ID.       |
| `/api/v1/*` route prefix enforced.                                                                          | S-001          | All new endpoints scoped under `/api/v1/recipes/digitize/*` and `/api/v1/circles/*`. |
| `@kitchensink/{group}-{name}` package naming.                                                               | S-002          | New packages must follow naming.                                                     |
| Audit logging required for membership changes.                                                              | NFR-003, S-004 | `circles-api` emits structured events on every membership-state change.              |
| `audience` field uses `{ scope, ref_id? }` shape (GR-014 v3.0.0; `price_cents` is `published-lesson`-only). | S-004          | `circle` scope ⇒ `ref_id = Circle.id`; defined in `@kitchensink/audience`.           |

---

## Consumer Contract

> Included because **FEATURE_TYPE = shared_infrastructure**. 011 owns `Circle`, the `circle` audience scope, and `@kitchensink/audience` — consumed by 001 / 006 / 007.

### How consumers depend on this feature (GR-015 — read before the Public API block)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md).

011 owns two deployable services, so it owns **two** wire contracts, and both halves of GR-015 apply:

- **The service half.** `@kitchensink/digitization-service` and `@kitchensink/circles-service` each **author**
  their wire shapes as zod at `src/**/*.schema.ts` beside the controller that serves them, **validate their own
  requests with that same zod** (`nestjs-zod` `createZodDto`), and each generates a committed
  `@kitchensink/schema-digitization` / `@kitchensink/schema-circles` package exporting the zod, `z.infer` types,
  a `contractHash.ts`, and a **derived** `openapi.yaml` (outbound only — for `oasdiff`, docs and integrators,
  never a codegen input).
- **The client half — separately mandatory.** Every consumer, whether it is `@commise/web`, `@commise/mobile`,
  a feature package, or **another service (001 / 006 / 007)**, imports its wire types **and zod** from those
  schema packages and **declares no request or response body shape of its own**. Where a consumer's shape
  genuinely differs it is **DERIVED** with `Pick` / `Omit` / `Partial` over the wire type, never independently
  declared (reference: `packages/apps/commise/features/recipes/src/filters/model.ts`). A consumer that
  hand-writes a `Circle` response or the `error_code` union is the failure GR-015 exists to prevent — it drifts
  silently and `typecheck` reports agreement between two representations that were never compared.
- **Drift gates** are inherited from GR-015 §15-c, all three, per service — turbo `inputs` rebuild, a
  regenerate-and-diff CI gate, and a `CONTRACT_HASH` boot assertion. The last one is what catches circles being
  deployed ahead of 001/006/007's pinned schema, since those ship independently.

⚠️ **A consumer MUST NOT depend on `@kitchensink/circles-service` itself.** The `CirclesService` interface below
describes the **capability**, not the dependency edge. Importing the deployable service package is ADR-0014's
rejected alternative 2 — it drags NestJS, Drizzle and the AWS SDK into web, mobile and every consuming service,
and inverts the build order. Consumers depend on **`packages/clients/circles` + `@kitchensink/schema-circles`**.
This corrects _Acceptance Criteria_ item 2, which says 001 "imports `@kitchensink/circles-service`".

✅ **`@kitchensink/audience` is unaffected and stays exactly as specified.** It is a **type-only domain**
package on the GR-007 axis — not a wire contract. A schema package **reuses** it `import type` and never
re-declares `Audience` or `AudienceScope`; re-declaring them to make a schema package literally
dependency-free would manufacture the very drift GR-015 prevents.

⚠️ **The OCR provider is the OPPOSITE case (GR-015 §15-d) — do not converge it.** Textract (and any future OCR
provider behind `ocr-provider.interface.ts`) is an API we do **not** serve. Its adapters **validate the raw
upstream response at the boundary with zod** and **may declare their own types**; no OpenAPI document is written
for it, and its shapes never enter `@kitchensink/schema-digitization`. `packages/clients/usda` is the reference
implementation. Deleting those boundary schemas in the name of convergence removes the parse standing between a
user-supplied photograph's extracted text and the recipe write path — a security regression, not a cleanup.

### Input validation — where that zod RUNS (GR-016)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15.4](../../docs/CODING_STANDARDS.md) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md). Full bindings:
[`plan.md` → _Input validation (GR-016)_](./plan.md#input-validation-gr-016--two-services-so-two-of-everything).
The section above decides who **authors** the contract; this one is where it is **enforced**. It adds no FR
(GR-003) — FR-027/FR-028's payload constraints and FR-030's error contract already exist; GR-016 states where
they run.

- **Each of 011's two services carries the obligation independently**: one validation mechanism
  (`createZodDto` + **`nestjs-zod`'s** `ZodValidationPipe`), one `400` path emitting the Problem Details
  envelope, every body/path/query parsed — including `/circles/join/:token`, where the invitation token is path
  data.
- **⛔ The save path reaches a storage floor authored by feature 001.** `POST .../jobs/:id/save` persists a
  recipe, and five int-backed recipe fields (`servings`, `prepTimeMinutes`, `cookTimeMinutes`,
  `totalTimeMinutes`, `timerSeconds`) write `integer` (`int4`) columns capped at **2,147,483,647**. On this
  feature those values came out of **a photograph of an arbitrary page**, so they are bounded before the write —
  a `400`, never a failed `INSERT`. The floor is **asserted, never derived**: no zod generated from Drizzle, no
  storage type imported into a `*.schema.ts`.
- **The OCR boundary parse is REQUIRED, not optional.** The paragraph above permits the adapters to own their
  types; GR-016 makes the parse mandatory before any extracted block, geometry or confidence value reaches a job
  result.
- **Async and callback ingress are in scope** — the job worker parses its queue payload, and any provider
  completion callback gets **authentication first, then schema validation**, because a signature proves
  **origin, not shape**.
- **Circles' three service consumers (001, 006, 007) validate in both directions** — outbound bodies against
  `@kitchensink/schema-circles` before the call, responses on receipt. "Internal" is not a synonym for
  "trusted".
- **⛔ Response validation is DEFERRED** by owner decision (GR-016 §16-g). Do not add server-side response
  parsing to either service.

### Public API

```typescript
// @kitchensink/circles-service — public surface for downstream features
export interface CirclesService {
    // Resolve audience for a shareable entity. 001/006/007 use this when listing
    // resources scoped to `circle` audience.
    listCirclesForUser(userId: string): Promise<Circle[]>;
    isMember(circleId: string, userId: string): Promise<boolean>;
    resolveAudience(audience: Audience, viewerUserId: string): Promise<{ allowed: boolean; reason?: string }>;
}

// @kitchensink/audience — type-only export consumed by 001/006/007
export enum AudienceScope {
    Private = 'private',
    Circle = 'circle',
    PublicProfile = 'public-profile',
    PublishedLesson = 'published-lesson',
}
export interface Audience {
    scope: AudienceScope;
    ref_id?: string;
    // `price_cents` REMOVED 2026-08-02 per GR-014 v3.0.0 — recipes are not purchasable.
    // A price belongs only on a `published-lesson` audience (013 courses).
}
```

### Consumer Utilities

| Utility                             | Purpose                                                                                                            | Usage                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `AudienceGuard` (NestJS guard)      | Enforces `audience` access on a controller route.                                                                  | `@UseGuards(AudienceGuard)` on any handler returning a shareable entity. |
| `audienceQueryFilter(viewerUserId)` | Returns a Drizzle `where` clause that filters resources to those visible to `viewerUserId` across all four scopes. | `db.select().from(recipes).where(audienceQueryFilter(userId))`           |

### Fallback Behaviour

| Failure Mode                           | What Consumers Receive                                                                                                                                                    | Consumer Action Required                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `circles-api` unavailable              | `resolveAudience` throws `ServiceUnavailableError`; `audienceQueryFilter` excludes `circle`-scoped rows.                                                                  | Degrade: hide circle-scoped content; show user-facing "sharing temporarily unavailable".                                                                 |
| User has no Circles                    | `listCirclesForUser` returns `[]`                                                                                                                                         | Audience picker shows `Private` + `Public Profile` only.                                                                                                 |
| Membership stale (member just removed) | `isMember` returns `false`; `resolveAudience` returns `{ allowed: false, reason: 'not-a-member' }`.                                                                       | Return 403 with `error_code: 'circle.access.denied'`.                                                                                                    |
| Circle deleted (FR-033, C-002)         | All matching recipes are rewritten to `audience: { scope: 'private' }` synchronously with the deletion; consumers reading by `audience` see them as private to the owner. | No special handling; resource appears Private to the owner and 404 to all others. Audit events `circle.deleted` + `recipe.audience.changed` are emitted. |
| Owner account deleted (FR-035, C-004)  | Oldest non-owner member is promoted to owner; if none, Circle is soft-deleted (see row above).                                                                            | Consumers continue to call `resolveAudience`; new `Circle.owner_id` is reflected immediately.                                                            |
| `shared-audience` schema bump          | Type change is a major version.                                                                                                                                           | Consumers must pin and update; coordinated via portfolio rollout.                                                                                        |

### Integration Pattern

```typescript
// Consumer (e.g. 001 recipe read):
const audience: Audience = recipe.audience;
const decision = await this.circlesService.resolveAudience(audience, viewerUserId);
if (!decision.allowed) throw new ForbiddenException({ error_code: 'circle.access.denied', detail: decision.reason });
return recipe;
```

---

## Acceptance Criteria

The feature is complete when:

1. All Must Have user stories (US-001, US-002, US-003, US-004, US-005, US-006) are implemented and pass their independent tests.
2. The four new packages exist, follow `@kitchensink/{group}-{name}` naming, and 001 imports `@kitchensink/audience` + `@kitchensink/circles-service` for `circle` audience resolution.
3. NFR-001 (OCR p95 ≤ 10 s) and NFR-006 (queue health) verified via CloudWatch dashboards.
4. NFR-004 (WCAG 2.1 AA) passes axe-core in CI with 0 critical/serious violations + a manual VoiceOver/TalkBack pass on the correction + Circle invite flows (Q-007 protocol deferred to test-plan).
5. Audit logging on Circle membership changes verified by integration test (NFR-003).
6. Consumer Contract validated by a smoke test from 001 calling `circlesService.resolveAudience` against a seeded Circle.

---

## Success Metrics

> Full metrics definition: [product-spec/product-spec.md § Success Metrics](./product-spec/product-spec.md) and [research.md § Metrics & ROI](./research.md).

Primary KPI: **OCR parse quality** — Target: ≥ 70 % of submissions produce title + ≥ 3 ingredients without manual correction (Baseline: n/a — new feature).

| Metric                                         | Target                   |
| ---------------------------------------------- | ------------------------ |
| SC-001 OCR parse quality                       | ≥ 70 % of submissions    |
| SC-002 Median import-to-save time              | < 3 min                  |
| SC-003 Circle invite acceptance rate (48 h)    | > 60 %                   |
| Recipes digitised per active Sage / month      | ≥ 5                      |
| Circle-shared recipes with ≥ 2 non-owner views | ≥ 50 % of shared recipes |

---

## Testing Specification

### Coverage Targets

| Module / Service                             | Target Coverage            | Test Type               |
| -------------------------------------------- | -------------------------- | ----------------------- |
| `@kitchensink/digitization-service`          | ≥ 85 %                     | unit + integration      |
| `@kitchensink/digitization-workers` (Lambda) | ≥ 80 %                     | unit (handler + parser) |
| `@kitchensink/circles-service`               | ≥ 90 % (security-critical) | unit + integration      |
| `@kitchensink/audience`                      | 100 % (type + guard)       | unit                    |

### Critical Test Cases

| #      | Scenario                              | Input                                                                | Expected Output                                                                                                                                  | Type        |
| ------ | ------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| TC-001 | Photo upload happy path               | Clear printed recipe card JPEG ≤ 4 MB                                | `DigitizationJob.state` transitions `pending → processing → awaiting-correction`; `parsed_json.title`, `ingredients[≥1]`, `steps[≥1]` populated. | integration |
| TC-002 | Reject oversize photo                 | 25 MB JPEG                                                           | API returns 400 + RFC 7807 problem with `error_code: digitization.image.too_large`; no S3 PUT URL minted.                                        | unit        |
| TC-003 | Low-confidence flag round-trip        | OCR result with confidence < 0.6 on 2 tokens                         | `parsed_json` flags exactly those 2 tokens; correction screen renders icon + colour markers (FR-025).                                            | integration |
| TC-004 | Circle access denied for non-member   | Recipe `audience: { scope: 'circle', ref_id }`; viewer not in Circle | 403 with `error_code: circle.access.denied`; no recipe data leaked.                                                                              | integration |
| TC-005 | Circle invite accept (idempotent)     | Same invitation token accepted twice                                 | First accept = 200; second accept = 200 (no-op) and membership row stays unique.                                                                 | integration |
| TC-006 | Audit log on member removal (NFR-003) | Owner removes a member                                               | One structured `circle.membership.changed` event with `action: 'removed'` is emitted within 1 s.                                                 | integration |
| TC-007 | Bulk import batch wiring              | 3 photos in one session                                              | 3 `DigitizationJob` rows share a `batch_id`; queue UI shows "3 pending → 2 → 1 → 0".                                                             | integration |
| TC-008 | Async OCR non-blocking                | Upload triggers SQS enqueue                                          | API returns 202 with `job_id` in ≤ 300 ms; Lambda processes off-thread.                                                                          | integration |

### E2E Scenarios

| TC-ID      | Scenario                                              | Entry Point                            | Exit Condition                                                                                                              |
| ---------- | ----------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| TC-E2E-001 | Sage digitises a printed card end-to-end              | Recipe library "Import from photo" tap | `Recipe` row exists, visible in library, original photo retrievable from CloudFront.                                        |
| TC-E2E-002 | Sage creates a Circle, invites Riley, shares a recipe | Sharing settings "New Circle"          | Riley (second authenticated session) sees the recipe in her Circle list and can read it; a third user cannot.               |
| TC-E2E-003 | Bulk import of 5 cookbook pages                       | Bulk-mode picker                       | All 5 jobs reach `awaiting-correction`; Sage saves 4, discards 1; saved photos retained, discarded photo retained for 30 d. |
| TC-E2E-004 | Accessibility — Circle invite via VoiceOver only      | iOS VoiceOver session                  | Invitation accepted using only screen reader + keyboard; flow completes without trapped focus.                              |

---

## Risks

| Risk                                                                | Impact                                                       | Mitigation                                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handwriting OCR accuracy on aged paper falls below SC-001 threshold | High — kills heritage-archivist value prop                   | Q-003 sets ship threshold at test-plan time; provider trade-off (Q-001) explored before FR-006 implementation; correction UX absorbs marginal cases.                                                                            |
| Textract cost per job exceeds budget at scale                       | Medium — financial                                           | Per-user job cap (Q-002) routed through 010 entitlement once available; cost dashboard + per-user budget alarm.                                                                                                                 |
| `Circle` schema regret blocks 001 / 006 / 007                       | High — cross-feature blast radius                            | `@kitchensink/audience` versioned independently; Consumer Contract above pins the public surface; integration test from 001 in CI.                                                                                              |
| SQS DLQ build-up during incident                                    | Medium — silent failure                                      | NFR-006 alarms at any DLQ message; runbook owned by ops (Q-009 deferred).                                                                                                                                                       |
| Accessibility regressions on the correction screen                  | High — NFR-004 hard requirement                              | axe-core in CI; manual VoiceOver/TalkBack pass before each release (Q-007 protocol).                                                                                                                                            |
| Photo retention policy disputes                                     | Medium — legal/storage cost                                  | ⚠️ **Superseded 2026-08-16 (amendment §A-3):** every in-flight artifact is reaped at 72 h regardless of job state, so neither the 30-day discard default nor a separate saved-job retention question survives. Q-005 is closed. |
| Reusable invitation link leaks (C-001 / FR-031)                     | Medium — unauthorised join                                   | Token must be ≥ 128 bits of entropy, opaque, served over HTTPS only; rotation invalidates leaked token; rate-limit `POST /api/v1/circles/join/:token` per IP and per user.                                                      |
| Unbounded Circle / member growth (C-003 / FR-034)                   | Medium — cost + UX degradation                               | NFR-007 outlier alarm; ops review on alarm; introduce hard caps in a follow-up if abuse signals appear.                                                                                                                         |
| Owner-deletion ownership transfer race (C-004 / FR-035)             | Low — wrong owner promoted under concurrent membership churn | Promotion runs in the same DB transaction as account-deletion finalisation in 002; idempotent on retry.                                                                                                                         |

---

## Wireframes Reference

> Visual wireframes were not produced in the bootstrap pass; `product-spec/wireframes*` is intentionally absent. UX flows are documented as described screens in [research.md § UX Patterns](./research.md).

Key screens (described, not drawn):

- **Recipe library — "Import from photo" entry point** — single tap launches camera/picker.
- **Correction screen** — split layout (left: pinch-to-zoom photo; right: editable parsed fields with low-confidence highlights).
- **Bulk queue tray** — top-right queue icon with pending count; auto-advances on save.
- **Circles tab** — list of owned + joined Circles; "New Circle" action; per-Circle member list with rename + invite + remove.
- **Audience picker** — `Private` / each named Circle / (future) `Public Profile`.

A wireframes pass is recommended as part of `pre-impl-review` if visual fidelity becomes a risk.

---

## Open Questions

All nine product-spec open questions were **deferred to implementation** by user directive (see [review.md](./review.md)). Implementation phases (`plan`, `tasks`, `pre-impl-review`) own the resolution:

| #     | Question (abridged)                                  | Owner phase                                                                                                                                 |
| ----- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-001 | OCR provider — Textract vs. Google Vision vs. hybrid | `plan` (defaults to Textract)                                                                                                               |
| Q-002 | Subscription gating vs. monthly cap                  | `plan` (defaults to ungated until 010)                                                                                                      |
| Q-003 | Handwriting accuracy ship threshold                  | `test-plan` / V-Model acceptance                                                                                                            |
| Q-004 | Launch language matrix                               | `plan` (Latin-script default)                                                                                                               |
| Q-005 | Retention policy for S3 + `raw_ocr_json`             | ✅ **CLOSED 2026-08-16** — amendment §A-3: a 3-day reaper over every in-flight artifact, on ADR-0016's window. The 90-day purge is subsumed |
| Q-006 | 011 ↔ 012 Circle handoff timing                      | `plan` (cross-feature contract)                                                                                                             |
| Q-007 | A11y certification protocol (axe vs. manual)         | `test-plan`                                                                                                                                 |
| Q-008 | Mobile vs. web feature parity at launch              | `plan`                                                                                                                                      |
| Q-009 | SQS visibility timeout / DLQ / alarm config          | `pre-impl-review` (Operations)                                                                                                              |

---

## Amendment (2026-08-16) — on-device-first OCR, the escape hatch, the reaper, and the single-writer invariant

Four changes. Two come from decisions recorded elsewhere that name 011 explicitly (ADR-0019 §4, ADR-0016's
window); two are 011's own design, and they are here rather than in `plan.md` because they change what the
feature promises a user, not merely how it is built.

### A-1. OCR runs ON THE DEVICE FIRST; the cloud is the fallback

011's OCR was specified cloud-only: upload to S3, enqueue, Textract, poll. That is now the **second** tier.
The first is the platform's own text recognizer — Vision on iOS, ML Kit on Android — run on the captured
image **before any upload**. When it produces a usable parse, the photograph **never leaves the device**, and
no OCR is billed.

**Escalation to the cloud is by CAPABILITY, not by score**: no recognizer available, an unsupported script, a
device-side failure, or the user asking for it (§A-2). A confidence threshold MAY route a low-confidence
result to the cloud as well, but MUST NOT be the only path there — §A-2 explains why that would be a blind
spot rather than a policy.

⛔ **A device result is still untrusted input.** It is validated with zod at the service boundary exactly as a
cloud result is (GR-016). Our code produced it, but on hardware the user controls; a client that can post
arbitrary "OCR output" can post arbitrary recipe content. And an **absent confidence MUST be rejected, never
defaulted to `0`** — a sentinel confidence passes the quality gate silently. Both rules are inherited from the
OCR channel 011 took over from 004, not re-derived here.

### A-2. ⛔ The manual "re-run in the cloud" escape hatch is REQUIRED, because the heuristic has a blind spot

**The failure mode, named so it is not optimised away: a confidence heuristic cannot catch a result that is
WRONG BUT CONFIDENT.**

Confidence measures how certain the recognizer is that it read the **glyphs** correctly. It says nothing about
whether it read the **right** glyphs. A recognizer that confidently reads `1 tsp salt` as `1 tbsp salt`, or
that never sees a line and therefore never reports low confidence in it, returns a **high** score for a wrong
answer. Every automatic quality path in this feature — the low-quality state, the low-confidence highlighting,
the escalation threshold — keys off that score. So every automatic path is blind to this class by
construction, and no amount of tuning the threshold reaches it.

The user is the only detector. Therefore:

- The correction screen MUST carry an **always-available** control that re-runs OCR on the cloud tier.
- ⛔ It **MUST NOT be gated on a low-confidence condition.** That gate is exactly the blind spot: the results
  that need it most are the ones the system scored highest.
- It is **not** an error affordance. It is offered on a job the system considers a complete success.
- A re-run replaces the parse in place, preserves corrections the user has already made, is idempotent per
  attempt, and is rate-limited. It creates no second job and no second recipe.

Accepted consequence, stated rather than hidden: a user who does not notice the error does not press the
button, and a wrong-but-confident parse can be confirmed. Nothing in this design detects that. What the
escape hatch guarantees is that a user who **does** notice has a remedy other than retyping the recipe.

### A-3. A 3-day reaper over in-flight jobs and artifacts, on ADR-0016's window

Moving 011's state out of a database (`plan.md` §Data Model item 4 — the image-processing service owns none)
gives every artifact a lifetime it did not previously have. A scheduled sweep MUST delete every object under
`digitization/{user_id}/{job_id}/` older than **72 hours**, in whatever state its job is in, with an S3
lifecycle rule as the backstop.

**Why three days, and why it is not a new number.** It is
[ADR-0016](../../docs/architecture/decisions/0016-notification-retention-payload-dedup-and-valkey.md)'s
window — its title, its §2 (`expiresAt = publishedAt + 72h`), and its **2026-08-16 amendment**, whose store
table gives the **message substrate** a "3-day TTL, reaped". 011's per-job status messages live in that
substrate and expire with it. An artifact that outlived the messages describing it would be unreachable
state: the photograph is still there, and nothing is left to tell any consumer it exists. One window, not two.

⛔ **Nothing refreshes the clock.** Not a retry, not a poll, not the user reopening the correction screen. The
72 hours are a promise about how long an artifact **lives**, not a budget inactivity can top up — ADR-0016 §2
states the identical rule for a notification, for the identical reason: a refreshable expiry has no bound.

⚠️ **Reaping is a user-visible outcome, not a silent cleanup.** A job still awaiting correction at 72 hours
loses its photo and its parse. The UI MUST say so in localized copy, before and after; a job that simply
vanishes reads as data loss. A **submitted** job is unaffected — its recipe belongs to the recipe service and
no reaper of 011's touches it.

**What this replaces.** FR-036's 90-day `raw_ocr_json` purge had a table to null out and no longer does. The
reaper is **strictly stronger** — nothing survives three days to reach ninety — so FR-036's data-minimisation
intent is satisfied a priori and only its mechanism is withdrawn. Q-005 (retention policy for S3 +
`raw_ocr_json`) is **closed by this section**.

### A-4. ⛔ SINGLE WRITER PER GROUP — the invariant that makes timestamp selection safe

ADR-0019 §4 as amended assigns this statement to 011 by name. Selection of "the current message for an entity"
is **consumer-side: most-recent-by-timestamp wins**, and the envelope carries **no sequence** — a
fire-and-forget producer cannot issue one, and with producers running concurrently in more than one task there
is no single writer of "the last sequence I used".

That rule is correct **only while one writer produces a group's messages.** Two concurrent writers for one
entity can stamp out of order relative to their true sequence, and most-recent-wins would then pick the loser.

**011 satisfies it, and here is the argument rather than the assertion.** A digitization job is created by one
request, carries one job id, is processed by one worker invocation, and publishes under the group key
`('import', jobId)`. No other producer writes that group: 004's URL and text channels own their own entities,
and food's resolution pipeline is the single writer for a food. The one thing that could have broken it is
§A-2's re-run — so re-runs are **sequential and idempotent per attempt**, never concurrent. That is not a
convenience; it is what keeps this invariant true, and it is why the test that proves it is a **concurrency**
test rather than an assertion about a comment.

**A future producer that shares a group with another writer MUST NOT rely on this rule.** It needs its own
ordering discipline, and adding one is a decision, not an implementation detail.

### A-5. Submission classifies `imported_paid`, never `imported_physical`

Recorded here because it is the one place the premium gate could quietly lose its enforcement point.

011 does not create recipes. It submits corrected candidates to **004's bulk import contract**
(`004-FR-047`), and 004's convergence point creates them. The `sourceType` 011 declares is **`imported_paid`**.

**Why not `imported_physical`, which is what a photograph of a cookbook literally is.** A client-declared
`imported_physical` is **not representable** in 004's DTO (`004-FR-025`, HAZ-057): a caller that could declare
it would grant itself a private recipe the C-004 policy reserves for premium. `imported_paid` is therefore the
only non-public class a client is permitted to declare at all.

**The gate is not weakened by the substitution.** Under the shipped `evaluateVisibility`, `imported_physical`
and `imported_paid` are behaviourally identical: both are **private-only**, and `imported_paid` may _never_ be
made public. The premium gate keeps its enforcement point — 004's convergence point, where provenance and
quota are enforced once for every channel — rather than moving into 011 where it would have to be re-derived.
