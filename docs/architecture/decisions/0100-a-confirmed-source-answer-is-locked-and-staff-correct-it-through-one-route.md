# 0100: A confirmed source answer is locked, and staff correct it through one route

- **Status:** Accepted
- **Date:** 2026-11-21
- **Relates to:** [ADR-0097](0097-a-recipe-has-one-state-model-and-only-commise-changes-a-confirmed-source.md)
  decision 3. This ADR adds no second supersession. It records how decision 3 is stored and enforced.
- **Relates to:** [ADR-0095](0095-a-recorded-source-is-kept-and-a-recipe-is-public-only-with-a-statement.md) and
  [ADR-0074](0074-content-source-check.md), whose public check reads the hold below.
- **Drivers:** the plan `everyAnswerSourceLock` (P8), signed by po, qse, staff and designer, with redteam
  conditions 1 to 5 met.

## Context

ADR-0097 decision 3 says that only Commise changes a confirmed source answer. The code had no stored fact for
"confirmed" and no route for the change. A boolean in the client could not hold the rule, and a cook could still
change the answer in the editor.

## Decision

1. **`recipes.source_confirmed_at`** (nullable timestamp) records when the answer was confirmed. The database sets
   it, once, and never clears it: on the first publish (also an insert that is already published, and an erasure
   donation), and when a staff correction runs. The service sets it when a cook makes a recipe public with a
   statement. Editing a draft never confirms.
2. **`recipes.source_correction_hold`** (boolean, default false) keeps a corrected recipe off Public. It is a
   ratchet: only a staff correction sets it. A CHECK refuses a held recipe that is public. A clone inherits the hold
   by trigger. The public check, the default clone visibility, the erasure donation and the wire read it.
3. **`recipe_source_corrections`** is an append-only record of each correction: actor, old and new answer, ground,
   reason. A correction also appends source evidence with capture `staffCorrection`. An erased staff account is
   relabelled to one `erased_` token, and only while its erasure job runs. A deleted recipe takes its records with it.
4. **One route**, `POST /api/v1/recipes/:id/source-correction` (and its read-only `GET` preview, for the runbook), behind the grant `recipes:source:correct`. A pure
   policy returns one of `forbidden`, `notFound`, `invalidTarget`, `unchanged` or `apply`. The command takes the
   per-user lock, then `FOR UPDATE`, and does not bump the version.
5. **The lock is one function**, `sourceLockOf(facts)` in recipe-core: `open`, `downgradeOnly` or `locked`. It
   replaces the boolean `sourceIsCorrectable`. A locked answer refuses the cook with the typed 403 `SOURCE_LOCKED`.
6. **Trust model.** Integrity rests on two things. Staff hold the scope. Every `admin` and `superuser` account
   holds `recipes:source:correct` through `ROLE_SCOPES` (owner ruling 2026-10-15), and a scope can also be set in Clerk
   `public_metadata`. Revocation is a role change or a `public_metadata` change in Clerk (session tokens are short-lived). And the runbook asks the owner to prove the mailbox, which code
   cannot check.

## Consequences

- A mistaken hold (the wrong recipe of the right owner) is undone only by a migration. The runbook preview before
  apply is the guard.
- The column, triggers, CHECKs and table are reversible by migration while the app is not live. They are one-way at
  launch, because cooks will have confirmed answers.
- A forged or insider correction needs the owner's mailbox or a scoped staff token. It makes a recipe private and
  held, which cannot open Public. An in-app request record is the upgrade path.
