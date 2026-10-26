# Data Model: Content Source Check

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-26 (revised after the owner's Q1
and Q2 rulings)

Every table here is new and lives in the **recipe** database (`kitchensink_recipe`), owned by `recipe_owner` with
grants from its default privileges (ADR-0039). Migrations are expand-first (ADR-0035). No name collides with a
shipped table (checked against `packages/services/recipe-service/src/database/schema` on 2026-10-26, GR-021).

## 0. The digest: a one-way door

`checked_content_digest` is SHA-256 over a canonical serialisation of the checked content, prefixed with a digest
version: `v1:` + hex. The canonical form is, in order:

1. title, description, tags (sorted), each ingredient's raw source line in line order, and each step's instruction in
   step order. Each part is Unicode NFKC-normalised with whitespace collapsed.
2. the **sorted** set of `content_sha256` values of the recipe's uploaded photos (section 1). Sorted, so reordering
   photos changes nothing (spec US6).

Parts are joined with a separator that cannot occur in normalised text.

- The field list, the normalisation and the hash are versioned by the prefix. Changing any of them is a new version,
  never an edit of `v1`. An edit makes every stored digest stale at once.
- The digest is computed by ONE pure function in `recipe-core` (`checkedContentDigest`), used by recipe-service on write
  and by the worker on read. A second implementation is a defect.

## 1. New columns on shipped tables

```sql
ALTER TABLE recipes ADD COLUMN checked_content_digest text NULL;
ALTER TABLE recipe_photos ADD COLUMN content_sha256 text NULL;
ALTER TABLE recipe_photos ADD COLUMN check_key text NULL;
```

- `recipes.checked_content_digest` is written only by recipe-service, in the same transaction as any write that changes
  the checked content: a text edit, or a photo confirmed or deleted.
- `recipe_photos.content_sha256` is the SHA-256 of the stored bytes. The upload's confirm step computes it. That step
  already reads the bytes to make the thumbnail, so this adds no new read.
- `recipe_photos.check_key` is the object key of the photo's **check rendition**: a copy at a fixed maximum size,
  made with `sharp` at confirm beside the thumbnail, under the same owner erasure prefix (research R-07). The worker
  sends it to the model. NULL means the rendition failed, and the check then reads `unchecked` (`checkFailed`).
- All three are NULL on rows written before the columns existed. Nothing is live, so no backfill is planned.

## 2. `source_check_evidence_sets` and `source_check_evidence_items`: shared evidence

Evidence for one version of checked content, under one rule set and one model. Shared by every recipe with that
content. **No user id, no recipe text and no photo.** Retained through erasure under a `RETAINED_BY_RULING` entry with
its columns pinned (ADR-0027 precedent).

```sql
CREATE TABLE source_check_evidence_sets (
    id                text        PRIMARY KEY,               -- ULID
    content_digest    text        NOT NULL,
    rule_set_version  text        NOT NULL,
    model_id          text        NULL,                      -- NULL when the model did not run on all content
    model_run         text        NOT NULL,
    photo_count       integer     NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT source_check_evidence_sets_model_run_check
        CHECK (model_run IN ('ran', 'budgetSpent', 'tooLong', 'failed')),
    CONSTRAINT source_check_evidence_sets_model_iff_ran
        CHECK ((model_run = 'ran') = (model_id IS NOT NULL)),
    CONSTRAINT source_check_evidence_sets_photo_count_range
        CHECK (photo_count BETWEEN 0 AND 10)                     -- MAX_RECIPE_PHOTOS
);

CREATE UNIQUE INDEX source_check_evidence_sets_ran_key
    ON source_check_evidence_sets (content_digest, rule_set_version, model_id)
    WHERE model_run = 'ran';

CREATE TABLE source_check_evidence_items (
    evidence_set_id   text     NOT NULL REFERENCES source_check_evidence_sets (id) ON DELETE CASCADE,
    ordinal           integer  NOT NULL,
    kind              text     NOT NULL,
    detector          text     NOT NULL,
    field             text     NOT NULL,
    span_start        integer  NULL,
    span_end          integer  NULL,
    photo_sha256      text     NULL,
    marker_text       text     NULL,                         -- a short marker that names no person (see below)
    PRIMARY KEY (evidence_set_id, ordinal),
    CONSTRAINT source_check_evidence_items_kind_check CHECK (kind IN (
        'isbn', 'publisherImprint', 'copyrightNotice', 'pageReference',
        'paidSiteTemplate', 'citedPaidSiteHost', 'modelJudgement',
        'photoCopyrightText', 'photoWatermarkOrLogo', 'photoPrintedPage',
        'photoIsbnOrBarcode', 'photoPublisherName')),
    CONSTRAINT source_check_evidence_items_detector_check CHECK (detector IN ('rules', 'model')),
    CONSTRAINT source_check_evidence_items_field_check CHECK (field IN (
        'title', 'description', 'tags', 'ingredient', 'step', 'citation', 'photo')),
    CONSTRAINT source_check_evidence_items_photo_shape CHECK (
        (field = 'photo') = (kind LIKE 'photo%')
        AND (field = 'photo') = (photo_sha256 IS NOT NULL)
        AND (field <> 'photo' OR (span_start IS NULL AND span_end IS NULL AND detector = 'model'))
        AND (field = 'photo' OR (span_start IS NOT NULL AND span_end > span_start AND span_start >= 0))),
    CONSTRAINT source_check_evidence_items_marker_length
        CHECK (marker_text IS NULL OR char_length(marker_text) <= 200),
    CONSTRAINT source_check_evidence_items_no_free_text_marker
        CHECK (marker_text IS NULL OR kind NOT IN ('copyrightNotice', 'modelJudgement') AND field <> 'photo')
);
```

- **Text items are proven; photo items never are.** A model quote that code did not find in the text is counted in a
  metric and never written. Code cannot prove a photo item at all, so the outcome function treats every photo kind as
  "for a person" (spec FR-006). The CHECK keeps photo items model-only and span-free.
- **Marker text names no person.** These rows are shared and outlive erasure, so they keep a marker only when its value
  comes from a list or a fixed pattern: an ISBN, a listed imprint, host or template, a page number. A copyright notice
  can name the cook ("© 2024 Jane Doe"), a model judgement quotes free text, and a photo can show anything, so for
  those kinds only the field and position are kept.
- `citedPaidSiteHost` has `field = 'citation'`. The citation is not checked content and is never sent to the model.
  The rules read it.
- A set with `model_run <> 'ran'` is rule-only for at least part of the content, and nothing reuses it in place of a
  full model run. The unique index admits only `ran` sets, so a later run after the budget returns writes a new set.

## 3. `recipe_source_checks`: the per-recipe outcome

One row per recipe and digest. The read rule asks for a row for the recipe's **current** digest that `allows`.

```sql
CREATE TABLE recipe_source_checks (
    recipe_id           uuid        NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
    content_digest      text        NOT NULL,
    evidence_set_id     text        NULL REFERENCES source_check_evidence_sets (id),
    state               text        NOT NULL,
    outcome             text        NULL,
    reason              text        NULL,
    judged_source_type  text        NOT NULL,
    judged_cited_host   text        NULL,
    cleared_at          timestamptz NULL,
    cleared_by          text        NULL,
    cleared_decision_id text        NULL,
    allows              boolean     NOT NULL DEFAULT false,
    checking_since      timestamptz NOT NULL DEFAULT now(),
    decided_at          timestamptz NULL,
    PRIMARY KEY (recipe_id, content_digest),
    CONSTRAINT recipe_source_checks_state_check CHECK (state IN ('checking', 'decided')),
    CONSTRAINT recipe_source_checks_outcome_check
        CHECK (outcome IS NULL OR outcome IN ('clear', 'possible', 'detected', 'unchecked')),
    CONSTRAINT recipe_source_checks_reason_check
        CHECK (reason IS NULL OR reason IN ('budgetSpent', 'tooLong', 'checkFailed')),
    CONSTRAINT recipe_source_checks_decided_has_outcome
        CHECK ((state = 'decided') = (outcome IS NOT NULL AND evidence_set_id IS NOT NULL AND decided_at IS NOT NULL)),
    CONSTRAINT recipe_source_checks_reason_iff_unchecked
        CHECK ((outcome = 'unchecked') = (reason IS NOT NULL)),
    CONSTRAINT recipe_source_checks_cleared_by_check
        CHECK (cleared_by IS NULL OR cleared_by IN ('reviewer', 'curatorGrant')),
    CONSTRAINT recipe_source_checks_clearance_complete
        CHECK ((cleared_at IS NULL) = (cleared_by IS NULL)),
    CONSTRAINT recipe_source_checks_reviewer_clearance_cites_decision
        CHECK ((cleared_by = 'reviewer') = (cleared_decision_id IS NOT NULL)),
    CONSTRAINT recipe_source_checks_clearance_only_held
        CHECK (cleared_at IS NULL OR outcome IN ('possible', 'detected', 'unchecked')),
    CONSTRAINT recipe_source_checks_curator_not_detected
        CHECK (cleared_by IS DISTINCT FROM 'curatorGrant' OR outcome IN ('possible', 'unchecked')),
    CONSTRAINT recipe_source_checks_source_type_check
        CHECK (judged_source_type IN ('user_created', 'imported_public'))
);

CREATE INDEX recipe_source_checks_checking ON recipe_source_checks (checking_since) WHERE state = 'checking';
```

### `allows` is computed by one pure function, never by SQL

`allowsPublication(outcome, clearedBy)` in `recipe-core` is the only author of `allows`:

| Outcome     | `allows` is true when                                               |
| ----------- | ------------------------------------------------------------------- |
| `clear`     | always                                                              |
| `possible`  | `cleared_by` is `reviewer` or `curatorGrant` (spec FR-016, FR-003a) |
| `unchecked` | `cleared_by` is `reviewer` or `curatorGrant` (spec FR-020, FR-003a) |
| `detected`  | `cleared_by` is `reviewer` (an appeal overturned it)                |
| none yet    | never (`state = 'checking'`)                                        |

There is no cook confirmation. Nothing the cook does sets `allows` (owner ruling, 2026-10-26).

Four writes change an input: the worker's outcome, a reviewer's decision, the curator-grant clearance, and the
next-period re-check. Each recomputes `allows` in the same statement, with a compare-and-set on `(recipe_id,
content_digest, state)`. Two writers touch this row (recipe-service and the worker), and the digest key keeps either
from writing a stale verdict onto new content.

### The state machine

```text
(no row) ──save with public intent──▶ checking ──outcome lands──▶ decided
                                         │                          │
                                         └──24 h, retries spent──▶ decided (unchecked / checkFailed)

decided: reviewer clears (possible | unchecked | detected on appeal) ─▶ allows
         curator grant   (possible | unchecked)                       ─▶ allows
         re-check        (unchecked only)                             ─▶ decided again, new evidence set (spec FR-021)
         content changes                                              ─▶ a NEW row for the new digest; this one is history
```

The re-check is the only transition out of `decided` for the same digest that changes the outcome. It is allowed only
while `outcome = 'unchecked'`, by a compare-and-set on `(recipe_id, content_digest, state, outcome)`. A `clear` result
closes the open referral as `resolvedByCheck`. A `detected` result writes an `automatedHold` decision. A `possible`
result leaves the referral open.

## 4. `recipe_source_decisions`: the evidence of a hold or a person's decision

This row is the evidence of a decision (`016-FR-052`). It is kept for 016's period (`016-FR-052a`, 3 years from the
decision), and it survives the recipe's deletion and account erasure. It holds the opaque owner id and the short marker
text, never the recipe text or a photo.

```sql
CREATE TABLE recipe_source_decisions (
    id                   text         PRIMARY KEY,               -- ULID
    recipe_id            uuid         NOT NULL,                  -- opaque: no FK, it survives the recipe
    owner_id             varchar(255) NOT NULL,                  -- opaque app user id, as recipes.owner_id
    content_digest       text         NOT NULL,
    kind                 text         NOT NULL,
    automated_detection  boolean      NOT NULL,                  -- the evidence was found by automated means
    automated_decision   boolean      NOT NULL,                  -- the decision itself was automated
    decided_by           text         NULL,                      -- operator identity; NULL only when automated
    ground               text         NOT NULL,
    facts                jsonb        NOT NULL,                  -- evidence kinds, fields and marker text
    decided_at           timestamptz  NOT NULL,
    statement_in_app_at  timestamptz  NULL,
    statement_email_at   timestamptz  NULL,
    email_attempts       integer      NOT NULL DEFAULT 0,
    purge_after          timestamptz  NOT NULL,
    CONSTRAINT recipe_source_decisions_kind_check CHECK (kind IN (
        'automatedHold', 'referralCleared', 'referralHeld', 'auditRestriction')),
    CONSTRAINT recipe_source_decisions_person_unless_automated
        CHECK (automated_decision = (decided_by IS NULL)),
    CONSTRAINT recipe_source_decisions_only_detected_is_automated
        CHECK (automated_decision = (kind = 'automatedHold'))
);
```

- Two automated-means facts, because DSA Art. 17(3)(c) asks about both: was the content found by automated means, and
  was the decision taken by them. A person's hold after a check referral is `automated_detection = true`,
  `automated_decision = false`.
- The statement of reasons is derived from this row, as 016 derives its own from `notice_decisions`. It is issued for
  `automatedHold`, `referralHeld` and `auditRestriction`. Delivery is recorded per channel here, through 016's
  generalised delivery (research R-13).
- `purge_after = decided_at + 3 years`. 016's retention sweep honours it, and 016's legal holds can suspend it.

## 5. `recipe_source_referrals`: work for a person

One row per time a recipe is sent to a person. Deleted with the recipe and with account erasure. The decision it
produced lives on in `recipe_source_decisions`.

```sql
CREATE TABLE recipe_source_referrals (
    id               text        PRIMARY KEY,                     -- ULID
    recipe_id        uuid        NOT NULL,
    content_digest   text        NOT NULL,
    origin           text        NOT NULL,
    import_id        text        NULL,                            -- set when the recipe came from a bulk import
    cook_reason      text        NULL,                            -- the cook's own words on an appeal, ≤ 2,000 chars
    excluded_reviewer text       NULL,                            -- who made the hold being appealed (spec FR-026a)
    state            text        NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    due_at           timestamptz NOT NULL,
    decision_id      text        NULL REFERENCES recipe_source_decisions (id),
    FOREIGN KEY (recipe_id, content_digest)
        REFERENCES recipe_source_checks (recipe_id, content_digest) ON DELETE CASCADE,
    CONSTRAINT recipe_source_referrals_origin_check CHECK (origin IN ('check', 'appeal')),
    CONSTRAINT recipe_source_referrals_state_check CHECK (state IN (
        'shadow', 'open', 'cleared', 'held', 'withdrawn', 'superseded', 'resolvedByCheck')),
    CONSTRAINT recipe_source_referrals_person_decided_has_decision
        CHECK ((state IN ('cleared', 'held')) = (decision_id IS NOT NULL)),
    CONSTRAINT recipe_source_referrals_reason_only_on_appeal
        CHECK (cook_reason IS NULL OR origin = 'appeal'),
    CONSTRAINT recipe_source_referrals_reason_length
        CHECK (cook_reason IS NULL OR char_length(cook_reason) <= 2000)
);

CREATE UNIQUE INDEX recipe_source_referrals_one_open
    ON recipe_source_referrals (recipe_id, content_digest) WHERE state = 'open';
CREATE UNIQUE INDEX recipe_source_referrals_one_appeal
    ON recipe_source_referrals (recipe_id, content_digest) WHERE origin = 'appeal';
CREATE INDEX recipe_source_referrals_queue ON recipe_source_referrals (due_at) WHERE state = 'open';
```

- `due_at` is `created_at + 72 hours` for `origin = 'check'` and `+ 7 days` for `origin = 'appeal'` (spec FR-030).
  It is stored, not recomputed, so a later change of the target never moves an existing promise.
- `one_appeal` enforces spec FR-026a's "once per version of the content".
- `superseded`: the content changed while the referral was open. `withdrawn`: the cook set the recipe to draft or
  private, downgraded the label, or deleted it. `resolvedByCheck`: the next-period re-check returned `clear`.
- `import_id` lets the queue group one import's referrals (spec FR-030a).

## 6. `content_source_markers`: the rightsholder list

One list for 020 and for `004-FR-014`'s paywall blocklist (004 D-004, not yet built). A paid-site host is one fact,
so it is one row (research R-06).

```sql
CREATE TABLE content_source_markers (
    id               text        PRIMARY KEY,                  -- ULID
    kind             text        NOT NULL,
    value            text        NOT NULL,
    normalized_value text        NOT NULL,
    added_by         text        NOT NULL,
    added_at         timestamptz NOT NULL DEFAULT now(),
    added_reason     text        NOT NULL,
    retired_by       text        NULL,
    retired_at       timestamptz NULL,
    retired_reason   text        NULL,
    CONSTRAINT content_source_markers_kind_check CHECK (kind IN ('host', 'imprint', 'template')),
    CONSTRAINT content_source_markers_reason_present CHECK (char_length(btrim(added_reason)) > 0),
    CONSTRAINT content_source_markers_retire_complete
        CHECK ((retired_at IS NULL) = (retired_by IS NULL) AND (retired_at IS NULL) = (retired_reason IS NULL))
);

CREATE UNIQUE INDEX content_source_markers_live ON content_source_markers (kind, normalized_value)
    WHERE retired_at IS NULL;
```

- Entries are retired, never deleted, so the audit trail stays whole.
- `rule_set_version` (section 2) includes a digest of the live markers, so adding a publisher produces new evidence
  for new checks. It never changes an outcome already produced (spec FR-002).

## 7. `source_check_enforcement_events`: the blocking switch

Append-only. The latest row decides whether the read rule enforces holds.

```sql
CREATE TABLE source_check_enforcement_events (
    id              text        PRIMARY KEY,                   -- ULID
    mode            text        NOT NULL,
    actor           text        NOT NULL,
    reason          text        NOT NULL,
    evaluation_ref  text        NULL,                          -- the evaluation run that met SC-001 and SC-002
    staffing_ref    text        NULL,                          -- the named reviewers and hours that meet SC-011
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT source_check_enforcement_events_mode_check CHECK (mode IN ('shadow', 'blocking')),
    CONSTRAINT source_check_enforcement_events_blocking_cites_evidence
        CHECK (mode <> 'blocking' OR (evaluation_ref IS NOT NULL AND staffing_ref IS NOT NULL))
);
```

With no row, the mode is `shadow`. In shadow mode a referral that would be made is written with `state = 'shadow'`.
It feeds the forecast (spec FR-039a), never enters the queue, and no reviewer is asked. The read rule ignores holds.

## 8. The read rule

`isRecipeViewableBy` gains a **required** field, so every in-memory call site fails to compile until it supplies it
(the tactic its required `status` field already uses):

```text
viewable = owner
        OR (visibility = 'public' AND status = 'published' AND sourceCheckAllows)

sourceCheckAllows = mode = 'shadow'
                 OR EXISTS (recipe_source_checks rsc
                            WHERE rsc.recipe_id = r.id
                              AND rsc.content_digest = r.checked_content_digest
                              AND rsc.allows)
```

The same condition joins the three SQL twins (`viewableBy`, `readableBy`, `communityOf` in `recipePredicates.ts`).
The `EXISTS` is a primary-key lookup.

## 9. Erasure and retention

| Table                              | On recipe delete | On account erasure                                | Retention                         |
| ---------------------------------- | ---------------- | ------------------------------------------------- | --------------------------------- |
| `recipe_source_checks`             | cascade          | deleted with the recipes                          | life of the recipe                |
| `recipe_source_referrals`          | cascade          | deleted                                           | life of the recipe                |
| `recipe_source_decisions`          | kept             | kept (evidence, `016-FR-052a`)                    | 3 years, then purged              |
| `source_check_evidence_sets/items` | kept             | kept, `RETAINED_BY_RULING` (no user, text, photo) | life of the rule set, then pruned |
| `content_source_markers`           | n/a              | n/a                                               | permanent, retired not deleted    |
| `source_check_enforcement_events`  | n/a              | n/a                                               | permanent                         |

`erasureSweepCoverage.test.ts` must list each new table in one of its two maps. `recipe_photos.content_sha256` is a
hash of the cook's own photo and is deleted with the photo row. The check rendition sits under the owner erasure
prefix, so the existing object sweep deletes it.
