# Research: Public Versions of Imported Recipes

Each item gives the decision, the reason, and the options set aside.

## R1. Engine ownership

- **Decision**: 027 owns the engine's design. The first feature to land builds 027's core and adapter. 003B owns the
  import side only.
- **Reason**: 027 FR-045 already names the import-time rewrite as a consumer. Two engines drift on the facts
  sheet and the checks, and those are the rules that hold the feature up.
- **Set aside**: 003B owning the engine. That splits one design across two specs.

## R2. Where the job lives

- **Decision**: a `public_version_jobs` table of its own, keyed on the source record.
- **Reason**: the import item is purged on the schedule of ADR-0072, and the later route (US3) has no
  item at all.
- **Set aside**: columns on the import item.

## R3. The comparator for every later save

- **Decision**: a keyed hash of each word 5-shingle of the source's steps, and of each 2-word shingle of its title,
  stored as `bigint[]` with a format version and a key version. The normalised source title is stored as one hash.
- **Reason**: the "For everyone" path keeps no text, but FR-050 must still run on every save. A hash set answers
  Jaccard and containment with no text.
- **Set aside**: keeping the pasted text (the copy promises it is not kept). Keeping only a digest (it cannot measure
  closeness).

## R4. Title

- **Decision**: built by code from the facts sheet: the two main foods by weight, and the main method.
- **Reason**: 027 never changes a title, so a title field in the engine answer is a mode flag. A code title costs
  nothing and never echoes the source.
- **Set aside**: a title in the engine answer. A second prompt now. It stays the fallback for poor code titles in the bake-off.

## R5. Classification inputs

- **Decision**: one pure function reads the evidence, the statement, the live site claim and three data lists
  (honoured licences, federal publishers, paid sites). The paid-site list is 004-FR-014's existing list. Each list
  is data with an admin lifecycle (D-004 shape).
- **Reason**: an allowlist that fails closed. One reader for one rule.

## R6. Idempotent Publish

- **Decision**: one transaction. Lock the job row. Insert the recipe under a unique source page key. Mark the job `published`. A second device gets the existing
  recipe id.

## R7. Spend

- **Decision**: call site `import-public-rewrite`, under the one verification role, operating cost, terminal
  `budgetSpent`. No per-cook cap: the one import allowance and 3 calls per item bound it.
- **Reason**: ADR-0024 §4c and §6, and the paste fallback's precedent (004-FR-059).

## R8. Copy (source strings)

From the owner-approved copy, v3 over v2, as published in the public-version boards' spec. Keys are under `importMessages.choice.*`.
`staff-ux-engineer` SPECIFY owns the final words. A curly apostrophe is used in the product strings.

| Key                                                    | Copy                                                                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`                                                | Just for you, or for everyone?                                                                                                                                |
| `explain`                                              | Your copy stays just as you saved it, for you alone. To share it, we write the steps in our own words and publish that version.                               |
| `private.label`                                        | Just for me                                                                                                                                                   |
| `private.hint`                                         | Saved exactly as it is. Uses one of your {limit} private recipes, and you have {count} left. (ICU plural)                                                     |
| `private.hintPro`                                      | Saved exactly as it is. Only you can see it.                                                                                                                  |
| `public.label`                                         | For everyone                                                                                                                                                  |
| `public.hint`                                          | We write the steps in our own words. Every amount, time and temperature stays as it was. You read it before anyone else does. We don’t keep your pasted copy. |
| `both.label`                                           | Both                                                                                                                                                          |
| `both.hint`                                            | Your copy stays just for you, and our version goes to everyone. Uses one of your {limit} private recipes, and you have {count} left. (ICU plural)             |
| `both.hintPro`                                         | Your copy stays just for you, and our version goes to everyone.                                                                                               |
| `credit`                                               | Shared recipes carry your name and ours. Anyone can cook from them and pass them on.                                                                          |
| `creditLink`                                           | How sharing works                                                                                                                                             |
| `pickOne`                                              | Pick one to carry on.                                                                                                                                         |
| `button.private` / `button.public` / `button.both`     | Save my copy / Write the public version / Save and write                                                                                                      |
| `writing.title`                                        | Writing your public version                                                                                                                                   |
| `writing.body`                                         | This takes a moment. Stay here, or stop and come back to it.                                                                                                  |
| `writing.bothSaved`                                    | Your copy is saved.                                                                                                                                           |
| `writing.stop`                                         | Stop                                                                                                                                                          |
| `writing.offline`                                      | You’re offline, so we stopped. Back online? Try again.                                                                                                        |
| `review.title`                                         | Here’s your public version                                                                                                                                    |
| `review.body`                                          | Have a read. The wording is new, and the numbers are the same as your copy. Publish it once it looks right to you.                                            |
| `review.compare` / `review.compareHide`                | Show my copy / Hide my copy                                                                                                                                   |
| `review.titleNote`                                     | We gave it a new name. You can change it.                                                                                                                     |
| `review.photoNote`                                     | Add your own photo. Photos from the page don’t come along.                                                                                                    |
| `credit.written`                                       | Steps written by Commise with AI, checked by {cook}. ({cook} is the display name, else the username)                                                          |
| `credit.basedOn`                                       | Based on a recipe at {domain}. Not affiliated. ({domain} is a link; free site only)                                                                           |
| `review.licence`                                       | It’s shared under {licenceName}, credited to Commise and contributors, and so are your edits.                                                                 |
| `button.none`                                          | Continue                                                                                                                                                      |
| `creditPreview.label`                                  | Your public version will say                                                                                                                                  |
| `review.titleLabel`                                    | Recipe name                                                                                                                                                   |
| `review.stepsHeading`                                  | Steps                                                                                                                                                         |
| `review.oursHeading` / `review.yourCopyHeading`        | Public version / Your copy                                                                                                                                    |
| `failed.done`                                          | Done                                                                                                                                                          |
| `offerChanged.line`                                    | Something changed since you chose. Have a look and pick again.                                                                                                |
| `review.publish` / `review.edit`                       | Publish / Edit steps                                                                                                                                          |
| `review.notNow`                                        | Public path: Keep it just for me. Both path: Don’t publish.                                                                                                   |
| `flag.title`                                           | One thing to look at / {count} things to look at (ICU plural)                                                                                                 |
| `flag.step`                                            | Your copy says “{line}”. Ours leaves it out.                                                                                                                  |
| `flag.allergen`                                        | Your copy uses {ingredient}. Our steps don’t mention it.                                                                                                      |
| `flag.fix`                                             | Add it in Edit steps, or we can write it again.                                                                                                               |
| `flag.rewrite`                                         | Write it again                                                                                                                                                |
| `blocked.body`                                         | We can’t publish this version. Let us write it again, or keep it just for you. (shown with the `flag.rewrite` action "Write it again" and `review.notNow`)    |
| `failed.title`                                         | We couldn’t write the public version this time                                                                                                                |
| `failed.body`                                          | Try again, or save it just for you. You can share it later from the recipe.                                                                                   |
| `failed.bodyBoth`                                      | Your copy is saved. Try again, or share it later from the recipe.                                                                                             |
| `budget.line`                                          | We can’t write public versions right now. Save it just for you.                                                                                               |
| `full.line`                                            | You can share this one with everyone. All {limit} of your private recipes are in use, so it can’t be kept just for you.                                       |
| `full.free`                                            | To make room, delete a private recipe or share one.                                                                                                           |
| `publicExists.published` / `publicExists.link`         | There's already a public version of this recipe. / See the public version                                                                                     |
| `publicExists.writing`                                 | A public version of this recipe is being written.                                                                                                             |
| `publicExists.inReview`                                | A public version of this recipe is being checked.                                                                                                             |
| `privateOnly.line`                                     | This one is saved just for you. We can't write a public version of it.                                                                                        |
| `privateOnly.paidRecent`                               | This one is saved just for you. You can share a public version after {date}.                                                                                  |
| `privateOnly.under16`                                  | Publishing is for cooks 16 or over. This one is saved just for you.                                                                                           |
| `privateOnly.noSteps`                                  | There are no steps to write from yet. Save it, add steps in the editor, then share a public version.                                                          |
| `privateOnly.noSource`                                 | We need the page's link to share this one. Save it, add the link as its source, then share a public version.                                                  |
| `publicPage.hiddenOwner`                               | Hidden after a report. Only you can see it now.                                                                                                               |
| `publicPage.hiddenReader`                              | This recipe isn't available right now.                                                                                                                        |
| `rewriteNeeded.body`                                   | This version needs writing again before it can be published.                                                                                                  |
| `deadEnd.title`                                        | Your private recipes are full                                                                                                                                 |
| `deadEnd.body`                                         | This one can only be saved just for you right now, and all {limit} of your spots are in use.                                                                  |
| `deadEnd.free`                                         | To make room, delete a private recipe or share one. Then import this one again.                                                                               |
| `pro.name` / `pro.price`                               | Pro / {monthlyPrice} a month, or {yearlyPrice} a year                                                                                                         |
| `pro.perk.private` / `pro.perk.pantry` / `pro.perk.ai` | As many private recipes as you like / A pantry that reminds you what to use up / {aiUses} AI uses a month                                                     |
| `pro.trial`                                            | Free for {trialDays} days. Then {monthlyPrice} a month, unless you cancel before {date}.                                                                      |
| `pro.renews`                                           | Renews each month or year until you cancel. You can cancel any time.                                                                                          |
| `pro.upgrade` / `pro.compare` / `notNow`               | Upgrade to Pro / Compare plans / Not now                                                                                                                      |
| `notNow.note`                                          | With Not now, this recipe isn’t saved.                                                                                                                        |
| `pro.welcome`                                          | You’re on Pro. Pick where this recipe goes.                                                                                                                   |
| `deadEnd.closed`                                       | Import cancelled. Nothing was saved.                                                                                                                          |
| `deadEnd.close` / `deadEnd.closeNote`                  | Close / This recipe isn’t saved.                                                                                                                              |
| `done.private`                                         | {title} is saved, just for you.                                                                                                                               |
| `done.public`                                          | {title} is published. We’re checking it now.                                                                                                                  |
| `done.both`                                            | {title} is saved for you, and the public version is published. We’re checking it now.                                                                         |
| `done.linkPublic` / `done.linkPrivate`                 | See the public version / See my copy                                                                                                                          |
| `later.action`                                         | Share a public version                                                                                                                                        |
| `publicPage.report`                                    | Report a problem                                                                                                                                              |

ICU parameters: `{limit}` is the Free private-recipe limit (ADR-0073), `{aiUses}` the Pro monthly uses and `{trialDays}` the trial length (`010-FR-041b`, `010-FR-042`). The copy holds no plan number.

Not used: the draft's own-wording line for paid copies (the owner ruled that paid copies keep the site's wording) and
`budget.allowance` (the writer never spends a cook's uses).

Open copy items for the owner: who "Not affiliated." names, the licence link target, and the credit for a
source with no domain (spec C-items and "Conflicts").
