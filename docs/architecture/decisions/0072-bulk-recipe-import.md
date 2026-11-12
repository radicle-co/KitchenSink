# 0072 — Bulk recipe import

- **Status:** Accepted
- **Date:** 2026-10-26
- **Amended by:** [ADR-0082](0082-recipes-are-an-open-library-of-facts-cooks-words-and-gated-public-domain.md): §9 and its Related work. A recipe whose source is not a public web page can be public as the cook's own "Adapted" version or as a facts card. The server looks for a stated licence, never for "no copyright". Two statement kinds are added. Every other part stands.
- **Amended by:** [ADR-0077](0077-recipe-rights-label-linked-cards-and-outside-copy-checks.md): §9's statement list gains
  "Adapted in my own words" and "From a family member or friend, with their permission". A family or friend recipe is
  no longer labelled like a paid source. The rest of §9 stands, except that a web import now goes private for any cook,
  using a slot, as ADR-0077 §6 says. The Premium-and-substantive-edit notes in §9 no longer apply.
- **Amended by:** [ADR-0089](0089-a-pasted-web-link-sets-the-source-and-a-web-copy-stays-private.md): §9. The web
  statement is the same member a recipe's own `statement` uses, and a recipe from a public web page is private only. The
  exception to ADR-0023 is no longer this route alone: a cook's pasted link sets the same label on
  `POST /api/v1/recipes`.
- **Relates to:** [ADR-0071](0071-paste-matches-are-proposals.md): matching runs as the cook, and a paste match is a
  proposal. [ADR-0070](0070-catalog-ranking-head-noun-and-defaults.md): defaults serve imports and are never selected
  for the cook. [ADR-0024](0024-llm-spend-ceiling-reserve-then-settle.md): the one spend pool, and the exception this
  path takes to its retry rule. [ADR-0026](0026-two-engine-ingredient-parse-pipeline.md): the two-engine parse.
  [ADR-0045](0045-ingredient-lookup-and-unresolved-foods.md): no food names in the recipe database.
  [ADR-0023](0023-curator-declared-provenance.md): who can declare `imported_public`, and this route's exception.
  [ADR-0057](0057-editor-device-draft-and-outbox-format.md): the device draft's format is a one-way door.
  [ADR-0058](0058-never-published-drafts-record-no-version.md): a draft records no version.
  [ADR-0039](0039-database-role-split.md) and [ADR-0035](0035-schema-stacks-decoupled-from-service-deploys.md): new
  tables, their grants and their expand-first migrations.
  [ADR-0014](0014-service-owned-api-contracts.md): the service owns the wire contract.
  [ADR-0073](0073-free-tier-private-slots.md): a free cook's 50 private slots, and the import's out-of-slots pause.
  [ADR-0074](0074-content-source-check.md): every imported recipe is checked and sits in review until approved.

## Context

A cook who moves from another app brings hundreds of recipes at once. The single-paste editor flow (ADR-0071) asks the
cook about each food that is not a confident match. That is right for one recipe. For five hundred it is not, so the
owner asked for three ways to match a bulk import: save the open lines as written, pick the best match, or review each
recipe in a wizard.

Four facts from earlier decisions shape the design.

1. **Matching must run as the cook.** Food search is made as the caller or not at all (ADR-0071 §1). The parse worker
   holds no caller credential, so nothing can match in the background. Someone with the cook's token has to drive each
   step.
2. **A parse job lives one day.** `PARSE_JOB_TTL_HOURS` in `parseJobs.service.ts` is the authority. A wizard over five
   hundred recipes can take longer than that, and a job's match rows are deleted with the job.
3. **Verdicts land from the worker, by key.** The review gate writes a verdict under its verification key, not under
   any import row. Anything that wants to know "did something change?" must read the verdicts, not a counter that
   recipe-service bumps.
4. **"Flagged" depends on a verdict that can still be on its way.** A stored flag is wrong the moment the verdict
   arrives.

The design left four questions open: the route, the daily allowance, visibility and attestation, and the spend
ceiling. The owner ruled on all four on 2026-10-26. Those rulings are part of the decision below.

## Decision

### 1. The route is `/api/v1/import`

The owner chose the singular `/api/v1/import`. The resources are:

| Method | Path                                    | Purpose                                                    |
| ------ | --------------------------------------- | ---------------------------------------------------------- |
| `POST` | `/api/v1/import`                        | Create a bulk import from the recipes the client sends     |
| `GET`  | `/api/v1/import/{importId}`             | Read the import: items, match lines, flags and `version`   |
| `POST` | `/api/v1/import/{importId}/advance`     | Do the next bounded step of work, as the cook              |
| `POST` | `/api/v1/import/{importId}/items/{ord}` | Record the cook's choices on one item (wizard and flagged) |

- `importId` is a UUID (every recipe-service id is) and is parsed as one at the boundary. Spec 004's task list names
  `/api/v1/import/{url,instagram,text}` for its single-recipe channels. None of those words can parse as a UUID, so a
  later channel route and the import read can never shadow each other.
- The server receives recipes, not an archive. The client reads the export file and sends one structured recipe per
  item. The contract is zod in recipe-service (ADR-0014).
- Spec 017's library migration has not been confirmed as this resource. Its contract carries that as an open question
  for the owner.

### 2. The client drives the work in bounded steps

Each `advance` call does a bounded amount of work for the import, as the calling cook, and returns the import view.
One call does four kinds of work:

- It creates a parse job for the next items.
- It asks for matches on parsed lines, through the same matcher ADR-0071 §4 uses.
- It takes match snapshots (§4).
- It saves every item that is ready (§3).

The batch size is a constant. The builder sizes it so one call fits the request budget, the way ADR-0071 §6 bounds the
matches request.

- With no client calling, nothing runs. A cook who closes the app pauses the import, and the next `advance` resumes
  from the stored state.
- Each import view carries a `version`. It is a digest of what the view was built from, including the verdicts it
  read by key. Nothing stores it and nothing bumps it. The client compares it with the last one to tell whether the
  view changed.
- `advance` is safe to repeat. An item already saved is not saved again, and an item that already spent its allowance
  unit does not spend another (§8). That is what makes a restart free of duplicates (017 FR-017).
- The parse job an import creates admits no paste allowance unit (`createPrepaid` in the blueprint). The import pays
  for its items under its own channel (§8).

### 3. Each recipe is saved once, published, and sits in review until it is approved

Owner ruling, 2026-10-26: "Users upload, they review food matching, then the recipes are published according to the
private or public setting the user chose when they started the upload and sits in review and not visible (except to
the user) until they are approved (while review is private it is not a private slot since users can't share or add
private recipes to collections or use the recipe with meal planning, cooking mode, shopping lists, and all other
features - like drafts)."

When an item is ready (`isReadyToSave`), which is after the cook's match review, the server saves its recipe one time,
**published**, with the visibility the cook chose (§9). It is never saved as a draft. Every line keeps what the source
said: the raw source line, the measure the source printed and the ingredient phrase, the three facts
`transcriptionCarryForward.ts` carries. Each line is bound or kept as written by `bindingOf` (§7). The item records the
recipe it created, so a repeated `advance` sees the item as done.

- **Every imported recipe is checked, public or private** (ADR-0074 §3a). It shows "Checking" to the cook. If every
  part is green it goes straight to the visibility the cook chose; otherwise it waits "In review" for a person. Not
  every import waits for a person (owner confirmation, 2026-10-26). Until it is approved it is
  visible only to the cook and has the same restrictions as a draft (spec 001 FR-003b): no collections, meal plans,
  cooking mode, shopping lists or AI assistant. A public one in review uses no slot. A private one **holds its slot
  from the save until a person checks it**, and the screens say so (owner ruling, 2026-10-26, ADR-0073 §11).
- **On approval**, a public recipe becomes public, and a private one simply stays private, in the slot it already
  holds.
- Because the save publishes, the recipe records its first version then (ADR-0058).
- The import still binds nothing in the background and never chooses a visibility for the cook.
- **This is bulk import only.** The single-recipe imports (a link, a paste, a video) are unchanged.

### 4. Match lines are snapshotted, because parse jobs expire

The first read of a line's match copies what the import needs into its own rows:

- the line digest, the parsed phrase and the measure.
- the proposed food id, with its tier, rung and margin.
- the candidate ids, each with its `isDefault` mark.
- the verification key.

The import then reads these rows, not the parse job. So a job that expires does not erase a wizard that is still
open.

- The snapshot holds food ids and never food names (ADR-0045). Names come from food at read time, as the caller.
- The verdict is NOT snapshotted. It is read by the verification key on every view, so a verdict that lands after the
  snapshot still reaches the line.
- The import's tables are user data. Account erasure deletes them, and they join the erasure-sweep coverage guard. The
  test-principal purge deletes them too. Grants come from the owner's default privileges (ADR-0039), and the migration
  is expand-first (ADR-0035).

### 5. Who bound a line is stored: `ingredients.bound_by`

A new nullable column on `ingredients` records who bound each line. Its values are a closed set, owned by
`BOUND_BY_VALUES`. It is declared once in `@kitchensink/recipe-core`, because the wire schema is built from it, and
`recipes/domain/bindingOriginCarryForward.ts` re-exports it for the carry-forward rule:

| Value      | The line was bound by                                                                  |
| ---------- | -------------------------------------------------------------------------------------- |
| `exact`    | A confident exact-name match                                                           |
| `curated`  | A confident curated mapping                                                            |
| `review`   | A confident match the review gate verified, or a remembered match                      |
| `default`  | The seeded default, in a mode where defaults bind (`keepAsWritten`, or Save and leave) |
| `autoBest` | "Pick the best match for me": the shown proposal, else the first candidate             |
| `cook`     | The cook's own pick                                                                    |

- A line kept as written has no food, so `bound_by` is NULL.
- The column's SQL constraint is parity-tested against `BOUND_BY_VALUES`. Adding a value is a migration and a contract
  change, so the set is a one-way door for stored rows.
- `bound_by` is carried forward by IDENTITY, and the identity is the food alone (`carryForwardBinding`). Editing
  `2 cups` to `3 cups` keeps the origin. Choosing a different food makes the line `cook`. A line's `import_line_id` is
  carried the same way, and cleared on a food change unless the rebind command passes it on purpose. This rule is
  separate from the transcription rule, whose identity is the whole judgement (food, quantity and unit).
- The column is written only by the save path, from the rule above. A client never sends it.

### 6. "Flagged" is a third mapping over `identityReadingOf`

ADR-0071 §9 has two mappings over the one verdict classifier: the paste view (`matchStateOf`) and a saved line's
badge. Bulk import adds a third, `importFlagOf`, for a line the import BOUND without the cook in front of it. It is
derived at read time and never stored.

| Reading                                                    | Flag       |
| ---------------------------------------------------------- | ---------- |
| `agree`                                                    | `clear`    |
| `unasked`, with the review still owed                      | `checking` |
| `unasked`, with the review refused, given up or never sent | `flagged`  |
| `contradict`, `doubt`, `hedged`, `abstain` or `unreadable` | `flagged`  |

- A flagged line suggests the default candidate. It suggests nothing for a line already bound to that default.
- The review input is this module's addition to the blueprint's one-line mapping. Without it, a review that never
  comes reads `checking` forever, which ADR-0071 §9 forbids.

### 7. The three modes, and when an item is ready

`bindingOf` (`importBindingPolicy.ts`) decides each line. A cook's decision always wins, including "keep this as
written". A confident match binds in every mode. A skipped item keeps its open lines as written.

- **`keepAsWritten`** (Save lines as written). Open lines are kept as written, and a `default` line binds its default
  candidate. Ready once matched and no undecided line is still `checking`, or once the match is older than a wait.
- **`bindBest`** (Pick the best match for me). Every open line binds its top match as `autoBest`. Ready once matched.
- **`review`** (Let me review each). The cook ends it, not a clock. An item is ready in two cases. The cook has no
  open line on it, or the cook closed the wizard with Save and leave. Save and leave binds defaults only on items the
  cook never went through.

**An item headed public also waits for the source check's rule-based detectors, and for nothing else of it** (spec 020
FR-024, ADR-0074 §2). It follows from two facts: ADR-0074 lets only the rule-based detectors block, and the owner
ruled (2026-10-26) that the lookup in our own database never runs in a request. They run inside `advance`. A
`detected` item is not saved. It waits for the cook to keep it private (it is then "not approved", and needs a free
slot), skip it, or stop the import. Every other item is saved published (§3), and its AI check and the lookup in our
own database run after the save, keyed by the saved recipe. Readiness never
waits for the model or the lookup, because neither can block, and the lookup never runs in a request.

The builder made three choices where the blueprint was silent. They are recorded so nobody re-decides them by accident:

- **The wait for a `checking` line is a parameter.** `isReadyToSave` takes `checkingWaitMs`. The blueprint named `CHECKING_WAIT`
  but gave no number, and the module does not invent one. The constant is owed where the module is wired.
- **The flag policy reads the review state** (§6).
- **In `bindBest`, a `default` line binds its TOP candidate as `autoBest`**, not its default candidate as `default`.
  The ruling says "binds every top match", and a default is a suggestion, not a match. The default sits first in the
  list (ADR-0070), so the food is usually the same and only the origin differs. The pinned test names this reading.

### 8. Bulk import has its own allowance: 200 recipes a rolling day on Free, 1,000 on a paid plan

The owner ruled that bulk import has an allowance of its own, separate from paste's.

- **Paste: 200 a rolling day**, one unit per paste (004 FR-022 and plan §5).
- **Bulk import: 1,000 recipes a rolling day on a paid plan (Pro, Pro with AI), 200 on Free**, one unit per recipe.
  The lower Free limit is an owner ruling of 2026-10-27. The plan decides the limit at the first send of a line.
- Both are counted in the one ledger this branch built, `import_allowance_events` (migration 0058), under the per-user
  advisory lock. Each channel sums only its own rows. The window is the trailing 24 hours that
  `importAllowancePolicy.ts` defines.
- An item spends its unit at the first send of its lines for parsing, because LLM spend starts there. The item
  records that it paid, so a repeated `advance` or a re-created parse job never charges it twice.
- **A file of any size is accepted** (owner ruling, second round). There is no per-file cap. A file larger than the
  room left today imports what fits, and the rest follows as room frees up.
- An `advance` that reaches the allowance does the work it can still pay for and returns the `IMPORT_QUOTA_EXCEEDED`
  refusal with `resetsAt` for the rest. The import pauses. The next call after that time resumes it.
- The ledger's channel names follow the route: `bulk`, not `migration`. Migration 0058 is not pushed, so it is
  edited in place rather than followed by a rename.
- **Builder work: the allowance policy has one limit today.** `importAllowancePolicy.ts` sums every channel's rows
  against a single limit of 200, and its comments and migration 0058's say a bulk file costs one unit. Both are
  wrong under this ruling. The policy takes the channel and counts only that channel's rows against that channel's
  limit.

### 9. Each recipe carries its own source statement, and the statement sets its provenance

- **The per-recipe statement has two forms** (owner ruling, second round). "I wrote this" needs no citation.
  "From a source" needs a citation. With it, the cook says whether the source is public (a public web page) or
  private (a book, or a paid site). One statement for a whole file is not the per-item attestation of 004 FR-014a
  and 016 FR-014. 017's portability contract already says bulk import is not a side door around it.
- **A recipe without its statement stays in the import, not in the library** (owner ruling, 2026-10-26). It is listed
  under "Needs your statement", uses no slot, and cannot be published until the cook gives the statement. It is kept
  as long as the import's working data: purged 30 days after the import's last `advance`, which covers an import the
  cook finished and one they abandoned.
- **The purge runs on the band drain's 15-minute tick** in recipe-workers (`purgeFinishedImports`), beside the
  parse-job sweep. It adds no Lambda, no schedule rule and no NAT consumer, so ADR-0004, ADR-0060 and ADR-0061 apply
  unchanged. Its clock is `recipe_imports.updated_at`, indexed for it (migration 0066). It deletes 3 imports per
  statement, oldest first, and stops after 20 seconds of the Lambda's 60. Each statement is its own transaction with a
  5-second lock timeout. If a statement waits that long for a lock, for example a cook's lock on a saved ingredient, the
  purge rolls it back and stops until the next tick. Any other failure fails the tick. Each sweep runs even if an earlier
  one failed. The import row goes, and its items and snapshot lines go with it by
  cascade. Every saved recipe stays with its ingredients and `bound_by`, and the ingredient's `import_line_id` becomes
  NULL. The allowance ledger is not touched and nothing is refunded. The purge takes its rows `FOR UPDATE SKIP LOCKED`,
  so it skips an import that a cook's transaction holds and does not delete it under them. If the band drain fails,
  the tick still runs the sweeps, and then it fails with the drain's error. Every tick publishes the age of the oldest
  import, before the purge deletes anything, and then the purged count, both with `Stage` (ADR-0062). If that age is a day past the 30-day bound,
  `BulkImportPurgeBehindAlarm` fires.
- **The import sets the provenance label from the statement:**

    | Statement                            | `sourceType`        | Visibility the policy allows                      |
    | ------------------------------------ | ------------------- | ------------------------------------------------- |
    | I wrote this                         | `user_created`      | Public. Private needs Premium or a free slot.     |
    | From a public web page, with its URL | `imported_public`   | Private only. Needs Pro or a free slot (ADR-0089) |
    | From a book, with a citation         | `imported_physical` | Private only. Needs Premium or a free slot.       |
    | From a paid site, with a citation    | `imported_paid`     | Private only. Needs Premium or a free slot.       |

- **This is an exception to ADR-0023's curator-only rule for `imported_public`.** On `POST /api/v1/recipes` only a
  principal holding the curator grant can DECLARE `imported_public` with its `source`. On the bulk import route the
  cook's own statement sets it, and the stored statement and citation are what back the label. A cook's pasted web link
  (`statement` on `POST /api/v1/recipes`, ADR-0089) sets the same label in the same way. ADR-0023 names the exception. `imported_paid` and `imported_physical` are set the same way, from the statement, and stay
  undeclarable on `POST /api/v1/recipes`.
- **The cook still chooses Public or Private.** The import flow asks once for the whole import, and the review wizard
  can change it per recipe, the way the editor's visibility field does. The visibility policy (`visibilityPolicy.ts`)
  decides whether each choice is allowed for that recipe's label, as the table shows. A recipe whose source is not a
  public web page cannot be public. That is FR-014a's own rule.
- **A free cook has 50 private slots** (ADR-0073). Every recipe a free cook holds as private uses one, book and
  paid-site recipes included. A Premium cook has no limit. A free cook keeps a book or paid-site recipe private only
  while a slot is free. An `imported_public` recipe still goes private only with Premium and a substantive edit, so
  slots never apply to it.
- **When a free cook runs out of slots, the import pauses** (ADR-0073 §8). The ordinary slot count already includes
  the cook's private recipes in review, because each holds its slot. When the private items left exceed the free
  slots, it saves no more private items and warns the cook. The cook chooses to stop there, or to make the rest
  public: one list of the remaining recipes with their sources, which the cook may untick, and one confirmation that
  records a separate statement for each recipe. A book or paid-site item can never go public, so for it the choice is
  skip or stop. The pause is derived from the live count, and the cook's choice is
  stored on the item.
- **Counsel confirms the statement's wording before launch**, both forms included. It is on 016 FR-050's list.
- **A cook who chooses Private for a public web recipe is refused on a fresh import.** `imported_public` goes
  private only with Premium and after a substantive edit. The import keeps that recipe public, or lets the cook
  change the choice, and never edits the recipe to get round the rule.
- **004 FR-028 no longer asks for Premium** on any route (owner ruling, 2026-10-26, ADR-0073 §7). A free cook brings
  in book and paid-site recipes by any route, within their slots.

### 10. When the spend ceiling is reached, matching goes on without the LLM

The owner ruled that there is no per-import cap on LLM calls. ADR-0024's one prod ceiling is the only bound. When it
is reached, this path does not wait for the budget to return.

- **What stops.** For a parse-job line (paste or bulk import), a ceiling denial on the LLM parse leg, on either of its
  in-loop validators, or on the paste-match review is NOT retried. The worker records it and acknowledges the message.
    - The parse leg lands the CRF reading alone. That is ADR-0026's `single-engine` outcome, with the LLM absent. The
      LLM's absence is not written to the parse cache, so the same text is asked again once the budget returns.
    - The review records a `budgetSpent` outcome under its verification key, together with the spend period captured at
      reserve (ADR-0024 §2). Within that period it blocks a resend, the way an exhausted attempt does (ADR-0071 §8). It
      is not a verdict, and it never counts as "a verdict on record that asked identity". So the save path's dedup
      (ADR-0071 §12) still sends a saved line for review.
    - The outcome reads `budgetSpent` only while its period is the current one. In the next period the next matches call
      claims the review and sends it again.
- **What the cook sees.** `matchStateOf` gains the review value `budgetSpent` and the reason `reviewBudgetSpent`. The
  state enum stays closed. A `default` line stays `default`. A line with no proposal stays `noMatch` or `needsChoice`.
  Every other line, curated, remembered and exact-name lines included, reads `needsChoice`, with the proposed food kept
  as a candidate. ADR-0071 §9 records the row.
- **Why every food, and not only the lexical ones.** The owner confirmed that every food goes to the cook, curated
  and remembered matches included. Without the LLM parse leg, nothing reviews the parse itself. A
  curated or exact-name match on a CRF-only phrase can be a confident match to the wrong words.
- **Nothing binds without the cook, in every mode** (owner ruling, second round). With the budget spent, a bulk
  import follows the same process as a single paste, for many recipes. In `keepAsWritten`, `bindBest` and `review`
  alike, a line whose review reads `budgetSpent` is saved as written, with no food and so no nutrition. It is listed
  under "to check" until the cook accepts it, by picking a food or by keeping it as written. A default does not bind,
  and `bindBest` does not bind its top match. The design session drew the "to check" list this way.
- **Scope.** The exception covers the parse-job origin only: paste and bulk import. The save path's verification of a
  saved recipe still treats a ceiling denial as transient. An unreadable counter is still transient and still fails
  closed on every path. The ceiling is enforced in prod only (ADR-0024 §3), so this fallback can only happen in prod.
- **Matching gets worse past the budget, by decision.** The owner accepted that, and said the ceiling itself is
  temporary.

## Consequences

- A bulk import moves only while a client is calling `advance`. Progress lives in the server's rows, so any device the
  cook signs in on can resume it.
- A recipe saved by the import is published and in review until approved (§3). The cook can still open and edit it,
  and `bound_by` follows the food through every later save.
- One read model, three mappings. The paste view, a saved line's badge and the import flag all read the one
  classifier, so the three surfaces cannot disagree about what a verdict means.
- The allowance now has two channels in one table. Paste and bulk import never borrow from each other.
- With the budget spent, a bulk import keeps working. Its lines are saved as written and wait under "to check" for
  the cook. Nothing waits for the next month.
- The `/api/v1/import` prefix now holds a resource, so a later single-recipe channel under it must be a literal word
  that is not a UUID.

## One-way doors

- **`ingredients.bound_by` and its value set.** Stored on every bound line. Renaming or removing a value means
  rewriting rows.
- **The import's wire contract**, in particular the closed `MatchState` it reuses and the flag states. A new fact is a
  new field or a new reason key.
- **The reason key `reviewBudgetSpent`** on the parse-job view and the import view. Installed clients localize it.
- **The ledger's channel values.** Once 0058 is pushed, `bulk` and `paste` are stored data.

## Residual risks

- **One cook can spend the shared pool.** With no per-import cap, a large bulk import can use the month's ceiling, and
  every cook's paste matching then runs without the LLM until the period ends. The allowance bounds how many recipes a
  day one cook can send, not how much of the pool they use. The rate table, not this ADR, states the pool's cost per
  recipe.
- **A raised ceiling does not revive earlier lines.** A `budgetSpent` outcome reads as spent until its period ends, even
  if the ceiling is raised mid-month. New lines are reviewed again only in the next period.
- **The fallback only fires in prod**, where the ceiling is enforced. It needs a test that injects a denial, because no
  non-prod stage ever produces one.
- **A CRF-only parse is permanent for its job line.** ADR-0026 records the exception: elsewhere a ceiling denial
  retries, so an outage never becomes a fact about a line. The parse cache does not store the LLM's absence, so a
  later job asks again, but the landed job line is not re-parsed.
- **The built modules do not know about the budget yet.** `bindingOf` has no budget input, so it still binds defaults
  and `autoBest` lines. `importFlagOf` flags only a bound line, so it cannot list a line saved as written. The builder
  owes both: a spent budget makes `bindingOf` keep every line without a cook choice as written, and the "to check"
  list covers those lines.
- **A large library takes days.** At 1,000 recipes a rolling day (a paid plan), 017 SC-004's 2,000-recipe export
  finishes on the second day at the earliest. On Free's 200 a day it takes ten days.

- **A purge drops open "to check" lines.** That list is derived from the snapshot. When an import is purged, its
  lines that still wait for the cook leave the list and the count. The saved recipe keeps the line as the import left
  it. This follows the owner's ruling literally, and it is open for the owner. To keep those lines findable, the purge
  needs a rule that spares an import with open lines.
- **One very large import can outlast a purge statement.** The purge deletes 3 imports per statement, and each one
  takes its items and lines with it by cascade. A file of any size is accepted. So one import that holds tens of
  thousands of recipes can make a single statement run past the tick's time. The tick then fails, and the next tick
  tries the same import again.

## Follow-ups

- Rename the module folder `src/migrations/` to `src/import/`, so it follows the route. It also sits beside
  `src/database/migrations/`, where "migrations" means schema migrations.
- Edit migration 0058 in place: channel `bulk` for bulk import, and change the comments that say a migration file is
  one unit. Split the allowance policy by channel, with 200 for paste and 1,000 for bulk.
- Add the `budgetSpent` review value and its worker outcome, the `reviewBudgetSpent` reason, and the CRF-only landing
  on a ceiling denial. Each needs a test that fails on a return of the old transient behaviour.
- Set the provenance label from the per-recipe statement (§9), and store the statement and citation with the
  recipe.
- Give `bindingOf` a budget input and build the "to check" list (§10).
- Build the out-of-slots pause and take the slot lock on each private save, so a private recipe holds its slot from
  the save (§9, ADR-0073 §5 and §8). Save every item published, never as a draft (§3).

## Related work

- **URL import is a separate flow** (004, owner ruling, second round). Before it imports a page, the server checks the
  source page's copyright or licence and decides public, private, or block. An allowed-public link is stored as
  `imported_public`. A link allowed only as private is stored as `imported_paid`, private-only on every plan. A
  free cook keeps it private with no Premium and no edit, within their 50 slots (ADR-0073). A blocked link is not
  imported. 004's spec records the
  ruling near FR-008.
  This ADR does not design that check, and bulk import does not use it: in bulk import, the cook's statement sets the
  label (§9).

## Alternatives

- **`/api/v1/recipes/migrations`.** Spec 017's proposed name. The owner chose `/api/v1/import`.
- **`/api/v1/imports`.** ADR-0071's follow-up named the plural. The owner chose the singular.
- **Background matching or binding.** The worker holds no caller credential, and food search as a service identity is
  refused (ADR-0071 §1).
- **A stored `flagged` column.** It goes wrong the moment a verdict lands. The flag is derived (§6).
- **Food names on the import's rows.** ADR-0045 keeps names out of the recipe database.
- **A server bind recorded as a resolution correction.** A bind the cook did not make is not a correction. Recording
  it teaches the memo tier from guesses.
- **A version counter bumped by recipe-service writes.** Verdicts land from the worker by key, so the arrival of a
  verdict does not move a counter. `version` is a digest of what the view was built from, verdicts included, computed at
  read time and never stored.
- **Server-sent events or a WebSocket.** Every browser-facing service is bearer-only (ADR-0047). The import view is
  polled, like the parse job.
- **Keeping the import's state in the device draft.** The draft's format is a one-way door (ADR-0057), and the import
  must resume on another device.
- **A new verification-message origin.** The import's lines are parse-job lines, so they reuse the parse-job origin
  and its call site.
- **Parsing the export archive on the server.** The client reads the file and sends recipes. An archive is hostile
  input that the server then has to unpack, and the user bringing the bytes is the safer channel (016, finding 3).
- **Rebinding a cook's pick on a late verdict.** A late verdict never replaces the cook (ADR-0071 §9).
- **A response maximum on candidates.** The wire has no upper bound, so the server can change its own limit.
- **A per-import cap on LLM calls.** The owner ruled it out. The prod ceiling is the one bound.
- **Retrying a ceiling denial on this path.** It holds a cook's paste or import until the next month. The owner
  ruled that matching goes on without the LLM instead (§10).
