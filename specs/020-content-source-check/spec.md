# Feature Specification: Content Source Check

**Feature Branch**: `docs/im-spec020` (single-branch directive. The spec directory is `specs/020-content-source-check`.)
**Created**: 2026-10-26
**Status**: Draft (both clarifications answered by the owner, 2026-10-26)
**Input**: User description, owner, 2026-10-26: "We will need an automated review process checking all new content -
that needs to be a new feature and spec ... that uses an AI agent to check to see if the content of a recipe is from a
paid site, copyrighted content, a book, etc." Context ruling, same day: "If we can tell then we can prevent them from
going public; otherwise we have to rely on the user telling us that it's ok to make them public."

## Dependencies

| Spec or decision                                                                                                                                                   | Relationship                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md)                                                                                                        | **Required.** Owns visibility (`001-FR-003`), public read (`001-FR-004`), the clone chain (`001-FR-005`) and the C-004 visibility policy                                                                  |
| [004-recipe-importing](../004-recipe-importing/spec.md)                                                                                                            | **Required, amended.** Owns provenance (`004-FR-011`), the per-item attestation (`004-FR-014a`), the paywall blocklist (`004-FR-014`, D-004) and the import channels. `004-FR-014a` changes (FR-040)      |
| [016-legal-compliance-framework](../016-legal-compliance-framework/spec.md)                                                                                        | **Required, amended.** Owns the statement of reasons (`016-FR-018`), the reviewer dashboard (`016-FR-053a` to `g`) and strikes (`016-FR-020`). Also owns retention (`016-FR-052`) and the counsel list    |
| [015-publishing-rewards](../015-publishing-rewards/spec.md)                                                                                                        | **Referenced.** A recipe that this check holds back is not published, so it earns nothing                                                                                                                 |
| [017-recime-parity](../017-recime-parity/spec.md)                                                                                                                  | **Referenced.** Its portability contract says bulk import is not a side door around the per-item attestation. This check applies to bulk import too                                                       |
| [ADR-0072](../../docs/architecture/decisions/0072-bulk-recipe-import.md) and [ADR-0023](../../docs/architecture/decisions/0023-curator-declared-provenance.md) §1a | **Required.** The per-recipe statement and the four provenance labels. The check never changes a label                                                                                                    |
| [ADR-0073](../../docs/architecture/decisions/0073-free-tier-private-slots.md)                                                                                      | **Required.** Free cooks hold up to 50 private recipes, counted live. When slots run out mid-import, the cook can stop, or make the rest public. This check stops a book or paid-site recipe going public |
| [ADR-0024](../../docs/architecture/decisions/0024-llm-spend-ceiling-reserve-then-settle.md)                                                                        | **Governs.** The one $100 monthly pool, reserve-then-settle at worst case, and the single `bedrock:InvokeModel` grantee                                                                                   |
| [ADR-0026](../../docs/architecture/decisions/0026-two-engine-ingredient-parse-pipeline.md)                                                                         | **Applied by analogy.** A model is never shown another engine's answer. Here the model is never shown the cook's statement or our rule-based signals                                                      |
| `GR-010` EU AI Act Compliance Propagation                                                                                                                          | **Referenced.** The check's output is a decision, not AI-generated content shown to users, so no Art. 50(2) marking is owed (FR-034)                                                                      |
| `GR-003` FR Identifier Namespace                                                                                                                                   | **Governs.** Every cross-feature reference here is written `{feature}-FR-{NNN}`                                                                                                                           |

## Overview

When a cook makes a recipe public, Commise shows it to everyone. If the recipe came from a cookbook or a paid site, that
is a copy of someone else's work, shown to the public by us. Today the only thing that stops this is what the cook
tells us. For each imported recipe, the cook says "I wrote this" or "From a source", with a citation. That statement
sets the recipe's label (`004-FR-014a`, ADR-0072 §9). A book or paid-site recipe can never be public.

This works only if the cook knows the source and tells the truth. This feature adds an automated **source check**. It
reads the recipe, text and photos, before the recipe goes public. It looks for signs that the recipe came from a book,
a paid site or another published source.

The owner's rulings set what happens next:

- **When code can tell**, the recipe does not go public.
- **When the AI cannot tell** whether a recipe is fine or a copy, a person decides before it goes public. Owner,
  2026-10-26: "We should check everything we can. If the AI can't figure out if it's valid or a violation, then we need
  to raise it to a human to check." And for the unsure case: "A person decides."
- **When nothing is found**, the cook's statement stands, as today.

### What the check does

- It runs on every recipe that is about to become publicly visible: a new recipe published as public, a private recipe
  made public, a public recipe whose text or photos changed, and every bulk-imported recipe headed public.
- It reads the recipe's text and the photos the cook uploaded.
- Code looks for evidence it can prove from the text: a valid ISBN, a listed publisher, a copyright notice that names a
  listed publisher or paid site, a known paid-site template, and a cited link to a known paid site. That evidence holds
  the recipe back on its own.
- An AI model reads the text and the photos as a second, separate detector. What it finds in the text is kept only if
  code finds the same words in the text. What it finds in a photo can never be proven by code, so it never decides
  anything on its own: it sends the recipe to a person.
- When the check holds a recipe back, the recipe stays saved, and only its owner can see it. The cook is told what was
  found, in a statement that says an automated check was used.

### What the check does NOT do

- **It is not a legal shield.** A contract cannot move liability for a third party's copyright onto the cook (016,
  finding 2). Our protection still comes from hosting content at a user's direction and from fast takedown
  (DMCA §512(c), `016-FR-016` to `FR-022`). This check lowers the number of copied recipes that reach the public. It does
  not make us safe. Nobody can present it as a defence.
- **It does not delete or block a save.** The recipe is always saved. Only public visibility is held back.
- **It never changes the cook's label.** The statement the cook made stays the record (`016-FR-014`). The hold is a
  separate fact that a person can reverse.
- **It never publishes an unsure recipe without a person.** No timer, budget state or backlog lets an unsure recipe go
  public on its own.
- **It does not fetch anything.** It does not visit cited links, search the web or compare the recipe with any source.
  Retrieval stays user-directed only.
- **It does not check private recipes.** Privacy does the heavy lifting (016, finding 1). To check a recipe nobody
  else can see costs money and sends the cook's content out for no gain.
- **It does not take content down after a notice.** That stays with 016's human notice process.
- **It cannot catch a copy with no markers.** A cookbook recipe typed out by hand, with no ISBN, publisher or page
  number, usually looks like any other recipe. We say so, measure it (SC-003) and do not claim otherwise.

### Words used in this spec

| Word                 | Meaning                                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source check**     | The automated check this feature adds. We never call it a "review". The review gate (ADR-0071) and the review wizard (ADR-0072) use that word                                       |
| **Checked content**  | What the check reads: title, description, tags, ingredient lines as written, steps, text taken from a photo by OCR, and the photos the cook uploaded                                |
| **Evidence**         | One thing the check found: its kind, where it is in the recipe, and whether code proved it                                                                                          |
| **Outcome**          | The result for one recipe and one version of its checked content: `clear`, `possible`, `detected` or `unchecked`. It depends on the evidence and on the recipe's label and citation |
| **Publication hold** | The fact that a recipe cannot be publicly visible now, because of its outcome. It is separate from the label, and a person can lift it                                              |
| **Referral**         | A recipe sent to a person to decide: automatically for `possible` and `unchecked`, or by the cook's appeal                                                                          |
| **Appeal**           | The cook asking a person to decide on a hold                                                                                                                                        |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A recipe the check can tell is from a book does not go public (Priority: P1)

A cook pastes a recipe, says "I wrote this" and publishes it as public. The pasted text still carries the line
"© 2019 Ten Speed Press. All rights reserved." and an ISBN. The recipe is saved. For a moment it shows "Checking before
it goes public". Then it shows "Kept private: this looks like it is from a book", with the two pieces of evidence and
the cook's choices: keep it private, change where it came from, or ask a person to look.

**Why this priority**: This is the owner's ruling itself. Without it, a false or mistaken "I wrote this" puts a
cookbook recipe in front of the public. Our record then shows that nobody told us anything.

**Independent Test**: Publish, as public, a recipe whose text holds a valid ISBN and a listed publisher's copyright
notice. It is saved, never visible to a signed-out viewer, shows the evidence to its owner, and offers the choices.

**Acceptance Scenarios**:

1. **Given** a cook who publishes a recipe as public, **When** the check has not finished, **Then** the recipe is saved,
   the cook sees that it is being checked, and no other person can see it.
2. **Given** a recipe whose text holds blocking evidence that code proved, **When** the check finishes, **Then** the
   outcome is `detected`, the recipe stays out of public view, and the cook sees each piece of evidence and where it is.
3. **Given** a `detected` recipe, **When** the cook chooses to keep it private, **Then** it becomes private under the
   usual private rules and ADR-0073's slot count, and its label does not change.
4. **Given** a `detected` recipe, **When** the cook changes their statement to "From a source" with a book citation,
   **Then** the label becomes `imported_physical` and the recipe becomes private (FR-015a). If the cook has no private
   slot free, the change is refused, and the cook can appeal or leave the recipe held.
5. **Given** a recipe whose content holds no evidence at all, **When** the check finishes, **Then** the outcome is
   `clear` and the recipe becomes publicly visible with no further step.
6. **Given** a `detected` outcome, **When** it is shown to the cook, **Then** it comes with a statement of reasons
   that says an automated check made the decision (FR-028).

---

### User Story 2 - Bulk import never makes a known book recipe public (Priority: P1)

A free cook imports 300 recipes from another app. All 50 of their private slots are in use, so they choose to make the
rest public after confirming each statement (ADR-0073 §8). Each recipe headed public is checked during the import. Four
are `detected`. The import lists them: each one can only be skipped, or the import can be stopped. None is made public.
Eleven more are `possible`. They are saved as drafts, marked "a person checks this before it goes public".

**Why this priority**: The owner named this case. When slots run out mid-import, a cook can make the rest public. This
check stops a book or paid-site recipe going public with them. Bulk import is where the volume is.

**Independent Test**: Run a bulk import for a free cook with no slots left, including recipes with blocking evidence
and recipes with only weak signs. The blocked ones are never saved as public and offer only skip or stop. The unsure
ones are saved as drafts and are sent to a person only when the cook publishes them. The clean items continue.

**Acceptance Scenarios**:

1. **Given** a bulk import with an item headed public, **When** the import reaches that item, **Then** the item is
   checked before it is saved as public.
2. **Given** a free cook with no private slots left, **When** an item headed public is `detected`, **Then** the cook can
   skip that item or stop the import, and cannot make it public.
3. **Given** a cook with a private slot free, **When** an item headed public is `detected`, **Then** the cook can also
   keep it private, using a slot.
4. **Given** an item headed public that is `possible` or `unchecked`, **When** it is saved, **Then** it is saved as a
   draft with that outcome shown, and no person is asked yet (FR-024a).
5. **Given** an item the cook stated is from a book or paid site, **When** the import runs, **Then** no check runs for
   it, because it can never be public.
6. **Given** an import paused while items are being checked, **When** the cook resumes on another device, **Then** each
   item shows its outcome or that it is still being checked, and no item is checked twice for the same content.

---

### User Story 3 - When the AI cannot tell, a person decides (Priority: P1)

A cook publishes a recipe as public. The check finds only weak signs: the text says "see page 112", or a photo looks
like a photographed cookbook page. The AI cannot tell whether this is fine or a copy. The recipe is saved and stays
hidden. The cook sees "A person will check this before it goes public", with what made the check unsure and when to
expect an answer. A reviewer looks at the recipe, its photos and the signals, and decides. The cook is told.

**Why this priority**: This is the owner's ruling for the unsure case: "A person decides." It is also where the AI is
most likely to be wrong, in both directions, and photos can only ever land here.

**Independent Test**: Publish, as public, a recipe whose only signal is a page reference. The outcome is `possible`,
the recipe is hidden, and a referral is in the reviewer queue. Clear it as a reviewer: the recipe becomes public and
the cook is told. Repeat and hold it: the cook receives a statement of reasons.

**Acceptance Scenarios**:

1. **Given** a recipe with only non-blocking signals in its text, **When** the check finishes, **Then** the outcome is
   `possible`, never `detected` and never `clear`.
2. **Given** a recipe with any signal in a photo, **When** the check finishes, **Then** the outcome is `possible`,
   whatever the photo signal is (FR-006).
3. **Given** a `possible` outcome on a recipe the cook published as public, **When** it is recorded, **Then** a
   referral is created, the recipe stays hidden, and the cook sees the expected wait.
4. **Given** a referral, **When** a reviewer clears it, **Then** the hold is lifted, the recipe becomes publicly
   visible, and the decision records who decided, when and why.
5. **Given** a referral, **When** a reviewer holds it, **Then** the cook receives a statement of reasons that names
   the signals and says an automated check flagged it and a person decided.
6. **Given** a referral past its target time, **When** nobody has decided it, **Then** it shows as overdue and raises an
   alert, and the recipe still stays hidden.

---

### User Story 4 - The cook can ask a person to look again (Priority: P2)

A cook's own family recipe is `detected`. It names the publisher of the church cookbook where it was first printed, and
the page number. The cook says the recipe is theirs. They appeal. A reviewer sees the recipe, the evidence and the
cook's reason, and decides. The cook is told the result and the reason.

**Why this priority**: The check will be wrong sometimes. A false `detected` takes away a cook's right to share their
own recipe, and EU law expects a way to challenge a restriction. The appeal makes a false positive cost a wait, not a
lost recipe.

**Independent Test**: Appeal a `detected` recipe. As a reviewer, overturn it. The recipe becomes public and the cook is
told. Repeat and uphold. The recipe stays held and the cook is told why.

**Acceptance Scenarios**:

1. **Given** a `detected` recipe, **When** the cook appeals with a reason, **Then** the appeal is recorded and appears
   in the reviewer queue with the recipe, the evidence and the reason.
2. **Given** a recipe a reviewer held after a referral, **When** the cook appeals once, **Then** the appeal goes to a
   different reviewer where one is available (FR-026a).
3. **Given** an appeal, **When** a reviewer overturns the hold, **Then** the hold is lifted and the cook is told. If
   the cook still wants the recipe public, it becomes publicly visible.
4. **Given** an appeal, **When** a reviewer upholds the hold, **Then** the hold stays, and the cook receives a
   statement of reasons that says a person decided.
5. **Given** any decision, **When** it is saved, **Then** it records who decided, when, the ground and the facts relied
   on. It cannot be saved without them.
6. **Given** any hold, upheld or not, **When** the cook's account record is read, **Then** no infringement strike was
   added (FR-031).

---

### User Story 5 - When the AI budget is spent, a person decides (Priority: P2)

The month's AI budget is used up. A cook publishes a recipe as public. The rule-based detectors still run and find
nothing. The model cannot run. The recipe is recorded as `unchecked`, never as `clear`, and is sent to a person, as for
any case the AI could not decide.

**Why this priority**: The owner ruled that an unsure case goes to a person. A recipe the AI never read is the most
unsure case there is. To treat "we did not check" as "clean" is a silent pass, and this feature must never do that.

**Independent Test**: With an injected ceiling denial, publish a recipe with no rule-based evidence. The outcome is
`unchecked`, a referral exists, and the record never says `clear`. Repeat with a recipe that holds an ISBN. It is
`detected` with no model call.

**Acceptance Scenarios**:

1. **Given** a spent budget, **When** a recipe holds rule-based blocking evidence, **Then** the outcome is `detected`,
   because those detectors need no model.
2. **Given** a spent budget and no rule-based evidence, **When** the check runs, **Then** the outcome is `unchecked`
   with the reason `budgetSpent`, and a referral is created.
3. **Given** an `unchecked` referral still open, **When** the next spend period starts, **Then** the AI check runs, and
   a `clear` result closes the referral with no person needed (FR-021).
4. **Given** a spend counter that cannot be read, **When** the check runs, **Then** no model call is made. The check is
   retried, and the recipe stays held until it ends (FR-022).

---

### User Story 6 - Changing an already-public recipe is checked again (Priority: P3)

A cook edits a public recipe and pastes new steps copied from a paid site, with its template text still in place. Or
they add a photo of a cookbook page. The edit is saved. The recipe leaves public view during the check of the new
content. With a `detected` or `possible` outcome, it stays out until that outcome is resolved.

**Why this priority**: Without it, a cook can publish a clean recipe and then replace its content. It is P3 because it
needs a deliberate act.

**Independent Test**: Edit the steps of a public recipe to include a paid-site marker. A signed-out viewer cannot see
the recipe from the moment the edit is saved, and the cook sees the outcome. Repeat by adding a photo.

**Acceptance Scenarios**:

1. **Given** a public recipe, **When** its checked content changes (text, or a photo added, replaced or removed),
   **Then** it is not publicly visible until the new content has an outcome that allows it.
2. **Given** a public recipe, **When** a change leaves the checked content the same (cuisine, photo order), **Then** no
   new check runs and visibility does not change.
3. **Given** a recipe whose checked content is the same as content already checked under the same rules and model,
   **When** it is published, **Then** the stored evidence is reused and no new model call is made. (A clone of another
   cook's recipe needs a substantive edit before it is published, `GR-014` AC-014-g, so it is new content.)

---

### User Story 7 - The operator can show how good the check is, and that people can keep up (Priority: P3)

The operator runs the check over a labeled set of recipes and sees its precision and recall. In shadow mode the
operator also sees how many recipes would go to a person each day. Only when both are good enough can the check hold
anything back.

**Why this priority**: A check that holds back honest cooks' recipes, or misses most copies while we claim it works,
is worse than no check. A check that sends more recipes to people than people can decide leaves cooks waiting. The
numbers decide whether blocking is switched on.

**Independent Test**: Run the evaluation over the labeled set and read the shadow-mode referral forecast. While
SC-001, SC-002 or SC-011 is not met, blocking cannot be turned on.

**Acceptance Scenarios**:

1. **Given** the labeled set, **When** the evaluation runs, **Then** it reports precision and recall for `detected`,
   recall on items with explicit markers, recall on items with none, and the share of items that would go to a person.
2. **Given** shadow mode in production or a rehearsal, **When** the operator looks, **Then** they see the forecast
   referrals per day and the reviewer time that forecast needs.
3. **Given** results below SC-001, SC-002 or SC-011, **When** someone tries to turn blocking on, **Then** it stays in
   shadow mode.

---

### Edge Cases

- **A copyright notice in the cook's own name.** "© 2024 Jane Doe" can be the cook. Code cannot tell, so a notice that
  does not name a listed publisher or paid site is `possible`, never `detected`.
- **A public web page's footer.** An `imported_public` recipe from a blog often carries the blog's own notice. A notice
  naming the cited site is consistent with the statement and is not evidence against it. Only paid-site and book
  evidence counts for `imported_public`.
- **A photo of the finished dish.** Most photos carry no signal. A photo signal is one of a fixed set of things seen in
  the image (FR-006a). "Looks professional" is not one of them, so a good food photo does not send a recipe to a person.
- **The model quotes text that is not there.** A quote that code cannot find in the checked text is discarded and never
  counts as evidence.
- **The model reads text in a photo.** Code cannot prove what is in an image, so an ISBN the model reads in a photo is a
  photo signal: it sends the recipe to a person and never blocks it (FR-006).
- **Content over the input cap.** The model is not sent content it cannot take whole (ADR-0024: reject, never
  truncate). The rule-based detectors still run on the full text. With no rule-based evidence the outcome is
  `unchecked` with the reason `tooLong`, and a person decides.
- **A check that never finishes.** After its retries are spent, the outcome becomes `unchecked` with the reason
  `checkFailed`, and a person decides. No recipe waits in "checking" forever (FR-022).
- **The cook changes the content while the check runs.** The outcome belongs to the content it read. A new version
  needs its own outcome, and an outcome for an older version never makes the new one public. An open referral for the
  old version closes as superseded.
- **Two cooks publish the same content.** Evidence is keyed by the content, so the second reuses it. Neither sees the
  other's recipe or identity.
- **A recipe already held is cloned.** Nobody else can clone a held recipe, because others clone only public
  recipes. The owner's own copy keeps the source's evidence until its content changes.
- **The cook is offline at publish.** Publishing needs the server. A publish made offline waits in the outbox. Once it
  reaches the server, the check starts (Offline Behavior).
- **A recipe passes the check and later gets a takedown notice.** The notice follows 016. A `clear` outcome, or a
  person's clearance, is not evidence that the recipe is lawful and is never offered as such.
- **The check model changes.** Outcomes record which model and which rules produced them. A change of model does not
  re-check public recipes on its own, and it never hides them (FR-002). A re-check of the public corpus is a separate,
  deliberate operator act.
- **A cook erases their account and their public recipes are donated.** Donation makes recipes public and published
  without the editor. A held recipe is not donated. It is deleted with the account, like a private recipe, because
  nobody is left to appeal it (FR-018a).
- **A curated public-domain import.** The curator path (ADR-0023 §1) imports old cookbooks on purpose, and they are
  full of page references. A curator is a person with an administrator grant, so the grant counts as a person's
  clearance of `possible` and `unchecked` (FR-003a). A `detected` outcome still holds the recipe and goes to a
  reviewer.
- **The cook deletes the recipe or erases their account while a referral is open.** The referral closes as withdrawn.
  The decision records 016 requires are kept for their period (FR-036).
- **The cook withdraws a publish while a person has not decided.** The cook can set the recipe back to draft. The
  referral closes as withdrawn, and no person spends time on it.

## Clarifications

### Session 2026-10-26

- **Q1. Are photos in scope?** → **A: Yes, text and photos, in this release.** Owner, verbatim: "We should check
  everything we can. If the AI can't figure out if it's valid or a violation, then we need to raise it to a human to
  check." Because code cannot prove what a model reads in an image, every photo signal sends the recipe to a person. A
  photo signal never blocks and never clears a recipe on its own (FR-006, FR-006a).
- **Q2. What happens to a `possible` outcome?** → **A: A person decides.** Owner, verbatim: "A person decides." The
  recipe stays hidden until a reviewer clears or holds it. The cook is not asked to confirm (FR-016).
- **Applied from the same ruling: `unchecked` also goes to a person.** A recipe the AI could not read is a case the AI
  could not decide. This replaces, for this feature only, the general budget ruling that the cook is asked when the AI
  budget is spent (FR-020). Raised with the owner, because it is a reading of the ruling, not its words.

## Requirements _(mandatory)_

### Functional Requirements

#### A. When the check runs

- **FR-001**: The check MUST run before a recipe becomes publicly visible. A public, published recipe is publicly
  visible (`isRecipeViewableBy`). The check MUST run at each of these moments:
    - A recipe is published with public visibility.
    - A published recipe's visibility changes from private to public.
    - The checked content of a public, published recipe changes.
    - A bulk-imported recipe is headed public (FR-024).
- **FR-002**: A recipe MUST be publicly visible only while the current version of its checked content has an outcome
  that allows it (FR-013, FR-016a). This one rule covers every moment in FR-001. A recipe without such an outcome is
  visible only to its owner. The rule reads the outcome that was produced for that recipe and content. A later change
  of model or rules MUST NOT, on its own, hide a recipe that already has an allowing outcome.
- **FR-003**: The check MUST NOT run on a recipe that stays private, or on a recipe whose label is `imported_paid` or
  `imported_physical`, because those can never be public.
- **FR-003a**: For a recipe whose provenance was declared under the curator grant (ADR-0023 §1), the grant MUST count as
  a person's clearance of a `possible` or `unchecked` outcome. A `detected` outcome still holds it and goes to a
  reviewer. This MUST be keyed on the recorded grant or channel (`016-FR-028`), never on the `imported_public` label,
  because a cook's bulk statement also sets that label (ADR-0072 §9).
- **FR-004**: The check MUST run for every way a recipe arrives: typed, pasted (`004-FR-052`), from a link
  (`004-FR-008`), from a photo (`011`), from a file and in bulk (ADR-0072). It runs on the recipe's content, not on the
  channel.
- **FR-005**: Evidence MUST be stored **per part** of the checked content: once for the text and once for each photo,
  each keyed by that part's digest, the rule set version and the model, and shared by every recipe with the same part.
  The same part MUST NOT be sent to the model twice for the same rules and model, so a text edit re-checks the text
  only and a new photo re-checks that photo only. The outcome is separate and per recipe, because it also depends on the recipe's label and
  citation (FR-010). A change that does not touch the checked content MUST NOT start a check.
- **FR-006**: Photos are checked, in this release. The check reads every photo the cook uploaded to a recipe headed
  public. **Code cannot prove what a model reads in an image**, so every photo signal is unproven: it MUST make the
  outcome at least `possible`, which sends the recipe to a person. A photo signal MUST NEVER make an outcome `detected`
  and MUST NEVER make it `clear`. This holds even when the model reads an ISBN or a copyright notice in the photo.
  Imported third-party photos are not checked: they are shown by reference and never stored (`016-FR-027`).
- **FR-006a**: A photo signal MUST be one of a fixed set of things seen in the image:
    - visible copyright or "all rights reserved" text
    - a watermark, or a publisher or site logo
    - a printed page, or a page of a book
    - a visible ISBN or barcode
    - a named publisher or paid site

    The model MUST NOT return a judgement of style, quality or "looks professional". Code MUST discard any signal outside
    the set.

#### B. What the check reads, and what counts as evidence

- **FR-007**: The check MUST be two detectors that run separately and are combined only afterwards:
    - **Rule-based detectors**, which need no model. They find, in the text:
        - a valid ISBN-10 or ISBN-13, with its checksum tested
        - a listed publisher or imprint name
        - a copyright notice, and the holder it names
        - a page reference
        - a known paid-site template string
        - for a statement that cites a public web page, a cited link whose host is a listed paid site.
    - **A model detector**, which reads the checked text and the photos and returns evidence items. A text item carries
      a quote from the text. A photo item names the photo and a signal from FR-006a.
- **FR-008**: The model MUST see the checked content and nothing else. It MUST NOT see the cook's statement, the
  label, the citation, the rule-based results, or anything about the cook. The statement is the claim under test. If
  the model sees it, the model leans towards agreeing with it. ADR-0026 states this rule for parse engines, and it
  applies here.
- **FR-009**: Code MUST find every quote the model returns in the checked text. A quote that cannot be found MUST be
  discarded. Text evidence is never taken on the model's word. Photo evidence cannot be found by code at all, which is
  why it can only send a recipe to a person (FR-006).
- **FR-010**: Each evidence kind MUST be **blocking**, **for a person**, or **not evidence**, decided by a fixed table in
  code, never by the model. At minimum:

    | Evidence                                                                   | For `user_created` | For `imported_public`                             |
    | -------------------------------------------------------------------------- | ------------------ | ------------------------------------------------- |
    | Valid ISBN in the text                                                     | blocking           | blocking                                          |
    | Listed publisher or imprint in the text                                    | blocking           | blocking                                          |
    | Copyright notice in the text naming a listed publisher or paid site        | blocking           | blocking                                          |
    | Known paid-site template string in the text                                | blocking           | blocking                                          |
    | Cited link whose host is a listed paid site                                | not used           | blocking                                          |
    | Copyright notice in the text naming anyone else                            | for a person       | for a person, and not evidence for the cited site |
    | Page reference, or a cross-reference to another recipe by page             | for a person       | for a person                                      |
    | Model judgement on the text with no proven quote ("reads like a cookbook") | for a person       | for a person                                      |
    | Any photo signal (FR-006a)                                                 | for a person       | for a person                                      |

- **FR-011**: The lists of publishers, imprints, paid-site hosts and paid-site template strings MUST be data. Each
  has an admin-managed lifecycle and an audit trail: who added an entry, when and why. This is the governance of
  `004-FR-014`'s blocklist (004 D-004). Paid-site hosts MUST reuse that blocklist, not a second one.
- **FR-012**: The check MUST NOT fetch any link, search the web, or compare the recipe or its photos with any outside
  source.

#### C. Outcomes and the publication hold

- **FR-013**: The check MUST produce exactly one outcome for a version of the checked content:
    - **`clear`**: both detectors ran on the text and every photo, and found nothing. Allows publication.
    - **`detected`**: at least one blocking piece of evidence that code proved in the text. Holds publication back.
    - **`possible`**: no blocking evidence, but at least one item for a person. Holds publication back until a person
      decides (FR-016).
    - **`unchecked`**: the model did not run on all of the content, and the rule-based detectors found no blocking
      evidence. The reason is one of `budgetSpent`, `tooLong` or `checkFailed`. Holds publication back until a person
      decides (FR-020).

    An outcome MUST NOT be `clear` unless the model ran on the text and on every photo.

- **FR-014**: A `detected`, `possible` or `unchecked` outcome MUST create a **publication hold** on the recipe. The hold
  MUST NOT change the recipe's label, MUST NOT delete the recipe, MUST NOT block a save, and MUST be liftable only by a
  person's decision (FR-016, FR-026) or by FR-003a's curator grant.
    > **Why the boundary is a hold, not a new label.** We weighed three options.
    >
    > 1. **Reclassify the recipe to `imported_paid`.** Rejected. That label can never be public, so a false positive is
    >    permanent. It also replaces the cook's own attestation with a guess, and `016-FR-014` makes that attestation the
    >    controlling record.
    > 2. **Send every `detected` recipe to a person first.** Rejected. A cook with a cookbook ISBN in the text waits days
    >    for a person to repeat what code already proved. An appeal exists for the case code got wrong.
    > 3. **Hold public visibility, keep the recipe, and let a person reverse it.** Chosen. A false positive costs a wait
    >    and an appeal. A false negative is what happens today, without the check.
- **FR-015**: A cook with a held recipe MUST be offered these choices:
    - Keep it private, under the usual private rules and ADR-0073's slots.
    - Change their statement to "From a source" with a book or paid-site citation (FR-015a).
    - Appeal a `detected` hold, or a hold a person made (FR-026).
    - Wait for the person, for a `possible` or `unchecked` hold.
    - Leave it as it is, or set it back to draft. It stays visible only to them.

    A free cook with no private slot free does not get the first two.

- **FR-015a**: Changing the statement after a save MUST be a one-way **downgrade** only: from `user_created` or
  `imported_public` to `imported_physical` or `imported_paid`, with a citation, and the recipe becomes private in the
  same act. It needs a private slot under ADR-0073. No route can change a label upward or to `imported_public`. Today
  provenance cannot change after a save at all (ADR-0023 keeps `source` on create only), so this route MUST be recorded
  as an amendment to ADR-0023. The new label is private-only, so no outcome is needed for it, and any open referral
  closes as withdrawn.
- **FR-016**: A `possible` outcome on a recipe the cook publishes as public MUST create a **referral** to a person.
  The recipe MUST stay hidden until a person decides. The person MUST either **clear** it, which lifts the hold, or
  **hold** it, which keeps the hold and gives the cook a statement of reasons (FR-028). The cook MUST NOT be able to
  lift it themselves, and nothing automatic MUST lift it (owner ruling, 2026-10-26: "A person decides").
- **FR-016a**: An outcome allows publication when it is `clear`, or when a person cleared it, or when FR-003a's grant
  applies. Nothing else allows it.
- **FR-016b**: A referral MUST be created only when the recipe is actually headed for public view: on publish, or on a
  change to public. A draft, including a bulk-imported draft, records its outcome and creates no referral until the
  cook publishes it (FR-024a). This keeps people's time for recipes a cook wants public.
- **FR-016c**: The cook MUST be told, for a `possible` or `unchecked` hold, what made the check unsure, that a person
  will decide, and the expected wait (FR-030). They MUST NOT be asked to confirm their statement instead.
- **FR-017**: A person's decision on a referral, and the cook's appeal reason, MUST be recorded with its time, the
  outcome it answered and the evidence shown. They are part of the per-item attestation record (`004-FR-014a`).
- **FR-018**: The hold MUST be part of the one rule for who can see a recipe (`isRecipeViewableBy` and its SQL
  twins), on every read path: a recipe page, search, lists and collections. It MUST NOT be a refusal on the write side.
  A save, a publish and a visibility change never fail because of an outcome (FR-014), and the C-004 matrix
  (`visibilityPolicy.ts`, with ADR-0073's slot fact) keeps deciding which visibility a recipe may hold. The only
  write-side refusal is bulk import's (FR-025).
- **FR-018a**: Every path that makes a recipe public and published, including account erasure's donation of recipes,
  MUST be subject to FR-002. Because the hold lives in the read rule, no path can go around it. Erasure MUST NOT donate
  a recipe whose current content has no allowing outcome. It is deleted with the account, as a private recipe is.
- **FR-018b**: A held recipe's photos MUST NOT be reachable through any public recipe surface. When a recipe that was
  public becomes held, its photos MUST be removed from the content delivery cache, using the existing invalidation path.
- **FR-019**: Blocking MUST start in **shadow mode**: outcomes and the referrals that would be made are recorded, and
  no recipe is held back. Blocking MUST be switched on only after the evaluation meets SC-001 and SC-002 and the
  staffing check meets SC-011, and switching it on MUST be a recorded operator act. Shadow mode runs **before launch**.
  If blocking is ever switched on while public recipes exist, it MUST NOT hide any of them at once: each recipe it
  would hide first gets its cook-facing step (a statement of reasons, or a referral notice). That transition needs its
  own plan before it is used.

#### D. Budget, failure and cost

- **FR-020**: If the AI budget is spent, the model cannot run, but the rule-based detectors MUST still run. With no
  rule-based blocking evidence, the outcome MUST be `unchecked` (`budgetSpent`), and a published recipe MUST be referred
  to a person as in FR-016. An `unchecked` outcome MUST NEVER be shown or stored as `clear`.
    > This applies the owner's Q1 ruling ("If the AI can't figure out … raise it to a human"). It replaces, for this
    > feature, the general budget ruling that the cook is asked (ADR-0072 §10 keeps that ruling for matching).
- **FR-021**: At the start of the next spend period, every open referral whose outcome is `unchecked` (`budgetSpent`)
  MUST be checked again. A `clear` result closes the referral with no person needed. A `detected` result holds the
  recipe and issues a statement of reasons (FR-028). A `possible` result keeps the referral open. This is the only way
  a decided outcome changes for the same content.
- **FR-022**: A spend counter that cannot be read MUST fail closed: no model call, the check retries, and the recipe
  stays held. When retries are spent, the outcome MUST become `unchecked` (`checkFailed`) and a published recipe is
  referred to a person. A recipe MUST NOT stay in "checking" for more than 24 hours.
- **FR-023**: Every model call MUST be a call site of ADR-0024's one pool, attributed under its own call-site name. It
  MUST run under the existing single Bedrock grantee and MUST NOT add a second one (ADR-0024 layer 4b). It MUST set an
  explicit output cap and a hard input cap, and MUST NOT truncate content to fit.
- **FR-023a**: Photo calls MUST be reserved at their **worst case** before the call, as ADR-0024 requires. Each photo
  MUST be sent as a copy resized to a fixed maximum size, so its token cost has a known ceiling. The reservation is
  the prompt, plus each photo's ceiling, plus the output cap. A recipe has at most `MAX_RECIPE_PHOTOS` photos (10), so
  the worst case for one recipe is bounded. A photo with no resized copy is not sent, and the outcome is
  `unchecked` (`checkFailed`).

#### E. Bulk import and private slots

- **FR-024**: In a bulk import, an item headed public MUST have an outcome before it is saved. The item MUST wait in
  the import's "checking" state meanwhile, and the import MUST keep working on other items.
- **FR-024a**: A `possible` or `unchecked` item headed public MUST be saved as a draft, with its outcome shown. It
  creates no referral until the cook publishes it (FR-016b).
- **FR-025**: In a bulk import, a `detected` item MUST NOT be saved as public. The cook MUST be able to keep it private
  if they have a private slot free (ADR-0073), skip it, or stop the import. With no slot free, only skip and stop are
  offered. This follows the owner's ruling: a recipe known to be from a book or paid site can only be stopped or
  skipped, never made public.

#### F. People, referrals, appeals and statements of reasons

- **FR-026**: A cook MUST be able to appeal a `detected` hold, with an optional reason. The appeal is a referral, and
  MUST appear in 016's reviewer queue (`016-FR-053a`). A person holding 016's review scope (`016-FR-053g`) MUST decide
  it: overturn, which lifts the hold, or uphold, which keeps it.
- **FR-026a**: A cook MUST be able to appeal a hold a person made, once per version of the content. The appeal MUST go
  to a different reviewer when one is available. With one reviewer, the same person decides it, and the record says so.
- **FR-027**: Every person's decision MUST record who decided, when, the ground and the facts relied on, and MUST NOT
  be saved without them (`016-FR-017`, `016-FR-053b`). No referral is ever decided by the check.
- **FR-027a**: The reviewer MUST see the recipe's text and photos, each signal and where it is, and the cook's statement
  and citation. Only the model is kept from the statement (FR-008). A person is not.
- **FR-028**: A `detected` hold, and a person's hold, MUST each give the cook a **statement of reasons** through 016's
  mechanism (`016-FR-018`, `016-FR-018a`). It MUST name:
    - the action: publication withheld
    - the ground: the terms clause on rights to upload
    - the facts: the kinds of evidence, and where they are
    - that automated means were used to find them, and, for a person's hold, that a person decided
    - the redress: keep private, change the statement (FR-015a), or appeal.
- **FR-029**: The statement MUST be built from a fixed template filled with the evidence kinds and locations, and, for
  a person's hold, the ground the person chose. It MUST NOT be prose written by the model.
- **FR-030**: Referrals made by the check MUST be decided within **72 hours** of being made, and appeals within
  **7 days**, the target `016-FR-017a` sets for grounds other than copyright notices. A referral past its target MUST
  show as overdue and raise an alert. An overdue referral still MUST NOT publish the recipe.
- **FR-030a**: The reviewer queue MUST order referrals by time left before their target, and MUST let a reviewer see
  every open referral from one cook or one import together, so a large import is decided in one sitting. Each recipe
  still gets its own decision.
- **FR-031**: A hold, a person's hold and an upheld appeal MUST NOT add an infringement strike (`016-FR-020`).
  Strikes come only from actioned notices.
- **FR-032**: A reviewer can open a sample of `clear` public recipes for audit. A finding from that audit that restricts
  a recipe is a decision with a statement of reasons like any other.

#### G. Privacy and records

- **FR-033**: The checked content MUST be sent only to the model provider in the deploy region, unless the owner records
  an approval of another region for this call site. An approval given for a model at another call site MUST NOT cover
  this one. The provider MUST NOT use the content for training.
- **FR-034**: The check's output is a decision about content, not content shown to users. It MUST NOT be shown to the
  cook as AI-written text. The cook-facing words come from the template (FR-029).
- **FR-035**: Evidence records MUST hold the digest, the rule set version, the model, and each evidence kind with its
  field and position (a span in the text, or a photo id), and only the short marker text (for example the ISBN). They
  MUST NOT hold the recipe's text, any photo, or any user id. A recipe's outcome record MUST hold the recipe, the
  digest, the outcome, the reason, the label and cited host it was judged under, and the times.
- **FR-036**: A recipe's outcome records and referrals MUST be deleted with the recipe and with account erasure. Shared
  evidence records hold no user id, no recipe text and no photo, so they are kept, and the erasure coverage guard
  records them as retained by ruling. A decision record that is evidence of a hold or a person's decision MUST be kept
  for 016's period (`016-FR-052a`). It keeps only the short marker text it relied on, for example the ISBN, and never
  the recipe or a photo.
- **FR-037**: The cook MUST be able to see, for their own recipe, its current outcome, the evidence, any open referral
  and its expected wait, and any decision.

#### H. Measurement, staffing and operation

- **FR-038**: There MUST be an evaluation that runs the check over a labeled set and reports precision and recall for
  `detected`, recall on third-party items that carry an explicit marker, recall on those that carry none, and the share
  of items that would go to a person. The labeled set MUST include photos: dish photos, photographed book pages and
  screenshots of paid sites. It MUST be kept outside the repository, with access limited to the operator, because it
  holds excerpts of copyrighted works (FR-041).
- **FR-039**: The check MUST report outcome counts by outcome and reason, referral counts by origin, open and overdue
  referrals, time to decision, the overturn rate, time to outcome, and the number of recipes held in "checking". A
  recipe held past FR-022's limit, and a referral past FR-030's target, MUST raise an alert.
    > Inspection is not user evidence. The labeled set measures detection. It says nothing about whether cooks find the
    > check fair or the copy clear. Any claim about that needs a study.
- **FR-039a**: Shadow mode MUST produce a **referral forecast**: referrals per day by origin, and the reviewer time they
  need at a measured minutes-per-referral. The forecast MUST also cover a month in which the AI budget runs out, when
  every publish without rule evidence becomes a referral (FR-020).
- **FR-039b**: The owner MUST name the reviewers and their weekly hours before blocking is switched on. That staffing,
  against the forecast, is SC-011.

#### I. Changes to other specs

- **FR-040**: `004-FR-014a` MUST be amended. Its sentence "a heuristic MUST NOT by itself reclassify a recipe or block
  a save" stays true, and gains: "Blocking evidence that the source check (020) proves in the text can prevent
  publication, by a publication hold. When the check cannot decide, a person decides before the recipe goes public. A
  hold never changes the label, never blocks a save, and a person can lift it. A heuristic still never reclassifies a
  recipe." The attestation and citation stay the controlling record.
- **FR-041**: 016 MUST be amended:
    - **Out of Scope** says "Automated content moderation or classifier-driven takedown". It becomes "Automated
      takedown after a notice". Automated pre-publication checks are in scope, through 020.
    - **Assumptions** says "automated means" is expected to read "no". It gains: "except for 020's publication holds,
      where it reads yes".
    - **Assumptions** says "Volume is low" for human decisions. It gains: "020 adds pre-publication referrals, whose
      volume is forecast in shadow mode (020 FR-039a)".
    - **`016-FR-050`** gains five counsel items:
        - **Clearing flagged content.** Can a person who looks at a flagged recipe and clears it be said to know of
          infringement, under 17 U.S.C. §512(c)(1)(A)? DSA Art. 7 protects voluntary checks in the EU. US law has no
          equivalent. **What breaks**: if the answer is yes, a reviewer's clearance needs a stated standard, and the
          decision record must carry the reason.
        - **A pending hold.** Does holding a recipe while a person decides need a statement of reasons under DSA
          Art. 17, or only the final hold? **What breaks**: if it needs one, every referral issues a statement.
        - **The statement wording.** Counsel confirms the statement of reasons for an automated hold and for a person's
          hold. **What breaks**: a statement that fails DSA Art. 17 is a defect on every hold.
        - **The labeled set.** Is it lawful to keep excerpts and photos of copyrighted works for internal testing, and
          on what terms? **What breaks**: the evaluation then needs another source of positive examples.
        - **The region.** The owner approves a region for recipe content sent to the model at this call site (FR-033).
          **What breaks**: without it, the model detector cannot run, and every publish without rule evidence goes to a
          person.
    - **`016-FR-018a`'s delivery** MUST accept a decision from 020 (a hold or a person's decision), not only a notice
      decision. 016's `notice_decisions` table is not changed (research R-13).
    - These 016 amendments are NOT applied by this feature. Another session is working on 016, so they are listed here
      and applied with 016's own next revision.
- **FR-042**: ADR-0024 §4c's call-site list MUST gain this check's call site. Layer 4b's single grantee does not
  change.
- **FR-043**: ADR-0072's readiness rule (§7) MUST gain FR-024: an item headed public is not ready to save until it has
  an outcome.
- **FR-044**: ADR-0023 MUST be amended for FR-015a: a one-way downgrade of provenance after a save, to a private-only
  label with a citation, and nothing else.

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`, with no `any` outside marked test doubles. Outcome,
  reason, evidence kind, photo signal and referral state are closed unions. (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc. The outcome function and the evidence table are
  pure modules that name the pattern they implement. (Principle II)
- **NFR-003**: Every surface that shows an outcome, a hold, a referral or an appeal MUST expose accessible names
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
- **Sync**: when the publish reaches the server, the recipe enters "checking". The outcome and any referral are read
  from the server.
- **Conflict**: an outcome belongs to one version of the checked content, so an edit from another device needs its own
  outcome and never inherits one.

### Key Entities

- **Evidence Set**: the evidence found in one version of checked content, under one rule set and model. Shared by
  every recipe with the same content. Holds no user id, no recipe text and no photo.
- **Evidence Item**: one piece of evidence in a set: kind, field, position or photo, proven or not, which detector
  found it, and the short marker text.
- **Source Check Outcome**: the result for one recipe and one digest: outcome, reason, the label and cited host it was
  judged under, whether a person or a curator grant cleared it, and times.
- **Publication Hold**: the fact that a recipe cannot be publicly visible now. It is derived from the recipe's current
  content and its outcome. A person's clearance lifts it.
- **Referral**: a recipe sent to a person: its origin (the check, or the cook's appeal), its target time, and its
  decision.
- **Decision**: what a person decided, or what the check decided for `detected`, with ground, facts and statement
  delivery. Kept as evidence for 016's period.
- **Rightsholder List**: publishers, imprints, paid-site hosts and template strings, with an audit trail.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On the labeled set, at least 97% of `detected` outcomes are correct, and the lower bound of the 95%
  confidence interval is at least 95%. The set holds at least 300 third-party items with markers and at least 300
  items the cook wrote or that are public.
- **SC-002**: On the labeled set, at least 90% of third-party items that carry a blocking marker in their text are
  `detected`, and at least 90% of photographed book pages and paid-site screenshots go to a person.
- **SC-003**: Recall on third-party items with no marker is measured and reported with every evaluation. No target
  is set, and no claim can say the check catches unmarked copies.
- **SC-004**: Zero recipes are publicly visible whose current checked content lacks an outcome that allows it, checked
  by an automated assertion, not by sampling.
- **SC-005**: 95% of checks reach an outcome within 60 seconds of the publish, and zero recipes stay in "checking" for
  more than 24 hours.
- **SC-006**: 100% of holds that need one have a statement of reasons that says automated means were used, delivered
  on both of 016's channels.
- **SC-007**: 95% of referrals made by the check are decided within 72 hours, and 95% of appeals within 7 days.
- **SC-008**: Zero model calls receive the cook's statement, label, citation or rule-based results, checked
  structurally.
- **SC-009**: Zero infringement strikes come from a hold, a person's hold or an appeal.
- **SC-010**: Zero model calls are made for a recipe that stays private, and zero for a part (the text, or one photo)
  that already has evidence under the same rules and model.
- **SC-011**: Before blocking is switched on, the named reviewers' weekly hours cover the shadow-mode referral
  forecast at SC-007's targets, with at least 25% to spare. A month in which the budget runs out is shown separately.
- **SC-012**: Zero recipes are made `detected` or `clear` by a photo signal alone, checked structurally.

## Assumptions

- **ADR-0073 owns the slot rule.** Free cooks hold up to 50 private recipes. A slot is a private, undeleted recipe,
  counted live. 020 does not own it and only reads it.
- **A held recipe uses no slot.** ADR-0073 counts `visibility = 'private'` only. A held recipe is a public recipe that
  is hidden, like a public draft. So held and drafted recipes are owner-only and unmetered. That gap exists for public
  drafts already, and 020 adds no new kind of it. Raised with the owner as a question on ADR-0073.
- **Nothing is live.** At launch there is no public corpus to check.
- **016 is planned and not built.** The statement of reasons, the reviewer dashboard and the email channel come from 016. Blocking stays in shadow mode until they exist (FR-019).
- **The reviewer dashboard inherits 016's open decision A-11** on `002`'s "no admin UI" exclusion.
- **The model is one already in ADR-0024's registry** that takes images and stays in the deploy region. The plan
  chooses it, under FR-033.
- **At launch the owner may be the only reviewer.** SC-011 decides whether that is enough. A second reviewer is also
  what makes FR-026a's "a different person" possible.
- **Rule-based detectors come first.** We expect most `detected` outcomes to come from them. The model widens what is
  found. It never decides what blocks, and it never clears a photo signal.
- **Bulk import does not publish** (ADR-0072 §3). "Headed public" means the cook chose public visibility for the item.
  The check runs during the import so the cook can choose skip or stop there, as the owner ruled (FR-024, FR-025).
- **Prompt injection is possible.** A recipe or a photo can contain text aimed at the model ("ignore your
  instructions"). At worst it hides evidence, which is the same as a copy with no markers. It cannot cause a block,
  because a block needs evidence that code proves in the text. It cannot cause a clearance of a photo signal, because a
  photo signal goes to a person.

## Out of Scope

- Deciding whether any recipe is lawful. The check finds evidence of a source. It does not judge copyright.
- Checking private recipes, or recipes labelled `imported_paid` or `imported_physical`.
- Fetching, crawling or comparing against sources, including cited links and reverse image search.
- Takedown after a notice, strikes and account termination (016).
- A re-check of the public corpus after a change of model or rules. That is a separate operator act.
- Telling the cook which published work their recipe matches. The check reports markers, not matches.
