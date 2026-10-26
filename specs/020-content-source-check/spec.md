# Feature Specification: Content Source Check

**Feature Branch**: `docs/im-spec020` (single-branch directive. The spec directory is `specs/020-content-source-check`.)
**Created**: 2026-10-26
**Status**: Draft
**Input**: User description, owner, 2026-10-26: "We will need an automated review process checking all new content -
that needs to be a new feature and spec ... that uses an AI agent to check to see if the content of a recipe is from a
paid site, copyrighted content, a book, etc." Context ruling, same day: "If we can tell then we can prevent them from
going public; otherwise we have to rely on the user telling us that it's ok to make them public."

## Dependencies

| Spec or decision                                                                                                                                                   | Relationship                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md)                                                                                                        | **Required.** Owns visibility (`001-FR-003`), public read (`001-FR-004`), the clone chain (`001-FR-005`) and the C-004 visibility policy this check feeds                                              |
| [004-recipe-importing](../004-recipe-importing/spec.md)                                                                                                            | **Required, amended.** Owns provenance (`004-FR-011`), the per-item attestation (`004-FR-014a`), the paywall blocklist (`004-FR-014`, D-004) and the import channels. `004-FR-014a` changes (FR-040)   |
| [016-legal-compliance-framework](../016-legal-compliance-framework/spec.md)                                                                                        | **Required, amended.** Owns the statement of reasons (`016-FR-018`), the reviewer dashboard (`016-FR-053a` to `g`) and strikes (`016-FR-020`). Also owns retention (`016-FR-052`) and the counsel list |
| [015-publishing-rewards](../015-publishing-rewards/spec.md)                                                                                                        | **Referenced.** A recipe that this check holds back is not published, so it earns nothing                                                                                                              |
| [017-recime-parity](../017-recime-parity/spec.md)                                                                                                                  | **Referenced.** Its portability contract says bulk import is not a side door around the per-item attestation. This check applies to bulk import too                                                    |
| [ADR-0072](../../docs/architecture/decisions/0072-bulk-recipe-import.md) and [ADR-0023](../../docs/architecture/decisions/0023-curator-declared-provenance.md) §1a | **Required.** The per-recipe statement and the four provenance labels. The check never changes a label                                                                                                 |
| [ADR-0024](../../docs/architecture/decisions/0024-llm-spend-ceiling-reserve-then-settle.md)                                                                        | **Governs.** The one $100 monthly pool, reserve-then-settle, and the single `bedrock:InvokeModel` grantee                                                                                              |
| [ADR-0026](../../docs/architecture/decisions/0026-two-engine-ingredient-parse-pipeline.md)                                                                         | **Applied by analogy.** A model is never shown another engine's answer. Here the model is never shown the cook's statement or our rule-based signals                                                   |
| The free-tier private slots ADR (being written on another branch)                                                                                                  | **Required.** Free cooks hold up to 50 private recipes. When slots run out, the cook can stop, or make the rest public. This check stops a book or paid-site recipe going public                       |
| `GR-010` EU AI Act Compliance Propagation                                                                                                                          | **Referenced.** The check's output is a decision, not AI-generated content shown to users, so no Art. 50(2) marking is owed (FR-034)                                                                   |
| `GR-003` FR Identifier Namespace                                                                                                                                   | **Governs.** Every cross-feature reference here is written `{feature}-FR-{NNN}`                                                                                                                        |

## Overview

When a cook makes a recipe public, Commise shows it to everyone. If the recipe came from a cookbook or a paid site, that
is a copy of someone else's work, shown to the public by us. Today the only thing that stops this is what the cook
tells us. For each imported recipe, the cook says "I wrote this" or "From a source", with a citation. That statement
sets the recipe's label (`004-FR-014a`, ADR-0072 §9). A book or paid-site recipe can never be public.

This works only if the cook knows the source and tells the truth. This feature adds an automated **source check**. It
reads the recipe before it goes public and looks for signs that it came from a book, a paid site or another published
source. When the check can tell, the recipe does not go public. When it cannot tell, we rely on the cook's statement,
as today.

### What the check does

- It runs on every recipe that is about to become publicly visible: a new recipe published as public, a private recipe
  made public, an already-public recipe whose text changed, and every bulk-imported recipe headed public.
- It looks for evidence that code can check: a valid ISBN, a named publisher, a copyright notice that names a
  publisher or paid site, a known paid-site template, page references, and a cited link to a known paid site. An AI
  model reads the recipe as a second, separate detector. It can point at more evidence, and code then finds that evidence in
  the text.
- When it finds evidence it can verify, it holds the recipe back from public view. The recipe stays saved, and the cook
  can keep it private, change their statement, or ask a person to decide.
- It tells the cook what it found and why, in a statement that says an automated check made the decision.

### What the check does NOT do

- **It is not a legal shield.** A contract cannot move liability for a third party's copyright onto the cook (016,
  finding 2). Our protection still comes from hosting content at a user's direction and from fast takedown
  (DMCA §512(c), `016-FR-016` to `FR-022`). This check lowers the number of copied recipes that reach the public. It does
  not make us safe. Nobody can present it as a defence.
- **It does not delete or block a save.** The recipe is always saved. Only public visibility is held back.
- **It never changes the cook's label.** The statement the cook made stays the record (`016-FR-014`). The hold is a
  separate fact that a person can reverse.
- **It does not fetch anything.** It does not visit cited links, search the web or compare the recipe with any source.
  Retrieval stays user-directed only.
- **It does not check private recipes.** Privacy does the heavy lifting (016, finding 1), and checking a recipe nobody
  else can see costs money and sends the cook's text out for no gain.
- **It does not take content down after a notice.** That stays with 016's human notice process.
- **It cannot catch a copy with no markers.** A cookbook recipe typed out by hand, with no ISBN, publisher or page
  number, usually looks like any other recipe. We say so, measure it (SC-003) and do not claim otherwise.

### Words used in this spec

| Word                 | Meaning                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source check**     | The automated check this feature adds. We never call it a "review". The review gate (ADR-0071) and the review wizard (ADR-0072) use that word                                    |
| **Evidence**         | One thing the check found: its kind, where it is in the recipe, and whether code found it in the text                                                                            |
| **Outcome**          | The result for one recipe and one version of its checked text: `clear`, `possible`, `detected` or `unchecked`. It depends on the evidence and on the recipe's label and citation |
| **Publication hold** | The fact that a recipe cannot be publicly visible now, because of its outcome. It is separate from the label, and a person can lift it                                           |
| **Appeal**           | The cook asking a person to decide on a `detected` outcome                                                                                                                       |
| **Checked text**     | The parts of a recipe the check reads: title, description, tags, ingredient lines as written, steps, and any text taken from a photo by OCR                                      |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A recipe the check can tell is from a book does not go public (Priority: P1)

A cook pastes a recipe, says "I wrote this" and publishes it as public. The pasted text still carries the line
"© 2019 Ten Speed Press. All rights reserved." and an ISBN. The recipe is saved. For a moment it shows "Checking before
it goes public". Then it shows "Kept private: this looks like it is from a book", with the two pieces of evidence and
three choices: keep it private, change where it came from, or ask a person to look.

**Why this priority**: This is the owner's ruling itself. Without it, a false or mistaken "I wrote this" puts a
cookbook recipe in front of the public. Our record then shows that nobody told us anything.

**Independent Test**: Publish, as public, a recipe whose text holds a valid ISBN and a listed publisher's copyright
notice. Confirm it is saved, never visible to a signed-out viewer, shows the evidence to its owner, and offers the three
choices.

**Acceptance Scenarios**:

1. **Given** a cook who publishes a recipe as public, **When** the check has not finished, **Then** the recipe is saved,
   the cook sees that it is being checked, and no other person can see it.
2. **Given** a recipe whose checked text holds a verified, blocking piece of evidence, **When** the check finishes,
   **Then** the outcome is `detected`, the recipe stays out of public view, and the cook sees each piece of evidence
   and where it is.
3. **Given** a `detected` recipe, **When** the cook chooses to keep it private, **Then** it becomes private under the
   usual private rules and slot count, and its label does not change.
4. **Given** a `detected` recipe, **When** the cook changes their statement to "From a source" with a book citation,
   **Then** the label becomes `imported_physical` and the recipe becomes private (FR-015a). If the cook has no private
   slot free, the change is refused, and the cook can appeal or leave the recipe held.
5. **Given** a recipe whose checked text holds no evidence, **When** the check finishes, **Then** the outcome is
   `clear` and the recipe becomes publicly visible with no further step.
6. **Given** a `detected` outcome, **When** it is shown to the cook, **Then** it comes with a statement of reasons
   that says an automated check made the decision (FR-028).

---

### User Story 2 - Bulk import never makes a known book recipe public (Priority: P1)

A free cook imports 300 recipes from another app. All 50 of their private slots are in use, so they choose to make the
rest public after confirming each statement. Each recipe headed public is checked during the import. Four are
`detected`. The import lists them: each one can only be skipped, or the import can be stopped. None is made public.

**Why this priority**: The owner named this case. When slots run out mid-import, a cook can make the rest public. This
check stops a book or paid-site recipe going public with them. Bulk import is where the volume is.

**Independent Test**: Run a bulk import for a free cook with no slots left, including recipes with blocking evidence.
Confirm those items are never saved as public, are listed with their evidence, and offer only skip or stop. Confirm
the clean items continue.

**Acceptance Scenarios**:

1. **Given** a bulk import with an item headed public, **When** the import reaches that item, **Then** the item is
   checked before it is saved as public.
2. **Given** a free cook with no private slots left, **When** an item headed public is `detected`, **Then** the cook can
   skip that item or stop the import, and cannot make it public.
3. **Given** a cook with a private slot free, **When** an item headed public is `detected`, **Then** the cook can also
   keep it private, using a slot.
4. **Given** an item the cook stated is from a book or paid site, **When** the import runs, **Then** no check runs for
   it, because it can never be public.
5. **Given** an import paused while items are being checked, **When** the cook resumes on another device, **Then** each
   item shows its outcome or that it is still being checked, and no item is checked twice for the same text.

---

### User Story 3 - The cook can ask a person to decide (Priority: P2)

A cook's own family recipe is `detected`. It names the publisher of the church cookbook where it was first printed, and
the page number. The cook says the recipe is theirs. They appeal. A reviewer sees the recipe, the
evidence and the cook's reason, and decides. The cook is told the result and the reason.

**Why this priority**: The check will be wrong sometimes. A false `detected` takes away a cook's right to share their
own recipe, and EU law expects a way to challenge an automated restriction. The appeal is what makes a false positive
cost a short wait instead of a lost recipe.

**Independent Test**: Appeal a `detected` recipe. As a reviewer, overturn it. The recipe becomes public and the cook is
told. Repeat and uphold. The recipe stays held and the cook is told why.

**Acceptance Scenarios**:

1. **Given** a `detected` recipe, **When** the cook appeals with a reason, **Then** the appeal is recorded and appears
   in the reviewer queue with the recipe, the evidence and the reason.
2. **Given** an appeal, **When** a reviewer overturns the outcome, **Then** the hold is lifted and the cook is told. If
   the cook still wants the recipe public, it becomes publicly visible.
3. **Given** an appeal, **When** a reviewer upholds the outcome, **Then** the hold stays, and the cook receives a
   statement of reasons naming the evidence and that a person decided.
4. **Given** any decision on an appeal, **When** it is saved, **Then** it records who decided, when, the ground and
   the facts relied on. It cannot be saved without them.
5. **Given** a `detected` outcome, upheld or not, **When** the cook's account record is read, **Then** no
   infringement strike was added (FR-031).

---

### User Story 4 - When the check is unsure, the cook's statement decides (Priority: P2)

A cook publishes a recipe as public. The check finds only weak signs: it reads like a cookbook headnote, or it says
"see page 112" with nothing else. The check cannot tell. The cook is asked to confirm their statement, and the app
shows what made the check unsure.

**Why this priority**: This is the second half of the owner's ruling: "otherwise we have to rely on the user telling
us". It is also where the check is most likely to be wrong, in both directions.

**Independent Test**: Publish, as public, a recipe whose only signal is a page reference. Confirm the outcome is
`possible`, and that the behaviour follows the answer to Clarification Q2.

**Acceptance Scenarios**:

1. **Given** a recipe with only non-blocking signals, **When** the check finishes, **Then** the outcome is `possible`,
   never `detected`.
2. **Given** a `possible` outcome, **When** it is handled, **Then** it follows FR-016 [NEEDS CLARIFICATION, Q2].
3. **Given** a `possible` outcome that the cook confirmed, **When** the recipe is published, **Then** the record shows
   the signal, the confirmation and its time.

---

### User Story 5 - When the AI budget is spent, the cook is asked (Priority: P2)

The month's AI budget is used up. A cook publishes a recipe as public. The rule-based detectors still run and find
nothing. The model cannot run. The cook is told the check did not finish and is asked to confirm their
statement. The recipe is recorded as `unchecked`, never as `clear`.

**Why this priority**: The owner ruled that AI-dependent steps stop, and the cook is asked, once the AI budget is
spent. To treat "we did not check" as "clean" is a silent pass. This feature must never do that.

**Independent Test**: With an injected ceiling denial, publish a recipe with no rule-based evidence. Confirm the
outcome is `unchecked`, the cook is asked to confirm, and the record never says `clear`. Repeat with a recipe that
holds an ISBN. It is `detected` with no model call.

**Acceptance Scenarios**:

1. **Given** a spent budget, **When** a recipe holds rule-based blocking evidence, **Then** the outcome is `detected`,
   because those detectors need no model.
2. **Given** a spent budget and no rule-based evidence, **When** the check runs, **Then** the outcome is `unchecked`
   with the reason `budgetSpent`, and the cook is asked to confirm their statement before it goes public.
3. **Given** an `unchecked` recipe that went public on the cook's confirmation, **When** the next spend period starts,
   **Then** it is checked again (FR-021).
4. **Given** a spend counter that cannot be read, **When** the check runs, **Then** no model call is made. The check is
   retried, and the recipe stays held until it ends (FR-022).

---

### User Story 6 - Changing an already-public recipe is checked again (Priority: P3)

A cook edits a public recipe and pastes new steps copied from a paid site, with its template text still in place. The
edit is saved. The recipe leaves public view during the check of the new text. With a `detected` outcome, it stays out.

**Why this priority**: Without it, a cook can publish a clean recipe and then replace its text. It is P3 because it
needs a deliberate act and the window is short.

**Independent Test**: Edit the steps of a public recipe to include a paid-site marker. Confirm a signed-out viewer
cannot see the recipe from the moment the edit is saved, and that the cook sees the outcome.

**Acceptance Scenarios**:

1. **Given** a public recipe, **When** its checked text changes, **Then** it is not publicly visible until the new text
   has an outcome that allows it.
2. **Given** a public recipe, **When** a change leaves the checked text the same (cuisine, tags, photo replaced),
   **Then** no new check runs and visibility does not change.
3. **Given** a recipe whose checked text is the same as text already checked under the same rules and model, **When**
   it is published, **Then** the stored evidence is reused and no new model call is made. (A clone of another cook's
   recipe needs a substantive edit before it is published, `GR-014` AC-014-g, so it is new text.)

---

### User Story 7 - The operator can show how good the check is (Priority: P3)

The operator runs the check over a labeled set of recipes and sees its precision and recall. Only then can it hold
anything back. While it runs in production, the operator sees how often each outcome happens and how many
appeals are overturned.

**Why this priority**: A check that holds back honest cooks' recipes, or that misses most copies while we claim it
works, is worse than no check. The numbers decide whether blocking is switched on.

**Independent Test**: Run the evaluation over the labeled set. It reports precision and recall for `detected`. While
SC-001 or SC-002 is not met, blocking cannot be turned on.

**Acceptance Scenarios**:

1. **Given** the labeled set, **When** the evaluation runs, **Then** it reports precision and recall for `detected`,
   recall on items with explicit markers, and recall on items with none.
2. **Given** results below SC-001 or SC-002, **When** someone tries to turn blocking on, **Then** it stays in shadow
   mode, recording outcomes without holding anything back.
3. **Given** the check in production, **When** the operator looks, **Then** they see outcome counts, appeal counts and
   the overturn rate.

---

### Edge Cases

- **A copyright notice in the cook's own name.** "© 2024 Jane Doe" can be the cook. Code cannot tell, so a notice that
  does not name a listed publisher or paid site is `possible`, never `detected`.
- **A public web page's footer.** An `imported_public` recipe from a blog often carries the blog's own notice. A notice
  naming the cited site is consistent with the statement and is not evidence against it. Only paid-site and book
  evidence counts for `imported_public`.
- **The model quotes text that is not there.** A quote that code cannot find in the checked text is discarded and never
  counts as evidence.
- **Text over the input cap.** The model is not sent text it cannot take whole (ADR-0024: reject, never truncate). The
  rule-based detectors still run on the full text. With no rule-based evidence the outcome is `unchecked` with the
  reason `tooLong`.
- **A check that never finishes.** After its retries are spent, the outcome becomes `unchecked` with the reason
  `checkFailed`, and the cook is asked. No recipe waits forever (FR-022).
- **The cook changes the text while the check runs.** The outcome belongs to the text it read. A new version of the
  text needs its own outcome, and an outcome for an older version never makes the new one public.
- **Two cooks publish the same text.** The outcome is keyed by the checked text, so the second reuses the first.
  Neither sees the other's recipe or identity.
- **A recipe already `detected` is cloned.** A clone of a held recipe is impossible, because only public recipes can be
  cloned by others. The owner's own clone keeps the source's outcome until its text changes.
- **The cook is offline at publish.** Publishing needs the server. A publish made offline waits in the outbox. Once it
  reaches the server, the check starts (Offline Behavior).
- **A recipe passes the check and later gets a takedown notice.** The notice follows 016. A `clear` outcome is not
  evidence that the recipe is lawful and is never offered as such.
- **The check model changes.** Outcomes record which model and which rules produced them. A change of model does
  not re-check public recipes on its own, and it never hides them (FR-002). A re-check of the public corpus is a
  separate, deliberate operator act.
- **A cook erases their account and their public recipes are donated.** Donation makes recipes public and published
  without the editor. A held recipe is not donated: it is deleted with the account, like a private recipe, because
  nobody would be left to appeal it (FR-018a).
- **A curated public-domain import.** The curator path (ADR-0023 §1) imports old cookbooks on purpose, and they are
  full of page references. Those recipes have no cook to ask, so the curator's grant counts as the confirmation
  (FR-003a). A `detected` outcome still holds them, and goes to the reviewer queue.
- **The cook deletes the recipe or erases their account while an appeal is open.** The appeal closes as withdrawn.
  The decision records 016 requires are kept for their period (FR-036).

## Clarifications

### Session 2026-10-26

Two questions are open. Each has a recommended answer, which the plan uses as a labelled working assumption until the
owner answers.

- **Q1. Are photos in scope?** See FR-006. Recommended: **A** for this release, then **B** once 011's OCR engine
  exists.
- **Q2. What happens to a `possible` outcome?** See FR-016. Recommended: **A**, unless counsel's answer on red-flag
  knowledge (FR-041) says otherwise, in which case **B**.

The spent-budget case is not an open question: the owner already ruled that AI steps stop and the cook is asked
(FR-020).

## Requirements _(mandatory)_

### Functional Requirements

#### A. When the check runs

- **FR-001**: The check MUST run before a recipe becomes publicly visible. A public, published recipe is publicly
  visible (`isRecipeViewableBy`). The check MUST run at each of these moments:
    - A recipe is published with public visibility.
    - A published recipe's visibility changes from private to public.
    - The checked text of a public, published recipe changes.
    - A bulk-imported recipe is headed public (FR-024).
- **FR-002**: A recipe MUST be publicly visible only while the current version of its checked text has an outcome that
  allows it (FR-013). This one rule covers every moment in FR-001. A recipe without such an outcome is visible only to
  its owner. The rule reads the outcome that was produced for that recipe and text. A later change of model or rules
  MUST NOT, on its own, hide a recipe that already has an allowing outcome.
- **FR-003**: The check MUST NOT run on a recipe that stays private, or on a recipe whose label is `imported_paid` or
  `imported_physical`, because those can never be public.
- **FR-003a**: For a recipe whose provenance was declared under the curator grant (ADR-0023 §1), the grant MUST count as
  the confirmation of a `possible` or `unchecked` outcome. A `detected` outcome still holds it and goes to the reviewer
  queue. This MUST be keyed on the recorded grant or channel (`016-FR-028`), never on the `imported_public` label,
  because a cook's bulk statement also sets that label (ADR-0072 §9).
- **FR-004**: The check MUST run for every way a recipe arrives: typed, pasted (`004-FR-052`), from a link
  (`004-FR-008`), from a photo (`011`), from a file and in bulk (ADR-0072). It runs on the recipe's text, not on the
  channel.
- **FR-005**: Evidence MUST be stored once per digest of the checked text, rule set version and model, and shared by
  every recipe with that text. The same text MUST NOT be sent to the model twice for the same rules and model. The
  outcome is separate and per recipe, because it also depends on the recipe's label and citation (FR-010). A change
  that does not touch the checked text MUST NOT start a check.
- **FR-006**: Photos. The text taken from a photo by OCR is checked text in every option. Whether the recipe's own
  images are checked is [NEEDS CLARIFICATION: Q1. Are the images a cook uploads checked for visible marks of a third
  party (watermark, copyright text, a photographed book page)? **A**: no, text only in this release. **B**: yes, and a
  `detected` image cannot be public, but the recipe can go public without that image (the cook replaces it).
  **C**: yes, and a `detected` image holds the whole recipe back. Recommended: **A** for this release, then **B** once
  011's OCR engine exists. Images are the highest-risk part, but code cannot find a model's reading of an image in
  the image (FR-009), so without OCR an image can never reach `detected`. Image tokens also escape the spend gate's
  input cap (FR-023). Imported third-party photos are not affected: they are shown by reference and never stored
  (`016-FR-027`).]

#### B. What the check reads, and what counts as evidence

- **FR-007**: The check MUST be two detectors that run separately and are combined only afterwards:
    - **Rule-based detectors**, which need no model. They find:
        - a valid ISBN-10 or ISBN-13, with its checksum tested
        - a listed publisher or imprint name
        - a copyright notice, and the holder it names
        - a page reference
        - a known paid-site template string
        - for a statement that cites a public web page, a cited link whose host is a listed paid site.
    - **A model detector**, which reads the checked text and returns evidence items, each with a quote from the text.
- **FR-008**: The model MUST see the checked text and nothing else. It MUST NOT see the cook's statement, the label,
  the citation, the rule-based results, or anything about the cook. The statement is the claim under test. If the
  model sees it, the model leans towards agreeing with it. ADR-0026 states this rule for parse engines, and it applies
  here.
- **FR-009**: Code MUST find every quote the model returns in the checked text. A quote that cannot be
  found MUST be discarded. Evidence is never taken on the model's word.
- **FR-010**: Each evidence kind MUST be either **blocking** or **non-blocking**, and that MUST be decided by a fixed
  table in code, never by the model. At minimum:

    | Evidence                                                                     | Kind for `user_created` | Kind for `imported_public`                |
    | ---------------------------------------------------------------------------- | ----------------------- | ----------------------------------------- |
    | Valid ISBN                                                                   | blocking                | blocking                                  |
    | Listed publisher or imprint                                                  | blocking                | blocking                                  |
    | Copyright notice naming a listed publisher or paid site                      | blocking                | blocking                                  |
    | Known paid-site template string                                              | blocking                | blocking                                  |
    | Cited link whose host is a listed paid site                                  | not used (no citation)  | blocking                                  |
    | Copyright notice naming anyone else                                          | non-blocking            | non-blocking, and none for the cited site |
    | Page reference, or a cross-reference to another recipe by page               | non-blocking            | non-blocking                              |
    | Model judgement with no verified quote of a marker ("reads like a cookbook") | non-blocking            | non-blocking                              |

- **FR-011**: The lists of publishers, imprints, paid-site hosts and paid-site template strings MUST be data. Each
  has an admin-managed lifecycle and an audit trail: who added an entry, when and why. This is the governance of
  `004-FR-014`'s blocklist (004 D-004). Paid-site hosts MUST reuse that blocklist, not a second one.
- **FR-012**: The check MUST NOT fetch any link, search the web, or compare the recipe with any outside source.

#### C. Outcomes and the publication hold

- **FR-013**: The check MUST produce exactly one outcome for a version of the checked text:
    - **`clear`**: no evidence. Allows publication.
    - **`possible`**: only non-blocking evidence. Handled by FR-016.
    - **`detected`**: at least one blocking piece of evidence that code found in the text. Holds publication back.
    - **`unchecked`**: the model did not run, and the rule-based detectors found no blocking evidence. The reason is one of
      `budgetSpent`, `tooLong` or `checkFailed`. Handled by FR-020.

    An outcome MUST NOT be stored as `clear` unless both detectors ran.

- **FR-014**: A `detected` outcome MUST create a **publication hold** on the recipe. The hold MUST NOT change the
  recipe's label, MUST NOT delete the recipe, MUST NOT block a save, and MUST be liftable by a person's decision on
  appeal (FR-026).
    > **Why the boundary is a hold, not a new label.** We weighed three options.
    >
    > 1. **Reclassify the recipe to `imported_paid`.** Rejected. That label can never be public, so a false positive is
    >    permanent. It also replaces the cook's own attestation with a guess, and `016-FR-014` makes that attestation the
    >    controlling record.
    > 2. **Send every detection to a person first.** Rejected as the default. A cook with a cookbook ISBN in the text
    >    waits days for a person to repeat what code already found. The queue also grows with import volume.
    > 3. **Hold public visibility, keep the recipe, and let a person reverse it.** Chosen. A false positive costs a
    >    short wait and an appeal. A false negative is what happens today, without the check.
- **FR-015**: A cook with a `detected` recipe MUST be offered these choices:
    - Keep it private, under the usual private rules and the free-tier private slots ADR.
    - Change their statement to "From a source" with a book or paid-site citation (FR-015a).
    - Appeal.
    - Leave it as it is. It stays held, visible only to them, like a draft.

    A free cook with no private slot free has only the last two, plus deleting the recipe.

- **FR-015a**: Changing the statement after a save MUST be a one-way **downgrade** only: from `user_created` or
  `imported_public` to `imported_physical` or `imported_paid`, with a citation, and the recipe becomes private in the
  same act. It needs a private slot under the free-tier private slots ADR. No route MAY change a label upward or to
  `imported_public`. Today provenance cannot change after a save at all (ADR-0023 keeps `source` on create only), so
  this route MUST be recorded as an amendment to ADR-0023. The new label is private-only, so no outcome is needed for
  it.
- **FR-016**: A `possible` outcome MUST be handled as [NEEDS CLARIFICATION: Q2. **A**: the cook is shown what made
  the check unsure and asked to confirm their statement. On confirmation the recipe is published, and the confirmation
  is recorded. **B**: the recipe is held until a person decides, as for an appeal. **C**: the recipe is published with
  no extra step, and the outcome is recorded for a sample audit. Recommended: **A**. It follows the owner's ruling: if we
  cannot tell, we rely on the cook. Counsel can answer FR-041 by saying that to publish after a `possible` signal counts
  as awareness of infringement. In that case, use **B**.]
- **FR-017**: Every confirmation a cook gives (FR-016, FR-020) MUST be recorded with its time, the outcome it answered
  and the evidence shown. It is part of the per-item attestation record (`004-FR-014a`).
- **FR-018**: The hold MUST be part of the one rule for who can see a recipe (`isRecipeViewableBy` and its SQL
  twins), on every read path: a recipe page, search, lists and collections. It MUST NOT be a refusal on the write side.
  A save, a publish and a visibility change never fail because of an outcome (FR-014), and the C-004 matrix
  (`visibilityPolicy.ts`) keeps deciding which visibility a recipe may hold. The only write-side refusal is bulk
  import's (FR-025).
- **FR-018a**: Every path that makes a recipe public and published, including account erasure's donation of recipes,
  MUST be subject to FR-002. Because the hold lives in the read rule, no path can go around it. Erasure MUST NOT donate
  a recipe whose current text has no allowing outcome. It is deleted with the account, as a private recipe is.
- **FR-019**: Blocking MUST start in **shadow mode**: outcomes are recorded and no recipe is held back. Blocking MUST
  be switched on only after the evaluation meets SC-001 and SC-002, and switching it on MUST be a recorded operator
  act. Shadow mode runs **before launch**. If blocking is ever switched on while public recipes exist, it MUST NOT hide
  any of them at once: each recipe it would hide first gets its cook-facing step (a confirmation request, or a
  statement of reasons for `detected`). That transition needs its own plan before it is used.

#### D. Budget, failure and cost

- **FR-020**: If the AI budget is spent, the model cannot run, but the rule-based detectors MUST still run. With no
  rule-based blocking evidence, the outcome MUST be `unchecked` (`budgetSpent`). The cook MUST be told that the check did
  not finish, and asked to confirm their statement before the recipe goes public. This follows the owner's ruling: once
  the AI budget is spent, AI-dependent steps stop and the cook is asked. An `unchecked` outcome MUST NEVER be shown or stored as
  `clear`.
- **FR-021**: At the start of the next spend period, a public recipe whose outcome is `unchecked` (`budgetSpent`) MUST
  be checked again. This is the only way a decided outcome changes: only from `unchecked`, with a new evidence set. A
  `detected` result then holds the recipe back, with a statement of reasons (FR-028). Any other result keeps the cook's
  earlier confirmation.
- **FR-022**: A spend counter that cannot be read MUST fail closed: no model call, the check retries, and the recipe
  stays held. When retries are spent, the outcome MUST become `unchecked` (`checkFailed`) and the cook is asked as in
  FR-020. A recipe MUST NOT stay in "checking" for more than 24 hours.
- **FR-023**: The model call MUST be a call site of ADR-0024's one pool, attributed under its own call-site name. It
  MUST run under the existing single Bedrock grantee and MUST NOT add a second one (ADR-0024 layer 4b). It MUST set an
  explicit output cap and a hard input cap, and MUST NOT truncate text to fit.

#### E. Bulk import and private slots

- **FR-024**: In a bulk import, an item headed public MUST have an outcome before it is saved as public. The item MUST
  wait in the import's "checking" state meanwhile, and the import MUST keep working on other items.
- **FR-025**: In a bulk import, a `detected` item MUST NOT be saved as public. The cook MUST be able to keep it private
  if they have a private slot free, skip it, or stop the import. With no slot free, only skip and stop are offered.
  This follows the owner's ruling. A recipe known to be from a book or paid site can only be stopped or skipped. It is
  never made public.

#### F. People, appeals and statements of reasons

- **FR-026**: A cook MUST be able to appeal a `detected` outcome, with an optional reason. The appeal MUST appear in
  016's reviewer queue (`016-FR-053a`), and a person holding 016's review scope (`016-FR-053g`) MUST decide it:
  overturn, which lifts the hold, or uphold, which keeps it.
- **FR-027**: An appeal decision MUST record who decided, when, the ground and the facts relied on, and MUST NOT be
  saved without them (`016-FR-017`, `016-FR-053b`). The appeal MUST be decided by a person, never by the check.
- **FR-028**: A `detected` hold, and an upheld appeal, MUST each give the cook a **statement of reasons** through 016's
  mechanism (`016-FR-018`, `016-FR-018a`). It MUST name:
    - the action: publication withheld
    - the ground: the terms clause on rights to upload
    - the facts: the kinds of evidence, and where they are
    - that automated means were used, and, for an upheld appeal, that a person decided
    - the redress: keep private, change the statement (FR-015a), or appeal.
- **FR-029**: The statement MUST be built from a fixed template filled with the evidence kinds and locations. It
  MUST NOT be prose written by the model.
- **FR-030**: Appeals MUST be decided within 7 days of being made, the target `016-FR-017a` sets for grounds other
  than copyright notices. An appeal past its target MUST show as overdue.
- **FR-031**: A `detected` outcome, a hold and an upheld appeal MUST NOT add an infringement strike (`016-FR-020`).
  Strikes come only from actioned notices.
- **FR-032**: A reviewer can open a sample of `possible` and `clear` public recipes for audit. A finding from that
  audit that restricts a recipe is a decision with a statement of reasons like any other.

#### G. Privacy and records

- **FR-033**: The checked text MUST be sent only to the model provider in the deploy region, unless the owner records
  an approval of another region for this call site. An approval given for a model at another call site MUST NOT
  cover this one. The provider MUST NOT use the text for training.
- **FR-034**: The check's output is a decision about content, not content shown to users. It MUST NOT be shown to the
  cook as AI-written text. The cook-facing words come from the template (FR-029).
- **FR-035**: Evidence records MUST hold the digest, the rule set version, the model, each evidence kind with its field
  and position, and only the short marker text (for example the ISBN). They MUST NOT hold the recipe's text or any
  user id. A recipe's outcome record MUST hold the recipe, the digest, the outcome, the reason, the label and cited host
  it was judged under, and the times.
- **FR-036**: A recipe's outcome records, confirmations and appeals MUST be deleted with the recipe and with account
  erasure. Shared evidence records hold no user id and no recipe text, so they are kept, and the erasure coverage
  guard records them as retained by ruling. A decision record that is
  evidence of a hold or an appeal decision MUST be kept for 016's period (`016-FR-052a`). It keeps only the short
  marker text it relied on, for example the ISBN, and never the recipe.
- **FR-037**: The cook MUST be able to see, for their own recipe, its current outcome, the evidence, any confirmation
  they gave, and any appeal and its decision.

#### H. Measurement and operation

- **FR-038**: There MUST be an evaluation that runs the check over a labeled set and reports precision and recall for
  `detected`, recall on third-party items that carry an explicit marker, and recall on those that carry none. The
  labeled set MUST be kept outside the repository, with access limited to the operator, because it holds excerpts of
  copyrighted works (FR-041).
- **FR-039**: The check MUST report outcome counts by outcome and reason, appeal counts, the overturn rate, time to
  outcome, and the number of recipes held in "checking". A recipe held past FR-022's limit MUST raise an alert.
    > Inspection is not user evidence. The labeled set measures detection. It says nothing about whether cooks find the
    > check fair or the copy clear. Any claim about that needs a study.

#### I. Changes to other specs

- **FR-040**: `004-FR-014a` MUST be amended. Its sentence "a heuristic MUST NOT by itself reclassify a recipe or block
  a save" stays true, and gains: "Blocking evidence that the source check (020) finds in the text can prevent
  publication. It does so by a publication hold. The hold does not change the label, and a person can lift it on
  appeal. A heuristic still never reclassifies a recipe and never blocks a save." The attestation and citation stay the controlling record.
- **FR-041**: 016 MUST be amended:
    - **Out of Scope** says "Automated content moderation or classifier-driven takedown". It becomes "Automated
      takedown after a notice". Automated pre-publication checks are in scope, through 020.
    - **Assumptions** says "automated means" is expected to read "no". It gains: "except for 020's publication holds,
      where it reads yes".
    - **`016-FR-050`** gains four counsel items:
        - **Red-flag knowledge.** Can it count as awareness of facts that make infringement apparent, under 17 U.S.C.
          §512(c)(1)(A)(ii), to publish a recipe after a `possible` signal and the cook's confirmation? DSA Art. 7
          protects voluntary checks in the EU. US law has no equivalent. **What breaks**: if the answer is yes, FR-016
          option A weakens safe harbour, and a `possible` recipe must wait for a person (option B).
        - **The statement wording.** Counsel confirms the statement of reasons for an automated hold. **What breaks**:
          a statement that fails DSA Art. 17 is a defect on every hold.
        - **The labeled set.** Is it lawful to keep excerpts of copyrighted works for internal testing, and on what
          terms? **What breaks**: the evaluation then needs another source of positive examples.
        - **The region.** The owner approves a region for recipe text sent to the model at this call site (FR-033).
          **What breaks**: without it, the model detector cannot run, and only the rule-based detectors do.
    - **`016-FR-018a`'s delivery** MUST accept a decision from 020 (a hold or an appeal decision), not only a notice
      decision. 016's `notice_decisions` table is not changed (research R-13).
    - These 016 amendments are NOT applied by this feature's first commit. Another session is working on 016, so they
      are listed here and applied with 016's own next revision.
- **FR-042**: ADR-0024 §4c's call-site list MUST gain this check's call site. Layer 4b's single grantee does not
  change.
- **FR-043**: ADR-0072's readiness rule (§7) MUST gain FR-024: an item headed public is not ready to save until it has
  an outcome.
- **FR-044**: ADR-0023 MUST be amended for FR-015a: a one-way downgrade of provenance after a save, to a private-only
  label with a citation, and nothing else.

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`, with no `any` outside marked test doubles. Outcome,
  reason and evidence kind are closed unions. (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc. The outcome function and the evidence table are
  pure modules that name the pattern they implement. (Principle II)
- **NFR-003**: Every surface that shows an outcome, a hold, a confirmation or an appeal MUST expose accessible names
  queryable by `getByRole`/`getByLabel`. (Principles IV & VII)
- **NFR-004**: An outcome MUST NOT be conveyed by colour alone. Every state has an icon and a text label.
  (Principle VII)
- **NFR-005**: Every cook-facing string, including the statement-of-reasons template, MUST go through the localization
  path (`016-FR-049`).
- **NFR-006**: Every cook-facing surface ships on web and mobile in the same release. The reviewer queue is operator
  tooling and is web-only, as 016 records. (Principle VIII)

### Offline Behavior _(GR-005 declaration)_

- **Offline scope**: none for the check itself. It runs on the server.
- **Persistence**: a publish made offline waits in the existing outbox (ADR-0057). No new device storage.
- **Sync**: when the publish reaches the server, the recipe enters "checking". The outcome is read from the server.
- **Conflict**: an outcome belongs to one version of the checked text, so an edit from another device needs its own
  outcome and never inherits one.

### Key Entities

- **Evidence Set**: the evidence found in one version of checked text, under one rule set and model. Shared by every
  recipe with the same text. Holds no user id and no recipe text.
- **Evidence Item**: one piece of evidence in a set: kind, field, position, verified, which detector found it, and
  the short marker text.
- **Source Check Outcome**: the result for one recipe and one digest: outcome, reason, the label and cited host it
  was judged under, and times.
- **Publication Hold**: the fact that a recipe cannot be publicly visible now. It is derived from the recipe's current
  text and its outcome, and an overturned appeal lifts it.
- **Cook Confirmation**: the cook confirming their statement after a `possible` or `unchecked` outcome. Part of the
  attestation record.
- **Appeal**: the cook's request for a person to decide, with the reason, the decision, who made it and when.
- **Rightsholder List**: publishers, imprints, paid-site hosts and template strings, with an audit trail.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On the labeled set, at least 97% of `detected` outcomes are correct, and the lower bound of the 95%
  confidence interval is at least 95%. The set holds at least 300 third-party items with markers and at least 300
  items the cook wrote or that are public.
- **SC-002**: On the labeled set, at least 90% of third-party items that carry a blocking marker are `detected`.
- **SC-003**: Recall on third-party items with no marker is measured and reported with every evaluation. No target
  is set, and no claim can say the check catches unmarked copies.
- **SC-004**: Zero recipes are publicly visible whose current checked text lacks an outcome that allows it, checked by
  an automated assertion, not by sampling.
- **SC-005**: 95% of checks reach an outcome within 60 seconds of the publish, and zero recipes stay in "checking" for
  more than 24 hours.
- **SC-006**: 100% of holds and upheld appeals have a statement of reasons that says automated means were used,
  delivered on both of 016's channels.
- **SC-007**: 95% of appeals are decided within 7 days.
- **SC-008**: Zero model calls receive the cook's statement, label, citation or rule-based results, checked
  structurally.
- **SC-009**: Zero infringement strikes come from a hold or an appeal.
- **SC-010**: Zero model calls are made for a recipe that stays private, and zero for text that already has an outcome
  under the same rules and model.

## Assumptions

- **The slot rule belongs to the free-tier private slots ADR.** Free cooks hold up to 50 private recipes, and every
  private recipe a free cook holds uses a slot, book and paid-site recipes included. That changes ADR-0072 §9's "No
  Premium needed" row and the C-004 matrix. 020 does not own it and only reads it.
- **Nothing is live.** At launch there is no public corpus to check.
- **016 is planned and not built.** The statement of reasons, the reviewer dashboard and the email channel come from 016. If 020 ships first, it needs 016's statement and queue for the hold path, so blocking stays in shadow mode until
  they exist (FR-019).
- **The reviewer dashboard inherits 016's open decision A-11** on `002`'s "no admin UI" exclusion.
- **The model is one already in ADR-0024's registry.** The plan chooses it and its region, under FR-033.
- **A person reads the appeal.** Volume is low. Appeals are not decided by any automated means.
- **Rule-based detectors come first.** We expect most `detected` outcomes to come from them. The model widens what is
  found, but it never decides what blocks.
- **A held recipe counts like a draft for private slots.** A held recipe is visible only to its owner, as a draft is.
  The free-tier private slots ADR decides whether owner-only drafts use a slot, and a held recipe follows the same
  answer. The risk is stated, not solved here: if drafts use no slot, a cook can keep book recipes as held or as
  drafts without a slot. That hole exists for drafts already, and 020 adds no new one.
- **Bulk import does not publish** (ADR-0072 §3). "Headed public" means the cook chose public visibility for the item.
  The check runs during the import so the cook can choose skip or stop there, as the owner ruled (FR-024, FR-025).
- **Prompt injection is possible.** A recipe can contain text aimed at the model ("ignore your instructions"). At
  worst it hides evidence, which is the same as a copy with no markers. It cannot cause a block. A block needs evidence
  that code finds in the text.

## Out of Scope

- Deciding whether any recipe is lawful. The check finds evidence of a source. It does not judge copyright.
- Checking private recipes, or recipes labelled `imported_paid` or `imported_physical`.
- Fetching, crawling or comparing against sources, including cited links.
- Takedown after a notice, strikes and account termination (016).
- A re-check of the public corpus after a change of model or rules. That is a separate operator act.
- Telling the cook which published work their recipe matches. The check reports markers, not matches.
