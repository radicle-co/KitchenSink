# 0073 — Free-tier private slots

- **Status:** Accepted
- **Date:** 2026-10-26
- **Relates to:** [ADR-0072](0072-bulk-recipe-import.md) §9: the per-recipe statement and the label it sets. This ADR
  adds the out-of-slots pause to that flow. [ADR-0023](0023-curator-declared-provenance.md): which labels a caller
  can declare on `POST /api/v1/recipes`. [ADR-0040](0040-test-principals-containment-and-purge.md): containment runs
  in front of the visibility policy. [ADR-0058](0058-never-published-drafts-record-no-version.md): drafts. Spec
  001 FR-003 and FR-003a, spec 004 FR-028 and D-014, and spec 015 (publishing rewards, stopped).

## Context

Today a free cook cannot keep a recipe they wrote private. `visibilityPolicy.ts` allows `user_created` to go private
only with Premium (001 FR-003). Book and paid-site recipes (`imported_physical`, `imported_paid`) are private-only, and
the policy lets anyone keep them private with no limit and no Premium. Spec 004 FR-028 and D-014 then put a Premium gate
in front of the channels that make those labels. Spec 015 planned to un-gate free privacy through earned slots. That
was decision D4a, and it stayed open.

The owner ruled on 2026-10-26:

- A free cook gets **50 private slots**, fixed, now. 015's earning rules come later and add to the 50.
- A slot is used by **every** recipe a free cook holds as private, from any route: the editor, paste, photo, URL and
  bulk import. Book and paid-site recipes count too.
- A Premium cook has no slot limit.
- When a free cook runs out of slots during an import, the import pauses, warns them, and lets them choose: stop
  there, or make the rest public after confirming each recipe's statement.
- A recipe we can tell is from a book or paid site can never go public. Otherwise we rely on the cook's statement.
  Spec 020 will specify an automated provenance check.
- An imported public-web recipe the cook chooses to make private keeps today's rule: Premium and a substantive edit.

This reverses 001 FR-003's "free-tier recipes are always public". It decides D4a as "private within 50 slots".

## Decision

### 1. A free cook can hold 50 private recipes. Premium has no limit.

- The 50 is a constant owned by one pure module, next to `visibilityPolicy.ts`. Nothing else states the number.
- Premium is read from the signed token, as today (`isPremiumPrincipal`). Premium never counts slots.
- A free cook's limit is the base of 50. When 015 ships, the limit becomes the base plus the cook's earned
  slots (§9).

### 2. A slot is a private recipe the cook owns, counted live

A used slot is one row in `recipes` where all of these hold:

- `owner_id` is the cook.
- `visibility = 'private'`.
- `deleted_at IS NULL`. A tombstoned recipe is hidden everywhere, so it does not hold a slot. Deleting a recipe frees
  its slot at once.

Every label counts: `user_created`, `imported_physical`, `imported_paid`, and an `imported_public` recipe made private
while the cook had Premium. **Status matters: a draft holds no slot** (owner ruling, 2026-10-26, §12). So a fourth
condition holds for every used slot: `status = 'published'`. The existing index serves it, because a cook's own rows
are few.

**A private recipe in review holds its slot** (owner ruling, 2026-10-26, §11). A private recipe from a bulk import is
saved published and waits in review until a person checks it. It is private and published, so the four conditions
already count it, and no fifth condition is needed. A **public** recipe in review is stored `public`, so it holds no
slot. The screens say so: a private recipe in review "holds a slot until a person checks it".

**The count is a live `COUNT(*)` over those rows.** It is never a stored counter. A counter is a second copy of a
fact that the `recipes` table already holds. Each path that writes a recipe must then keep the counter in step: create,
delete, erase, purge, clone and every change of visibility. One missed path makes it drift for good. The existing partial index on `owner_id`
(`idx_recipes_owner_id`, `WHERE deleted_at IS NULL`) serves the count.

### 3. The check runs only when a recipe becomes private

The slot fact matters only on a move **to** private. These are the moves:

- A new recipe created private and published, by the editor, a paste, a photo import or a URL import.
- A published recipe set to private by the set-visibility endpoint.
- A private draft published, which is how a private clone or an owner's own copy comes to hold a slot (§12). Saving
  either as a draft never checks slots.
- A private bulk-import recipe saved after the cook's match review (§8). It takes its slot at the save, under the
  lock, and keeps it while it is in review. Approval takes no new slot.

Editing a recipe that is already private never checks slots. Making a recipe public never checks slots. It frees one.
When the live count is below the limit, a free cook has a free slot.

### 4. On a downgrade, the cook keeps every private recipe

A Premium cook can hold any number of private recipes. If they lose Premium with more than 50, they keep every one of
them private. Nothing is made public or deleted. They cannot make a new recipe private until their count is below the
limit again.

- This is the rule C-004 already has for a lapse: it gates the move to private, never what the cook already holds.
- A book or paid-site recipe can never go public, so the only way to free its slot is to delete it. The refusal copy
  says so.

### 5. The count and the write share one transaction, under a per-user lock

Two private writes can race at 49. Both read 49, both see a free slot, both write, and the cook holds 51. So:

- A new entry in `ADVISORY_LOCK_CLASSES` (`@kitchensink/db-schema-guard`), keyed per user:
  `pg_advisory_xact_lock(class, hashtext(owner_id))`.
- Every writer that can make a recipe private takes it as the first statement of the transaction that writes the
  row. It then counts, and writes in the same transaction. That covers create, set-visibility, clone and the bulk
  import save.
- This is the shape the import allowance ledger already uses (`importAllowance.dal.ts`). It serializes one cook's
  writes and no one else's.
- A slot fact computed before the transaction is never trusted. That is exactly the race the lock exists to close.
- Set-visibility runs no transaction today. It needs one.
- If one transaction ever holds both this lock and the allowance lock, it takes the allowance lock first. A fixed
  order means the two can never deadlock.
- A delete or a publish does not need the lock. If it races a private write, the worst case is a refusal. A moment
  later the same write passes. That is the safe direction.

The policy stays pure. The caller resolves the slot fact under the lock and passes it in.

### 6. The visibility policy gains a required slot fact

`VisibilityPolicyInput` gains `hasAvailablePrivateSlot: boolean`. It is **required**, so every call site fails to
compile until it decides what the fact is. With a default, a site can keep the old behaviour and nobody notices.

| Requested | Label               | Allowed when                                                   |
| --------- | ------------------- | -------------------------------------------------------------- |
| public    | `user_created`      | Always (containment runs first, ADR-0040)                      |
| public    | `imported_public`   | Always (containment runs first)                                |
| public    | `imported_physical` | Never                                                          |
| public    | `imported_paid`     | Never                                                          |
| private   | `user_created`      | Premium, or a free slot                                        |
| private   | `imported_public`   | Premium and a substantive edit. Slots never apply. (Unchanged) |
| private   | `imported_physical` | Premium, or a free slot                                        |
| private   | `imported_paid`     | Premium, or a free slot                                        |

- A refusal for want of a slot is a denial of its own kind, not the generic `INVALID_VISIBILITY`. The client must tell
  the cook why, show how many slots they use, and offer the choices in §8. The wire carries the code
  `PRIVATE_SLOTS_FULL` with HTTP 403, and the body carries `used` and `limit`.
- The status is 403, not 409. The recipe client maps any 409 code it does not know to a version conflict
  (`client.ts`, the `case 409` fallback). An installed build that predates this code then opens the conflict
  view for a slot refusal. A 403 reaches those builds as a plain refusal, and newer builds branch on the code.
- `imported_public` keeps today's rule. A free cook is refused for want of Premium before slots are looked at, so a
  slot never makes an imported public-web recipe private.
- `defaultCloneVisibility` stops being a side door. Today it defaults a clone of a book or paid-site recipe, and
  every clone by a contained test principal, to private with no check. Under this ADR a clone that lands private
  takes the lock and the slot check like any other private write. A free cook with no slot cannot make it.

### 7. Book and paid-site recipes now use slots, and Premium is no longer needed

- A free cook can bring a book or paid-site recipe in by any route: paste with a statement, photo import (011), URL
  import whose rights check allows private only, or bulk import. Each one uses a slot.
- Premium is not required. This reverses 004 FR-028 and D-014 ("non-public creation is premium").
- A free cook with no free slot **cannot keep a new book or paid-site recipe at all**. It can never go public, so
  there is nowhere else for it to go. The single-recipe routes refuse the save with `PRIVATE_SLOTS_FULL`. Bulk import
  pauses (§8).
- A recipe we can tell is from a book or paid site carries `imported_physical` or `imported_paid`, from the channel,
  the URL rights check, or the cook's statement. It can never go public. Where we cannot tell, the cook's statement
  decides. Spec 020 will specify an automated provenance check. This ADR does not design it.

### 8. Bulk import pauses when a free cook runs out of slots

This extends ADR-0072 §9.

Owner rulings, 2026-10-26: bulk import saves every recipe **published**, with the visibility the cook chose, and each
waits in review unless every part is green (ADR-0072 §3). A private one holds its slot from the save, in review or not
(§2), so the import counts slots the ordinary way.

- When `advance` reaches an item the cook chose to keep private, it counts slots under the lock (§5). That count
  already includes the cook's private recipes in review. If no slot is free, it does not save that item or any later
  private item. It still saves items chosen public.
- The import view reports the pause, with `used` and `limit`. The pause is **derived** from the live count on each
  read, never stored. If the cook frees slots (by deleting a recipe or making one public), the next `advance` goes on.
- The cook chooses:
    - **Stop here.** The import ends. Items already saved stay. The rest are not saved.
    - **Make the rest public.** Only items whose label allows public (`user_created` and `imported_public`). The cook
      sees **one list** of the remaining recipes, each with its source, may untick any of them, and confirms **once**.
      That one confirmation records a separate statement for each recipe left ticked, so the per-recipe attestation of
      004 FR-014a stands. An unticked recipe is not saved.
    - **Skip.** For a book or paid-site item. It can never go public, so the only choices for it are skip or stop.
- **A race.** Because the slot is taken at the save, an approval never needs a new one. If a race ever leaves a
  private recipe without a free slot (two private writes, one slipping past the lock), it stays private and the cook
  is over the limit, as after a downgrade (§4).
- The cook's choice is stored on the item, the way the wizard's choices are, so `advance` stays safe to repeat.
- A Premium cook never pauses for slots.
- This pause is separate from the daily allowance pause (`IMPORT_QUOTA_EXCEEDED`, ADR-0072 §8). An import can be in
  both at once.
- An imported public-web recipe chosen private is still refused for a free cook, as ADR-0072 §9 records. Slots do not
  change that.

### 9. The seam 015 will extend

015 grants earned slots. When it ships, they **add to** the base:

- The limit is resolved in one place: the base today, the base plus the cook's earned slots later.
- The policy's input does not change. 015 changes only how the limit is worked out.
- 015 is not built, and this ADR builds nothing for it.
- 015's own numbers were written for a zero start: a schedule that ends at 50 earned slots, and a ceiling of 50
  private recipes. When 015 is un-stopped, both are decided again.

### 10. The PRO badge no longer reads privacy as Premium

001 FR-003a derives the PRO badge from "private AND (`user_created` or `imported_public`)". Once a free cook can hold
a private `user_created` recipe, privacy no longer means Premium. The badge then marks free cooks' recipes PRO.

- The badge marks **private `imported_public`** recipes only. That is the one kind of privacy that still needs
  Premium.
- It is still derived on read, in one place, and it changes in the same commit as the policy.

### 11. A public recipe in review uses no slot, a private one holds its slot, and a recipe not approved becomes private

Owner ruling, 2026-10-26: "The review process does not take a slot and doesn't become visible as public or private
until it's been approved. While it's in review it is labeled as such." The content source check (ADR-0074 §3a) holds
some recipes for a person to review.

- **A public recipe in review uses no slot.** Its stored visibility stays `public` and the read rule hides it.
- **A private bulk-import recipe in review holds a slot until a person checks it** (owner ruling, 2026-10-26). It took
  the slot at the save, and the screens say so. On approval it simply stays private.
- A recipe in review, of either visibility, has the same restrictions as a draft (§12): no collections, meal plans,
  cooking mode, shopping lists or AI assistant.
- **Not approved becomes private, and uses a slot.** When the rules block a save, or a person does not approve a
  recipe, it moves to `private` in the same transaction, under this ADR's lock. A person's decision never refuses: a
  free cook with no free slot is then over the limit, exactly as after a downgrade (§4). They keep every recipe and
  cannot make a new one private until under the limit.
- **A blocked save with no free slot is refused**, as §7 refuses a book recipe with no slot. Nothing is saved yet. It
  answers `403 SOURCE_DETECTED_NO_PRIVATE_SLOT` with the same `used` and `limit` as `PRIVATE_SLOTS_FULL`. It is `403`
  for the reason `PRIVATE_SLOTS_FULL` is: the recipe client treats any unknown `409` as a version conflict, so an
  older installed app would open the conflict view. Otherwise "I wrote this" over a book recipe would buy more private storage than the honest statement.
- **Leaving review for Private is an ordinary move to private.** It needs a free slot, as §3 requires.
- So review is never a free private store: a person's decision always ends it, the same content cannot enter it again,
  and a recipe keeps its queue place across edits.
- **The Draft exit is closed by §12.** A cook may move a recipe from review back to Draft, and a draft uses no slot,
  but a draft can be used for nothing except editing. So it is not a free private store.

### 12. A draft uses no slot, and a draft can be used for nothing but editing

Owner ruling, 2026-10-26, recorded in spec 001 FR-003b:

- A draft (status `draft`, any visibility) uses no private slot.
- It cannot be used in meal planning, collections, the planned AI assistant, cooking mode, or sending its ingredients
  to a shopping list. Opening a draft always opens the editor.
- Setting a published recipe back to draft removes it from its meal plans and collections, after a confirmation that
  names the counts. Items it already put on a shopping list stay, as plain ingredients.
- Drafts are hidden, with no note, in the plan, collection and shopping-list pickers.
- "AI features" means the planned AI assistant only. Parsing and the ingredient-match review keep working on drafts.

This reverses §2's earlier "a private draft holds a slot". It also answers the reason the Alternatives below gave for
refusing to exempt drafts, that a cook could keep any number of private recipes by never publishing them. They still
can, but only as text in an editor. A recipe they can plan, cook, collect or shop from is published, and a private
published recipe holds a slot. The slot is now checked when a private draft is published (§3). Nothing is live, so no
cook holds a recipe whose slot status this changes.

## Consequences

- A free cook can keep a recipe private for the first time, up to 50. GDPR Art. 25(2)'s "public by default" concern
  is now answered for the first 50 recipes. A new recipe still defaults to public.
- A free cook can bring in book and paid-site recipes without Premium. Those recipes now count against the same 50.
- Photo import (011) is no longer Premium-only. D-014 also kept Textract spend to paying users. That bound is gone.
  The per-photo sub-quota (004 FR-022) is now the only bound on it.
- Every move to private takes a per-user lock. One cook's private writes run one at a time, and nobody else's wait.
- 015 starts from a live base of 50 instead of zero.
- ADR-0023 still keeps `imported_physical` and `imported_paid` undeclarable on `POST /api/v1/recipes`. One of its two
  reasons, the FR-028 Premium gate, is gone. The other stands: the attestation and citation that must travel with
  those labels are not built on that route.

## One-way doors

- **`PRIVATE_SLOTS_FULL`, its status and its `used` and `limit` fields.** Installed clients read them. A new fact is
  a new field.
- **The meaning of a slot**: a private, published recipe that is not deleted (§12 left drafts out before anything was
  live). Cooks plan around it. A change to what counts,
  such as leaving out drafts or book recipes, changes what a cook already holds.
- **The 50.** Raising it is free. Lowering it leaves cooks over the limit. They keep their recipes but cannot add
  more.

## Residual risks

- **A cook out of slots can misstate a source to keep a recipe.** "I wrote this" lets a recipe go public, and a book
  recipe cannot. A cook who wants to keep a book recipe and has no slot has a reason to say they wrote it. Spec 020's
  provenance check exists for this (ADR-0074). Until it ships, the cook's statement is the control.
- **Downgraded cooks over 50 cannot make anything new private** until they delete or publish. The refusal copy must
  tell them how many slots they are over.
- **A contained test principal on a free plan, out of slots, cannot clone a book recipe or make any clone at all.**
  Containment blocks public, and slots block private. The test pool's signer already carries Premium
  (`e2e-seed/src/provision.ts`), so today's seeded runs are not affected.
- **The count runs inside the write transaction.** It reads one cook's rows through an existing index. If a cook ever
  holds very many recipes this is the read to watch.

## Code owed (builder work, not this ADR's)

1. **The policy.** `visibilityPolicy.ts` gains the required `hasAvailablePrivateSlot` and the matrix in §6, with its
   docstring updated in the same commit. A distinct `privateSlots` denial maps to `PRIVATE_SLOTS_FULL` (403) with
   `used` and `limit`. The 50 lives in one pure module beside it.
2. **The lock and the count.** A new `ADVISORY_LOCK_CLASSES` entry. A DAL method that takes the lock and returns the
   live count, inside the caller's transaction.
3. **Every call site.** `RecipesService.create` and `setVisibility` (`evaluateVisibility`), and `clone`
   (`defaultCloneVisibility`). Set-visibility gains a transaction. The bulk import save (ADR-0072 §3) takes the lock
   per item. The schema-generated contract gains the error code (ADR-0014).
4. **The import pause.** The derived pause on the import view, the stored per-item choice (stop, make public with
   its own confirmation, skip), and `advance` honouring it.
5. **The PRO badge.** The one derivation behind FR-003a changes to private `imported_public` only.
6. **The editor.** The Private choice for a free cook with no slot is refused with localized copy. It says how many
   slots they use and what they can do: make this recipe public, delete or publish another private recipe, or go
   Premium. Book and paid-site saves on single routes get the same refusal, without the "make public" choice.
7. **The channel gates.** Remove the Premium gate FR-028 put on photo import and on attested paid-source paste. The
   channels stay advertised to free cooks.
8. **The design system.** The design session removed `ImportNoPrivateSlot` on features canvas v21. It must restore
   an out-of-slots pause board for bulk import. The board offers stop, make the rest public with a confirmation per
   recipe, and skip for book and paid-site items. It must also add the editor's Private refusal. Both are drawn on
   phone, tablet and desktop.
9. **The editor outbox** (ADR-0057). A queued private create or set-visibility that meets `PRIVATE_SLOTS_FULL` is
   final. The sender parks it for the cook to resolve and never re-sends it. Offline mode (019) makes this path
   common, because a cook can queue private writes while another device uses the last slot.
10. **Tests, every tier.** Unit tests over the full matrix in §6. An integration test that races two private writes at
    49 and proves only one lands. A downgrade case: 60 private recipes are kept, and a new private one is refused. The
    import pause, Playwright and Maestro included.

## Alternatives

- **A stored slot counter.** It drifts the first time a write path forgets it. The count is derived (§2).
- **A CHECK constraint.** A CHECK sees one row. It cannot count the cook's other rows. 015's plan records that a
  CHECK was defeated even for a one-row ratchet.
- **A trigger that counts.** Under READ COMMITTED two transactions still both count 49 and both pass. It needs the
  same lock, so it adds a second place for the rule and no safety.
- **SERIALIZABLE isolation on every write.** It works, but every private write path then needs retry handling
  for serialization failures. The advisory lock is the house pattern and needs no retry.
- **Exempting book and paid-site recipes from slots.** 015's FR-007d proposed it, marked "flag for confirmation". The
  owner ruled the other way.
- **Counting drafts.** Chosen first, and reversed by the owner (§12). A draft held a slot because, with drafts exempt,
  a cook could keep any number of private recipes by never publishing them. The owner instead made a draft usable for
  nothing but editing, which removes that store without metering a recipe the cook is still writing.
- **Making recipes public on a downgrade.** It publishes content the cook chose to keep private, on a billing event.
- **Making a book or paid-site item public as a way out of the pause.** FR-014a's own rule forbids it. Such a
  recipe can never go public.
- **One statement for all of "make the rest public".** One statement for many recipes is not the per-recipe
  attestation FR-014a requires. The chosen form is one list and one confirmation that records a separate statement for
  each recipe (§8).
- **Waiting for 015's earning rules.** The owner ruled that the 50 ships now and earning adds later.
