# 0105: A held recipe is hidden from readers, and Commise never makes a recipe private

- **Status:** Accepted
- **Date:** 2026-11-27
- **Supersedes:** [ADR-0073](0073-free-tier-private-slots.md) §11, the bullet "Not approved becomes private, and uses a
  slot", and the bullet "A blocked save with no free slot is refused". Also §7's refusal of a create with no free slot.
  The rest of ADR-0073 stands, including the slot count, the lock and `PRIVATE_SLOTS_FULL` for a move the cook chooses.
- **Supersedes:** [ADR-0074](0074-content-source-check.md) §3a, the move to `private` in "Not approved ends review", and
  the second write-side refusal ("a detected save by a free cook with no free slot"). The read-rule hold of §1, the
  first and third write-side refusals and every other part stand.
- **Supersedes:** [ADR-0100](0100-a-confirmed-source-answer-is-locked-and-staff-correct-it-through-one-route.md) §2, the
  words "keeps a corrected recipe off Public" and the sentence "A CHECK refuses a held recipe that is public". Also
  the last Consequences bullet's "It makes a recipe private and held". The rest stands.
- **Supersedes:** [ADR-0103](0103-the-recipe-state-model-is-code-and-staff-can-clear-the-correction-hold.md) Decision 2,
  three bullets: "It lifts the hold only. It never makes a recipe public. The recipe stays private…", "The CHECK
  `recipes_held_is_not_public` does not change", and "Every released recipe stays private". Also the words "a
  staff-only, audited edge" in that decision's first sentence, and the record's "staff actor" (model 4.6.1): a system
  clear for an earned rewrite writes a clear record too. The rest stands.
- **Relates to:** [ADR-0097](0097-a-recipe-has-one-state-model-and-only-commise-changes-a-confirmed-source.md)
  Decision 3, whose system unblock this ADR uses. [ADR-0095](0095-a-recorded-source-is-kept-and-a-recipe-is-public-only-with-a-statement.md),
  whose evidence rule is read, in part, by the read-rule function. [ADR-0082](0082-recipes-are-an-open-library-of-facts-cooks-words-and-gated-public-domain.md),
  the signed-out reader. [ADR-0038](0038-authored-food-withdrawal.md): the clause-level `Supersedes:` form.
- **Drivers:** the owner's rulings of 2026-11-27, Solar's P10 and P8h, and the state-model plan.

## Context

Several rules move a public recipe to `private` when it can no longer be shown: a staff correction, a review that ends
without approval, and a later check. A free cook has a limit on private recipes, so a move made by Commise can push a
cook over the limit, and it spends a slot the cook did not choose to spend. The owner ruled that Commise never makes a
recipe private. Only the cook does, and only with a free slot. A recipe that cannot be shown is hidden from readers
instead, and its audience stays as the cook chose it.

ADR-0074 already hides a recipe through the read rule while its content is in review. This ADR uses the same place for
every other hold.

## Decision

1. **Commise never makes a recipe private.** No system, staff or erasure write sets `visibility = 'private'`. Only a
   cook's own choice does, through the slot rule of ADR-0073. There is no move to private over the limit.
2. **A recipe that cannot be shown is hidden.** Its audience stays as the cook chose it. A hidden recipe uses no slot.
   The owner still sees it and can edit it. The hide is the same whether or not a slot is free. These hide a recipe:
    - a staff source correction (`HOLD_SOURCE_CORRECTED`).
    - a recorded source that holds the recipe off Public (the evidence rule of ADR-0095), including a site claim that
      is not confirmed, once site claims exist.
    - a content check, a staff not-approved decision and an upheld appeal (ADR-0074, through its own outcome records).
    - a report (020).
3. **One read rule, one SQL function.** "Held from readers" is decided in one place: the database function
   `recipe_held_from_readers(recipe, private_only_keys)`. It takes the `recipes` row and the private-only origin keys,
   bound as one parameter from recipe-core's `PRIVATE_ONLY_SOURCE_KEYS`, and is true when any of three terms holds:
    - the correction hold is set (`HOLD_SOURCE_CORRECTED`).
    - the recipe has cook-captured third-party evidence: a `recipe_source_evidence` row whose capture is not
      `staffCorrection`, with a source domain or a kind of book or paid site. A staff correction's own evidence rows
      are ignored, so a mistaken correction that is undone and cleared is readable again.
    - the recipe's origin label is private-only (a web page, a book or a paid site), so a correct correction to a
      book stays hidden after its hold is cleared.
      Every SQL read of other cooks' recipes calls it through the service's shared predicates, and the erasure worker
      calls the same function. The in-memory viewability rule receives the function's value as a required selected field,
      so the rule has no TypeScript twin. A real-database test pins the function to a literal truth table. A guard fails
      any recipe-visibility read outside the shared predicates.
    - The write side keeps its own evidence rule for now (`recipe_holds_third_party_source` and `sourceConflictOf`,
      which stop a cook publishing, count every evidence row and exempt private-only labels). Two definitions of
      "third-party evidence" therefore exist: the write side's and the read side's. PR 5 (the hold clear) aligns them.
    - The function reads the origin triple (`source_type`, `source_kind`), so it is a reader under
      [ADR-0104](0104-a-recipe-stores-its-origin-in-one-column.md). When that ADR's mover changes the origin column,
      it replaces the function body and moves `PRIVATE_ONLY_SOURCE_KEYS` to origin values in the same change. The
      signature does not change, so no caller changes.
    - ADR-0074's own condition (`SOURCE_CHECK_ALLOWS_SQL`) sits beside this one in the same predicates when 020
      ships. It is not copied into this function.
    - There is no new visibility value and no new column.
4. **"Held" means "never publicly readable".** The CHECK `recipes_held_is_not_public` is dropped. A held recipe may be
   public or private. If it is public, the read rule hides it. The clone trigger does not change. No hold is
   permanent: a held recipe has two ways back. One is the staff clear (Decision 7). The other is a rewrite that earns the
   fact (Decision 5), which also lifts a correction hold when the corrected answer is third-party (a
   book, a paid site or a web page). The ratchet keeps false to true. PR 5 gives it one guarded true-to-false path, which
   needs a clear record in the same transaction, either a staff clear or a system clear for the earned rewrite. The
   writers stop setting `private` (Decision 1) in the change that drops the CHECK, and that change waits for the
   function to be deployed (the schema deploys first).
5. **An edit that cannot stay public.** When a cook edits a recipe that readers can see, and the new content cannot
   stay public (a recorded source holds it, its wording is too close, or it was not approved), the save is refused and
   the edit stays on the device. The same sheet opens for a recipe that is already hidden: it is refused while a
   private slot is free, and with no free slot only an explicit Save and hide saves it. The cook chooses one of these:
    - change the steps in their own words. A rewrite that earns the fact unblocks the recipe, for every origin, own and
      unstated included (ADR-0097 Decision 3 for the unblock, and the owner ruling recorded as model decision Q21 for
      own and unstated origins). When the corrected answer is third-party, the earned fact also clears a
      staff correction hold. This is a system edge on the earned fact (ADR-0097 Decision 3), not a cook declaration, and
      the correction record stays. A correction to own or "from another person" clears only by staff, even when third-party evidence is on the recipe. The rejection of a cook-side
      clear in ADR-0103 stands: this is a system clear, and the cook still cannot declare the hold away (owner ruling
      2026-11-28).
    - discard the edit.
    - with a free slot, make it private and save.
    - with no free slot, save it and hide it. The recipe stays public and hidden, and the cook chose that.
6. **A create or a publish that cannot go public** saves a draft. A draft uses no slot (ADR-0073 §12). With a free slot
   the cook may publish it as private. A create of a private recipe with no free slot saves a draft too. Nothing is
   refused for want of a slot.
7. **Clearing the correction hold** is one of the two ways back (Decision 4). It lifts the hold only. A recipe whose audience is private stays private. A recipe
   whose audience is public is readable again when no other term of the read rule hides it (a recorded source or a
   private-only label still does). A cleared correction does not make a "from another person" recipe readable. It
   stays hidden until spec 016's family source type ships and the cook confirms the giver agreed (owner ruling
   2026-11-15 and the family member or friend row of spec 016's rights table). PR 5 adds that term with its clear
   route (ADR-0097 Decision 2). The staff clear also releases the owner's clones, and each released clone keeps its own
   audience. A system clear for an earned rewrite clears exactly the recipe that earned the fact. Each clone clears on
   its own earned rewrite, or by staff.
8. **Erasure removes a held public recipe.** It is not kept and it is not donated. The kept set is "public, published
   and not held from readers". A donation is refused for a recipe held from readers.
9. **A cached public page is purged when a hold is set.** Any surface that caches a public recipe (the signed-out reader
   of 003A, its sitemap or a feed) reads through the shared predicates, and every write that hides a recipe purges
   its cached copies. 003A does not turn on before this holds.

## Consequences

- A free cook is never pushed over the slot limit by Commise, and never loses a slot they did not choose to spend.
- A held recipe stays "Public" in the cook's own data. The owner sees the chip "Hidden" and a line that says why.
- The refusal `REFUSAL_DETECTED_NO_PRIVATE_SLOT` (never sent by a built route) and the planned private moves after a
  review retire.
- A read of other cooks' recipes now calls the hold function per row, in the WHERE clause. PostgreSQL does not inline a
  function with a sublink, so the cost is one call and one index probe per candidate row. The change that adds it
  records the measured cost.
- **A known window.** After this ADR the model has no system or staff move to private, but the staff correction writer
  and the correction-driven save still write `private` until Solar's P8h. The window is named here and in the model
  document (4.6), and P8h closes it.
- Dropping the CHECK is reversible only while no row is both public and held. Rolling back past the code that writes
  such rows is a forward fix.
- The rule that the evidence hold lifts after a rewrite (P4a B10b) is an exemption in the function body, not a new
  term. The change that adds it replaces the body and adds a row to the truth table.

## Alternatives considered

- **Keep the move to private and allow it over the limit.** The owner ruled against it. Rejected.
- **A new visibility value "hidden".** Installed clients switch over the visibility enum, and it would make one column
  hold the restriction, which ADR-0103 Decision 3 forbids. Rejected.
- **A stored column for "hidden".** It would be a second copy of facts that are already stored. Rejected.
- **Refuse every save that cannot stay public, with no slot.** It traps the edit, because no edit clears recorded
  evidence. The cook's "Save and hide" ends the trap. Rejected.
