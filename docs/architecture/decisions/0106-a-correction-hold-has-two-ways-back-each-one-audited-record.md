# 0106: A correction hold has two ways back, and each is one audited record

- **Status:** Accepted
- **Date:** 2026-11-28
- **Supersedes:** [ADR-0095](0095-a-recorded-source-is-kept-and-a-recipe-is-public-only-with-a-statement.md), the write-side
  evidence rule that counts evidence captured as `staffCorrection`. The write side now ignores those rows, as the read side
  does since ADR-0105.
- **Supersedes:** [ADR-0100](0100-a-confirmed-source-answer-is-locked-and-staff-correct-it-through-one-route.md) §2, the
  words "Never cleared" in the column's comment and in the ratchet's message.
- **Supersedes:** [ADR-0103](0103-the-recipe-state-model-is-code-and-staff-can-clear-the-correction-hold.md) Decision 2,
  the bullets "a staff-only edge", "one audited exit" and "needs the scope" as they describe the only exit, and the
  per-clone release rule, restated in Decision 5 below.
- **Supersedes:** [ADR-0105](0105-a-held-recipe-is-hidden-never-made-private.md) D4 (the ratchet sentence, made exact in
  Decision 2), D5 (the system clear reads every correction row in the chain, not "the latest") and D7 (the clone sentence,
  Decision 5).
- **Relates to:** [ADR-0097](0097-a-recipe-has-one-state-model-and-only-commise-changes-a-confirmed-source.md) Decision 3,
  [ADR-0074](0074-content-source-check.md) and [ADR-0039](0039-database-role-split.md).
- **Drivers:** the owner's rulings of 2026-11-28: a held recipe can be made public again when what blocked it is resolved,
  and the cook's own rewrite works for a paid-book finding.

## Context

`recipes.source_correction_hold` was set by a staff correction and never cleared. A mistaken correction was permanent, and a
cook who rewrote a recipe corrected to a third-party source had no way back.

## Decisions

1. **Two causes, one table.** `recipe_source_hold_clears` holds one row per cleared recipe: `cause` is `staff` (with the
   actor and a required reason) or `earnedRewrite` (no actor, the fixed reason `earnedRewrite`). The column `recorded_at` and
   `xact_id` (`xid8`, `pg_current_xact_id()`) are written by a BEFORE INSERT trigger, never by the caller.
   `UNIQUE (recipe_id, xact_id)`. The table is append-only by trigger, with the carve-outs of
   `recipe_source_corrections` (recipe deletion; the erasure relabel of the actor, which freezes every other column).
2. **The database gate.** The ratchet is an AFTER UPDATE row trigger with a `WHEN` on the column, so it sees the final row
   after every BEFORE trigger. True to false is allowed only when a clear record exists for the same recipe, the same
   transaction and the same instant. False to true is refused when such a record exists: no hold after a clear in the same
   transaction. A deferred constraint trigger on the record checks at commit that the hold is false, so a clear rolled back
   to a savepoint cannot leave a record behind. Enforcement is by trigger and not by grant: the grant setup of 0086
   re-grants every table, so the application roles can UPDATE and DELETE. "Staff only" is a service rule, and no reader or
   cook response selects the table.
3. **Eligibility is a service policy, and the database cannot know "earned".** A staff clear is allowed for any held recipe
   when the caller names the newest correction it saw. An earned clear is allowed only when every correction row in the chain
   of the recipe (itself and each ancestor by `cloned_from_id`) has a third-party answer (book, paid site, web page); an own
   or from-person row, or no row, refuses (fail closed). The domain is narrow: a correction holds only when the new answer
   is own or person, or the old answer was a paid site. A book label stays hidden through the private-only term after the
   clear.
4. **The staff route.** `POST /api/v1/recipes/:id/source-correction/hold-clear`, scope `recipes:source:correct`, body
   `{ ownerAccountId, correctionId | null, reason }`. One error code `HOLD_CLEAR_CONFLICT` (409) with `details.reason` in
   `HOLD_NOT_SET`, `CORRECTION_NOT_LATEST`, `LOCK_CONFLICT`. One metric `source.holdCleared`, valued at the number of holds
   cleared, with an alarm above ten a day and a runbook section. The earned clear is service-internal: no controller and no
   request field reach it.
5. **The clone walk.** A staff clear releases each same-owner descendant that has no correction row of its own and whose
   nearest held ancestor is released. Lock order: the owner's private-slot advisory lock, the recipe row, then the
   descendants in ascending id; the release set is derived after the locks. A deadlock from a row locker outside the slot
   lock answers 409 `LOCK_CONFLICT`. The earned clear releases only the earning recipe, takes no slot lock and opens no
   transaction.
6. **The read rule gains a fourth term.** `recipe_held_from_readers` adds `recipe_is_from_person(r.id)`, so a from-person
   recipe stays hidden after a clear. A later rewrite of the body keeps that term (a CI guard checks the newest definition);
   the exemption planned for the private-only and evidence terms does not cover it.
7. **Write side aligned.** `sourceConflictOf` ignores `staffCorrection` evidence. The SQL twin `recipe_holds_third_party_source`
   keeps its body (an earlier worker may still call it) and carries a legacy comment.
8. **Erasure.** The actor of a staff clear is relabelled like the actor of a correction; deleting a recipe cascades its records.

## Consequences

- Trust model: a savepoint takes the top-level transaction id, so the deferred check catches a rolled-back clear. `COMMIT
PREPARED` and logical apply run no trigger. An owner or master role bypasses every trigger; DD17 keeps services off those
  roles. `xid8` with `recorded_at` survives a restore into a new cluster.
- The ratchet is a one-way door: it ships right the first time.
- Accepted: a clone inserted during a staff clear keeps the hold (staff clears again); an earned clear leaves clones to their
  own rewrite or to staff; a chain with an own or from-person row is staff-only; a broken chain (an erased ancestor) can make
  a clone earned-eligible on its own rows; a 40P01 becomes a 409.
- Until P8h, nothing calls the earned clear in production; a test caller proves it.
