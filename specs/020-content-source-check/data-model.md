# Data Model: Content Source Check

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-26

Every table here is new and lives in the **recipe** database (`kitchensink_recipe`), owned by `recipe_owner` with
grants from its default privileges (ADR-0039). Migrations are expand-first (ADR-0035). No name collides with a
shipped table (checked against `packages/services/recipe-service/src/database/schema` on 2026-10-26, GR-021).

## 0. The digest: a one-way door

`checked_text_digest` is SHA-256 over a canonical serialisation of the checked text, prefixed with a digest version:
`v1:` + hex. The canonical form is, in order: title, description, tags (sorted), each ingredient's raw source line in
line order, and each step's instruction in step order. Each part is Unicode NFKC-normalised with whitespace
collapsed, and parts are joined with a separator that cannot occur in normalised text.

- The field list, the normalisation and the hash are versioned by the prefix. Changing any of them is a new version,
  never an edit of `v1`. An edit makes every stored digest stale at once.
- The digest is computed by ONE pure function in `recipe-core` (`checkedTextDigest`), used by recipe-service on write
  and by the worker on read. A second implementation is a defect.

## 1. `recipes.checked_text_digest` (new column)

```sql
ALTER TABLE recipes ADD COLUMN checked_text_digest text NULL;
```

- Written only by recipe-service, in the same transaction as any write that changes the checked text.
- NULL on rows written before the column existed. Nothing is live, so no backfill is planned; the save path sets it on
  the next write.

## 2. `source_check_evidence_sets` and `source_check_evidence_items`: shared evidence

Evidence for one version of checked text, under one rule set and one model. Shared by every recipe with that text.
**No user id and no recipe text.** Retained through erasure under a `RETAINED_BY_RULING` entry with its columns
pinned (ADR-0027 precedent).

```sql
CREATE TABLE source_check_evidence_sets (
    id                text        PRIMARY KEY,               -- ULID
    text_digest       text        NOT NULL,
    rule_set_version  text        NOT NULL,
    model_id          text        NULL,                      -- NULL when the model did not run
    model_run         text        NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT source_check_evidence_sets_model_run_check
        CHECK (model_run IN ('ran', 'budgetSpent', 'tooLong', 'failed')),
    CONSTRAINT source_check_evidence_sets_model_iff_ran
        CHECK ((model_run = 'ran') = (model_id IS NOT NULL))
);

CREATE UNIQUE INDEX source_check_evidence_sets_ran_key
    ON source_check_evidence_sets (text_digest, rule_set_version, model_id)
    WHERE model_run = 'ran';

CREATE TABLE source_check_evidence_items (
    evidence_set_id   text     NOT NULL REFERENCES source_check_evidence_sets (id) ON DELETE CASCADE,
    ordinal           integer  NOT NULL,
    kind              text     NOT NULL,
    detector          text     NOT NULL,
    field             text     NOT NULL,
    span_start        integer  NOT NULL,
    span_end          integer  NOT NULL,
    marker_text       text     NULL,                         -- a short marker that names no person (see below)
    PRIMARY KEY (evidence_set_id, ordinal),
    CONSTRAINT source_check_evidence_items_kind_check CHECK (kind IN (
        'isbn', 'publisherImprint', 'copyrightNotice', 'pageReference',
        'paidSiteTemplate', 'citedPaidSiteHost', 'modelJudgement')),
    CONSTRAINT source_check_evidence_items_detector_check CHECK (detector IN ('rules', 'model')),
    CONSTRAINT source_check_evidence_items_field_check CHECK (field IN (
        'title', 'description', 'tags', 'ingredient', 'step', 'citation')),
    CONSTRAINT source_check_evidence_items_span_check CHECK (span_start >= 0 AND span_end > span_start),
    CONSTRAINT source_check_evidence_items_marker_length CHECK (marker_text IS NULL OR char_length(marker_text) <= 200),
    CONSTRAINT source_check_evidence_items_no_free_text_marker
        CHECK (marker_text IS NULL OR kind NOT IN ('copyrightNotice', 'modelJudgement'))
);
```

- Only verified items are stored. A model quote that code did not find is counted in a metric and never written.
- **Marker text names no person.** These rows are shared and outlive erasure, so they keep a marker only when its value
  comes from a list or a fixed pattern: an ISBN, a listed imprint, host or template, a page number. A copyright notice
  can name the cook ("© 2024 Jane Doe") and a model judgement quotes free text, so for those two kinds only the field
  and span are kept. A listed rightsholder in a notice is stored as a separate `publisherImprint` item.
- `citedPaidSiteHost` has `field = 'citation'`. The citation is not checked text and is never sent to the model; the
  rules read it.
- A set with `model_run <> 'ran'` is rule-only, and nothing reuses it in place of a model run. The unique index admits
  only `ran` sets, so a later run after the budget returns writes a new set.

## 3. `recipe_source_checks`: the per-recipe outcome

One row per recipe and digest. The read rule asks for a row for the recipe's **current** digest that `allows`.

```sql
CREATE TABLE recipe_source_checks (
    recipe_id          uuid        NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
    text_digest        text        NOT NULL,
    evidence_set_id    text        NULL REFERENCES source_check_evidence_sets (id),
    state              text        NOT NULL,
    outcome            text        NULL,
    reason             text        NULL,
    judged_source_type text        NOT NULL,
    judged_cited_host  text        NULL,
    confirmed_at       timestamptz NULL,
    confirmed_by       text        NULL,
    overturned_at      timestamptz NULL,
    allows             boolean     NOT NULL DEFAULT false,
    checking_since     timestamptz NOT NULL DEFAULT now(),
    decided_at         timestamptz NULL,
    PRIMARY KEY (recipe_id, text_digest),
    CONSTRAINT recipe_source_checks_state_check CHECK (state IN ('checking', 'decided')),
    CONSTRAINT recipe_source_checks_outcome_check
        CHECK (outcome IS NULL OR outcome IN ('clear', 'possible', 'detected', 'unchecked')),
    CONSTRAINT recipe_source_checks_reason_check
        CHECK (reason IS NULL OR reason IN ('budgetSpent', 'tooLong', 'checkFailed')),
    CONSTRAINT recipe_source_checks_decided_has_outcome
        CHECK ((state = 'decided') = (outcome IS NOT NULL AND evidence_set_id IS NOT NULL AND decided_at IS NOT NULL)),
    CONSTRAINT recipe_source_checks_reason_iff_unchecked
        CHECK ((outcome = 'unchecked') = (reason IS NOT NULL)),
    CONSTRAINT recipe_source_checks_confirmed_by_check
        CHECK (confirmed_by IS NULL OR confirmed_by IN ('cook', 'curatorGrant')),
    CONSTRAINT recipe_source_checks_confirmation_complete
        CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL)),
    CONSTRAINT recipe_source_checks_overturn_only_detected
        CHECK (overturned_at IS NULL OR outcome = 'detected'),
    CONSTRAINT recipe_source_checks_source_type_check
        CHECK (judged_source_type IN ('user_created', 'imported_public'))
);

CREATE INDEX recipe_source_checks_checking ON recipe_source_checks (checking_since) WHERE state = 'checking';
```

### `allows` is computed by one pure function, never by SQL

`allowsPublication(outcome, confirmedAt, overturnedAt)` in `recipe-core` is the only author of `allows`:

| Outcome     | `allows` is true when                              |
| ----------- | -------------------------------------------------- |
| `clear`     | always                                             |
| `possible`  | `confirmed_at` is set (WA-2, spec FR-016 option A) |
| `unchecked` | `confirmed_at` is set (spec FR-020)                |

`confirmed_by` is `cook` for the cook's own confirmation, or `curatorGrant` when the recipe's provenance was declared
under the curator grant (spec FR-003a). It is set from the recorded grant or channel, never from the label.
| `detected` | `overturned_at` is set (a person overturned it) |
| none yet | never (`state = 'checking'`) |

Four writes change an input: the worker's outcome, a confirmation, an appeal decision and the next-period re-check. Each recomputes `allows` in
the same statement, with a compare-and-set on `(recipe_id, text_digest, state)`. Two writers touch this row
(recipe-service and the worker), and the digest key is what keeps either from writing a stale verdict onto new text.

### The state machine

```text
(no row) ──save with public intent──▶ checking ──outcome lands──▶ decided
                                         │                          │
                                         └──24 h, retries spent──▶ decided (unchecked / checkFailed)

decided: confirm (possible | unchecked) ─▶ allows
         appeal overturned (detected)   ─▶ allows
         re-check (unchecked only)      ─▶ decided again, with a new evidence set (spec FR-021)
         text changes                   ─▶ a NEW row for the new digest; this row is history
```

The re-check is the only transition out of `decided` for the same digest. It is allowed only while `outcome =
'unchecked'`, by a compare-and-set on `(recipe_id, text_digest, state, outcome)`. It writes a new evidence set and a new
outcome, and keeps `confirmed_at`/`confirmed_by` unless the new outcome is `detected`. A `detected` result clears
`allows`, writes an `automatedHold` decision and issues a statement of reasons.

## 4. `recipe_source_decisions`: the evidence of a hold or an appeal decision

This row is the evidence of a decision (`016-FR-052`). It is kept for 016's period (`016-FR-052a`, 3 years from the
decision), and it survives the recipe's deletion and account erasure. It holds the opaque owner id and the short marker
text, never the recipe text.

```sql
CREATE TABLE recipe_source_decisions (
    id                   text        PRIMARY KEY,               -- ULID
    recipe_id            uuid        NOT NULL,                  -- opaque: no FK, it survives the recipe
    owner_id             varchar(255) NOT NULL,                 -- opaque app user id, as recipes.owner_id
    text_digest          text        NOT NULL,
    kind                 text        NOT NULL,
    automated_means      boolean     NOT NULL,
    decided_by           text        NULL,                      -- operator identity; NULL only when automated
    ground               text        NOT NULL,
    facts                jsonb       NOT NULL,                  -- evidence kinds, fields and marker text
    decided_at           timestamptz NOT NULL,
    statement_in_app_at  timestamptz NULL,
    statement_email_at   timestamptz NULL,
    email_attempts       integer     NOT NULL DEFAULT 0,
    purge_after          timestamptz NOT NULL,
    CONSTRAINT recipe_source_decisions_kind_check CHECK (kind IN (
        'automatedHold', 'appealUpheld', 'appealOverturned', 'auditRestriction')),
    CONSTRAINT recipe_source_decisions_person_unless_automated
        CHECK ((kind = 'automatedHold') = (decided_by IS NULL)),
    CONSTRAINT recipe_source_decisions_automated_flag
        CHECK (automated_means = (kind = 'automatedHold'))
);
```

- The statement of reasons is derived from this row, as 016 derives its own from `notice_decisions`. Delivery is
  recorded per channel here, through 016's generalised delivery (research R-13).
- `purge_after = decided_at + 3 years`. 016's retention sweep honours it, and 016's legal holds can suspend it.

## 5. `recipe_source_appeals`

Deleted with the recipe and with account erasure. The decision it produced lives on in `recipe_source_decisions`.

```sql
CREATE TABLE recipe_source_appeals (
    id            text        PRIMARY KEY,                     -- ULID
    recipe_id     uuid        NOT NULL,
    text_digest   text        NOT NULL,
    reason        text        NULL,                            -- the cook's own words, at most 2,000 characters
    state         text        NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    due_at        timestamptz NOT NULL,                        -- created_at + 7 days (spec FR-030)
    decision_id   text        NULL REFERENCES recipe_source_decisions (id),
    FOREIGN KEY (recipe_id, text_digest) REFERENCES recipe_source_checks (recipe_id, text_digest) ON DELETE CASCADE,
    CONSTRAINT recipe_source_appeals_state_check CHECK (state IN ('open', 'upheld', 'overturned', 'withdrawn')),
    CONSTRAINT recipe_source_appeals_decided_has_decision
        CHECK ((state IN ('upheld', 'overturned')) = (decision_id IS NOT NULL)),
    CONSTRAINT recipe_source_appeals_reason_length CHECK (reason IS NULL OR char_length(reason) <= 2000)
);

CREATE UNIQUE INDEX recipe_source_appeals_one_open ON recipe_source_appeals (recipe_id, text_digest)
    WHERE state = 'open';
```

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
    evaluation_ref  text        NULL,                          -- the evaluation run that justified 'blocking'
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT source_check_enforcement_events_mode_check CHECK (mode IN ('shadow', 'blocking')),
    CONSTRAINT source_check_enforcement_events_blocking_cites_evaluation
        CHECK (mode <> 'blocking' OR evaluation_ref IS NOT NULL)
);
```

With no row, the mode is `shadow`.

## 8. The read rule

`isRecipeViewableBy` gains a **required** field, so every in-memory call site fails to compile until it supplies it
(the tactic its required `status` field already uses):

```text
viewable = owner
        OR (visibility = 'public' AND status = 'published' AND sourceCheckAllows)

sourceCheckAllows = mode = 'shadow'
                 OR EXISTS (recipe_source_checks rsc
                            WHERE rsc.recipe_id = r.id
                              AND rsc.text_digest = r.checked_text_digest
                              AND rsc.allows)
```

The same condition joins the three SQL twins (`viewableBy`, `readableBy`, `communityOf` in `recipePredicates.ts`).
The `EXISTS` is a primary-key lookup.

## 9. Erasure and retention

| Table                              | On recipe delete | On account erasure                            | Retention                         |
| ---------------------------------- | ---------------- | --------------------------------------------- | --------------------------------- |
| `recipe_source_checks`             | cascade          | deleted with the recipes                      | life of the recipe                |
| `recipe_source_appeals`            | cascade          | deleted                                       | life of the recipe                |
| `recipe_source_decisions`          | kept             | kept (evidence, `016-FR-052a`)                | 3 years, then purged              |
| `source_check_evidence_sets/items` | kept             | kept, `RETAINED_BY_RULING` (no user, no text) | life of the rule set, then pruned |
| `content_source_markers`           | n/a              | n/a                                           | permanent, retired not deleted    |
| `source_check_enforcement_events`  | n/a              | n/a                                           | permanent                         |

`erasureSweepCoverage.test.ts` must list each new table in one of its two maps.
