# Phase 1 Data Model: ReciMe Parity (017)

**Date**: 2026-08-22 · **Plan**: [`plan.md`](./plan.md) · **Research**: [`research.md`](./research.md)

Naming follows **GR-004** (snake_case tables/columns, ULID ids). Migrations are **EXPAND-FIRST** and run via
the in-stack Trigger of **ADR-0022** — never a pipeline step.

⚠️ **Reused, not redefined.** `IngredientQuantity` / `ABSENT_QUANTITY` (`recipe-core`) already model unstated
amounts and are consumed unchanged (R-01). No entity here re-declares a quantity.

---

## 1. Household — the one-way door

```text
households
  id              ULID  PK
  display_name    text            -- defaults to the creating user's handle
  created_at      timestamptz     -- ISO-8601 at every interface
  updated_at      timestamptz

household_members
  household_id    ULID  FK -> households.id   ON DELETE CASCADE
  user_id         ULID                        -- app ULID, not the Clerk sub
  role            text            -- 'owner' | 'member'
  state           text            -- 'invited' | 'active' | 'removed' | 'left'
  invited_at      timestamptz
  joined_at       timestamptz NULL
  PRIMARY KEY (household_id, user_id)
  UNIQUE (user_id) WHERE state = 'active'     -- one active household per account
```

**Invariants** (enforced in `packages/shared/household-core`, pure, so both apps and the service agree):

1. **Every account has exactly one active household**, created implicitly at signup. There is no
   "user without a household" state, so no code path needs that branch (R-07).
2. A household always has **≥1 `owner` in `active`**. The last owner may not leave; they may transfer or
   delete the household.
3. `state` is a **state machine**, not a flag: `invited → active → (removed | left)`. `removed`/`left` are
   terminal for that row; re-joining writes a new row so history survives.
4. **Content stays with the household** when a member departs (FR-032). A departing member keeps their own
   personal recipes, which are owned by `user_id`, not by the household.
5. **Role capability** (confirmed 2026-08-22): every `active` member may create, edit, check off, and
   **complete/archive** shared content (FR-030a, FR-030c). **Reserved to `owner`**: invite, remove, delete the
   household, and _delete_ shared content (FR-030b). The rule is uniform across grocery lists, meal plans and
   the aisle taxonomy — one truth table, no per-resource exceptions.
   5a. **Sole-owner departure transfers ownership** to the longest-tenured `active` member (FR-032a), including on
   GDPR erasure, which MUST NOT be blocked. Ties resolve by a stable secondary key so the outcome is
   deterministic. The transfer is written **before** the departing row is removed and is idempotent under
   redelivery (FR-032b). `display_name` is re-derived if it carried the erased owner's handle (FR-032c).
6. **Seats** are `min(subscription seat allowance, active member count)`. The allowance is read from the
   signed `public_metadata` claim `010-FR-044` already publishes — **no new lookup, no new token claim**.

**Migration ordering (EXPAND-FIRST)**: create tables → backfill one household per existing account →
add `household_id` to plans/lists **nullable** → dual-write → flip reads → drop owner-scoping in a _later_
release. `006-FR-029`'s owner scoping is only removed once nothing reads it.

### Ownership transfer, stated explicitly

| Today                                     | After                                                                |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `meal_plans.owner_user_id` (`006-FR-029`) | `meal_plans.household_id`                                            |
| grocery lists scoped to owner             | `grocery_lists.household_id`                                         |
| personal recipes                          | **unchanged** — still `user_id`. Recipes are not household property. |

That last row is deliberate: making recipes household-owned would silently change who can erase them and
collide with `015`'s reward grants and `016`'s per-user content licence.

---

## 2. Capture — the waterfall record

```text
captures
  id                 ULID PK
  user_id            ULID
  source_ref         text          -- the URL or opaque share payload reference
  channel            text          -- 'chooser'|'share_sheet'|'extension'|'migration'
  channel_class      text          -- 016-FR-028: 'user_supplied_bytes' | 'operator_retrieval'
  outcome            text          -- 'draft'|'no_recipe'|'unreadable'|'failed'
  resolved_tier      smallint NULL -- the tier that produced the draft
  created_at         timestamptz

capture_tier_results
  capture_id         ULID FK -> captures.id ON DELETE CASCADE
  tier               smallint      -- 1..5
  attempted          boolean
  yielded            boolean
  insufficiency      text NULL     -- why it did not satisfy the floor
  cost_micros        bigint        -- FR-039 attribution; 0 for non-inference tiers
  PRIMARY KEY (capture_id, tier)
```

**Invariants**:

1. Tiers are attempted **in order** and stop at the first that satisfies the completeness floor. A row with
   `tier = n, attempted = true` implies rows exist for every `tier < n` (FR-002).
2. `resolved_tier` is null exactly when `outcome != 'draft'`.
3. **`outcome` distinguishes `no_recipe` from `unreadable`** — FR-008's requirement, and the thing ReciMe
   collapses into one generic error.
4. `channel_class` for any video source is **always `operator_retrieval`** (FR-015, accepted under
   `016-FR-029` — a user cannot hand us the bytes of a hosted video).
5. ⛔ **No frame, decoded audio, or derived rendition is persisted** — `capture_tier_results` stores
   _outcomes and costs_, never media (FR-011, `016-FR-027`).
6. `cost_micros` is written by the **settle** step of ADR-0024's reserve-then-settle counter, never
   incremented from a response, and never retried (settle is not idempotent).
7. **Rows are the resume log** (clarified 2026-08-22, FR-011a): each tier commits before the next begins, so a
   retried capture resumes at the first tier with no row. This is why `capture_tier_results` is a table rather
   than a JSON column on `captures` — a partial waterfall must be durable at a tier boundary.

**Per-field provenance** rides on the draft, not this table: each extracted field carries the tier that
produced it plus the confidence `004-FR-015` already requires. That satisfies SC-009 without a second store.

---

## 3. Unit preference — a view, never a recipe property

```text
user_preferences
  user_id         ULID PK
  unit_system     text     -- 'metric' | 'imperial'
```

**Invariants**: conversion is **display-only** (FR-026) — the stored recipe is never rewritten. An `absent`
quantity converts to `absent`. A line stating both systems ("1 lb (450 g)") is converted **once**. Conversion
is a pure function in `recipe-core/src/units/`, so web, mobile and export share one implementation.

---

## 3a. Shared-content lifecycle — why `complete` is a state, not a delete

Applies **uniformly** to grocery lists, meal plans and the aisle taxonomy (confirmed 2026-08-22):

```text
<shared content>
  ...
  state           text     -- 'active' | 'completed' | 'archived'
  completed_at    timestamptz NULL
  completed_by    ULID NULL
```

**Invariant**: `complete` is a **state transition any active member may perform** (FR-030c); `delete` is a row
removal **reserved to owners** (FR-030b). Modelling completion as a state is what keeps the owner-only
restriction out of the end-of-shop path, and keeping it uniform is what keeps `householdPolicy` a single truth
table rather than a per-resource switch.

⚠️ Note the house rule this inherits: outside the account-erasure worker, "delete" in this system sets
`deleted_at` rather than issuing `DELETE`. Owner-only `delete` here means the **soft** delete; the erasure
worker remains the only path permitted a hard purge.

## 4. Aisle taxonomy

```text
household_aisle_categories
  household_id    ULID FK -> households.id ON DELETE CASCADE
  position        smallint
  label_key       text     -- localisation key, never a literal (NFR-006)
  PRIMARY KEY (household_id, position)
```

Per-**household**, not per-user (FR-029) — two people shopping one list must see one ordering. Absent rows
mean the system default; a household never sees an empty taxonomy.

---

## 5. Library migration

```text
library_migrations
  id              ULID PK
  user_id         ULID
  source_app      text     -- 'paprika'|'anylist'|'copymethat'|'recime'|'commise'
  total           integer
  processed       integer  -- restart position (FR-017)
  created_at      timestamptz

library_migration_items
  migration_id    ULID FK -> library_migrations.id ON DELETE CASCADE
  ordinal         integer
  outcome         text     -- 'imported'|'skipped'|'failed'
  detail          text NULL
  recipe_id       ULID NULL
  PRIMARY KEY (migration_id, ordinal)
```

**Invariants**: a failed item never discards succeeded ones (FR-017); restart resumes from `processed` without
duplicating; **`source_app = 'commise'` is the round-trip importer** that makes FR-020 testable — today an
exporter exists with nothing to prove it lossless (R-02).

---

## Entities deliberately NOT introduced

| Not added                        | Why                                                                                                                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A media/frame table              | FR-011 and `016-FR-027` — nothing is persisted, so there is nothing to model.                                                                                                                                           |
| A second spend ledger            | ADR-0024 has **one** ceiling and one counter; `cost_micros` references it, it does not duplicate it.                                                                                                                    |
| A recipe-level unit field        | Conversion is a view (§3). A stored unit would make two recipes of one.                                                                                                                                                 |
| A separate "shared list" join    | The household **is** the sharing boundary (FR-030). A per-list ACL would be the second ownership path R-07 rejects.                                                                                                     |
| A notifications table            | The completion signal is published through `shared/messaging`'s existing publisher port (R-08). `014` owns delivery and its own storage; duplicating it here would create a second notification authority.              |
| A `roles` or `permissions` table | Role is a column on `household_members` and the rules are a pure function (R-09). A permissions table would be the speculative generality CLAUDE.md's YAGNI rule forbids — there are exactly two roles and six actions. |
