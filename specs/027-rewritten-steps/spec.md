# Feature Specification: Flow Steps (rewritten recipe steps, on the cook's request)

**Feature Branch**: single-branch directive. The spec directory is `specs/027-rewritten-steps`. The slug is neutral on purpose, because the name below waits for the owner.
`.specify/feature.json` is not pointed here: another session uses it.
**Created**: 2026-11-15
**Status**: Draft. Clarified with assumed answers (see Clarifications, C-1 to C-21, each marked "Assumed, owner to confirm"). Planned
(`plan.md`). Not built. Every user-facing surface needs `staff-ux-engineer` DISCOVER, DESIGN and SPECIFY before build.
None has run.
**Input**: Owner, 2026-11-15, verbatim: "we have a feature in the future that allows users to elect to have the
instructions (regardless of public or private) rewritten and be our 'AI optimized' instructions ... that users can
choose to have them replace the current instructions or we'll have it attached as additional instructions (I.e. for
use in cooking mode when they request AI optimized instructions - we need a better term for that, something more
exciting - so that we don't regenerate the instructions every single time if the current non-optimized instructions
haven't changed)."

## The name

The owner asked for a better term than "AI optimized". A name must describe the cook's benefit, must not claim more
than the feature does ("optimized", "perfect", "smart"), must not use the words this spec bans in copy (FR-044), must
not collide with names already in use ("Commise version" in `016`, "suggestion" and "rewording" in `020`, the rights
labels "Written by you" and "Adapted by you" in `016-FR-015c`), and must read well as a localisation key.

| Name             | For                                                                         | Against                                                                    |
| ---------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Flow Steps**   | Says the benefit: steps that keep the cook moving. Short, verb-able, plain. | "Flow" is a little abstract until the cook has seen it once.               |
| Cook-Ready Steps | Very clear about the job.                                                   | Long on a phone button. "Ready" can read as a status, not a version.       |
| Clear Steps      | Calm and honest.                                                            | Flat. Implies the cook's own steps are unclear.                            |
| Step Coach       | Friendly, fits cooking mode.                                                | Promises coaching (tips, feedback) that the facts-only writer cannot give. |
| Kitchen Pass     | Kitchen word for the hand-off of a finished plate. Distinctive.             | Jargon most home cooks do not know. Collides with "pass" in other UIs.     |

**Recommendation: Flow Steps.** It is the only candidate that is short, exciting enough for a feature name, honest
about what the cook gets, and clear of every existing term. The rest of this spec uses it. In copy, the cook's own
steps are "Original steps". The localisation namespace is `recipes.flowSteps.*`. The owner confirms the name
(Clarifications, C-1). Renaming touches copy and keys only, never the data model, which uses the neutral term
"rewritten steps".

## What the cook gets

A recipe's steps are often written for the author, not the cook at the stove. The research names the gaps: the cook
does not see the whole job before starting (`CK-007`), is not told what to do while something else cooks (`CK-003`),
and must choose between prepping first and prepping during the waits (`CK-022`). The same research warns that imports
and AI rewrites change amounts and drop steps (`CK-006`), which is the trust problem ranked second of all needs
(`docs/research/userNeeds/synthesis.md`).

Flow Steps rewrites a recipe's steps into a cook-ready form: one action per step, prep gathered before the heat where
the recipe allows it, waits made visible, and the whole job previewed. It keeps every amount, temperature, time,
ingredient and safety line, and it adds none. The cook asks for it, recipe by recipe. The cook then either keeps it
beside the original (most useful in Cooking Mode) or uses it to replace the original.

## Dependencies

| Spec / ADR                                                                                                         | Why                                                                                               |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [001](../001-commise-recipe-app/spec.md)                                                                           | The recipe, its steps and the edit path.                                                          |
| [004](../004-recipe-importing/spec.md)                                                                             | The import pipeline and the import-time rewrite that shares this engine. FR-056..063 template.    |
| [005](../005-ai-integration/spec.md)                                                                               | A use (`FR-015a`), the out-of-uses stop (`FR-015d`), own keys (`FR-015`).                         |
| [008](../008-cooking-mode/spec.md)                                                                                 | Cooking Mode shows the steps. `FR-033a` (empty steps), `FR-034` timers, `FR-034a` no amounts.     |
| [010](../010-subscriptions/spec.md)                                                                                | The plan register (`FR-041b`) and the two limits (`FR-041d`).                                     |
| [016](../016-legal-compliance-framework/spec.md)                                                                   | Rights labels (`FR-015c`).                                                                        |
| [019](../019-offline-mode/spec.md)                                                                                 | What the device keeps for offline cooking.                                                        |
| [020](../020-content-source-check/spec.md)                                                                         | The check on every edit (`FR-058`), labels after AI text (`FR-077`), the source line (`FR-080`).  |
| ADR-0024 / DD21                                                                                                    | The one spend pool, reserve-then-settle, the single Bedrock role.                                 |
| ADR-0058 / DD27                                                                                                    | Versions start at the first publish. Replace relies on them.                                      |
| [003B](../003B-public-rewrite/spec.md)                                                                             | Public versions of imports. The only door that publishes another site's steps. Shares the engine. |
| [ADR-0093](../../docs/architecture/decisions/0093-imported-recipes-go-public-only-as-a-commise-written-version.md) | An import goes public only as a Commise-written version.                                          |

## User Scenarios & Testing _(mandatory)_

### User Story 1, Get Flow Steps for a recipe and cook with them (Priority: P1)

A cook opens one of their own recipes and asks for Flow Steps. After a short wait they see the rewritten steps beside
the original, with a note that Commise wrote them from the recipe's own facts. In Cooking Mode they choose Flow Steps
or Original steps. Next time they cook the same recipe, Flow Steps opens at once, with no wait and no use spent.

**Why this priority**: It is the whole value of the feature in its safest form. Nothing about the recipe changes, and
nobody else sees the rewritten text.

**Independent Test**: Request Flow Steps on a saved recipe, see it attached, cook with it in Cooking Mode on web and
mobile, request again and confirm no new generation and no use.

**Acceptance Scenarios**:

1. **Given** the owner of a saved recipe with uses left, **When** they ask for Flow Steps, **Then** they see a
   generating state, then the rewritten steps, and one use is taken.
2. **Given** a recipe whose Flow Steps exist and whose steps and ingredients have not changed, **When** the cook asks
   again or opens Cooking Mode, **Then** the stored Flow Steps show at once, no generation runs and no use is taken.
3. **Given** a recipe with Flow Steps attached, **When** the cook starts Cooking Mode, **Then** they can choose Flow
   Steps or Original steps, the choice is remembered for that recipe on that device, and timers come from the steps
   shown.
4. **Given** the cook asks on web and on mobile at the same moment, **Then** one generation runs, one use is taken,
   and both devices show the same result.
5. **Given** a public recipe with Flow Steps attached, **When** another person reads the recipe, **Then** they see only
   the original steps.

---

### User Story 2, Flow Steps after the recipe changed (Priority: P1)

The cook edits a step. Their attached Flow Steps no longer match the recipe. The app says so plainly and offers to
update them. It does not update them by itself.

**Why this priority**: Showing rewritten steps that disagree with the recipe would put a wrong instruction in front of
a cook mid-recipe. Updating silently would spend the cook's uses without asking.

**Independent Test**: Attach Flow Steps, edit a step, open the recipe and Cooking Mode, confirm the out-of-date state,
then update and confirm one use.

**Acceptance Scenarios**:

1. **Given** attached Flow Steps and an edited step, **When** the cook opens Cooking Mode, **Then** it opens on the
   Original steps, says the Flow Steps are out of date, and offers "Update Flow Steps".
2. **Given** the same state, **When** the cook does nothing, **Then** no generation runs and no use is taken.
3. **Given** the cook edits the step back to its earlier text, **Then** the stored Flow Steps are current again with
   no new generation.

---

### User Story 3, Replace the recipe's steps with Flow Steps (Priority: P2)

The cook likes the Flow Steps more than their original and makes them the recipe's steps. They see both side by side,
confirm, and the recipe now holds the new steps. They can go back to the old steps from the recipe's history.

**Why this priority**: Useful, but it changes the recipe itself, and on a public recipe it changes what others read.

**Independent Test**: On a private recipe, replace, confirm the steps changed and a version holds the old ones,
restore it.

**Acceptance Scenarios**:

1. **Given** current Flow Steps on a private recipe, **When** the cook chooses Replace, **Then** they see the original
   and the Flow Steps side by side and must confirm. No use is taken.
2. **Given** they confirm, **Then** the recipe's steps are the Flow Steps, the earlier steps are a version in the
   recipe's history, and the recipe's rights label is unchanged (FR-032).
3. **Given** the recipe changed after the Flow Steps were made, **When** the cook tries to replace, **Then** the
   replace is refused with the out-of-date message and nothing changes.
4. **Given** a public recipe written by the cook, **When** they confirm a replace, **Then** the edit goes through the
   content check like any edit (`020-FR-058`), and the recipe shows the credit line (FR-043).
5. **Given** a public version of an imported recipe (spec 003B), **When** the cook confirms a replace, **Then** the
   wording check of 003B-FR-050 runs on the new steps like any save, and the label and the credit line are unchanged.

---

### User Story 4, When Flow Steps cannot be made (Priority: P1)

Something stops the generation: the cook has no uses left, the platform's AI budget is spent, the cook is offline,
the recipe is too long, or the rewritten text failed the checks. The cook is told plainly, keeps what they had, and
can always cook from the original steps.

**Why this priority**: Every one of these happens in normal use. The original steps must never be lost or blocked.

**Independent Test**: Force each condition and confirm the state, the copy and that no use is taken.

**Acceptance Scenarios**:

1. **Given** no uses left, **When** the cook asks, **Then** they see 005's out-of-uses stop with the reset date, and
   no generation runs (`005-FR-015d`).
2. **Given** the platform budget is spent, **When** the cook asks, **Then** they see "Flow Steps can't be made right
   now", their uses are untouched, nothing is queued, and nothing retries by itself (`010-FR-041d`).
3. **Given** the device is offline, **When** the cook opens a recipe with current Flow Steps kept on the device,
   **Then** they cook with them. **When** none are kept, **Then** the request control says it needs a connection.
4. **Given** the rewritten steps failed the fact check or the wording check, **Then** the cook sees "We couldn't
   rewrite these steps without changing a detail", the original steps stay, and no use is taken.

### Edge Cases

- A recipe with no step that has text (`008-FR-033a`): nothing to rewrite. The control is not offered.
- A recipe that is still a draft (never saved as a recipe): not offered until it is saved (FR-003).
- A recipe over the size cap (FR-004): refused before any generation, never truncated.
- The cook deletes the recipe while a generation runs: the result is discarded and no use is taken.
- The cook loses their plan while Flow Steps exist: existing Flow Steps stay readable and usable. New ones cannot be
  made (FR-002).
- Ingredient list edited, steps unchanged: Flow Steps become out of date, because they name ingredients (FR-020).
- Servings changed in Cooking Mode: Flow Steps, like the original steps, keep the recipe's own numbers and show the
  `008-FR-034a` note.
- A step that says only "Enjoy!" or similar: carries no facts. The writer may drop it (FR-040 does not count it).
- A recipe in a language other than the cook's app language: Flow Steps are written in the recipe's language. Only
  English is offered at first (C-12).
- The recipe is under a takedown or a content hold: not offered while the hold stands (FR-003).
- The model returns more steps, fewer steps, merged or split steps: allowed, as long as FR-040 passes.

## Requirements _(mandatory)_

### Functional Requirements

#### A. Who can ask, and for what (eligibility)

- **FR-001**: Only the recipe's owner MAY request, attach, replace or remove Flow Steps for that recipe. A request for
  another person's recipe MUST be answered as if the recipe did not exist. A person who wants Flow Steps for someone
  else's public recipe saves their own copy first. (C-2)
- **FR-002**: Requesting new Flow Steps MUST need a plan whose register entry includes Flow Steps (`010-FR-041b`). At
  first that is Pro with AI and its trial. (C-4) Flow Steps already made stay readable and usable after a plan ends.
- **FR-003**: Flow Steps MUST be offered only for a recipe that has been saved as a recipe at least once (not a draft),
  has at least one step with text (`008-FR-033a`), and is not under a takedown or content hold. Each refusal MUST have
  its own reason and its own copy.
- **FR-004**: The steps and ingredient lines sent for rewriting MUST be capped (the plan sets the figures). Over the
  cap the request MUST be refused before anything is generated or reserved. Text MUST NOT be truncated: a cut recipe
  could lose its last steps and still look complete (the same rule as `004-FR-058`).
- **FR-005**: Flow Steps MUST be made only when the cook asks, recipe by recipe. Nothing generates Flow Steps in the
  background, on import, on save, on opening Cooking Mode, or on a schedule. A recipe created in the single-recipe
  editor is never rewritten automatically (owner ruling).

#### B. Attach and replace

- **FR-010**: Every generation MUST produce one attached Flow Steps version stored beside the recipe. It MUST NOT
  change the recipe, its steps, its version history, its rights label or its public view.
- **FR-011**: An attached version MUST be visible only to the recipe's owner, on every device they use. Readers of a
  public recipe MUST see only the recipe's own steps. A household member never sees attached Flow Steps, and never sees
  a replace of a paid site's private copy: for such a copy the household sees what 003B-FR-019 allows, and nothing
  more. (C-3)
- **FR-012**: The owner MUST be able to switch between Flow Steps and Original steps on the recipe page and in Cooking
  Mode. In Cooking Mode the choice MUST be remembered per recipe on that device, and timers MUST come from the steps
  being shown (`008-FR-034`). Switching MUST keep the cook's place as closely as the two step lists allow: the
  cook returns to the first step that covers the same point (the plan defines the mapping).
- **FR-013**: The owner MUST be able to remove attached Flow Steps. Removing them gives back no use.
- **FR-020** to **FR-024** (section C) say when an attached version is current.
- **FR-030**: The owner MUST be able to replace the recipe's steps with current Flow Steps. Before it happens they MUST
  see the original and the Flow Steps side by side and confirm. Replacing MUST NOT run a new generation or take a use.
- **FR-031**: A replace is an ordinary edit of the recipe. It MUST go through the recipe's normal edit path, so that:
    - the earlier steps are kept as a version (ADR-0058), and the cook can restore them from the recipe's history;
    - on a public recipe, the content check runs on the new steps like any edit (`020-FR-058`);
    - the recipe's rights label does not change (FR-032).
- **FR-032**: A replace MUST NEVER change the recipe's rights label, whichever recipe it is. A recipe whose steps came
  from another site becomes public only through the two doors of 003B-FR-015, so a replace opens no way to publish
  another site's steps. A replace is allowed on a private copy: it is the cook's own choice.
- **FR-033**: A replace MUST be refused if the recipe changed after the Flow Steps were made (FR-020), or if another
  edit landed first. The cook sees the out-of-date state and nothing changes.
- **FR-034**: After a replace, the attached version is the recipe's steps, so it MUST be shown as current (the recipe
  now matches it). The cook does not see two copies of the same steps.

#### C. Kept, not remade (the cache)

- **FR-020**: An attached version MUST record a fingerprint of the saved recipe content it was made from: the steps,
  the ingredient lines and the recipe language. It is current while the saved recipe has the same fingerprint, and
  out of date otherwise. The fingerprint MUST be taken from the recipe as saved on the server, never from a draft on
  the device (DD26).
- **FR-021**: A request for a recipe whose current fingerprint matches its attached version MUST return that version
  with no generation and no use.
- **FR-022**: An out-of-date version MUST NOT be shown as the steps to cook from. It is shown only as out of date,
  with "Update Flow Steps". Updating is a new request (one use, FR-050). Nothing updates it without the cook.
- **FR-023**: Requests for the same recipe and the same fingerprint that arrive together (two devices, a double tap,
  a retry) MUST lead to one generation and at most one use.
- **FR-024**: A recipe keeps one attached version. Updating replaces it. Deleting the recipe, or erasing the account,
  MUST delete its Flow Steps and any job for it (`016` erasure rules).
- **FR-025**: A change to the writer (a new model or prompt) MUST NOT make existing versions out of date. Each version
  records which writer made it.

#### D. How Flow Steps are written and checked (the shared engine)

- **FR-035**: The writer MUST receive only a sheet of facts drawn from the recipe by code: the order of the steps, the
  actions from a fixed list, the amounts, temperatures, times, ingredient names, equipment from a fixed list, and the
  safety lines (FR-041). It MUST NOT receive the wording of the steps, the source address, the source statement or
  any other recipe text. This holds for every recipe, whoever wrote it. (C-7)
- **FR-036**: The writer MUST be a model that is not made by Anthropic (owner ruling, 2026-11-17), run on Amazon Bedrock. The cook's own keys (`005-FR-015`) MUST NOT be used for Flow Steps. (C-6)
- **FR-037**: The writer MUST rewrite into cook-ready steps: one main action per step, preparation gathered before the
  heat where the facts allow, waits named so the cook can work during them, and a short "before you start" step for
  anything that must happen well ahead (preheat, marinate, rest). It MUST NOT add tips, reasons, substitutions,
  serving ideas, or any fact not on the sheet.
- **FR-040**: Code MUST check every result before anyone sees it, in both directions, across the whole recipe:
    - every amount, temperature, time, ingredient name and safety line on the fact sheet appears in the result, as
      often as on the sheet. And
    - the result holds no amount, temperature, time, ingredient name or safety line that is not on the sheet.
      Steps may be merged, split or reordered. A result that fails is never shown, stored or charged.
- **FR-041**: A safety line is a statement in the steps in one of these seven categories. The plan fixes the detectors. (C-13)
    1. An internal or doneness temperature.
    2. Raw or undercooked meat, poultry, fish, egg or flour.
    3. Hot oil or deep frying.
    4. Pressure cooking, canning or fermenting.
    5. Flambé, or alcohol near a flame.
    6. An allergen named in the steps.
    7. A "do not", "never" or "discard" warning.
- **FR-042**: Code MUST check the result's wording against the original step wording. A result whose wording is too
  close to the original (the plan sets the measure and the threshold, and this feature owns both for every consumer of
  the engine, spec 003B included) MUST NOT be shown, stored or charged. This is a
  ceiling on reuse of the original wording, not a measure of quality. The measure works on a hashed fingerprint of the
  original wording (a versioned set of keyed hashes of word runs), not on the text. This feature takes the fingerprint
  in memory from the saved steps. Spec 003B stores one, because it keeps no source text. Both run the one function.
- **FR-043**: Flow Steps MUST carry a credit line wherever they are shown:
    - attached, to the owner: "Steps written by Commise from this recipe." (key `recipes.flowSteps.credit.attached`);
    - after a replace on a public recipe the cook wrote: "Steps written by Commise with AI, checked by {cook}."
      (`recipes.flowSteps.credit.publicOwn`);
    - after a replace on a private copy of another site's recipe: "Steps written by Commise. Based on a recipe at
      {site}." (`recipes.flowSteps.credit.privateSourced`). It replaces the copy's "Saved from {site}" wording,
      which no longer describes the steps (C-19).
      A public version of an imported recipe keeps the credit lines of spec 003B (`credit.written`, plus `credit.basedOn` for a free site).
      This feature adds no key for it (C-20).
      The credit line sits beside the rights label and the source line. It does not replace them (FR-032).
- **FR-044**: Copy for this feature MUST NOT use any word on the one shared banned-word list, in any language. The
  list is defined once, in spec 003B (003B-FR-064), and held in one module that every copy guard imports. A test MUST
  enforce it over every `recipes.flowSteps.*` string.
- **FR-045**: The writer, the fact sheet, the fact check and the wording check MUST be one engine, shared with the
  import-time public version (spec [003B](../003B-public-rewrite/spec.md)) and offered to `020`'s rewording
  suggestion (`020-FR-075`). They MUST NOT be written twice. Spec 003B builds the engine first, and this feature uses it.
  The engine takes its time reader and its keyed hash as injected inputs, and its fingerprint functions take sets, so the
  shared package needs no dependency on a package that depends on it. The plan says where the engine lives.
- **FR-046**: The writer's output MUST be read as data. An answer that cannot be read, holds more steps than the plan's
  cap, or holds text outside the step list MUST be refused, and the job ends failed. Nothing is guessed.

#### E. Cost

- **FR-050**: A generation that produces Flow Steps the cook sees MUST take one use (`005-FR-015a`). A request answered
  from the stored version, a refusal before generation, a failed check, a budget denial and a failure take no use.
  (C-5)
- **FR-051**: Every generation MUST reserve from and settle against the one platform spend pool, under its own call
  site (ADR-0024).
- **FR-052**: When the pool's ceiling is reached, the request MUST end at once as "budget spent". It MUST NOT retry,
  queue, or wait for next month. The cook keeps their uses (`010-FR-041d`).
- **FR-053**: With no uses left, the cook MUST see 005's out-of-uses stop (`005-FR-015d`), and no generation runs.

#### F. Platforms, states and offline

- **FR-060**: Every part of this feature MUST ship on web and mobile in the same release (`CODING_STANDARDS.md` §14),
  with the same states and the same copy keys. Mobile uses one-tap controls where web has hover.
- **FR-061**: Each of these states MUST be designed, have its copy, a localisation key under `recipes.flowSteps.state.*`,
  and a component test on both platforms:

    | State                | When                                            | Key                    |
    | -------------------- | ----------------------------------------------- | ---------------------- |
    | first-run            | The owner sees the control for the first time   | `state.firstRun`       |
    | available            | Eligible, nothing attached yet                  | `state.available`      |
    | generating (loading) | A request is running                            | `state.generating`     |
    | ready                | A current version is attached                   | `state.ready`          |
    | out of date          | The attached version no longer matches (FR-022) | `state.stale`          |
    | empty                | No step with text (FR-003)                      | `state.empty`          |
    | not yet saved        | The recipe is a draft (FR-003)                  | `state.draft`          |
    | too long             | Over the cap (FR-004)                           | `state.tooLong`        |
    | not on your plan     | The plan does not include it (FR-002)           | `state.planRequired`   |
    | out of uses          | No uses left (FR-053)                           | `state.outOfUses`      |
    | budget spent         | The pool ceiling is reached (FR-052)            | `state.budgetSpent`    |
    | could not keep facts | The result failed FR-040 or FR-042              | `state.checkRefused`   |
    | error                | Any other failure, or no answer in time         | `state.failed`         |
    | offline              | No connection and no version on the device      | `state.offline`        |
    | held                 | Under a takedown or content hold (FR-003)       | `state.held`           |
    | replace preview      | Side by side before a replace (FR-030)          | `state.replacePreview` |
    | busy                 | 3 requests already running (FR-065)             | `state.busy`           |
    | replaced (success)   | The replace saved (FR-031)                      | `state.replaced`       |

- **FR-062**: Errors MUST keep what the cook had: the original steps are always available, and an attached version
  survives a failed update.
- **FR-063**: A current attached version MUST be kept on the device with the recipe wherever `019` keeps the recipe for
  offline cooking, and MUST be usable offline. Requests, updates, replaces and removals need a connection. They MUST
  NOT be queued offline.
- **FR-064**: A generation that has not finished within the plan's limit (at most 10 minutes) MUST end failed. The cook
  can ask again.

#### G. Limits and signals

- **FR-065**: A cook MUST NOT have more than 3 Flow Steps requests running at once across all their recipes. A fourth
  is refused with the generating state's "wait" copy (`recipes.flowSteps.state.busy`). (C-16)
- **FR-066**: Every request MUST be counted by outcome (hit, ready, check refused by category, budget spent, failed,
  refused before generation). Logs and metrics MUST NOT hold step text, the fact sheet or the result. (C-17)

### Out of scope

- Rewriting the title, ingredient lines, notes or anything other than the steps.
- Regenerating one step at a time, or asking for a different style.
- Flow Steps for a reader of someone else's recipe (C-2).
- Reading Flow Steps aloud. Voice in Cooking Mode belongs to `008`.
- Building the import-time public version (spec 003B). Spec 003B builds the shared engine first
  (FR-045).

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`. No `any` outside marked test doubles. (Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc. (Principle II)
- **NFR-003**: Every control MUST have an accessible name reachable by `getByRole`/`getByLabel`. (Principles IV, VII)
- **NFR-004**: Colour MUST NOT be the only sign of a state (out of date, ready, failed). (Principle VII)
- **NFR-005**: The fact sheet, the fact check, the wording check and the answer reader MUST be pure functions, with
  tests that fail when a fact is dropped or added (mutation lens). (Principle IV, IX)
- **NFR-006**: Patterns are named in the plan's register and in `@pattern` tags where §11.2 requires. (Principle IX)

### Key Entities

- **Flow Steps version**: the one attached rewrite of a recipe's steps. Belongs to the recipe and its owner. Holds the
  steps, the fingerprint of the content it was made from, which writer made it, and when.
- **Flow Steps request (job)**: one asked-for generation. Holds the recipe, the fingerprint, its state (pending, ready,
  check refused, budget spent, failed) and its times. At most one pending per recipe and fingerprint.
- **Fact sheet**: what the writer sees. Made by code from the saved recipe. Never stored as recipe text.
- **Use**: 005's unit of a cook's AI allowance. One per shown generation.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On the evaluation set (at least 200 real recipes of mixed length and source), 0 Flow Steps shown to a
  cook are missing or adding an amount, temperature, time, ingredient or safety line, measured by an independent
  human audit of a 50-recipe sample as well as by the checks.
- **SC-002**: At least 90% of requests on the evaluation set end with Flow Steps shown (the rest end in a stated
  refusal, never a silent one).
- **SC-003**: A second request for an unchanged recipe makes no generation in 100% of cases, and shows Flow Steps in
  under 1 second on a normal connection.
- **SC-004**: 95% of generations finish within 30 seconds.
- **SC-005**: Two devices asking together take one use in 100% of trials.
- **SC-006**: The cook can always reach the original steps, in every state, on both platforms.
- **SC-007**: In a moderated test with at least 8 cooks, most prefer Flow Steps over the original for a recipe new to
  them. This is a hypothesis to test, not evidence (heuristic judgement, untested).

## Assumptions

- The writer, the checks and the import-time public version are new. The code has no step rewording today (`020` Q-6),
  so spec 003B builds the engine first (FR-045).
- 005's ledger of uses is built before or with this feature. This feature does not build a second one.
- The plan register (`010-FR-041b`) gains a Flow Steps entry.
- English is the only writing language at first (`025`, English markets first).
- The figures in FR-004, FR-042 and FR-064 are set in the plan and measured on the evaluation set.
- Flow Steps never change ingredient lists, servings, photos, the title, or nutrition.

## Clarifications

### Session 2026-11-15 (assumed answers. The owner was not asked, per the brief)

Each answer is the best-justified default. Each is **Assumed, owner to confirm**.

- **C-1. The name.** Q: What do we call it? → A: **Flow Steps**; Original steps for the cook's own. (The name)
  _Assumed, owner to confirm._
- **C-2. Who can ask.** Q: Can a reader get Flow Steps for someone else's public recipe? → A: No. Only the owner. A
  reader saves a copy first. Keeps the rewrite for the cook who saved it (`016-FR-015i`) and one version per recipe.
  (FR-001) _Assumed, owner to confirm._
- **C-3. Who sees an attached version.** Q: Do readers of a public recipe see its attached Flow Steps? → A: No. Only
  the owner. Others see Flow Steps only after a replace, with the credit line. (FR-011) _Assumed, owner to confirm._
- **C-4. Which plans.** Q: Free and Pro have uses too. Can they use them here? → A: Pro with AI and its trial only, at
  first, through the plan register. The owner's brief names Pro with AI. (FR-002) _Assumed, owner to confirm._
- **C-5. When a use is taken.** Q: Does a generation that fails the checks take a use? → A: No. A use is taken only
  when the cook sees Flow Steps. The pool still pays for the failed call. (FR-050) _Assumed, owner to confirm._
- **C-6. Own keys.** Q: May a Pro with AI cook's own keys pay for Flow Steps after the allowance? → A: No. The writer
  must be a known, measured, non-Anthropic model, and own keys may name any provider. (FR-036) _Owner ruling,
  2026-11-17: no Anthropic model._
- **C-7. Facts only for the cook's own words too?** Q: Could the writer see the wording when the cook wrote it? → A:
  No, facts only for every recipe. A source statement is the cook's claim and can be wrong, and one input type is one
  tested path. (FR-035) _Assumed, owner to confirm._
- **C-8. Rights label after a replace.** Q: Which label? → A: None changes. Neither an attached version nor a replace
  touches the label. (FR-032) _Assumed, owner to confirm._
- **C-9. Public replace of another site's recipe.** Q: Allowed now? → A: Another site's steps become public only through
  the two doors of 003B-FR-015, so a replace needs no gate and opens no door. (FR-032) _Assumed, owner to confirm._
- **C-10. Updating after a change.** Q: Update automatically when the recipe changes? → A: No. Show it out of date and
  update only when the cook asks, because an update spends a use. (FR-022) _Assumed, owner to confirm._
- **C-11. Undo a replace.** Q: How does the cook go back? → A: From the recipe's version history. A recipe must have
  been saved as a recipe once, so a version always exists (ADR-0058). (FR-003, FR-031) _Assumed, owner to confirm._
- **C-12. Language.** Q: Which language? → A: The recipe's language; English only at first. _Assumed, owner to confirm._
- **C-13. What counts as a safety line.** Q: Which statements must survive? → A: The seven categories in FR-041.
  _Assumed, owner to confirm._
- **C-14. What makes it out of date.** Q: Steps only, or ingredients too? → A: Steps, ingredient lines and language,
  because the steps name ingredients. (FR-020) _Assumed, owner to confirm._
- **C-15. One version or several.** Q: Keep older Flow Steps? → A: One per recipe. An update replaces it. (FR-024)
  _Assumed, owner to confirm._
- **C-16. Too many requests.** Q: What stops a cook flooding the writer? → A: One pending request per recipe and
  fingerprint (FR-023), at most 3 pending per cook (FR-065), and the cook's uses. (FR-065) _Assumed, owner to confirm._
- **C-17. What is recorded.** Q: What do we log? → A: Outcomes and check-failure categories, never recipe text.
  (FR-066) _Assumed, owner to confirm._
- **C-18. What is out of scope.** Q: Titles, ingredients, single-step regeneration? → A: Out of scope (Out of scope
  section). _Assumed, owner to confirm._
- **C-19. Replacing a private imported copy.** Q: The private copy keeps the site's wording; may the cook replace it?
  → A: Yes, by the cook's own choice. The ruling governs what the import pipeline does, not what the cook chooses
  later. The original stays in the recipe's history, and the credit line changes (FR-043). _Assumed, owner to
  confirm._
- **C-20. No second credit key.** Q: Does this feature keep its own credit for a public version of an imported recipe? → A:
  No. It uses spec 003B's credit keys, so each string has one key. (FR-043) _Assumed, owner to confirm._
- **C-21. AI disclosure on a public replace.** Q: Does the credit say AI wrote the steps? → A: Yes, in 003B's words
  ("with AI, checked by {cook}"), so every public page that carries Commise-written steps discloses the same way. (FR-043)
  _Assumed, owner to confirm._

## Conflicts with existing specs (for the owner)

1. **`020-FR-077`, `020-FR-080` and `020` Q-4**: 020 gives an accepted rewording suggestion the label "Adapted by
   you". A Flow Steps replace changes no label (FR-032), so the two differ. The owner decides whether a replace should
   follow 020 here.
2. **`020-FR-075`** lets the rewording suggestion model see the flagged step's text. FR-035 lets the shared writer see
   facts only. If 020 uses this engine (FR-045), FR-075's input rule changes to facts only.
3. **`020-FR-078`** leaves the suggestion call's spend open until 020 starts. This feature spends from the same pool
   first (FR-051), so the spend decision is needed now.
4. **`005-FR-015`** lists Anthropic among own-key providers, and `005-FR-015c` and ADR-0024 §6 cost a use on an
   Anthropic model. FR-036 uses no Anthropic model and no own keys here. The plan costs a use on a non-Anthropic
   model instead.
