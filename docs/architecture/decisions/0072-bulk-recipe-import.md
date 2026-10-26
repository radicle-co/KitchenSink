# 0072 — Bulk recipe import

- **Status:** Accepted
- **Date:** 2026-10-26
- **Relates to:** [ADR-0071](0071-paste-matches-are-proposals.md): matching runs as the cook, and a paste match is a
  proposal. [ADR-0070](0070-catalog-ranking-head-noun-and-defaults.md): defaults serve imports and are never selected
  for the cook. [ADR-0024](0024-llm-spend-ceiling-reserve-then-settle.md): the one spend pool, and the exception this
  path takes to its retry rule. [ADR-0026](0026-two-engine-ingredient-parse-pipeline.md): the two-engine parse.
  [ADR-0045](0045-ingredient-lookup-and-unresolved-foods.md): no food names in the recipe database.
  [ADR-0023](0023-curator-declared-provenance.md): who can declare `imported_public`.
  [ADR-0057](0057-editor-device-draft-and-outbox-format.md): the device draft's format is a one-way door.
  [ADR-0058](0058-never-published-drafts-record-no-version.md): a draft records no version.
  [ADR-0039](0039-database-role-split.md) and [ADR-0035](0035-schema-stacks-decoupled-from-service-deploys.md): new
  tables, their grants and their expand-first migrations.
  [ADR-0014](0014-service-owned-api-contracts.md): the service owns the wire contract.

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

- `importId` is a ULID and is parsed as one at the boundary. Spec 004's task list names
  `/api/v1/import/{url,instagram,text}` for its single-recipe channels. None of those words can parse as a ULID, so a
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

### 3. Each recipe is saved once, as a draft, with its full transcription

When an item is ready (`isReadyToSave`), the server saves its recipe one time, as a draft. Every line keeps what the
source said: the raw source line, the measure the source printed and the ingredient phrase, the three facts
`transcriptionCarryForward.ts` carries. Each line is bound or kept as written by `bindingOf` (§7). The item records the
recipe it created, so a repeated `advance` sees the item as done.

- A never-published draft records no version (ADR-0058), so the import's save does not grow version history.
- The import never publishes. The cook publishes from the editor, where the usual publish rules apply.

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
`BOUND_BY_VALUES` in `recipes/domain/bindingOriginCarryForward.ts`:

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

`bindingOf` (`migrationBindingPolicy.ts`) decides each line. A cook's decision always wins, including "keep this as
written". A confident match binds in every mode. A skipped item keeps its open lines as written.

- **`keepAsWritten`** (Save lines as written). Open lines are kept as written, and a `default` line binds its default
  candidate. Ready once matched and no undecided line is still `checking`, or once the match is older than a wait.
- **`bindBest`** (Pick the best match for me). Every open line binds its top match as `autoBest`. Ready once matched.
- **`review`** (Let me review each). The cook ends it, not a clock. An item is ready in two cases. The cook has no
  open line on it, or the cook closed the wizard with Save and leave. Save and leave binds defaults only on items the
  cook never went through.

The builder made three choices where the blueprint was silent. They are recorded so nobody re-decides them by accident:

- **The wait for a `checking` line is a parameter.** `isReadyToSave` takes `checkingWaitMs`. The blueprint named `CHECKING_WAIT`
  but gave no number, and the module does not invent one. The constant is owed where the module is wired.
- **The flag policy reads the review state** (§6).
- **In `bindBest`, a `default` line binds its TOP candidate as `autoBest`**, not its default candidate as `default`.
  The ruling says "binds every top match", and a default is a suggestion, not a match. The default sits first in the
  list (ADR-0070), so the food is usually the same and only the origin differs. The pinned test names this reading.

### 8. Bulk import has its own allowance: 1,000 recipes a rolling day

The owner ruled that bulk import has an allowance of its own, separate from paste's.

- **Paste: 200 a rolling day**, one unit per paste (004 FR-022 and plan §5).
- **Bulk import: 1,000 recipes a rolling day**, one unit per recipe.
- Both are counted in the one ledger this branch built, `import_allowance_events` (migration 0058), under the per-user
  advisory lock. Each channel sums only its own rows. The window is the trailing 24 hours that
  `importAllowancePolicy.ts` defines.
- An item spends its unit at the first send of its lines for parsing, because LLM spend starts there. The item
  records that it paid, so a repeated `advance` or a re-created parse job never charges it twice.
- An `advance` that reaches the allowance does the work it can still pay for and returns the `IMPORT_QUOTA_EXCEEDED`
  refusal with `resetsAt` for the rest. The import pauses. The next call after that time resumes it.
- The ledger's channel names follow the route: `bulk`, not `migration`. Migration 0058 is not pushed, so it is
  edited in place rather than followed by a rename.

### 9. The cook chooses Public or Private, and every recipe carries its own source statement

- The import flow asks once, Public or Private, for the whole import. The review wizard can change it per recipe,
  the way the editor's visibility field does. The visibility policy (`visibilityPolicy.ts`) still decides whether
  each choice is allowed.
- **Every imported recipe needs its own source statement with a citation** (004 FR-014a, 016 FR-014). This holds for
  private recipes as well as public ones. One statement for a whole file is not the per-item attestation FR-014a
  requires. 017's portability contract already says bulk import is not a side door around it.
- **A recipe whose source is not a public web page cannot be public.** That is FR-014a's own rule: it is classified
  `imported_paid`, which is private-only.
- Counsel confirms the attestation wording before launch. It is on 016 FR-050's list.
- **Three interactions are recorded, not resolved.**
    - Private still needs Premium today. A free-tier `user_created` recipe is public-only, and 004 FR-028 gates the
      `imported_paid` channel behind Premium. Whether that gate lifts is 015's open D4a. Until it does, a free-tier
      cook cannot keep a cookbook recipe from a bulk import at all: it cannot be public, and it cannot be private.
    - A public bulk-imported recipe has no provenance value to save as. An ordinary cook cannot declare
      `imported_public` (ADR-0023, 004 FR-025). `imported_paid` is private-only. Saving a cited web recipe as
      `user_created` states that the cook wrote it. The value is owed before the Public choice can be built.
      Note also that an `imported_public` recipe cannot be made private before a substantive edit by the cook.
    - The ruling asks for a citation on every imported recipe. `FR-014a` covers only a recipe the cook attests came
      from an external source. A cook who moves their own recipes over from another app has nothing to cite. What
      the source statement says for a cook's own recipe is owed, by the owner and by counsel (016 `FR-050`).

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
- **Why every food, and not only the lexical ones.** Without the LLM parse leg, nothing reviews the parse itself. A
  curated or exact-name match on a CRF-only phrase can be a confident match to the wrong words.
- **The bulk modes.** This ADR reads "no line binds without the cook" as the rule where the cook is present: the
  single-paste editor and `review` mode. It reads "in bulk modes such lines are flagged" as the rule for the other two
  modes. In `keepAsWritten` and `bindBest`, the cook chose up front to let the mode bind. There the mode's rule runs on the
  derived state, which holds no confident line while the budget is spent. A line the mode binds reads `flagged`,
  because its review is `budgetSpent`, not owed. This reading needs the owner's confirmation.
- **Scope.** The exception covers the parse-job origin only: paste and bulk import. The save path's verification of a
  saved recipe still treats a ceiling denial as transient. An unreadable counter is still transient and still fails
  closed on every path. The ceiling is enforced in prod only (ADR-0024 §3), so this fallback can only happen in prod.
- **Matching gets worse past the budget, by decision.** The owner accepted that, and said the ceiling itself is
  temporary.

## Consequences

- A bulk import moves only while a client is calling `advance`. Progress lives in the server's rows, so any device the
  cook signs in on can resume it.
- A draft saved by the import is an ordinary draft. The editor opens it, the cook edits and publishes it, and
  `bound_by` follows the food through every later save.
- One read model, three mappings. The paste view, a saved line's badge and the import flag all read the one
  classifier, so the three surfaces cannot disagree about what a verdict means.
- The allowance now has two channels in one table. Paste and bulk import never borrow from each other.
- With the budget spent, a bulk import keeps working. Its lines are worse matched and more of them are flagged or kept
  as written. Nothing waits for the next month.
- The `/api/v1/import` prefix now holds a resource, so a later single-recipe channel under it must be a literal word
  that is not a ULID.

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
- **A CRF-only parse is permanent for its job line.** ADR-0026 and `parseLine.ts` treat a ceiling denial as transient
  so that an outage never becomes a fact about a line. This path now lands that line. The parse cache does not store
  the LLM's absence, so a later job asks again, but the landed job line is not re-parsed.
- **The flag cannot see a line kept as written.** `importFlagOf` flags only a bound line. In `keepAsWritten`, a line
  that is confident with budget left is kept as written while the budget is spent, and nothing flags it. `bindingOf` has
  no budget input either. Both are owed by the builder.
- **The file limit and the allowance overlap.** 004 D-013 caps one file at 1,000 recipes, and 017 SC-004 measures a
  2,000-recipe export. A larger library takes more than one day and more than one file. That conflict is in the specs,
  not settled here.

## Follow-ups

- Rename the module folder `src/migrations/` to `src/import/`, so it follows the route. It also sits beside
  `src/database/migrations/`, where "migrations" means schema migrations.
- Edit migration 0058 in place: channel `bulk` for bulk import, and change the comments that say a migration file is
  one unit. Split the allowance policy by channel, with 200 for paste and 1,000 for bulk.
- Add the `budgetSpent` review value and its worker outcome, the `reviewBudgetSpent` reason, and the CRF-only landing
  on a ceiling denial. Each needs a test that fails on a return of the old transient behaviour.
- Settle the provenance value for a public bulk-imported recipe (§9).
- Update the `CLAUDE.md` pointer for ADR-0024, which states the transient rule with no exception.

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
