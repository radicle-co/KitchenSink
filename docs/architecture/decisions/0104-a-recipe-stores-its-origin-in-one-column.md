# 0104: A recipe stores its origin in one column

- **Status:** Accepted
- **Date:** 2026-11-27
- **Amends:** [ADR-0023](0023-curator-declared-provenance.md) §1b, [ADR-0089](0089-a-pasted-web-link-sets-the-source-and-a-web-copy-stays-private.md),
  [ADR-0095](0095-a-recorded-source-is-kept-and-a-recipe-is-public-only-with-a-statement.md) and
  [ADR-0097](0097-a-recipe-has-one-state-model-and-only-commise-changes-a-confirmed-source.md) Decision 5, where they
  name the three columns `source_type`, `source_kind` and `statement_kind` on `recipes`. They now name `recipes.origin`.
  Their rules stand. Only the column they are stored in changes.
- **Relates to:** [ADR-0103](0103-the-recipe-state-model-is-code-and-staff-can-clear-the-correction-hold.md), whose
  module holds the `Origin` values. [ADR-0072](0072-bulk-recipe-import.md), whose import item keeps its own
  `statement_kind`.
- **Drivers:** the owner's ruling of 2026-11-27, and the state-model plan.

## Context

A recipe's origin is stored in three columns that must agree: `source_type` (`user_created`, `imported_public`,
`imported_physical`, `imported_paid`), `source_kind` (`public_web`, `book`, `paid_site`) and `statement_kind`
(`authored`, `source`, `fromPerson`). Pairing CHECKs keep them in step, and several vocabularies name the same
facts (the columns, the import item, the wire, the attestation choice and the preview). ADR-0097 Decision 5 said the
values would move to one field under their own ADR. This is that ADR.

The Commise-written public version (spec 003B) needs a new origin value. Adding it to three columns would add a
fourth vocabulary.

## Decision

1. **`recipes.origin text NOT NULL DEFAULT 'unstated'`**, with a CHECK on eight values: `unstated`, `own`, `webPage`,
   `book`, `paidSite`, `person`, `publicDomain` and `commiseWritten`. "Unstated" is a value and not NULL, so every row
   names its origin.
2. **The column comes in by expand and contract.** Migrations are expand-only, and the schema is deployed ahead of the
   service that reads it (ADR-0035). The running service reads the old columns, so an add and a drop in one migration
   would break every recipe read and write, and a service rollback could not fix it. The owner's ruling of
   2026-11-27, as the plan records it: "Origin is stored in one column, `recipes.origin`, under its own ADR, landed
   before #511 merges. `commiseWritten` starts in it." The backfill stays, although nothing is live: the
   matches-triple CHECK below fails on any row that exists in the sandbox with a default `origin`.
    - **Expand (the first change).** Add `origin` and backfill it with one CASE over the triple. The CASE covers every
      combination today's CHECKs allow, not only the ones the app writes. A curator import is `publicDomain` and a web
      page is `webPage`, decided by the kind and never by whether a link is present. Keep the three old columns.
    - **`commiseWritten` has one owner, this change.** It adds `commiseWritten` to the `origin` values, adds
      `commise_written` to the old `source_type` CHECK (only so the sync trigger can mirror it during the window), and
      adds it to the sync mapping, the codec and the parity table. The 003B plan (#511) names only `origin`.
    - **A sync trigger,** `recipes_origin_sync` (BEFORE INSERT OR UPDATE), keeps the four columns in step from whichever
      side a statement changed. A write from the previous release sets only the triple and the trigger derives
      `origin`. A write from the new service sets `origin` and the trigger derives the triple. On insert a non-default
      `origin` wins. A CHECK, `recipes_origin_matches_triple`, fails any row where they disagree.
    - **Functions and triggers move to `origin`,** each with `CREATE OR REPLACE`, and each gives the answer it gives
      today: `recipe_needs_statement`, `recipe_is_from_person` (which keeps its attestation arm),
      `recipes_clone_inherits_from_person`, and `recipes_stated_source_has_evidence`. The constraint trigger of the last
      is dropped and created again as `UPDATE OF source_kind, origin, source_url`, with
      `WHEN (NEW.origin IN ('webPage', 'book', 'paidSite'))`. It names both columns because Postgres matches
      `UPDATE OF` against the statement's SET list, and a previous-release write never names `origin`. The tables that
      keep their own `source_kind` and `statement_kind` (the evidence and the import tables) are not touched.
    - **The correction audit table** gets `old_origin` and `new_origin`, each with a CHECK on the eight values. They are
      backfilled with the append-only trigger disabled and enabled again inside the migration's one transaction. The
      expand change adds no NOT NULL, because a previous-release writer sets neither column. A BEFORE INSERT trigger
      on `recipe_source_corrections` fills both columns from the triple, and the contract change does the final
      backfill and sets NOT NULL. The writer writes both sets during the window. The append-only function also freezes
      the new columns in its relabel branch.
    - **A new CHECK refuses two shapes** that today's CHECKs allow and no writer produces: `imported_physical` or
      `imported_paid` with no source kind and no statement. The backfill maps them like the other rows, and the CHECK
      stops new ones.
    - **Step order inside the expand change:** add the column and its CHECK; backfill `origin`; add the sync trigger and
      the matches-triple CHECK; replace the functions and the constraint trigger; restate the CHECKs on `origin`; add
      the correction table's new columns, backfill them with its append-only trigger disabled and then enabled again,
      add its fill trigger, and replace its append-only function. The service and every reader move in the same
      release.
    - **Raw SQL outside migrations** that names the old columns, such as the erasure worker's private-only key
      predicate, moves to `origin` in the same change, and its key format moves with it.
    - **Contract (a later change).** It waits for two things: every deployed reader of the triple, the Drizzle
      declarations included, and one release with no rollback after the deployed service stopped reading and writing
      the triple. In order: do the final backfill of the correction table's new columns and set them NOT NULL, replace
      the append-only function without the old columns, narrow the constraint trigger to
      `UPDATE OF origin, source_url`, drop the sync trigger, `recipes_origin_matches_triple` and the old CHECKs, then
      drop the three columns and the old triple columns of the correction table.
3. **The pairing CHECKs are restated on `origin`,** and the old ones stay until the contract change. The restated
   rules allow every row the old ones allow, with one exception: the new CHECK above, which refuses two shapes no
   writer produces. Today's schema allows `book` and `paidSite` with no citation, and so does `origin`. A stricter rule
   is its own decision. The rules are the closed value lists (migrations 0001, 0071 and 0087), the pairing of each
   source kind with its type, the rule that a web page needs its link (0071), and the rules that "I wrote this" and
   "from another person" carry no source (0087).
4. **`publicDomain` is written only with the grant `recipes:import:public`.** Only the column it is stored in changes.
5. **`commiseWritten` is written only by the 003B publish.** The value is added by the expand change (Decision 2),
   and the 003B plan (#511) names only `origin`.
6. **These stay as they are:** the attestation `choice` (`authored`, `publicWeb`, `book`, `paidSite`, `fromPerson`,
   `cleared`, `publicConfirm`), the import item's `statement_kind` and the evidence `source_kind`. They are answer
   words, or facts about one piece of evidence. One codec in recipe-core maps an answer to an origin.
7. **The wire does not change.** The codec maps `origin` to today's wire fields. A wire change is its own decision.

## Consequences

- One column, one value set, one codec. A new origin is one CHECK value and one codec case.
- Every reader and writer of the three columns moves in the expand change. A parity test records the answers of
  `sourceLockOf`, `privateRuleOf`, `fromPersonOf`, `statementRequiredOf` and `publicRefusalOf` for every allowed
  combination before anything changes, and asserts that the `origin` path gives the same answers. A local end-to-end
  test proves the column, the sync trigger in both directions, a previous-release insert that sets only the triple, the
  backfill of every allowed triple, and the constraint trigger firing on an update that sets only `source_kind`.
- The contract change drops the old columns, and a local end-to-end test then runs a clone insert, a stated-source
  insert, a correction relabel and an erasure.
- A recipe that is "from another person" only by an attestation stays `unstated` plus the attestation fact. It is not
  folded into `person`, because an attestation is appended to another table with no update to `recipes`.
- The expand change lands before the 003B plan's migration and after the open source-lock change merges. Migration
  numbers are taken at merge.
- The 003B plan's columns and ADR-0102 §3 name `origin` and not `source_type`. The merge order is #523, then the expand change, then #511.

## Alternatives considered

- **Make `commise_written` a `source_type` value and stop there.** It keeps three columns that must agree and adds a
  value to each vocabulary. The old CHECK takes it only so the sync trigger can mirror it. Rejected.
- **A lookup table of origins.** The set is closed and small, and a CHECK states it where the rows are. A table adds a
  join and a deploy step for no gain. Rejected.
- **Keep the three columns and generate their pairing from the module.** The pairing is the cost, and it stays.
  Rejected.
- **Add and drop in one migration.** It breaks the running service, which still reads the old columns, and a service
  rollback cannot fix it. Rejected.
