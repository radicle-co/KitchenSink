# Data Model: Content Source Check

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-26 (revised after the owner's Q1
and Q2 rulings, and again after the staff-architect REVIEW and the owner's four rulings on it) | **ADR**:
[ADR-0074](../../docs/architecture/decisions/0074-content-source-check.md)

Every table here is new and lives in the **recipe** database (`kitchensink_recipe`), owned by `recipe_owner` with
grants from its default privileges (ADR-0039). Migrations are expand-first (ADR-0035). No name collides with a
shipped table (checked against `packages/services/recipe-service/src/database/schema` on 2026-10-26, GR-021).

## 0. The digests: one-way doors

There are three digests. Each is SHA-256, prefixed with its version (`v1:` + hex). ONE pure function in `recipe-core`
computes each one. recipe-service uses it on write and the worker uses it on read. A second implementation is a
defect.

| Digest                                      | Covers                                                                                                                                                                                                                                                                                                                                | Keys                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Text digest** (`checkedTextDigest`)       | title, description, tags (sorted), each ingredient's raw source line in line order (its display text where it has none, plus its group label and preparation words), each step's instruction in step order, the cook's own notes, and the credit text of an Adapted or family statement _(widened 2026-11-03, ADR-0082, spec FR-058)_ | the text's model evidence (section 2)                          |
| **Photo digest**                            | the stored bytes of one uploaded photo: `recipe_photos.content_sha256`                                                                                                                                                                                                                                                                | that photo's model evidence (section 2)                        |
| **Content digest** (`checkedContentDigest`) | the text digest, the **sorted** photo digests, and the **source statement**: the label and the normalised citation (spec FR-005a)                                                                                                                                                                                                     | the recipe's outcome (section 3) and the read rule (section 8) |

- Each text field is Unicode NFKC-normalised with whitespace collapsed, and parts are joined with a separator that
  cannot occur in normalised text.
- Photos are sorted, so reordering them changes nothing (spec US6).
- The statement is in the content digest so a citation change needs a new outcome. It is not in any model key,
  because the model never sees it (spec FR-008), so a citation change costs no model call.
- The field list, the normalisation and the hash are versioned by the prefix. Changing any of them is a new version,
  never an edit of `v1`. A new version makes every stored digest stale at once.

## 1. New columns on shipped tables

```sql
ALTER TABLE recipes ADD COLUMN checked_content_digest text NULL;
ALTER TABLE recipe_photos ADD COLUMN content_sha256 text NULL;
ALTER TABLE recipe_photos ADD COLUMN check_key text NULL;
ALTER TABLE recipe_photos ADD COLUMN check_rendition_version text NULL;
ALTER TABLE account_erasure_jobs ADD COLUMN donation_review_until timestamptz NULL;
```

- `recipes.checked_content_digest` is written only by recipe-service, in the same transaction as any write that changes
  the checked content or the source statement: a text edit, a photo confirmed or deleted, or the downgrade route.
- _(Added 2026-11-03, ADR-0082, spec FR-058.)_ A trigger on every table that holds a checked field sets
  `checked_content_digest` to NULL on any change, in the same transaction. recipe-service then writes the new digest. A
  NULL digest has no outcome, so the recipe reads as held (spec FR-059). A digest version change is a re-keying
  migration. It carries each outcome and decision forward only when the new version reads the same fields. A version
  that reads more fields re-checks the new parts. It never hides every public recipe at once.
- `recipe_photos.content_sha256` is the SHA-256 of the stored bytes. The upload's confirm step computes it. That step
  already reads the bytes to make the thumbnail, so this adds no new read.
- `recipe_photos.check_key` is the object key of the photo's **check rendition**: a copy at a fixed maximum size, made
  with `sharp` at confirm beside the thumbnail, under the same owner erasure prefix (research R-07). The worker sends it
  to the model. NULL means the rendition failed, and that photo then reads `unchecked` (`checkFailed`).
- `recipe_photos.check_rendition_version` names the resize bound and encoder settings the rendition was made with. It is
  part of the photo's model key (section 2), so a change of bound produces new evidence rather than reusing old.
- `account_erasure_jobs.donation_review_until` is the donation deadline: the request time plus 14 days (spec FR-018a,
  owner ruling 2026-10-26). NULL when no elected recipe needs a person. The job is not claimed for its recipe phase while it is in the future and an elected recipe is still
  undecided. It adds no status value to the shipped erasure contract.
- All are NULL on rows written before the columns existed. Nothing is live, so no backfill is planned.

## 2. Shared model evidence, per part (Content-addressed Cache-Aside)

What the model found in one part is stored once and shared by every recipe with the same part (spec FR-005). **No user
id, no quote, no marker text, no recipe text and no photo.** These rows stay through erasure, under a
`RETAINED_BY_RULING` entry with their columns pinned (ADR-0027 precedent).

Only a run that **finished** is stored here. A budget denial, an over-cap part or a failed call goes on the recipe's
own part row (section 3a). So nothing can reuse it in place of a model run.

```sql
CREATE TABLE source_check_model_sets (
    id                     text        PRIMARY KEY,              -- ULID
    part_kind              text        NOT NULL,
    part_digest            text        NOT NULL,                 -- the text digest, or the photo's content_sha256
    model_id               text        NOT NULL,
    prompt_sha256          text        NOT NULL,                 -- the pinned system prompt for this part kind
    output_schema_version  text        NOT NULL,
    rendition_version      text        NOT NULL,                 -- the photo's check_rendition_version; 'none' for text
    unproven_quotes        integer     NOT NULL DEFAULT 0,       -- model quotes code could not find (text only)
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT source_check_model_sets_part_kind_check CHECK (part_kind IN ('text', 'photo')),
    CONSTRAINT source_check_model_sets_unproven_text_only CHECK (unproven_quotes = 0 OR part_kind = 'text'),
    CONSTRAINT source_check_model_sets_rendition_shape
        CHECK ((part_kind = 'text') = (rendition_version = 'none'))
);

CREATE UNIQUE INDEX source_check_model_sets_key ON source_check_model_sets
    (part_kind, part_digest, model_id, prompt_sha256, output_schema_version, rendition_version);

CREATE TABLE source_check_model_items (
    model_set_id  text     NOT NULL REFERENCES source_check_model_sets (id) ON DELETE CASCADE,
    ordinal       integer  NOT NULL,
    kind          text     NOT NULL,
    field         text     NOT NULL,
    span_start    integer  NULL,
    span_end      integer  NULL,
    PRIMARY KEY (model_set_id, ordinal),
    CONSTRAINT source_check_model_items_kind_check CHECK (kind IN (
        'publisherImprint', 'copyrightNotice', 'pageReference', 'paidSiteTemplate', 'modelJudgement',
        'photoCopyrightText', 'photoWatermarkOrLogo', 'photoPrintedPage', 'photoIsbnOrBarcode', 'photoPublisherName')),
    CONSTRAINT source_check_model_items_field_check CHECK (field IN (
        'title', 'description', 'tags', 'ingredient', 'step', 'photo')),
    CONSTRAINT source_check_model_items_photo_shape CHECK (
        (field = 'photo') = (kind LIKE 'photo%')
        AND (field <> 'photo' OR (span_start IS NULL AND span_end IS NULL))
        AND (field = 'photo' OR (span_start IS NOT NULL AND span_end > span_start AND span_start >= 0)))
);
```

- **The key is everything that can change the answer** (spec FR-005, review M3): the part, the model, the prompt, the
  output schema, and for a photo the rendition. A prompt edit therefore produces new evidence, never a silent reuse.
- **Code must find a text item's quote before the item is stored.** It is stored as a span in the part's own
  normalised text. A quote that code does not find is counted in `unproven_quotes` and in a metric, and never written. A photo item is never proven and
  has no span.
- **No marker text at all.** The model chooses what to quote, so even a proven quote can be a person's name. The
  same-items rule (spec FR-047a) needs a marker, and gets it from the recipe's own judged items (section 3b), which
  are erased with the recipe.
- The model cannot return `isbn` or `citedPaidSiteHost`. Only the rules produce those (section 3b).
- A photo item belongs to a `photo` set, which names the photo by its digest, so the item needs no photo column. The
  outcome function rejects a photo kind in a text set and a text kind in a photo set, and a unit test pins it.

### `source_check_part_claims`: who is reading a part now (Idempotent Receiver)

```sql
CREATE TABLE source_check_part_claims (
    part_kind              text        NOT NULL,
    part_digest            text        NOT NULL,
    model_key              text        NOT NULL,     -- SHA-256 over model, prompt, schema and rendition versions
    claimed_by             text        NOT NULL,     -- the Lambda request id
    lease_until            timestamptz NOT NULL,
    attempts               integer     NOT NULL DEFAULT 1,
    PRIMARY KEY (part_kind, part_digest, model_key),
    CONSTRAINT source_check_part_claims_part_kind_check CHECK (part_kind IN ('text', 'photo'))
);
```

- One statement claims a part before any reservation (ADR-0024 layer 0a): `INSERT … ON CONFLICT DO UPDATE … WHERE
source_check_part_claims.lease_until < now() AND NOT EXISTS (a finished model set under this key) RETURNING`. Zero
  rows returned is the refusal: another worker holds a live lease, or the evidence already exists. Either way the part
  costs nothing here.
- The lease is longer than the function's timeout, so a live worker never loses it, and a dead one's lease runs out and
  can be taken over (spec FR-005b). `attempts` bounds a part that keeps failing.
- Rows are deleted when the model set lands, or by the sweeper once their lease is long past.

## 3. `recipe_source_checks`: the per-recipe outcome

One row per recipe and content digest. The read rule asks for the row for the recipe's **current** digest.

```sql
CREATE TABLE recipe_source_checks (
    recipe_id             uuid        NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
    content_digest        text        NOT NULL,
    rule_set_version      text        NOT NULL,
    state                 text        NOT NULL,
    outcome               text        NULL,
    reason                text        NULL,
    budget_period         text        NULL,      -- captured at reserve when the reason is budgetSpent (spec FR-020)
    judged_source_type    text        NOT NULL,
    judged_cited_host     text        NULL,
    evidence_ref          text        NULL,      -- SHA-256 over the outcome's model set ids and judged items
    enforced              boolean     NULL,      -- the enforcement stamp: NULL until first headed public
    cleared_at            timestamptz NULL,
    cleared_decision_id   text        NULL,
    cleared_outcome       text        NULL,      -- the outcome the person cleared
    cleared_evidence_ref  text        NULL,      -- the evidence the person saw
    review_ended_at       timestamptz NULL,      -- set by the decision that ends review (detected, approved, not approved)
    allows                boolean     NOT NULL DEFAULT false,
    checking_since        timestamptz NOT NULL DEFAULT now(),
    decided_at            timestamptz NULL,
    reveal_at             timestamptz NULL,      -- the outcome is not revealed before this (spec FR-051)
    part_results          jsonb       NULL,      -- each part green or not, with why, match effects included (staff view)
    PRIMARY KEY (recipe_id, content_digest),
    CONSTRAINT recipe_source_checks_state_check CHECK (state IN ('checking', 'decided')),
    CONSTRAINT recipe_source_checks_outcome_check
        CHECK (outcome IS NULL OR outcome IN ('clear', 'possible', 'detected', 'unchecked')),
    CONSTRAINT recipe_source_checks_reason_check
        CHECK (reason IS NULL OR reason IN ('budgetSpent', 'tooLong', 'checkFailed')),
    CONSTRAINT recipe_source_checks_decided_has_outcome
        CHECK ((state = 'decided') = (outcome IS NOT NULL AND decided_at IS NOT NULL AND evidence_ref IS NOT NULL
                                      AND reveal_at IS NOT NULL)),
    CONSTRAINT recipe_source_checks_reason_iff_unchecked CHECK ((outcome = 'unchecked') = (reason IS NOT NULL)),
    CONSTRAINT recipe_source_checks_period_iff_budget CHECK ((reason = 'budgetSpent') = (budget_period IS NOT NULL)),
    CONSTRAINT recipe_source_checks_clearance_complete CHECK (
        (cleared_at IS NULL) = (cleared_decision_id IS NULL)
        AND (cleared_at IS NULL) = (cleared_outcome IS NULL)
        AND (cleared_at IS NULL) = (cleared_evidence_ref IS NULL)),
    CONSTRAINT recipe_source_checks_clearance_only_held
        CHECK (cleared_outcome IS NULL OR cleared_outcome IN ('possible', 'detected', 'unchecked')),
    CONSTRAINT recipe_source_checks_source_type_check
        CHECK (judged_source_type IN ('user_created', 'imported_public'))
);

CREATE INDEX recipe_source_checks_checking ON recipe_source_checks (checking_since) WHERE state = 'checking';
CREATE INDEX recipe_source_checks_budget ON recipe_source_checks (budget_period)
    WHERE reason = 'budgetSpent' AND cleared_at IS NULL;
```

- **A rule-only `detected` is written `decided` in the save's own transaction** (spec FR-013, review H4). No message
  is sent for it, because no model answer can change it. Its `reveal_at` is the save's own time.
- **`reveal_at` is the timing floor** (spec FR-051). A worker-produced outcome sets it to the later of now and
  `checking_since` plus the floor. A model answer from the shared cache is fast, and an exact copy of another cook's
  private recipe hits that cache, so without a floor the time to an outcome could show that such a recipe exists. The
  cook's view reads `checking` until `reveal_at`, and the hold Specification (section 8) does not allow before it. The
  floor is one constant, set from the measured time of an uncached check.
- **The cook-facing state is derived, never stored** (spec FR-014a). The classifier reads the stored visibility and
  status, the current digest's row, `reveal_at` and the latest decision, and answers `checking`, `public`, `inReview`
  or `notApproved` (or `draft` and `private` as today). "In review" is a published recipe whose current digest has an
  `enforced = true` row that does not allow it and that no decision has ended (`review_ended_at IS NULL`). Its stored
  visibility is what the cook asked for: `public`, or `private` for a bulk-import recipe (spec FR-003b). It needs no new
  visibility value. A public one is hidden by the read rule and uses no slot. A private one is owner-only anyway, and it
  **holds its slot** from the save until a person checks it, because ADR-0073 §2 counts every private, published
  recipe (owner ruling, 2026-10-26). Either way it has the same restrictions as a draft (`001-FR-003b`).
- **Not approved moves the recipe to private.** A `detected` save (with a free slot), a reviewer's `referralNotApproved`
  and an `appealUpheld` each set `recipes.visibility = 'private'` in the same transaction as the decision, under
  ADR-0073's per-user lock. For a person's decision the move never refuses: with no free slot, the cook is over the
  limit, as after a downgrade (ADR-0073 §4). For a `detected` save, no free slot refuses the save
  (`403 SOURCE_DETECTED_NO_PRIVATE_SLOT`, with ADR-0073's `used` and `limit`), because nothing is saved yet. Only a
  publish is refused: the same recipe saved as a draft uses no slot (`001-FR-003b`). An overturned appeal moves it back
  to `public`.
- **A decided content cannot re-enter review.** A change to public on a recipe whose current digest's latest decision
  is a non-approval is refused (`403 SOURCE_CHECK_NOT_APPROVED`). Edited content has a new digest, so it gets a new check.
- These moves and refusals apply only to outcomes stamped `enforced = true` (spec FR-019).
- **`enforced` is written once.** recipe-service sets it, from the latest enforcement event, at the first moment its
  recipe is headed for public view with this digest (spec FR-001): `true` while the mode is `blocking`, `false` while
  it is `shadow` or `paused`. The write is `… SET enforced = $mode WHERE enforced IS NULL`. A trigger refuses any later
  change. So a mode change never hides or reveals a recipe that already has an outcome (spec FR-019).

### `allows` is computed by one pure function, never by SQL (Policy)

`allowsPublication(outcome, evidenceRef, clearance)` in `recipe-core` is the only author of `allows`:

| Outcome     | `allows` is true when                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `clear`     | always                                                                                          |
| `possible`  | a person cleared it, `cleared_outcome = 'possible'`, and `cleared_evidence_ref = evidence_ref`  |
| `unchecked` | a person cleared it, `cleared_outcome = 'unchecked'`, and `cleared_evidence_ref = evidence_ref` |
| `detected`  | a person overturned it on appeal, with the same two equalities                                  |
| none yet    | never (`state = 'checking'`)                                                                    |

`clear` itself is computed only when every part is green (spec FR-013a): directly, or by a match under spec FR-047.
There is no cook confirmation and no curator shortcut. Nothing the cook does sets `allows` (owner rulings,
2026-10-26).

### Who writes this row, and how they cannot race (State machine with compare-and-set guards)

Three writers change an input to `allows`: the worker's outcome, a reviewer's decision, and the next-period re-check.
Each recomputes `allows` in the same statement, by a compare-and-set.

| Writer               | Lock order                           | Compare-and-set predicate                                                                          |
| -------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Worker outcome       | the check row                        | `state = 'checking'` and the digest matches                                                        |
| Reviewer decision    | the referral row, then the check row | referral `state = 'open'`, and check `outcome = $shown_outcome AND evidence_ref = $shown_evidence` |
| Next-period re-check | the referral row, then the check row | `state = 'decided' AND outcome = 'unchecked' AND reason = 'budgetSpent' AND cleared_at IS NULL`    |

Zero rows updated is the refusal, and the loser re-reads. A referral is created only once the row is `decided`
(spec FR-016). This is the repair for review H7.

```text
(no row) ──save, public intent──▶ checking ──outcome lands (fan-in)──▶ decided
   │                                 │                                    │
   └──save, rule blocks──────────────┼──────────────────────────────────▶ decided (detected)
                                     └──24 h, retries spent──────────────▶ decided (unchecked / checkFailed)

decided: reviewer clears this outcome on this evidence        ─▶ allows
         re-check (unchecked, budgetSpent, period passed, not cleared) ─▶ decided again
         content or statement changes                         ─▶ a NEW row for the new digest; this one is history
```

The re-check reads only the parts the model did not read and keeps the save's rule items, so it cannot produce
`detected`. A `clear` result closes the referral as `resolvedByCheck`. A `possible` result leaves it open.

### 3a. `recipe_source_check_parts`: what one outcome is waiting on (Observer)

```sql
CREATE TABLE recipe_source_check_parts (
    recipe_id       uuid  NOT NULL,
    content_digest  text  NOT NULL,
    part_kind       text  NOT NULL,
    part_digest     text  NOT NULL,
    photo_id        uuid  NULL,                -- the cook's photo row, for display; NULL for the text
    model_set_id    text  NULL REFERENCES source_check_model_sets (id),
    read_status     text  NOT NULL DEFAULT 'pending',
    budget_period   text  NULL,
    PRIMARY KEY (recipe_id, content_digest, part_kind, part_digest),
    FOREIGN KEY (recipe_id, content_digest)
        REFERENCES recipe_source_checks (recipe_id, content_digest) ON DELETE CASCADE,
    CONSTRAINT recipe_source_check_parts_kind_check CHECK (part_kind IN ('text', 'photo')),
    CONSTRAINT recipe_source_check_parts_status_check CHECK (read_status IN (
        'pending', 'ran', 'budgetSpent', 'tooLong', 'failed', 'noRendition')),
    CONSTRAINT recipe_source_check_parts_ran_has_set CHECK ((read_status = 'ran') = (model_set_id IS NOT NULL)),
    CONSTRAINT recipe_source_check_parts_period_iff_budget
        CHECK ((read_status = 'budgetSpent') = (budget_period IS NOT NULL))
);

CREATE INDEX recipe_source_check_parts_waiting ON recipe_source_check_parts (part_kind, part_digest)
    WHERE read_status = 'pending';
```

- recipe-service writes one row per part when it creates the check row, because it knows the text digest and every
  photo's digest.
- **Fan-in** (spec FR-005b). When a model set lands, the same transaction marks every `pending` part row with that
  part digest and model key as `ran`. It then sends a fresh `SourceCheckRequested` for every other `checking` check row
  that now has no `pending` part. That run does the cheap steps again (its own lookup, its own marker digests from its
  own text), finds the evidence already there, spends nothing, and writes its own outcome. So an outcome is always
  worked out in one place, by one run of the same steps. A message whose part was claimed elsewhere ends without
  spend, because the fan-in will send it again.
- The sweeper re-drives a `checking` row with no `pending` part that the fan-in missed, and ends the 24-hour limit
  (spec FR-022).

### 3b. `recipe_source_check_items`: the evidence as judged for one recipe

```sql
CREATE TABLE recipe_source_check_items (
    recipe_id       uuid     NOT NULL,
    content_digest  text     NOT NULL,
    ordinal         integer  NOT NULL,
    kind            text     NOT NULL,
    detector        text     NOT NULL,
    weight          text     NOT NULL,
    field           text     NOT NULL,
    span_start      integer  NULL,
    span_end        integer  NULL,
    photo_digest    text     NULL,
    marker_text     text     NULL,       -- list or pattern kinds only: an ISBN, a listed imprint, host or template
    marker_digest   text     NOT NULL,   -- 'v1:' + SHA-256 of the normalised marker; the same-items rule compares it
    PRIMARY KEY (recipe_id, content_digest, ordinal),
    FOREIGN KEY (recipe_id, content_digest)
        REFERENCES recipe_source_checks (recipe_id, content_digest) ON DELETE CASCADE,
    CONSTRAINT recipe_source_check_items_detector_check CHECK (detector IN ('rules', 'model')),
    CONSTRAINT recipe_source_check_items_weight_check CHECK (weight IN ('blocking', 'forAPerson')),
    CONSTRAINT recipe_source_check_items_only_rules_block CHECK (weight <> 'blocking' OR detector = 'rules'),
    CONSTRAINT recipe_source_check_items_kind_check CHECK (kind IN (
        'isbn', 'publisherImprint', 'copyrightNotice', 'pageReference',
        'paidSiteTemplate', 'citedPaidSiteHost', 'modelJudgement',
        'photoCopyrightText', 'photoWatermarkOrLogo', 'photoPrintedPage',
        'photoIsbnOrBarcode', 'photoPublisherName')),
    CONSTRAINT recipe_source_check_items_field_check CHECK (field IN (
        'title', 'description', 'tags', 'ingredient', 'step', 'citation', 'photo')),
    CONSTRAINT recipe_source_check_items_photo_shape CHECK ((field = 'photo') = (photo_digest IS NOT NULL)),
    CONSTRAINT recipe_source_check_items_marker_text_listed CHECK (
        marker_text IS NULL OR (detector = 'rules' AND kind IN (
            'isbn', 'publisherImprint', 'paidSiteTemplate', 'citedPaidSiteHost', 'pageReference'))),
    CONSTRAINT recipe_source_check_items_marker_length CHECK (marker_text IS NULL OR char_length(marker_text) <= 200)
);
```

- **Rule items are worked out on every check** (review M3). They depend on the text, the citation, the label and the
  live rightsholder list, so they are never shared. `rule_set_version` on the check row records which rules ran.
- **Model items are projected** from the shared model sets onto this recipe. The worker reads the recipe's own text at
  each span to compute `marker_digest`. A photo item's marker is its kind and `photo_digest`.
- **The database holds the "only rules block" rule** as a CHECK (spec FR-010), and the outcome function holds it as a
  type: the weight table is an exhaustive switch whose `model` arm returns `forAPerson` only.
- **`marker_digest` is what makes the same-items rule exact** (spec FR-047a). A copyright notice naming a different
  holder has a different digest, so a copy with a different holder is not the approved version's notice.
- These rows hold the cook's markers, so they are the cook's data: deleted with the recipe's hard purge and with
  account erasure.

## 4. `recipe_source_decisions`: the evidence of a hold or a person's decision

This row is the evidence of a decision (`016-FR-052`). It is kept for 016's period (`016-FR-052a`, 3 years from the
decision), and it survives the recipe's deletion and account erasure. The erasure coverage guard records it under its
**third map**, beside its exemption and retention maps: time-boxed legal retention (ADR-0027 §6).

```sql
CREATE TABLE recipe_source_decisions (
    id                        text         PRIMARY KEY,               -- ULID
    recipe_id                 uuid         NOT NULL,                  -- opaque: no FK, it survives the recipe
    owner_id                  varchar(255) NOT NULL,                  -- opaque app user id, as recipes.owner_id
    content_digest            text         NOT NULL,
    recipe_first_published_at timestamptz  NULL,                      -- for the time order of spec FR-046b
    text_fingerprint          text         NULL,                      -- a hold's exact-match hash, no text (FR-052)
    kind                      text         NOT NULL,
    automated_detection       boolean      NOT NULL,
    automated_decision        boolean      NOT NULL,
    decided_by                text         NULL,                      -- staff identity; NULL only when automated
    rejection_reason          text         NULL,                      -- a person's rejection: one of spec FR-027's keys
    facts                     jsonb        NOT NULL,                  -- evidence kinds, fields and listed markers
    cook_note                 text         NULL,                      -- shown to the cook word for word (FR-027)
    staff_note                text         NULL,                      -- staff only; never shown to the cook
    appeal_reason             text         NULL,                      -- the cook's words on the appeal decided here
    decided_at                timestamptz  NOT NULL,
    statement_in_app_at       timestamptz  NULL,
    statement_email_at        timestamptz  NULL,
    statement_undeliverable   boolean      NOT NULL DEFAULT false,    -- the account was erased first (FR-036)
    email_attempts            integer      NOT NULL DEFAULT 0,
    purge_after               timestamptz  NOT NULL,
    CONSTRAINT recipe_source_decisions_kind_check CHECK (kind IN (
        'automatedHold', 'referralCleared', 'referralNotApproved', 'appealOverturned', 'appealUpheld', 'auditRestriction')),
    CONSTRAINT recipe_source_decisions_reason_check CHECK (rejection_reason IS NULL OR rejection_reason IN (
        'book', 'paidSite', 'notYours', 'printedPage', 'other')),
    CONSTRAINT recipe_source_decisions_reason_iff_person_rejection CHECK (
        (rejection_reason IS NOT NULL) = (kind IN ('referralNotApproved', 'appealUpheld', 'auditRestriction'))),
    CONSTRAINT recipe_source_decisions_notes_only_from_a_person CHECK (
        automated_decision = false OR (cook_note IS NULL AND staff_note IS NULL)),
    CONSTRAINT recipe_source_decisions_person_unless_automated
        CHECK (automated_decision = (decided_by IS NULL)),
    CONSTRAINT recipe_source_decisions_only_detected_is_automated
        CHECK (automated_decision = (kind = 'automatedHold')),
    CONSTRAINT recipe_source_decisions_hash_only_on_holds CHECK (
        text_fingerprint IS NULL
        OR (kind IN ('automatedHold', 'referralNotApproved', 'appealUpheld', 'auditRestriction')
            AND text_fingerprint LIKE 'v1:%')),
    CONSTRAINT recipe_source_decisions_cook_note_length
        CHECK (cook_note IS NULL OR char_length(cook_note) <= 2000),
    CONSTRAINT recipe_source_decisions_staff_note_length
        CHECK (staff_note IS NULL OR char_length(staff_note) <= 2000),
    CONSTRAINT recipe_source_decisions_appeal_length
        CHECK (appeal_reason IS NULL OR char_length(appeal_reason) <= 2000)
);

CREATE INDEX recipe_source_decisions_hold_hash ON recipe_source_decisions (text_fingerprint)
    WHERE text_fingerprint IS NOT NULL;
```

- Two automated-means facts, because DSA Art. 17(3)(c) asks about both: was the content found by automated means, and
  was the decision taken by them. A person's hold after a check referral is `automated_detection = true`,
  `automated_decision = false`.
- **A rejection carries one reason** (spec FR-027, owner ruling 2026-10-26): `book`, `paidSite`, `notYours`,
  `printedPage` or `other`, each a localisation key under `recipe.review.reason.*`. A CHECK ties the reason to a
  person's rejection, so an approval and an automated hold carry none.
- **`notYours` is only for a public match.** The decision route accepts it only when the referral has a recipe match
  whose matched recipe is another cook's and is public when the decision is saved. It refuses any reason it did not
  offer with `422 SOURCE_CHECK_REASON_NOT_OFFERED`. The check reads `recipes.visibility` and `status` of
  `recipe_source_check_matches.matched_recipe_id` inside the decision's transaction, so a recipe made private after
  the screen loaded is caught.
- **Two notes, one for the cook and one for staff.** `cook_note` is shown to the cook word for word, under a staff
  guideline never to name, link or describe another cook or recipe. `staff_note` never reaches the cook. Both are
  strings in the request and `text` here (review M4).
- **`facts` never names a match.** It holds evidence kinds, fields and listed markers. The cook-facing statement takes
  the reason's text and the cook note, never a matched recipe.
- **The hash is kept only on a hold** (review M4). A clearance keeps none, so after erasure a kept hash can only ever
  produce FR-047 row 2: a person decides. It is versioned (`v1:`), so a change of normalisation never makes an old hash
  silently match nothing or match the wrong thing.
- The statement of reasons is derived from this row, as 016 derives its own from `notice_decisions`. It is issued for
  `automatedHold`, `referralNotApproved`, `appealUpheld` and `auditRestriction`. Delivery is recorded per channel through
  016's generalised delivery (research R-13). `statement_undeliverable` records that the account was gone first.
- `purge_after = decided_at + 3 years`. 016's retention sweep honours it, and 016's legal holds can suspend it.

## 5. `recipe_source_referrals`: work for a person

One row per time a recipe is sent to a person. Deleted with the recipe's hard purge and with account erasure. Closed
as `withdrawn` at a tombstone (spec FR-018c). The decision it produced lives on in `recipe_source_decisions`.

```sql
CREATE TABLE recipe_source_referrals (
    id                text        PRIMARY KEY,                    -- ULID
    recipe_id         uuid        NOT NULL,
    owner_id          varchar(255) NOT NULL,                      -- for the per-cook cap and the grouped view
    content_digest    text        NOT NULL,
    origin            text        NOT NULL,
    import_id         text        NULL,                           -- set when the recipe came from a bulk import
    erasure_job_id    uuid        NULL,                           -- set for a donation review (spec FR-018a)
    cook_reason       text        NULL,                           -- the cook's own words on an appeal, ≤ 2,000 chars
    queue_since       timestamptz NOT NULL DEFAULT now(),          -- when this recipe FIRST entered review (FR-030a)
    excluded_reviewer text        NULL,                           -- who made the hold being appealed (spec FR-026a)
    state             text        NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    decision_id       text        NULL REFERENCES recipe_source_decisions (id),
    FOREIGN KEY (recipe_id, content_digest)
        REFERENCES recipe_source_checks (recipe_id, content_digest) ON DELETE CASCADE,
    CONSTRAINT recipe_source_referrals_origin_check CHECK (origin IN ('check', 'appeal', 'donation')),
    CONSTRAINT recipe_source_referrals_state_check CHECK (state IN (
        'shadow', 'deferred', 'open', 'cleared', 'held', 'withdrawn', 'superseded', 'resolvedByCheck', 'expired')),
    CONSTRAINT recipe_source_referrals_person_decided_has_decision
        CHECK ((state IN ('cleared', 'held')) = (decision_id IS NOT NULL)),
    CONSTRAINT recipe_source_referrals_reason_only_on_appeal CHECK (cook_reason IS NULL OR origin = 'appeal'),
    CONSTRAINT recipe_source_referrals_donation_has_job CHECK ((origin = 'donation') = (erasure_job_id IS NOT NULL)),
    CONSTRAINT recipe_source_referrals_reason_length
        CHECK (cook_reason IS NULL OR char_length(cook_reason) <= 2000)
);

CREATE UNIQUE INDEX recipe_source_referrals_one_live
    ON recipe_source_referrals (recipe_id, content_digest) WHERE state IN ('open', 'deferred');
CREATE UNIQUE INDEX recipe_source_referrals_one_appeal
    ON recipe_source_referrals (recipe_id, content_digest) WHERE origin = 'appeal';
CREATE INDEX recipe_source_referrals_queue ON recipe_source_referrals (queue_since) WHERE state = 'open';
CREATE INDEX recipe_source_referrals_cook ON recipe_source_referrals (owner_id, created_at)
    WHERE state IN ('open', 'deferred');
```

- There is no due time. The owner set no decision target in this release ("we can deal with SLO/SLA later"). The
  queue orders by `queue_since`, oldest first (spec FR-030).
- **`queue_since` is carried forward only within one review.** When an edit supersedes a live referral, or the cook
  returns a recipe from Draft to review, the new referral copies the latest earlier referral's `queue_since` for that
  recipe, but only if no decision has ended review since. After a decision (approved, not approved, or resolved by the
  check), a new review starts a fresh `queue_since`. So editing, or a trip through Draft, never pushes a recipe back,
  and a recipe refused last week cannot jump to the front of the queue with an old date.
- **The reviewer sees the recipe's own history.** The referral detail lists every earlier decision on this recipe,
  read from `recipe_source_decisions` by `recipe_id`, because the lookup leaves the recipe itself out (spec FR-047
  row 1) and fingerprints hold only the current version.
- **The per-cook cap** (spec FR-030b). A new referral is created `deferred` when the cook already has the cap's number
  `open`, counted under a per-cook advisory lock in the same transaction (the ADR-0073 shape). When one closes, the
  cook's oldest `deferred` opens. The cap never publishes, clears or drops anything.
- `one_appeal` enforces spec FR-026a's "once per version of the content".
- `superseded`: the content changed while the referral was live (the editor warns before that save). `withdrawn`: the
  cook set the recipe to Draft or Private, downgraded the label, deleted it, or erased the account. A move to Private
  out of review needs a free slot and is refused without one. `resolvedByCheck`: the next-period re-check
  returned `clear`. `expired`: a donation review that reached its deadline undecided (spec FR-018a).
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

- **Retire-only.** `tablePolicy.ts` (ADR-0039) gains a `retireOnly` class: the service role holds SELECT, INSERT and
  UPDATE, and no DELETE. A trigger refuses any UPDATE that changes a column other than the three `retired_*` columns,
  or that touches a row already retired. So the audit trail stays whole (review Low).
- `rule_set_version` (section 3) includes a digest of the live markers, so adding a publisher changes the rule items of
  new checks. It never changes an outcome already produced (spec FR-002).

## 7. `source_check_enforcement_events`: the blocking switch (append-only ledger with a paused mode)

```sql
CREATE TABLE source_check_enforcement_events (
    id              text        PRIMARY KEY,                   -- ULID
    mode            text        NOT NULL,
    actor           text        NOT NULL,
    reason          text        NOT NULL,
    evaluation_ref  text        NULL,                          -- the evaluation run that met SC-001, SC-002, SC-015
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT source_check_enforcement_events_mode_check CHECK (mode IN ('shadow', 'blocking', 'paused')),
    CONSTRAINT source_check_enforcement_events_blocking_cites_evidence
        CHECK (mode <> 'blocking' OR evaluation_ref IS NOT NULL)
);
```

- With no row, the mode is `shadow`. In shadow mode a referral that would be made is written with `state = 'shadow'`.
  It feeds the forecast (spec FR-039a), never enters the queue, and no reviewer is asked.
- **Legal moves** (spec FR-019): `shadow` → `blocking`, `blocking` → `paused`, `paused` → `blocking`. A `BEFORE INSERT`
  trigger takes a transaction-scoped advisory lock, reads the latest row, and refuses any other move, a return to
  `shadow` included. A CHECK cannot do this, because it cannot see the row before it (015's ratchet lesson).
- **Append-only.** It is a `dictionary` table in `tablePolicy.ts`: the service role holds SELECT and INSERT, and
  nothing else.
- **The read rule never reads this table.** recipe-service reads the latest row only when it stamps `enforced` on a
  check row (section 3). That is what lets `paused` keep existing holds and stop new ones.

## 8. The read rule: one hold Specification, in two forms

`isRecipeViewableBy` gains a **required** field, so every in-memory call site fails to compile until it supplies it
(the tactic its required `status` field already uses):

```text
viewable = owner
        OR (visibility = 'public' AND status = 'published' AND sourceCheckAllows)
```

`sourceCheckAllows` is written once, in `recipe-core/src/sourceCheck/holdSpecification.ts`, in two forms held equal
by a parity test (spec FR-018):

- a TypeScript predicate over a check row, for `isRecipeViewableBy`.
- an exported SQL text, `SOURCE_CHECK_ALLOWS_SQL`, over a recipe alias, in the shape `PARSE_JOB_AGGREGATE_SQL`
  already uses in `recipe-core` (plain text that both deployables import, so neither needs the other's code):

```sql
EXISTS (SELECT 1 FROM recipe_source_checks rsc
        WHERE rsc.recipe_id = r.id
          AND rsc.content_digest = r.checked_content_digest
          AND ((rsc.allows AND rsc.reveal_at <= now()) OR rsc.enforced = false))
```

- The three SQL twins (`viewableBy`, `readableBy`, `communityOf` in `recipePredicates.ts`) and the account erasure
  worker's "truly public" predicate all use that text. The `EXISTS` is a primary-key lookup.
- An outcome stamped `enforced = false` (shadow or paused) never holds anything. An outcome stamped `true` holds until
  it `allows`. `enforced IS NULL` means the recipe was never headed public with this digest, and the recipe is then not
  published, so the clause is never what decides.
- **`IN_REVIEW_SQL`**, exported beside it, is the one definition of "in review" (owner ruling, 2026-10-26):

    ```sql
    EXISTS (SELECT 1 FROM recipe_source_checks rsc
            WHERE rsc.recipe_id = r.id
              AND rsc.content_digest = r.checked_content_digest
              AND rsc.enforced = true AND NOT rsc.allows AND rsc.review_ended_at IS NULL)
    ```

    The cook-facing classifier, the pickers and the feature gates (`001-FR-003b`) use it to treat a recipe in review
    like a draft, and the screens use it to say that a private one "holds a slot until a person checks it". ADR-0073's
    slot count does **not** use it: a private recipe in review holds its slot, so the count of private, published,
    undeleted recipes is already right.

- A repo guard fails any SQL text outside `holdSpecification.ts` and the writers that reads `recipe_source_checks`
  with `allows`, `enforced` or `review_ended_at`, so a fifth hand-written copy cannot appear (review H6).

## 9. Erasure, deletion and retention

| Table                             | On recipe delete (a tombstone, `001-FR-002`) | On hard purge and account erasure            | Retention                          |
| --------------------------------- | -------------------------------------------- | -------------------------------------------- | ---------------------------------- |
| `recipe_source_checks`            | kept (holds no text)                         | deleted                                      | life of the recipe                 |
| `recipe_source_check_parts`       | kept                                         | deleted                                      | life of the recipe                 |
| `recipe_source_check_items`       | kept                                         | deleted (the cook's markers)                 | life of the recipe                 |
| `recipe_source_referrals`         | live ones closed as `withdrawn`              | deleted                                      | life of the recipe                 |
| `recipe_source_check_matches`     | kept                                         | deleted                                      | life of the recipe                 |
| `recipe_match_fingerprints`       | **deleted** (spec FR-018c)                   | deleted (the cook's data)                    | life of the recipe, while live     |
| `recipe_source_keys`              | **deleted** (spec FR-018c)                   | deleted                                      | life of the recipe, while live     |
| `recipe_source_decisions`         | kept                                         | kept: time-boxed legal retention (third map) | 3 years, then purged               |
| `source_check_model_sets/items`   | kept                                         | kept: `RETAINED_BY_RULING` (no user or text) | life of the model key, then pruned |
| `source_check_part_claims`        | n/a                                          | n/a (no user, no recipe)                     | until the evidence lands           |
| `content_source_markers`          | n/a                                          | n/a                                          | permanent, retired not deleted     |
| `content_source_decisions`        | n/a                                          | n/a (keys a source, not a person)            | permanent, retired not deleted     |
| `source_check_enforcement_events` | n/a                                          | n/a                                          | permanent                          |

- `erasureSweepCoverage.test.ts` must list each new table under one of its verdicts: swept, exempt, retained by
  ruling (columns pinned), or retained for a legal period (a `purge_after` column asserted). ADR-0027 §6 records the
  legal-retention map.
- `recipe_photos.content_sha256` is a hash of the cook's own photo and is deleted with the photo row. The check
  rendition sits under the owner erasure prefix, so the existing object sweep deletes it.

### Donation at erasure (spec FR-018a)

1. **At election.** For each elected recipe that is not already allowed, recipe-service creates its check row (stamped
   from the current mode) and sends the check, exactly as for a publish. A recipe all green is donatable. One that is
   not gets a referral with `origin = 'donation'`, and so does an elected recipe already in review. A not-approved
   recipe is never donated, because its content has a final decision. If any donation referral exists, the job's
   `donation_review_until` is set to the request time plus 14 days.
2. **Waiting.** The job is not claimed for its recipe phase while `donation_review_until` is in the future and a
   donation referral is still live. The account is closed meanwhile. Two things wake it: the decision on its last live
   donation referral re-enqueues the job in the same transaction, and the sweeper claims it once
   `donation_review_until` passes.
3. **At completion** (every donation referral decided, or the deadline passed). Live donation referrals close as
   `expired`. The existing transaction then runs unchanged in shape: it flips the elected recipes, and removes every
   recipe of the owner that is not `visibility = 'public' AND status = 'published' AND SOURCE_CHECK_ALLOWS_SQL`. So a
   held recipe, an elected recipe a person held, and an elected recipe still undecided are deleted with no extra logic.

## 10. Same recipe and same source (spec section J)

### `recipe_match_fingerprints`: what makes the lookup fast (Derived index)

```sql
CREATE TABLE recipe_match_fingerprints (
    recipe_id         uuid        PRIMARY KEY REFERENCES recipes (id) ON DELETE CASCADE,
    content_digest    text        NOT NULL,                  -- the version this was computed for
    text_fingerprint  text        NOT NULL,                  -- 'v1:' + SHA-256 of match_text: exact copies
    match_text        text        NOT NULL,                  -- normalised ingredients and steps, capped in length
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recipe_match_fingerprints_exact ON recipe_match_fingerprints (text_fingerprint);
CREATE INDEX recipe_match_fingerprints_trgm ON recipe_match_fingerprints USING gin (match_text gin_trgm_ops);
```

- One row per live recipe, for its **current** version, written by recipe-service in the same transaction as the
  content (review M1). Deleted at a tombstone (spec FR-018c).
- `match_text` is the ingredient lines and steps, NFKC-normalised, lower-cased, with numbers and whitespace collapsed,
  capped at a fixed length. Title and description are left out on purpose: two cooks' titles for the same dish differ,
  and the method is what a copy keeps.
- **The lookup runs in the worker** (spec FR-053), inside its own transaction, which opens with
  `SET LOCAL pg_trgm.similarity_threshold = $measured`. Code then confirms each candidate with word-shingle Jaccard.
- **The flip** (spec FR-046). If the LOCAL e2e benchmark at the projected corpus size fails its budget, a
  `recipe_match_bands (recipe_id, band_no, band_hash)` table of MinHash LSH bands replaces the GIN index as the
  candidate source. Both are rebuilt from `match_text`, so the flip is a migration plus a backfill of a derived index,
  and the cook's stored data does not change.
- **This is the cook's data.** It is a normalised copy of their recipe text, so it is never a `RETAINED_BY_RULING`
  table. ADR-0027 kept an ingredient phrase because a phrase alone says nothing about a person. A whole recipe can (a
  family name, a story), so the same reasoning does not apply.

### Candidate rules (spec FR-046b)

The candidate query leaves out, with one bounded recursive CTE over `recipes.cloned_from_id` (a depth cap and a
`CYCLE` clause):

- the recipe itself.
- its ancestors, followed to the clone root.
- every recipe whose own root is the same root (siblings and cousins in the same clone tree).

For rows 2, 4 and 5 of spec FR-047, a candidate also needs `first_published_at < coalesce(this.first_published_at,
now())`. A candidate with a NULL `first_published_at` never qualifies. For a kept hold hash, the decision row's
`recipe_first_published_at` plays that part.

### `recipe_source_keys`: normalised sources

```sql
CREATE TABLE recipe_source_keys (
    recipe_id   uuid  NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
    key_kind    text  NOT NULL,
    key_value   text  NOT NULL,
    PRIMARY KEY (recipe_id, key_kind, key_value),
    CONSTRAINT recipe_source_keys_kind_check CHECK (key_kind IN ('page', 'host', 'isbn'))
);

CREATE INDEX recipe_source_keys_lookup ON recipe_source_keys (key_kind, key_value);
```

- `page`: the cited link, normalised by the `normalize-url` library (declared directly in `recipe-core`, current
  major. It is ESM-only, and `recipe-core` is `"type": "module"`), with the options pinned in one place: lower-case
  host, `www.` dropped, query and fragment dropped, trailing slash dropped. Not hand-rolled (review Low).
- `host`: the registrable domain, from `tldts`. It is in the tree today only through `jsdom`, a test dependency, so it
  is declared directly in `recipe-core`.
- `isbn`: the ISBN-13 form, from `isbn3`, read from the citation or found in the text by the rules.
- Written in the content transaction, deleted at a tombstone.

### `content_source_decisions`: a person's decision about a source

```sql
CREATE TABLE content_source_decisions (
    id              text        PRIMARY KEY,                 -- ULID
    key_kind        text        NOT NULL,
    key_value       text        NOT NULL,
    decision        text        NOT NULL,
    decided_by      text        NOT NULL,                    -- staff identity
    reason          text        NOT NULL,
    decided_at      timestamptz NOT NULL DEFAULT now(),
    retired_by      text        NULL,
    retired_at      timestamptz NULL,
    retired_reason  text        NULL,
    CONSTRAINT content_source_decisions_kind_check CHECK (key_kind IN ('page', 'host', 'isbn')),
    CONSTRAINT content_source_decisions_decision_check CHECK (decision IN ('approve', 'block')),
    CONSTRAINT content_source_decisions_reason_present CHECK (char_length(btrim(reason)) > 0),
    CONSTRAINT content_source_decisions_retire_complete
        CHECK ((retired_at IS NULL) = (retired_by IS NULL) AND (retired_at IS NULL) = (retired_reason IS NULL))
);

CREATE UNIQUE INDEX content_source_decisions_live ON content_source_decisions (key_kind, key_value)
    WHERE retired_at IS NULL;
```

- Only a staff reviewer writes it, explicitly (spec FR-050). Clearing one recipe never approves its whole source.
- **Retire-only**, like the markers (section 6). Reversing a decision is retiring it and inserting a new one.
- Retiring or reversing it changes no outcome already produced and undoes no person's past decision. It changes only
  what later checks find (spec FR-050).
- It keys a source, not a person, so it is not erased with an account.
- It is separate from `content_source_markers`. A marker **blocks automatically**, through the rules. A source decision
  feeds the green rule: `approve` can make the source reference green, `block` sends the recipe to a person.

### `recipe_source_check_matches`: what the reviewer sees

```sql
CREATE TABLE recipe_source_check_matches (
    recipe_id           uuid        NOT NULL,
    content_digest      text        NOT NULL,
    ordinal             integer     NOT NULL,
    match_kind          text        NOT NULL,
    matched_recipe_id   uuid        NULL,                    -- opaque: the matched recipe can be deleted later
    matched_private     boolean     NOT NULL,                -- the reviewer sees its decision only (spec FR-049)
    source_key_kind     text        NULL,
    source_key_value    text        NULL,
    similarity          real        NULL,
    relation            text        NOT NULL,
    effect              text        NOT NULL,
    earlier_decision_id text        NULL,                    -- recipe_source_decisions.id or content_source_decisions.id
    PRIMARY KEY (recipe_id, content_digest, ordinal),
    FOREIGN KEY (recipe_id, content_digest)
        REFERENCES recipe_source_checks (recipe_id, content_digest) ON DELETE CASCADE,
    CONSTRAINT recipe_source_check_matches_kind_check
        CHECK (match_kind IN ('exactText', 'nearText', 'exactPhoto', 'sameSource', 'heldHash')),
    CONSTRAINT recipe_source_check_matches_relation_check CHECK (relation IN (
        'cloneTree', 'held', 'personApproved', 'otherCookPrivate', 'internalCopy', 'noEffect',
        'sourceBlocked', 'sourceApproved')),
    CONSTRAINT recipe_source_check_matches_effect_check CHECK (effect IN ('green', 'notGreen', 'none'))
);
```

- `relation` names the row of spec FR-047 that applied, decided by one pure function (`matchEffectOf`): an ordered
  decision table, the first row that applies wins. `effect` follows from it. Per part, the effects combine as a lattice
  join where `notGreen` beats `green` and `green` beats `none` (spec FR-047c).
- The cook's API never returns a row of this table (spec FR-054). The reviewer's API returns it, with the matched
  recipe's content only when `matched_private` is false.
