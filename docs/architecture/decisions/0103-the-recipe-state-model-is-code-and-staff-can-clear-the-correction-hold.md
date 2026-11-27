# 0103: The recipe state model is code, and staff can clear the correction hold

- **Status:** Accepted
- **Date:** 2026-11-27
- **Supersedes:** [ADR-0097](0097-a-recipe-has-one-state-model-and-only-commise-changes-a-confirmed-source.md)
  Decision 1, that decision only: the model document is the authority, and its JSON copy follows it. The code is the
  source now, and the document's tables are generated from it (Decision 1 below). The rest of ADR-0097 stands.
- **Supersedes:** [ADR-0100](0100-a-confirmed-source-answer-is-locked-and-staff-correct-it-through-one-route.md) §2,
  the sentence "It is a ratchet: only a staff correction sets it", and the first Consequences bullet, "A mistaken hold
  (the wrong recipe of the right owner) is undone only by a migration". Staff can now clear the hold (Decision 2). The
  rest of ADR-0100 stands, including the CHECK that refuses a held public recipe.
- **Relates to:** [ADR-0074](0074-content-source-check.md), whose read rule the model cites and does not own.
  [ADR-0038](0038-authored-food-withdrawal.md): the clause-level `Supersedes:` form.
- **Drivers:** the owner's rulings of 2026-11-27, and the state-model plan.

## Context

The recipe state model lives in a document. A guard reads the JSON beside it as text, and no code reads the
model. So the model and the code can drift, and they have: the stored values, the refusal names, the labels and the
transitions are written in the document, in the recipe service and in the apps, each in its own words. A document that
code does not read cannot tell anyone that it is wrong.

ADR-0100 also made the correction hold a ratchet, and the hold had no way out. A staff correction made in error left
the recipe off Public for good, until a migration ran. Staff need a way to lift it, and it must leave a record.

## Decision

1. **The code is the source.** A pure module in recipe-core holds the stored values, the enforced transitions
   (`TRANSITIONS`), the planned ones (`PLANNED`, which nothing reads at runtime), the creation table, `refusalOf` and
   the registry of labelled names. The service and the apps call it. `recipeStateModel.json` and the tables and
   mermaid blocks of `recipeStateModel.md` are written from the module by a generator, between markers. The prose of
   the document stays hand-written. CI fails on a diff. Until the generator lands, the document is the authority and
   already carries its tables between the markers.
2. **Staff can clear the correction hold.** `CLEAR_SOURCE_HOLD` is a staff-only, audited edge.
    - It lifts the hold only. It never makes a recipe public. The recipe stays private, and the cook can make it public
      through the usual route, with every guard `refusalOf` applies.
    - The CHECK `recipes_held_is_not_public` does not change.
    - **Who can clear it.** The route is `POST /api/v1/recipes/:id/source-correction/hold-clear`, behind the grant
      `recipes:source:correct`, with the same per-user lock and row lock as the correction. The service checks the
      grant. The database does not.
    - **How the database checks it.** The ratchet trigger changes. A true to false update is allowed only when a clear
      record for the same recipe has the current transaction's id. The record's `xact_id` is an `xid8` set by a trigger
      (`pg_current_xact_id()`), so no writer supplies it. The service inserts the record before it updates the recipe.
      Any other update that clears the hold still raises. False to true is unchanged. The rule proves that an audit row
      exists. It does not prove who wrote it.
    - **The record** is a new append-only table, `recipe_source_hold_clears`: recipe, staff actor, reason, time and
      transaction. It is not a row of `recipe_source_corrections`, whose shape is an answer change. It has a no-truncate
      trigger.
    - **Erasure.** The actor column is relabelled to an `erased_` token when that staff account is erased, by the same
      rule as the correction table: only the actor changes, and only while the account's erasure job is queued or
      running (or its test reset is running). The erasure worker relabels it beside the two correction relabels. The
      trigger also allows the DELETE that cascades from deleting the recipe, and refuses any other DELETE.
    - **Held clones are released.** The clear mirrors the correction's clone hold. In the same transaction it releases
      the owner's descendants of the recipe, found by the same walk, and skips a descendant that has a correction of
      its own. It writes one record for each recipe it releases. Other cooks' clones keep their hold, and each is
      cleared on its own. A clone made after the clear starts unheld. Every released recipe stays private.
    - The exact shape of the record is settled by a staff-architect BLUEPRINT before the code is written.
    - This ADR merges before the code that clears a hold.
3. **Holds are a set of independent facts.** Each hold is its own stored fact. A hold either forces a recipe private
   by a CHECK, or hides it from readers in the read rule, as its own conjunct beside ADR-0074's. No column holds "the"
   restriction.
4. **Refusal names on the wire.** `details.reason` takes the `REFUSAL_*` names, which is a one-way door once a client
   ships. For a window the server and the client accept the old and the new reason together. An installed mobile
   client sends and reads the old reason strings, so the client accepts both for one release. The server keeps sending
   the old value until the mobile floor version reads the new one. Then the old values go. The top-level error codes
   stay.

## Consequences

- The model, the service and the apps share one definition. A guard can compare each to the module, and the document
  stops being a second copy that nothing checks.
- A mistaken correction can be undone by staff in the product, with a record of who did it and why. The runbook
  replaces the migration.
- **Trust model.** The database proves only that a clear record for the same recipe was written in the same
  transaction. The service's database role can write both the record and the column. A compromised service can clear a
  hold, and the record is the evidence. This is the same trust as for corrections (ADR-0100).
- The ratchet is now a ratchet with one audited exit. A forged or insider clear needs the scope and writes a record in
  the same transaction. It cannot make a recipe public by itself.
- The 0092 column comment, "never cleared", changes with the migration that adds the clear.
- Planned edges are listed apart from enforced ones. An edge moves from `PLANNED` to `TRANSITIONS` in the change that
  enforces it.

## Alternatives considered

- **Keep the document as the source, with a guard that reads it.** A guard can only compare text, and so it can never
  prove that a transition in the code is the one in the document. Rejected.
- **Make the clear a row of `recipe_source_corrections`.** That table records an answer change (old and new answer, a
  ground). A clear changes no answer. Rejected.
- **Clear by a migration only.** It needs an engineer for each mistake, and it leaves no product record. Rejected.
- **A cook-side clear.** The hold exists because the cook's answer was wrong. The cook cannot lift it. Rejected.
