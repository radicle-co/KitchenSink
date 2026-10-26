# Feature Specification: Content Source Check

**Feature Branch**: `docs/im-spec020` (single-branch directive. The spec directory is `specs/020-content-source-check`.)
**Created**: 2026-10-26
**Status**: Draft (clarifications answered by the owner, 2026-10-26; revised after the staff-architect REVIEW and the
owner's rulings on it, the same day. The decision is recorded in
[ADR-0074](../../docs/architecture/decisions/0074-content-source-check.md).)
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
| [ADR-0074](../../docs/architecture/decisions/0074-content-source-check.md)                                                                                         | **Records this feature.** The hold in the read rule, per-part evidence, the all-green rule, match effects, the switch, erasure and donation, and non-disclosure                                           |
| [ADR-0027](../../docs/architecture/decisions/0027-ingredient-phrase-is-not-personal-data.md)                                                                       | **Amended.** A third erasure verdict: time-boxed retention of a decision's hash and reviewer text (FR-036)                                                                                                |
| [ADR-0039](../../docs/architecture/decisions/0039-database-role-split.md)                                                                                          | **Required.** Table policy classes for the append-only tables (FR-011, FR-019)                                                                                                                            |
| [Account closure plan](../../docs/plans/2026-07-18-002-feat-account-closure-anonymization-plan.md) U3b                                                             | **Amended.** The erasure election runs the check on each recipe elected for donation (FR-018a, FR-044a)                                                                                                   |
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
- **Only when every part passes green** does the recipe go public with no person: the text, each photo, and any source
  reference the cook gave. Owner, 2026-10-26: "The only time we don't mark a recipe as needing review is if the photo
  AND the text and any source reference that was provided passes green." Then the cook's statement stands, as today.
- **We also look in our own database** for the same recipe, or recipes from the same source, and at what a person
  decided about them. Owner, 2026-10-26: "As part of the review we should also check our own database to see if same
  recipe already exists and was approved/passed or if recipes from the same source was approved/passed."
- **The people who decide are employees**, never users or the community. Owner, 2026-10-26: "the person reviewing
  these recipes are employees - not users".
- **Another cook's private recipe is never disclosed.** Private recipes are searched as candidates, but no cook ever
  learns anything about another cook's private recipe, or that it exists (owner ruling, 2026-10-26, Clarifications).
- **A recipe in review is neither public nor private.** Owner, 2026-10-26: "The review process does not take a slot
  and doesn't become visible as public or private until it's been approved. While it's in review it is labeled as
  such." A recipe a person does not approve becomes the cook's private recipe and is never published.

### What the check does

- It runs on every recipe that is about to become publicly visible: a new recipe published as public, a private recipe
  made public, a public recipe whose text, photos or source statement changed, every bulk-imported recipe headed
  public, and every private recipe a cook elects to donate when they erase their account.
- It reads the recipe's text and the photos the cook uploaded.
- Code looks for evidence it can prove from the text: a valid ISBN, a listed publisher, a copyright notice that names a
  listed publisher or paid site, a known paid-site template, and a cited link to a known paid site. That evidence holds
  the recipe back on its own. Only these rule-based detectors can hold a recipe back, and they run when the recipe is
  saved, so a `detected` outcome is known at once.
- An AI model reads the text and the photos as a second, separate detector. What it finds in the text is kept only if
  code finds the same words in the text, and even then it only sends the recipe to a person. What it finds in a photo
  can never be proven by code, so it also only sends the recipe to a person. The model never holds a recipe back on its
  own and never clears one.
- After the cook publishes, the recipe shows "Checking" for a short time, visible only to them. If every part is
  green it becomes public. Otherwise it shows "In review" until a person decides. A recipe the rules block, or one a
  person does not approve, is "Not approved": it becomes the cook's private recipe, and the cook gets a statement of
  reasons that says an automated check was used.

### What the check does NOT do

- **It is not a legal shield.** A contract cannot move liability for a third party's copyright onto the cook (016,
  finding 2). Our protection still comes from hosting content at a user's direction and from fast takedown
  (DMCA §512(c), `016-FR-016` to `FR-022`). This check lowers the number of copied recipes that reach the public. It does
  not make us safe. Nobody can present it as a defence.
- **It does not delete a recipe, and it blocks a save only in three narrow cases** (FR-018). Otherwise the recipe is
  always saved, and only public visibility is held back.
- **It never changes the cook's label.** The statement the cook made stays the record (`016-FR-014`). The hold is a
  separate fact that a person can reverse.
- **It never publishes an unsure recipe without a person.** No timer, budget state or backlog lets an unsure recipe go
  public on its own.
- **It does not fetch anything.** It does not visit cited links, search the web or compare the recipe with any source.
  Retrieval stays user-directed only.
- **It does not check private recipes**, with one exception. Privacy does the heavy lifting (016, finding 1). To check
  a recipe nobody else can see costs money and sends the cook's content out for no gain. The exception is a private
  recipe a cook elects to donate when they erase their account: donation makes it public, so it is checked (FR-018a).
- **It does not take content down after a notice.** That stays with 016's human notice process.
- **It cannot catch a copy with no markers.** A cookbook recipe typed out by hand, with no ISBN, publisher or page
  number, usually looks like any other recipe. We say so, measure it (SC-003) and do not claim otherwise.

### Words used in this spec

| Word                 | Meaning                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source check**     | The automated check this feature adds. We never call it a "review". The review gate (ADR-0071) and the review wizard (ADR-0072) use that word                                         |
| **Checked content**  | What the check reads: title, description, tags, ingredient lines as written, steps, text taken from a photo by OCR, and the photos the cook uploaded                                  |
| **Evidence**         | One thing the check found: its kind, where it is in the recipe, and whether code proved it                                                                                            |
| **Outcome**          | The result for one recipe and one version of its checked content: `clear`, `possible`, `detected` or `unchecked`. It depends on the evidence and on the recipe's label and citation   |
| **Publication hold** | The fact that a recipe cannot be publicly visible now, because of its outcome. It is separate from the label, and a person can lift it. The cook sees it as "Checking" or "In review" |
| **Checking**         | The short state after a publish, before the outcome is revealed. Visible only to the cook                                                                                             |
| **In review**        | A recipe the cook wants public that waits for a person. Owner-only, neither public nor private, and it uses no private slot (FR-014a)                                                 |
| **Not approved**     | A recipe the rules blocked, or that a person did not approve. It becomes the cook's private recipe and is never published with that content (FR-014a)                                 |
| **Referral**         | A recipe sent to a person to decide: automatically for `possible` and `unchecked`, or by the cook's appeal                                                                            |
| **Appeal**           | The cook asking a person to decide on a hold                                                                                                                                          |
| **Match**            | A recipe or a source in our own database that the lookup found for this recipe, with what a person decided about it (section J)                                                       |
| **Enforcement mode** | `shadow`, `blocking` or `paused`. It is stamped on each outcome when the recipe is first headed for public view with that content (FR-019)                                            |
| **Donation**         | At account erasure, a cook may elect recipes to leave behind as public. A donated recipe passes the same check (FR-018a)                                                              |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A recipe the check can tell is from a book does not go public (Priority: P1)

A cook pastes a recipe, says "I wrote this" and publishes it as public. The pasted text still carries the line
"© 2019 Ten Speed Press. All rights reserved." and an ISBN. The recipe is saved. As soon as it is saved it shows "Kept
private: this looks like it is from a book", with the two pieces of evidence and the cook's choices: keep it private,
change where it came from, or ask a person to look. The rule-based detectors found the evidence during the save, so
there is no wait and no AI call.

**Why this priority**: This is the owner's ruling itself. Without it, a false or mistaken "I wrote this" puts a
cookbook recipe in front of the public. Our record then shows that nobody told us anything.

**Independent Test**: Publish, as public, a recipe whose text holds a valid ISBN and a listed publisher's copyright
notice. It is saved, never visible to a signed-out viewer, shows the evidence to its owner, and offers the choices.

**Acceptance Scenarios**:

1. **Given** a cook who publishes a recipe as public, **When** the check has not finished, **Then** the recipe is saved,
   the cook sees that it is being checked, and no other person can see it.
2. **Given** a recipe whose text holds blocking evidence that the rule-based detectors found, and a cook with a free
   private slot, **When** it is saved, **Then** the outcome is `detected` in the same save, the recipe is "Not
   approved" and becomes private, no AI call is made, and the cook sees each piece of evidence and where it is.
3. **Given** the same recipe and a free cook with no private slot free, **When** it is saved, **Then** the save is
   refused, as ADR-0073 refuses a book recipe with no slot, and the cook is shown the evidence and how to free a slot
   (FR-018).
4. **Given** a `detected` recipe, **When** the cook changes their statement to "From a source" with a book citation,
   **Then** the label becomes `imported_physical` and the recipe stays private (FR-015a).
5. **Given** a recipe whose content holds no evidence at all, **When** the check finishes, **Then** the outcome is
   `clear` and the recipe becomes publicly visible with no further step.
6. **Given** a `detected` outcome, **When** it is shown to the cook, **Then** it comes with a statement of reasons
   that says an automated check made the decision (FR-028).

---

### User Story 2 - Bulk import never makes a known book recipe public (Priority: P1)

A free cook imports 300 recipes from another app. All 50 of their private slots are in use, so they choose to make the
rest public after confirming each statement (ADR-0073 §8). The rule-based detectors run on each recipe headed public
during the import. Four are `detected`. The import lists them: each one can only be skipped, or the import can be
stopped. None is made public. The rest are saved as drafts, and the AI check runs on each after its save. Eleven come
back `possible`. They stay drafts, marked "a person checks this before it goes public".

**Why this priority**: The owner named this case. When slots run out mid-import, a cook can make the rest public. This
check stops a book or paid-site recipe going public with them. Bulk import is where the volume is.

**Independent Test**: Run a bulk import for a free cook with no slots left, including recipes with blocking evidence
and recipes with only weak signs. The blocked ones are never saved as public and offer only skip or stop. The others
are saved as drafts without waiting for the AI. The unsure ones are sent to a person only when the cook publishes them.

**Acceptance Scenarios**:

1. **Given** a bulk import with an item headed public, **When** the import reaches that item, **Then** the rule-based
   detectors run on it before it is saved, and the import never waits for the AI (FR-024).
2. **Given** a free cook with no private slots left, **When** an item headed public is `detected`, **Then** the cook can
   skip that item or stop the import, and cannot make it public.
3. **Given** a cook with a private slot free, **When** an item headed public is `detected`, **Then** the cook can also
   keep it private, using a slot.
4. **Given** an item headed public that is not `detected`, **When** it is saved, **Then** it is saved as a draft, its
   AI check runs after the save, keyed by the saved recipe, and its outcome is shown when it lands. No person is asked
   yet (FR-024a).
5. **Given** an item the cook stated is from a book or paid site, **When** the import runs, **Then** no check runs for
   it, because it can never be public.
6. **Given** an import paused while items are being checked, **When** the cook resumes on another device, **Then** each
   item shows its outcome or that it is still being checked, and no item is checked twice for the same content.

---

### User Story 3 - When the AI cannot tell, a person decides (Priority: P1)

A cook publishes a recipe as public. The check finds only weak signs: the text says "see page 112", or a photo looks
like a photographed cookbook page. The AI cannot tell whether this is fine or a copy. The recipe is saved and stays
hidden. The cook sees "In review: a person will check this before it goes public", the same words whatever the
cause. A reviewer looks at the recipe, its photos and the signals, and decides. The cook is told.

**Why this priority**: This is the owner's ruling for the unsure case: "A person decides." It is also where the AI is
most likely to be wrong, in both directions, and photos can only ever land here.

**Independent Test**: Publish, as public, a recipe whose only signal is a page reference. The outcome is `possible`,
the recipe is "In review", and a referral is in the reviewer queue. Clear it as a reviewer: the recipe becomes public
and the cook is told. Repeat and do not approve it: the recipe becomes private, and the cook receives a statement of
reasons.

**Acceptance Scenarios**:

1. **Given** a recipe with only non-blocking signals in its text, **When** the check finishes, **Then** the outcome is
   `possible`, never `detected` and never `clear`.
2. **Given** a recipe with any signal in a photo, **When** the check finishes, **Then** the outcome is `possible`,
   whatever the photo signal is (FR-006).
3. **Given** a `possible` outcome on a recipe the cook published as public, **When** it is recorded, **Then** a
   referral is created, the recipe is "In review", and the cook sees the one generic message that a person will
   check it. They see no part results and no cause. No time is promised (FR-016c).
4. **Given** a referral, **When** a reviewer clears it, **Then** the hold is lifted, the recipe becomes publicly
   visible, and the decision records who decided, when and why.
5. **Given** a referral, **When** a reviewer does not approve it, **Then** review ends, the recipe becomes the cook's
   private recipe, even with no free slot, and the cook receives a statement of reasons. It says an automated check
   flagged the recipe and a person decided, gives a generic ground, and never names what matched (FR-014a, FR-028).
6. **Given** a referral nobody has decided yet, however old, **When** anyone reads the recipe, **Then** it is still
   hidden. Age never publishes a recipe.
7. **Given** a recipe whose text and source reference pass green and whose one photo the AI saw nothing in, **When** the
   check finishes, **Then** the outcome is `clear`. If any one of those parts is not green, the outcome is not `clear`
   (FR-013a).

---

### User Story 4 - The cook can ask a person to look again (Priority: P2)

A cook's own family recipe is `detected`. It names the publisher of the church cookbook where it was first printed, and
the page number. The cook says the recipe is theirs. They appeal. A reviewer sees the recipe, the evidence and the
cook's reason, and decides. The cook is told the result and the reason.

**Why this priority**: The check will be wrong sometimes. A false `detected` takes away a cook's right to share their
own recipe, and EU law expects a way to challenge a restriction. The appeal makes a false positive cost a wait, not a
lost recipe.

**Independent Test**: Appeal a `detected` recipe. As a reviewer, overturn it. The recipe becomes public and the cook is
told. Repeat and uphold. The recipe stays private and the cook is told why.

**Acceptance Scenarios**:

1. **Given** a `detected` recipe, **When** the cook appeals with a reason, **Then** the appeal is recorded and appears
   in the reviewer queue with the recipe, the evidence and the reason.
2. **Given** a recipe a reviewer held after a referral, **When** the cook appeals once, **Then** the appeal goes to a
   different reviewer where one is available (FR-026a).
3. **Given** an appeal, **When** a reviewer overturns the hold, **Then** the hold is lifted and the cook is told. If
   the cook still wants the recipe public, it becomes publicly visible.
4. **Given** an appeal, **When** a reviewer upholds the hold, **Then** the recipe stays private, and the cook receives
   a statement of reasons that says a person decided. That decision is final for that content.
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
   with the reason `budgetSpent` for that spend period, the check is not retried, and a referral is created (FR-020).
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

1. **Given** a public recipe, **When** its checked content changes (text, a photo added, replaced or removed, or its
   source statement), **Then** it is not publicly visible until the new content has an outcome that allows it.
2. **Given** a public recipe, **When** a change leaves the checked content the same (cuisine, photo order), **Then** no
   new check runs and visibility does not change.
3. **Given** a recipe whose checked content is the same as content already checked under the same rules and model,
   **When** it is published, **Then** the stored evidence is reused and no new model call is made. (A clone of another
   cook's recipe needs a substantive edit before it is published, `GR-014` AC-014-g, so it is new content.)

---

### User Story 7 - The operator can show how good the check is, and how much work it makes (Priority: P3)

The operator runs the check over a labeled set of recipes and sees its precision and recall. In shadow mode the
operator also sees how many recipes would go to a person each day. The accuracy decides whether the check may hold
anything back. The workload is information for planning staff.

**Why this priority**: A check that holds back honest cooks' recipes, or misses most copies while we claim it works,
is worse than no check. Under the owner's rulings most unsure cases become staff work, so the owner needs to see that
work before switching blocking on.

**Independent Test**: Run the evaluation over the labeled set and read the shadow-mode referral forecast. While
SC-001 or SC-002 is not met, blocking cannot be turned on. The forecast is shown either way and gates nothing.

**Acceptance Scenarios**:

1. **Given** the labeled set, **When** the evaluation runs, **Then** it reports precision and recall for `detected`,
   recall on items with explicit markers, recall on items with none, and the share of items that would go to a person.
2. **Given** shadow mode in production or a rehearsal, **When** the operator looks, **Then** they see the forecast
   referrals per day and the reviewer time that forecast needs.
3. **Given** results below SC-001 or SC-002, **When** someone tries to turn blocking on, **Then** it stays in shadow
   mode.

---

### User Story 8 - The check looks for the same recipe and the same source in our own database (Priority: P2)

A cook publishes a recipe from a public web page. Another cook published the same recipe, from the same page, last
month, and a staff reviewer approved it then. The text has page references, so on its own it goes to a person. The
check finds the earlier recipe, its approval and the same cited page. The new copy carries no evidence the approved one
lacked. That makes the text green. With a green photo and a green source reference, the recipe goes public with no
new review.

A different cook pastes a recipe that matches another cook's public recipe almost word for word, says "I wrote this",
and did not use the clone button. The two share no cited page or book. The check treats it as an internal copy and
sends it to a person, who sees the match.

**Why this priority**: The owner asked for it. It saves staff from deciding the same recipe twice, and it catches
copies from inside Commise that no outside marker would show.

**Independent Test**: Approve a recipe from a cited page as a reviewer. Publish a near copy from the same page as
another cook: it is `clear` with no referral. Add a new ISBN-shaped marker to the copy that the approved one lacked:
it goes to a person. Publish a near copy of a recipe a reviewer held: it goes to a person, who sees the earlier
decision. Paste a near copy of another cook's public recipe with "I wrote this": it goes to a person as an internal
copy. Repeat each against a private earlier recipe: the cook sees the same words and the same timing as for a public
one.

**Acceptance Scenarios**:

1. **Given** a recipe a staff reviewer approved, **When** a near copy citing the same page or the same book is
   published, **Then** its text is green on that ground, provided the copy carries no evidence item the approved
   version lacked and the approval was the latest person decision on the content that matched (FR-047, FR-047a).
2. **Given** a source a staff reviewer approved as a source, **When** a recipe citing it is published, **Then** its
   source reference is green.
3. **Given** a recipe or a source a staff reviewer blocked, **When** a near copy or a recipe from that source is
   published, **Then** it goes to a person, whatever its other parts are, and the reviewer sees the earlier decision.
4. **Given** another cook's public recipe, published before this one, **When** a near copy that shares no cited page
   or book with it, and did not come through the clone flow, is published, **Then** it goes to a person as an internal
   copy, even if the original passed.
5. **Given** a match against a recipe that only an automated check cleared, **When** the new recipe is checked,
   **Then** the match makes nothing green (FR-047).
6. **Given** a recipe that was made green by a match, **When** a third recipe matches it, **Then** that green counts
   for nothing. Only a person's own decision on the matched content counts (FR-047b).
7. **Given** a match against another cook's private recipe, **When** the cook sees the outcome, **Then** they see the
   same words, the same fields and the same timing as for any other case where a person will check where the recipe
   came from. Nothing tells them that the other recipe exists (FR-051).
8. **Given** another cook's private recipe that no person decided, **When** a near copy of it is published, **Then**
   the match can only send the new recipe to a person. It never makes anything green.

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
- **The model finds a publisher name that code can find in the text, but that is not on our list.** The quote is
  proven, so it is kept as evidence. It still only sends the recipe to a person. Only the rule-based detectors block
  (FR-010). Adding the publisher to the list is how it becomes blocking.
- **Content over the input cap.** The model is not sent content it cannot take whole (ADR-0024: reject, never
  truncate). The rule-based detectors still run on the full text. With no rule-based evidence the outcome is
  `unchecked` with the reason `tooLong`, and a person decides.
- **A check that never finishes.** After its retries are spent, the outcome becomes `unchecked` with the reason
  `checkFailed`, and a person decides. No recipe waits in "checking" forever (FR-022).
- **The cook changes the content while the check runs.** The outcome belongs to the content it read. A new version
  needs its own outcome, and an outcome for an older version never makes the new one public. An open referral for the
  old version closes as superseded.
- **A reviewer clears a recipe while a re-check runs on it.** The clearance records the outcome and the evidence the
  reviewer saw. It allows publication only while the outcome is still that one. A re-check never runs on an outcome a
  person cleared, and the two lock the referral row in the same order (FR-016d).
- **Two recipes share a photo, and one worker is already reading it.** The second recipe does not pay twice and does
  not wait forever. When the photo's evidence lands, every outcome still waiting on that photo is worked out again
  (FR-005b).
- **The cook changes the citation of a public recipe.** The source statement is part of what is checked, so the
  recipe needs a new outcome (FR-005a).
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
- **A cook erases their account and elects recipes to donate.** Donation makes recipes public and published without
  the editor. A public recipe that is already allowed stays. Each elected private recipe is checked. One that is all
  green is donated. One that is not goes to a person, and the erasure waits for that person for at most 14 days. A
  recipe still waiting after 14 days, a recipe a person does not approve, a not-approved recipe, and a recipe in
  review that was not elected are deleted with the account. The cook is told this when they elect (FR-018a).
- **A curated public-domain import.** The curator path (ADR-0023 §1) imports old cookbooks on purpose. Its recipes are
  checked and reviewed like everyone else's (FR-003a). Old cookbooks are full of page references, so most of a curated
  book will go to staff, and the whole book stays hidden until they decide.
- **The model raises a quote that is not in the text.** It never counts as evidence (FR-009). But the AI raised
  something it could not show, so the text is not green, and a person decides (FR-013a).
- **The cook publishes a copy of their own recipe.** A near copy of the same cook's own recipe that a person approved
  is not an internal copy. It counts as an approved match, under the same items rule (FR-047).
- **The cook strips the ISBN from their own `detected` recipe and publishes the copy.** The copy matches a recipe the
  check held. That match sends it to a person (FR-047, row 2).
- **The earlier recipe was erased.** Its text and fingerprint go with it, so nothing matches it any more. A hash is
  kept only on a hold decision, so after erasure it can still catch an exact copy of a held recipe, for the decision's
  retention period. It can only ever send the copy to a person. It never makes anything green (FR-052).
- **The earlier recipe was deleted, not erased.** A deleted recipe is a tombstone. At the moment it is deleted, its
  match rows go, and its open referral closes as withdrawn, so a deleted recipe matches nothing (FR-018c).
- **A clone, edited and published.** It is near the recipe it was cloned from by design. A match inside the same
  clone tree, ancestors and siblings included, is neither a pass nor a flag (FR-048).
- **A recipe published later than this one.** Only a recipe first published before this one can be flagged as the
  original. A recipe never published at all is never flagged (FR-046b).
- **A source reference that cannot be read.** A citation that is not a valid link, for a recipe stated to be from a
  public web page, is not green, and a person decides.
- **The cook deletes the recipe or erases their account while a referral is open.** The referral closes as withdrawn.
  The decision records 016 requires are kept for their period (FR-036).
- **One cook sends a very large number of recipes to a person.** Each cook has a cap on open referrals. Past it, new
  referrals wait as deferred and open one at a time as the cook's open ones close. The cap never publishes anything
  (FR-030b).
- **The cook edits a recipe that is in review.** Saving a change to the text, photos or source starts a new check and
  replaces the open referral. The editor warns before the save. The recipe keeps its place in the queue, so editing
  never pushes it back, and it never keeps a recipe in review for ever (FR-030a).
- **The cook wants out of review.** They can switch it to Private, which needs a free slot and is refused without one,
  or back to Draft. Either way the referral is withdrawn (FR-015).
- **The cook tries to publish content a person did not approve.** Review ended with that decision. The same unchanged
  content cannot enter review again, so the change to public is refused. Edited content gets a new check (FR-014a).
- **Blocking is paused.** Recipes already held stay held. New outcomes are recorded but hold nothing. Turning blocking
  back on does not hide what was published while paused (FR-019).
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
  budget is spent (FR-020).

### Session 2026-10-26 (second round: the owner's answers to four readings)

- **Budget spent → confirmed.** When the AI budget is spent, the recipe waits for a person (FR-020).
- **Curators → overruled.** A curator's grant does NOT count as a person's review. Curated recipes are reviewed like
  everyone else's (FR-003a, research R-16).
- **Photos → overruled and generalised.** Owner, verbatim: "The only time we don't mark a recipe as needing review is
  if the photo AND the text and any source reference that was provided passes green." A recipe skips review only when
  every part is green: each photo, the text, and the cook's source reference. Any part that is not green, including
  one that went unchecked, was unsure, or was not read because the budget was spent, sends the recipe to a person.
  "Green" is defined for each part in FR-013a.
- **Review time → dropped for now.** Owner, verbatim: "we can deal with SLO/SLA later." No decision target is set, and
  no staffing gates the blocking switch. The queue-load forecast stays, as information (FR-030, FR-039a).
- **Who reviews.** Owner, verbatim: "the person reviewing these recipes are employees - not users". Reviewers are
  staff, never users or the community (FR-026b).

### Session 2026-10-26 (third round: our own database)

- **Look in our own database.** Owner, verbatim: "As part of the review we should also check our own database to see
  if same recipe already exists and was approved/passed or if recipes from the same source was approved/passed." This
  became section J (FR-045 to FR-055). How a match counts first used default readings the coordinator set out. The
  fourth round below replaces them where they differ:
    - A near-duplicate of a recipe a person approved, from the same cited source, makes the text green.
    - A source a person approved before makes the source reference green.
    - A near-duplicate of a recipe a person blocked, or a recipe from a source a person blocked, goes to a person, who
      sees the earlier decision.
    - A near-duplicate of another cook's public recipe that did not come through the clone flow is an internal copy,
      and goes to a person.
    - A pass only ever comes from a person's decision, never from an earlier automated green.
    - The skip rule still holds: a recipe skips review only when photos, text and source reference are all green.

### Session 2026-10-26 (fourth round: the staff-architect review)

A staff-architect REVIEW of this spec returned nine High and seven Medium findings. The owner ruled on its four
questions the same day. The rulings below are quoted as the coordinator relayed them, and they bind.

- **Ruling 1, overlapping match rows (H1).** "Same cited page or book already approved by a person → the second
  cook's near copy is an approved match (green). 'Internal copy' applies only when the two recipes share no cited page
  or ISBN key, or the candidate is user_created. Make the match effects an ordered decision table with explicit
  precedence." Applied in FR-047.
- **Ruling 2, what a match may green (H2).** "A match turns the text green only when the copy carries no evidence item
  the approved version lacked (same kind and normalised marker), and the approval was on the matched content digest
  (latest person decision). Greening by match is never transitive." Applied in FR-047a and FR-047b.
- **Ruling 3, private recipes (M5, modified).** "Search ALL private recipes as candidates, BUT never surface any
  information about another cook's private recipe, or its existence, to other users. So the cook-facing result is the
  generic 'a person will check where this came from' whether the match was private or not; no
  `greenBy:'personEarlier'`-style field, no different wording, and no timing difference the cook can observe (say how:
  e.g. the lookup runs in the worker, per M1, never in the request). A match against another cook's private recipe
  that has NO person decision can only route to a person, never make anything green. Staff reviewers see the match
  and its earlier decision." Applied in FR-051 and FR-053.
- **Ruling 4, erasure and donation (H6).** "At account erasure, private recipes CAN be donated if they pass muster (all
  parts green, or a person clears them): a donation election runs the check on each elected private recipe, and those
  not green go to a person; an erasure does not wait on staff forever (decide and state what happens to an elected
  private recipe still pending when erasure must complete: recommend it is deleted, with the cook told at election).
  Already-allowed public recipes can be donated; held recipes and private ones that do not pass are deleted. Move the
  hold condition into one exported SQL fragment the erasure worker also uses, and amend the erasure election UI
  requirement." Applied in FR-018, FR-018a and FR-044a. The recommendation is taken: an elected recipe still undecided
  at the deadline is deleted, and the cook is told when they elect.

What else the review changed, without a question to the owner:

- Only the rule-based detectors can block. A model item, proven or not, only sends a recipe to a person. So `detected`
  is known during the save (H4).
- An internal copy can only be a recipe first published before this one, and never the recipe itself or anything in
  its clone tree (H3, M7).
- The blocking switch can no longer undo holds. It moves `shadow` → `blocking`, and between `blocking` and `paused`,
  and never back to `shadow` (H5).
- A reviewer's clearance records the outcome and evidence it cleared, so a re-check cannot race it (H7).
- Bulk import waits only for the rule-based detectors. The AI check runs after the draft is saved (H8).
- The worker's read of the check renditions is scoped to the source-check function alone (H9).
- The lookup runs in the worker, before any spend, at a measured cost (M1). Shared photos fan in (M2). Model evidence
  is keyed by everything that can change it, and rule evidence is worked out fresh on every check (M3). Erasure and
  retention are tightened (M4). A spent budget is not retried (M6).

### Session 2026-10-26 (fifth round: in review, the donation deadline, sampling, strict text)

The owner answered the open points the same day. The answers are quoted as the coordinator relayed them, and they
bind.

- **In review and slots.** "The review process does not take a slot and doesn't become visible as public or private
  until it's been approved. While it's in review it is labeled as such." A recipe in review is owner-only, labelled
  "In review", and uses no private slot. It becomes public only when it is all green or a person approves it
  (FR-014a). This resolves ADR-0073's open question.
- **What "not approved" means**, decided from the owner's rulings and relayed by the coordinator:
    - A not-approved recipe keeps its appeal (FR-026) and its statement of reasons (FR-028), as DSA Art. 17 and 20
      require. The ground is generic and never names what matched.
    - It is never published and never deleted by us. It becomes the cook's private recipe even with no free slot,
      like ADR-0073's downgrade rule, and the cook is then over the limit: no new private recipe until they are under 50. That closes the loophole of review as a free private store, because a not-approved recipe counts as private.
    - While in review, the cook may switch to Private (it uses a slot, and is refused if none is free, and the referral
      is withdrawn) or back to Draft (owner-only, and the referral is withdrawn).
    - The cook sees one generic message for every cause, and no part detail, so the cause cannot be inferred (FR-016c).
    - After Publish there is a short "Checking" state, hidden from everyone but the cook. All green: public. Otherwise:
      "In review". Saving a change to the text, photos or source of a recipe in review starts a new check and replaces
      the open referral. The editor warns before the save.
- **Donation deadline: 14 days.** A donated private recipe still waiting for staff after 14 days is deleted (FR-018a).
- **Random sampling of green recipes: no, not for now.** The residual is accepted: a cook learns only that a person
  will check, never what or whose (FR-051).
- **The strict text rule stands.** Text is green only when the model raised nothing at all, consistent with the
  all-green rule (FR-013a).

## Requirements _(mandatory)_

### Functional Requirements

#### A. When the check runs

- **FR-001**: The check MUST run before a recipe becomes publicly visible. A public, published recipe is publicly
  visible (`isRecipeViewableBy`). The check MUST run at each of these moments:
    - A recipe is published with public visibility.
    - A published recipe's visibility changes from private to public.
    - The checked content or the source statement of a public, published recipe changes.
    - A bulk-imported recipe is headed public (FR-024).
    - A cook elects a private recipe for donation at account erasure (FR-018a).
- **FR-002**: A recipe MUST be publicly visible only while the current version of its checked content has an outcome
  that allows it (FR-013, FR-016a). This one rule covers every moment in FR-001. A recipe without such an outcome is
  visible only to its owner. The rule reads the outcome that was produced for that recipe and content. A later change
  of model or rules MUST NOT, on its own, hide a recipe that already has an allowing outcome. Whether an outcome holds
  anything back is fixed by the enforcement mode stamped on it (FR-019), never by the mode read at query time.
- **FR-003**: The check MUST NOT run on a recipe that stays private, or on a recipe whose label is `imported_paid` or
  `imported_physical`, because those can never be public. A private recipe a cook elects to donate at account erasure
  is not staying private, so it is checked (FR-018a).
- **FR-003a**: A recipe whose provenance was declared under the curator grant (ADR-0023 §1) MUST be checked and
  reviewed like any other. The grant MUST NOT count as a person's review, and MUST NOT clear any outcome (owner ruling,
  2026-10-26).
- **FR-004**: The check MUST run for every way a recipe arrives: typed, pasted (`004-FR-052`), from a link
  (`004-FR-008`), from a photo (`011`), from a file and in bulk (ADR-0072). It runs on the recipe's content, not on the
  channel.
- **FR-005**: **Model** evidence MUST be stored **per part** of the checked content: once for the text and once for
  each photo, and shared by every recipe with the same part. It MUST be keyed by everything that can change what the
  model returns: the part's digest, the model, the system prompt's SHA-256, the output schema version, and for a photo
  the check rendition's version. The same part MUST NOT be sent to the model twice under the same key, so a text edit
  re-checks the text only and a new photo re-checks that photo only. **Rule** evidence is cheap and depends on the
  citation, the label and the rightsholder list as well as the text, so it MUST be worked out again on every check and
  stored with that recipe's outcome, never shared. The outcome is per recipe, because it also depends on the recipe's
  label and citation (FR-010). A change that touches neither the checked content nor the source statement MUST NOT
  start a check.
- **FR-005a**: The digest an outcome belongs to MUST cover the checked text, the sorted photo hashes, and the source
  statement (the label and the normalised citation). So a change of citation needs a new outcome, even though no model
  call is owed for it.
- **FR-005b**: Two recipes that share a part MUST NOT pay for it twice, and neither MUST wait on it forever. A worker
  MUST claim a part, with a lease, before it reserves any spend. A claim whose lease has run out MAY be taken over.
  When a part's evidence lands, a check request MUST be sent again for every outcome still `checking` whose digest
  names that part. Each outcome is then worked out by its own run of the same steps, in one place, and that run finds
  the evidence already there and spends nothing. A sweep re-drives any that this misses (FR-022).
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
      a quote from the text. A photo item names the photo and a signal from FR-006a. A model item is never blocking,
      whether or not code proves its quote (FR-010).

    The rule-based detectors run in recipe-service, in the save's own transaction, so a `detected` outcome is known
    when the save returns.

- **FR-008**: The model MUST see the checked content and nothing else. It MUST NOT see the cook's statement, the
  label, the citation, the rule-based results, or anything about the cook. The statement is the claim under test. If
  the model sees it, the model leans towards agreeing with it. ADR-0026 states this rule for parse engines, and it
  applies here.
- **FR-009**: Code MUST find every quote the model returns in the checked text. A quote that cannot be found MUST be
  discarded as evidence, and MUST still be counted, because it makes the text not green (FR-013a). Text evidence is
  never taken on the model's word. Photo evidence cannot be found by code at all, which is
  why it can only send a recipe to a person (FR-006).
- **FR-010**: Each evidence item MUST weigh **blocking**, **for a person**, or **not evidence**. The weight is decided
  by a fixed table in code over the item's kind, the detector that found it and the recipe's label, never by the
  model. **Only an item the rule-based detectors found can be blocking.** A model item is always "for a person", even
  when code finds its quote in the text, because a model's choice of what to quote is not a list or a pattern code can
  test. At minimum:

    | Evidence                                                                   | Detector | For `user_created` | For `imported_public`                             |
    | -------------------------------------------------------------------------- | -------- | ------------------ | ------------------------------------------------- |
    | Valid ISBN in the text                                                     | rules    | blocking           | blocking                                          |
    | Listed publisher or imprint in the text                                    | rules    | blocking           | blocking                                          |
    | Copyright notice in the text naming a listed publisher or paid site        | rules    | blocking           | blocking                                          |
    | Known paid-site template string in the text                                | rules    | blocking           | blocking                                          |
    | Cited link whose host is a listed paid site                                | rules    | not used           | blocking                                          |
    | Copyright notice in the text naming anyone else                            | rules    | for a person       | for a person, and not evidence for the cited site |
    | Page reference, or a cross-reference to another recipe by page             | rules    | for a person       | for a person                                      |
    | Any text item the model returned, with a quote code found                  | model    | for a person       | for a person                                      |
    | Model judgement on the text with no proven quote ("reads like a cookbook") | model    | for a person       | for a person                                      |
    | Any photo signal (FR-006a)                                                 | model    | for a person       | for a person                                      |

- **FR-011**: The lists of publishers, imprints, paid-site hosts and paid-site template strings MUST be data. Each
  has an admin-managed lifecycle and an audit trail: who added an entry, when and why. This is the governance of
  `004-FR-014`'s blocklist (004 D-004). Paid-site hosts MUST reuse that blocklist, not a second one. An entry is
  retired, never deleted: the service role MAY insert an entry and MAY set its retire fields once, and MUST NOT delete
  it or change anything else (ADR-0039's table policy, FR-019).
- **FR-012**: The check MUST NOT fetch any link, search the web, or compare the recipe or its photos with any outside
  source.

#### C. Outcomes and the publication hold

- **FR-013**: The check MUST produce exactly one outcome for a version of the checked content:
    - **`clear`**: both detectors ran on the text and every photo, and found nothing. Allows publication.
    - **`detected`**: at least one blocking item that the rule-based detectors found (FR-010). Holds publication back.
      It is decided in the save's own transaction and needs no model call.
    - **`possible`**: no blocking evidence, but at least one item for a person. Holds publication back until a person
      decides (FR-016).
    - **`unchecked`**: the model did not run on all of the content, and the rule-based detectors found no blocking
      evidence. The reason is one of `budgetSpent`, `tooLong` or `checkFailed`. Holds publication back until a person
      decides (FR-020).

    An outcome MUST be `clear` only when every part is green (FR-013a).

- **FR-013a**: A recipe skips review only when **every part passes green** (owner ruling, 2026-10-26). The parts, and
  what green means for each, are:

    | Part                     | Green when ALL of these hold                                                                                                                                                                                                                                                                                                             |
    | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | **The text**             | The rule-based detectors found no item of any kind in it. The model read the whole text: it was not over the cap, not denied by the budget, and did not fail. The model returned no evidence item at all, including a quote code could not find                                                                                          |
    | **Each photo**           | It has its fixed-size check copy. The model read that copy: not denied by the budget, and did not fail. The model returned no signal                                                                                                                                                                                                     |
    | **The source reference** | Either the cook gave none, because the statement is "I wrote this". Or the recipe is stated to be from a public web page and: its citation is a valid web link; the link's registrable host is not on the rightsholder list; and, if the link came through the URL import, the server's rights check allowed it as public (`004-FR-008`) |

    Section J can also make a part green, or not green, from what a person decided about the same recipe or source in
    our own database (FR-047).

    Any part that is not green makes the recipe not `clear`. A proven blocking item makes it `detected`. Otherwise it is
    `possible` when any part raised an item, and `unchecked` when a part was not read, and a person decides. The model
    never reads the source reference (FR-008). Only the rules do.

- **FR-014**: A `detected`, `possible` or `unchecked` outcome MUST create a **publication hold** on the recipe. The hold
  MUST NOT change the recipe's label, MUST NOT delete the recipe, and MUST be liftable only by a person's decision
  (FR-016, FR-026). It blocks a save in exactly the cases FR-018 lists.
    > **Why the boundary is a hold, not a new label.** We weighed three options.
    >
    > 1. **Reclassify the recipe to `imported_paid`.** Rejected. That label can never be public, so a false positive is
    >    permanent. It also replaces the cook's own attestation with a guess, and `016-FR-014` makes that attestation the
    >    controlling record.
    > 2. **Send every `detected` recipe to a person first.** Rejected. A cook with a cookbook ISBN in the text waits days
    >    for a person to repeat what code already proved. An appeal exists for the case code got wrong.
    > 3. **Hold public visibility, keep the recipe, and let a person reverse it.** Chosen. A false positive costs a wait
    >    and an appeal. A false negative is what happens today, without the check.
    >
    > One case costs more: a free cook with no free slot whose save the rules block loses the save, and so has nothing
    > to appeal (FR-018). They can free a slot, go Premium, or change the content. This follows ADR-0073's refusal of a
    > book recipe with no slot, and it stops "I wrote this" buying more private storage than the honest statement.
- **FR-014a**: **The lifecycle the cook sees** (owner ruling, 2026-10-26). The stored visibility keeps what the cook
  asked for. The cook-facing state is derived from it and from the outcome, by the same classifier as the read rule:
    - **Checking**: the short time after a publish before the outcome is revealed (FR-051's floor). Only the cook sees
      the recipe.
    - **Public**: the outcome allows it (all green, or a person approved it).
    - **In review**: the cook wants it public and a person has not decided yet. It is neither public nor private. Only
      the cook sees it, labelled "In review", and it uses **no** private slot (ADR-0073).
    - **Not approved**: the rules blocked it (`detected`), or a person did not approve it, or a person upheld a hold on
      appeal. In the same transaction as that decision it becomes the cook's **private** recipe. It is never
      published with that content and never deleted by us. A free cook with no free slot still gets it as private, and
      is then over the limit: no new private recipe until under 50 (ADR-0073's downgrade rule). The one exception is
      the save itself: a `detected` save with no free slot is refused with `403 SOURCE_DETECTED_NO_PRIVATE_SLOT`
      (FR-018), because nothing has been saved yet.
    - A person's decision always ends review. The same unchanged content cannot enter review again (FR-018).
    - So review cannot become a free private store: a recipe leaves review only by approval (public), by a decision
      (private, using a slot), by the cook's own move to Private (using a slot) or Draft, or by deletion.
- **FR-015**: The cook's choices:
    - **While in review**: wait for the person; switch to Private, which needs a free slot under ADR-0073 and is
      refused without one; set it back to Draft; edit it, which starts a new check and replaces the referral (the
      editor warns first); or delete it. Switching to Private or Draft withdraws the referral.
    - **When not approved**: keep it as their private recipe; change their statement to "From a source" with a book or
      paid-site citation (FR-015a); appeal (FR-026); edit it, which makes new content and a new check; or delete it.

- **FR-015a**: Changing the statement after a save MUST be a one-way **downgrade** only: from `user_created` or
  `imported_public` to `imported_physical` or `imported_paid`, with a citation, and the recipe becomes private in the
  same act. It needs a private slot under ADR-0073, unless the recipe is already private (a not-approved recipe). No route can change a label upward or to `imported_public`. Today
  provenance cannot change after a save at all (ADR-0023 keeps `source` on create only), so this route MUST be recorded
  as an amendment to ADR-0023. The new label is private-only, so no outcome is needed for it, and any open referral
  closes as withdrawn.
- **FR-016**: A `possible` outcome on a recipe the cook publishes as public MUST create a **referral** to a person. A
  referral MUST be created only once the outcome is decided, never while it is still `checking`.
  The recipe MUST stay "In review" until a person decides. The person MUST either **clear** it, which lifts the hold
  and makes it public, or **not approve** it, which ends review, makes it the cook's private recipe (FR-014a) and gives
  the cook a statement of reasons (FR-028). The cook MUST NOT be able to
  lift it themselves, and nothing automatic MUST lift it (owner ruling, 2026-10-26: "A person decides").
- **FR-016a**: An outcome allows publication when it is `clear`, or when a person cleared **that** outcome on
  **that** evidence. Nothing else allows it.
- **FR-016d**: A person's clearance MUST record the outcome and the evidence the person saw. It allows publication
  only while the recipe's outcome and evidence are still those. The next-period re-check (FR-021) MUST NOT run on an
  outcome a person has cleared. The re-check and a reviewer's decision MUST each lock the referral row first, then the
  outcome, and change the outcome only by a compare-and-set, so neither can overwrite the other.
- **FR-016b**: A referral MUST be created only when the recipe is actually headed for public view: on publish, or on a
  change to public. A draft, including a bulk-imported draft, records its outcome and creates no referral until the
  cook publishes it (FR-024a). This keeps people's time for recipes a cook wants public.
- **FR-016c**: For a recipe in review, the cook MUST see one generic message, "In review: a person will check this
  before it goes public", the same for every cause: an item in the text, a photo signal, a source reason, a match, a
  spent budget, a failed check. They MUST NOT see part results, reasons or the outcome value, so the cause cannot be
  inferred (owner ruling, 2026-10-26). No decision time is promised (FR-030). They MUST NOT be asked to confirm their
  statement instead.
- **FR-017**: A person's decision on a referral, and the cook's appeal reason, MUST be recorded with its time, the
  outcome it answered and the evidence shown. They are part of the per-item attestation record (`004-FR-014a`).
- **FR-018**: The hold MUST be part of the one rule for who can see a recipe (`isRecipeViewableBy` and its SQL
  twins), on every read path: a recipe page, search, lists and collections. The hold condition MUST be written once,
  as one exported Specification with a TypeScript form and a SQL form, held equal by a parity test. The read rule's
  three SQL twins and account erasure MUST all use that one SQL form, and a guard MUST fail any other code that reads
  the outcome table's `allows` to decide visibility. It MUST NOT be a refusal on the write side.
  A save, a publish and a visibility change never fail because of an outcome (FR-014), and the C-004 matrix
  (`visibilityPolicy.ts`, with ADR-0073's slot fact) keeps deciding which visibility a recipe may hold. The only
  write-side refusals are these three, and no other:
    - bulk import's, for a `detected` item (FR-025);
    - a `detected` save by a free cook with no free private slot, the editor's twin of FR-025 and of ADR-0073's
      refusal of a book recipe with no slot. It answers `403 SOURCE_DETECTED_NO_PRIVATE_SLOT` with ADR-0073's `used`
      and `limit`. Without it, stating "I wrote this" over a book recipe would buy more
      private storage than stating the truth;
    - a change to public of content whose review ended without approval (FR-014a). It answers
      `403 SOURCE_CHECK_NOT_APPROVED`. Editing the content first is always allowed.

    All three apply only while blocking is on, for outcomes stamped `enforced` (FR-019). Each is `403`, never `409`:
    the recipe client treats any unknown `409` as a version conflict, so an older installed app would open the conflict
    view (ADR-0073 chose `403` for `PRIVATE_SLOTS_FULL` for the same reason).

- **FR-018a**: Every path that makes a recipe public and published, including account erasure's donation of recipes,
  MUST be subject to FR-002. Because the hold lives in the read rule, no path can go around it. At account erasure
  (owner ruling, 2026-10-26):
    - A public, published recipe whose current content is allowed stays, as today.
    - A private recipe the cook elects to donate MUST be checked, at the moment of election, like any recipe headed
      public. If every part is green it is donated. If not, it goes to a person.
    - A recipe already in review that the cook elects waits the same way.
    - A not-approved recipe is never donated. Its content has a final decision and cannot enter review again.
    - The erasure MUST wait for that person only until the **donation deadline: 14 days** from the request (owner
      ruling, 2026-10-26). That leaves about 16 days of GDPR Art. 12(3)'s one month for the rest of the erasure, the
      identity scrub and the Clerk deletion included.
    - When the deadline comes, or when every elected recipe is decided, whichever is first, the erasure completes.
      It keeps only recipes the hold Specification allows. Every other recipe is deleted with the account: a recipe in
      review that was not elected, an elected recipe a person did not approve, and an elected recipe still waiting for
      staff after 14 days.
    - The cook MUST be told all of this when they elect, before they confirm. If no elected recipe needs a person, the
      erasure does not wait at all.
    - While it waits, the account is closed, so the cook cannot sign in, and their recipes are visible only through
      the read rule.
    - Two things wake the waiting erasure: the decision on its last open donation referral re-enqueues it at once, and
      the sweeper claims it when the deadline passes. Nothing else needs to run for it to finish.
- **FR-018c**: A recipe deleted by its owner is a tombstone (`001-FR-002`), not a removed row. In the same transaction
  as the delete, its open or deferred referrals MUST close as `withdrawn`, and its match rows (FR-052) MUST be removed,
  so a deleted recipe never matches another. Its outcome rows hold no recipe text and stay until the hard purge.
- **FR-018b**: A held recipe's photos MUST NOT be reachable through any public recipe surface. When a recipe that was
  public becomes held, its photos MUST be removed from the content delivery cache, using the existing invalidation path.
- **FR-019**: Blocking MUST start in **shadow mode**: outcomes and the referrals that would be made are recorded, and
  no recipe is held back. Blocking MUST be switched on only after the evaluation meets SC-001, SC-002 and SC-015, and
  switching it on MUST be a recorded operator act. The workload forecast (FR-039a) is shown with it, as information.
  Shadow mode runs **before launch**.
    - **The mode is stamped on each outcome**, at the moment its recipe is first headed for public view with that
      content (the moments in FR-001). The read rule reads the stamp, never the current mode. So a mode change never
      hides or reveals a recipe that already has an outcome.
    - **The switch is one-way out of shadow.** The modes are `shadow`, `blocking` and `paused`. The legal moves are
      `shadow` → `blocking`, `blocking` → `paused` and `paused` → `blocking`. Nothing goes back to `shadow`. The
      database MUST refuse any other move, because a CHECK cannot see the row before it.
    - **`paused` is the rollback.** It stops new holds and keeps existing ones: an outcome stamped while paused holds
      nothing, and an outcome stamped while blocking still holds.
    - The ledger is append-only: the service role holds SELECT and INSERT on it, and nothing else.
    - Because the stamp is fixed per outcome, switching blocking on never hides a recipe that is already public. A
      recipe published in shadow mode keeps its unenforced outcome until its content changes. A deliberate re-check of
      those recipes, with each cook's statement of reasons or referral notice first, needs its own plan before it is
      used.

#### D. Budget, failure and cost

- **FR-020**: If the AI budget is spent, the model cannot run, but the rule-based detectors MUST still run. With no
  rule-based blocking evidence, the outcome MUST be `unchecked` (`budgetSpent`), and a published recipe MUST be referred
  to a person as in FR-016. An `unchecked` outcome MUST NEVER be shown or stored as `clear`.
    - A ceiling denial on this call site MUST NOT be retried. The worker records the denial for that part and
      acknowledges the message. This is the second path in ADR-0024 §3 that does not retry a denial, after the parse-job
      line.
    - The spend period MUST be captured when the spend is reserved and stored with the denial. A `budgetSpent` part
      reads as spent only while its period is current. Once the period has passed, the part is owed a re-check
      (FR-021).
    - An unreadable counter is not a denial. It stays transient and fails closed (FR-022).
    > This applies the owner's Q1 ruling ("If the AI can't figure out … raise it to a human"). It replaces, for this
    > feature, the general budget ruling that the cook is asked (ADR-0072 §10 keeps that ruling for matching).
- **FR-021**: Once its spend period has passed, every outcome that is `unchecked` (`budgetSpent`) and that no person
  has cleared MUST be checked again, oldest first. A `clear` result closes the referral with no person needed. A
  `possible` result keeps the referral open. The re-check reads only the parts the model did not read, and keeps the
  rule evidence from the save, so it cannot produce `detected`. This is the only way a decided outcome changes for the same content, and it runs by a
  compare-and-set that requires the outcome to be still `unchecked` and still uncleared (FR-016d).
- **FR-022**: A spend counter that cannot be read MUST fail closed: no model call, the check retries, and the recipe
  stays held. When retries are spent, the outcome MUST become `unchecked` (`checkFailed`) and a published recipe is
  referred to a person. A recipe MUST NOT stay in "checking" for more than 24 hours.
- **FR-023**: Every model call MUST be a call site of ADR-0024's one pool, attributed under its own call-site name. It
  MUST run under the existing single Bedrock grantee and MUST NOT add a second one (ADR-0024 layer 4b). It MUST set an
  explicit output cap and a hard input cap, and MUST NOT truncate content to fit.
- **FR-023b**: The source-check function's read of the check renditions MUST be scoped to that function, even though
  the grant sits on the shared verification role. The grant MUST carry a `lambda:SourceFunctionArn` condition naming
  the source-check function, MUST cover the check-rendition prefix only, and MUST be read-only. An infra guard MUST
  assert the condition, so no other function on the role can read a cook's photos.
- **FR-023a**: Photo calls MUST be reserved at their **worst case** before the call, as ADR-0024 requires. Each photo
  MUST be sent as a copy resized to a fixed maximum size, so its token cost has a known ceiling. The reservation is
  the prompt, plus each photo's ceiling, plus the output cap. A recipe has at most `MAX_RECIPE_PHOTOS` photos (10), so
  the worst case for one recipe is bounded. A photo with no resized copy is not sent, and the outcome is
  `unchecked` (`checkFailed`).

#### E. Bulk import and private slots

- **FR-024**: In a bulk import, the rule-based detectors MUST run on an item headed public before it is saved, inside
  `advance`. That is all the import waits for. The rules alone decide `detected`, and nothing else can block (FR-010),
  so the lookup and the model never change whether an item may be saved. The lookup and the model run after the save,
  in the worker, keyed by the saved recipe's id (FR-053).
- **FR-024a**: An item headed public that is not `detected` MUST be saved as a draft. Its AI check then runs, and its
  outcome is shown when it lands. A `possible` or `unchecked` item creates no referral until the cook publishes it
  (FR-016b).
- **FR-025**: In a bulk import, a `detected` item MUST NOT be saved as public. The cook MUST be able to keep it private
  if they have a private slot free (ADR-0073), skip it, or stop the import. With no slot free, only skip and stop are
  offered. This follows the owner's ruling: a recipe known to be from a book or paid site can only be stopped or
  skipped, never made public.

#### F. People, referrals, appeals and statements of reasons

- **FR-026**: A cook MUST be able to appeal a `detected` hold, with an optional reason. The appeal is a referral, and
  MUST appear in 016's reviewer queue (`016-FR-053a`). A staff reviewer holding 016's review scope (`016-FR-053g`) MUST
  decide it: overturn, which lifts the hold, or uphold, which keeps it.
- **FR-026a**: A cook MUST be able to appeal a hold a person made, once per version of the content. The appeal MUST go
  to a different reviewer when one is available. With one reviewer, the same person decides it, and the record says so.
- **FR-026b**: Every reviewer MUST be an **employee** of the operator, never a user or a member of the community (owner
  ruling, 2026-10-26). 016's review scope (`016-FR-053g`) MUST be granted only to staff accounts. No user-facing role,
  reputation or volunteer path MAY lead to it. Every action is attributed to the individual employee
  (`016-FR-053f`). A staff reviewer's read of a cook's held recipe and its photos is new access to another person's
  content. It MUST pass a security review before it ships, and every read MUST be logged.
- **FR-027**: Every person's decision MUST record who decided, when, the ground and the facts relied on, and MUST NOT
  be saved without them (`016-FR-017`, `016-FR-053b`). No referral is ever decided by the check.
    - The **ground** is one of a closed set, each with a localised cook-facing text. It is what the cook is told.
    - The **facts** are the evidence kinds and where they are, taken from the check. A match fact is always the one
      generic fact "our records do not confirm where this recipe came from", the same for a public match,
      a private match and a source decision (FR-051).
    - The reviewer's own words are a **note**: a string, kept on the decision for staff and for 016's evidence, and
      never shown to the cook. So a reviewer cannot disclose another cook's private recipe by typing it.
- **FR-027a**: The reviewer MUST see the recipe's text and photos, each part's green or not-green result, each signal
  and where it is, and the cook's statement and citation. Only the model is kept from the statement (FR-008). A person is not.
- **FR-028**: Every "not approved" decision (a `detected` hold, a person's non-approval, an upheld appeal) MUST give the
  cook a **statement of reasons** through 016's mechanism (`016-FR-018`, `016-FR-018a`). It MUST name:
    - the action: publication withheld, and the recipe kept private
    - the ground: for `detected`, the terms clause on rights to upload; for a person's decision, the ground chosen
      from the closed set, which is generic and never names what matched
    - the facts: for `detected`, the kinds of evidence the rules found in the cook's own text, and where they are; for
      a person's decision, only the generic fact of FR-027, so the cause cannot be inferred (FR-016c)
    - that automated means were used, and, for a person's decision, that a person decided
    - the redress: keep it private, change the statement (FR-015a), appeal, edit it, or delete it.
- **FR-029**: The statement MUST be built from a fixed template filled, for `detected`, with the rule evidence kinds and
  locations, and, for a person's decision, with the ground the person chose from the closed set. It MUST NOT be prose written by the model, and it
  MUST NOT carry the reviewer's note.
- **FR-030**: No decision time target is set in this release (owner, 2026-10-26: "we can deal with SLO/SLA later").
  The queue MUST show each referral's age. However old a referral is, it MUST NOT publish the recipe. A target, when
  the owner sets one, is added then.
- **FR-030a**: The reviewer queue MUST order referrals oldest first, and MUST let a reviewer see every open referral
  from one cook or one import together, so a large import or a curated book is decided in one sitting. Each recipe still
  gets its own decision. A recipe's place in the queue is the time it **first** entered its current review. An edit
  that replaces the referral, or a return from Draft, keeps that place, so the cook cannot push a recipe back to stay
  in review. After a decision, a new review starts a fresh place, so an old date cannot jump the queue. The reviewer
  sees the recipe's own earlier decisions (FR-049).
- **FR-030b**: Each cook MUST have a cap on open referrals. Past the cap, a new referral is created as `deferred`. It
  is not in the queue, and it opens, oldest first, when one of the cook's open referrals closes. The cap only defers.
  It MUST NOT publish, clear or drop anything, and the cook sees a deferred referral the same way as an open one. A
  reviewer working a grouped view (FR-030a) MAY open a cook's deferred referrals directly, so a book is still decided
  in one sitting. Its number is set in the plan from the shadow-mode forecast.
- **FR-031**: A hold, a person's hold and an upheld appeal MUST NOT add an infringement strike (`016-FR-020`).
  Strikes come only from actioned notices.
- **FR-032**: A reviewer can open a sample of `clear` public recipes for audit. A finding from that audit that restricts
  a recipe is a decision with a statement of reasons like any other.

#### G. Privacy and records

- **FR-033**: The checked content MUST be sent only to the model provider in the deploy region, unless the owner records
  an approval of another region for this call site. An approval given for a model at another call site MUST NOT cover
  this one. The provider MUST NOT use the content for training. A guard MUST pin this call site's model to a model
  registry entry that runs in the deploy region, so a configuration change cannot route it elsewhere.
- **FR-034**: The check's output is a decision about content, not content shown to users. It MUST NOT be shown to the
  cook as AI-written text. The cook-facing words come from the template (FR-029).
- **FR-035**: **Shared model evidence** MUST hold the part's key (FR-005) and each item's kind, field and position (a
  span in the text, or the photo's digest), and nothing else. It MUST NOT hold any quote, marker text, recipe text,
  photo or user id. **A recipe's own judged items** (the rule items, and the model items as they apply to this
  recipe) are stored with its outcome. They MAY hold the short marker text for a list or pattern kind (for example the
  ISBN), and a digest of the normalised marker for a free-text kind (a copyright holder, a model quote), because the
  same-items rule needs it (FR-047a). A recipe's outcome record MUST hold the recipe, the digest, the outcome, the
  reason, the label and cited host it was judged under, the enforcement stamp, and the times.
- **FR-036**: Erasure and retention:
    - A recipe's outcome records, judged items and referrals MUST be deleted with the recipe's hard purge and with
      account erasure.
    - Shared model evidence holds no user id, no text and no photo, so it is kept. The erasure coverage guard records
      it as retained by ruling, with its columns pinned.
    - A decision record that is evidence of a hold or a person's decision MUST be kept for 016's period
      (`016-FR-052a`), and then purged. The erasure coverage guard MUST record it in a **third map**, beside its exemption and
      retention maps: time-boxed legal retention, which asserts that the table carries a `purge_after` column the retention sweep honours.
      ADR-0027 records that map.
    - What a decision record keeps: the short marker text it relied on, the reviewer's note, the cook's appeal reason,
      and, for a hold decision only, the text fingerprint (FR-052). Never the recipe text or a photo.
    - A statement of reasons owed to a cook whose account has been erased cannot be delivered. The decision record
      MUST say so, and counsel confirms that this is enough (FR-041).
- **FR-037**: The cook MUST be able to see, for their own recipe, its state (FR-014a), any open referral and its age,
  any decision, and its statement of reasons. For a `detected` recipe they also see the rule evidence in their own
  text. They see no part results and no outcome value for a recipe in review (FR-016c).

#### H. Measurement and operation

- **FR-038**: There MUST be an evaluation that runs the check over a labeled set and reports precision and recall for
  `detected`, recall on third-party items that carry an explicit marker, recall on those that carry none, and the share
  of items that would go to a person. The labeled set MUST include photos: dish photos, photographed book pages and
  screenshots of paid sites. It MUST be kept outside the repository, with access limited to the operator, because it
  holds excerpts of copyrighted works (FR-041).
- **FR-039**: The check MUST report outcome counts by outcome and reason, which parts were not green and why,
  referral counts by origin, open referrals and the age of the oldest, time to decision, the overturn rate, time to
  outcome, and the number of recipes held in "checking". A recipe held past FR-022's limit MUST raise an alert.
    > Inspection is not user evidence. The labeled set measures detection. It says nothing about whether cooks find the
    > check fair or the copy clear. Any claim about that needs a study.
- **FR-039a**: Shadow mode MUST produce a **referral forecast**, as information: referrals per day by origin and by the
  part that was not green, and the staff time they need at a measured minutes-per-referral. It MUST show three cases
  apart: ordinary publishing, a month in which the AI budget runs out (every publish becomes a referral, FR-020), and
  the one-time backlog of a curated book import (FR-003a). It gates nothing.
- **FR-039b**: _Removed (owner, 2026-10-26)._ Staffing no longer gates the blocking switch.

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
        - **Facts and non-disclosure.** DSA Art. 17(3)(b) asks for the facts relied on. A hold that rests on a match
          against another cook's private recipe can state only the generic fact (FR-027). Is that enough? **What
          breaks**: if not, a private match cannot be the only ground for a hold, and FR-051 must route it differently.
        - **The donation deadline.** The owner set 14 days, inside GDPR Art. 12(3)'s one month (FR-018a). Counsel
          confirms it is not undue delay. **What breaks**: if it is, donated recipes that need a person are deleted at
          once instead.
        - **A statement for an erased cook.** A person's hold during the donation wait, or after the account is gone,
          has nobody to deliver a statement to (FR-036). **What breaks**: if a statement is still owed, it must be sent
          by email before the identity record is scrubbed.
    - **`016-FR-018a`'s delivery** MUST accept a decision from 020 (a hold or a person's decision), not only a notice
      decision. 016's `notice_decisions` table is not changed (research R-13).
    - These 016 amendments are NOT applied by this feature. Another session is working on 016, so they are listed here
      and applied with 016's own next revision.
- **FR-042**: ADR-0024 MUST be amended in three places. §4c's call-site list gains `source-check`, and names
  `SPEND_CALL_SITES` as the authority for the list. §3 gains this call site as the second path that does not retry a
  ceiling denial (FR-020). Layer 4b records that the shared role's photo read is scoped to one function by
  `lambda:SourceFunctionArn` (FR-023b). Layer 4b's single grantee does not change.
- **FR-043**: ADR-0072's readiness rule (§7) MUST gain FR-024: an item headed public is not ready to save until the
  rule-based detectors have run on it. It never waits for the lookup or the model.
- **FR-044**: ADR-0023 MUST be amended for FR-015a: a one-way downgrade of provenance after a save, to a private-only
  label with a citation, and nothing else.
- **FR-044a**: The account closure plan's erasure election (U3b, R4) MUST be amended for FR-018a. The election screen
  MUST, before the cook confirms:
    - check each recipe the cook elects to donate, and show which ones are ready to donate now, and which need a
      person first;
    - say, in plain words, that a recipe a person has not cleared within 14 days is deleted with the account, and so
      is any recipe a person does not approve;
    - say that a recipe in review that is not elected, and a not-approved recipe, are deleted, not donated.

    The screen ships on web and mobile together, through `staff-ux-engineer` SPECIFY. This amendment is NOT applied to
    that plan by this feature. It is listed here and applied with the plan's own next revision, as 016's are.

#### J. Same recipe and same source in our own database

- **FR-045**: The check MUST look in **our own** recipe database for the same or nearly the same recipe, and for
  recipes from the same source, and MUST read what a person decided about them. It MUST NOT crawl, fetch or search
  anything outside our database (FR-012).
- **FR-046**: **Same-recipe lookup.** The check MUST find recipes whose text is the same (an exact fingerprint of the
  normalised text, versioned `v1:`) or nearly the same (a near-copy measure). The measure MUST come from a maintained
  library or extension, not a hand-rolled one.
    - In this release, Postgres `pg_trgm` finds candidates. It is maintained, ships with RDS and is already installed
      in the recipe database. The lookup MUST set its similarity threshold with `SET LOCAL` inside its own
      transaction, so it never depends on a session default. Word-shingle Jaccard confirms each candidate (research
      R-17).
    - Both thresholds MUST be set from measurement on a labeled set of recipe pairs (SC-015), never guessed.
    - Before blocking is switched on, a LOCAL e2e benchmark MUST run the lookup at the projected corpus size. If it
      fails its budget, the candidate index flips to MinHash signatures with an LSH band table, confirmed by the same
      shingle Jaccard. Both are derived indexes rebuilt from the stored match text, so the flip needs no change to what
      the cook stores.
- **FR-046a**: **Same-source lookup.** The check MUST find recipes with the same cited source, by a normalised source
  key: a web link's page (normalised by the maintained `normalize-url` library, never by hand); a site's registrable
  host; or a book's ISBN, read from the text or the citation. It MUST also find a person's explicit decision about
  that source (FR-050).
- **FR-046b**: **Which candidates count.**
    - The recipe itself, and every recipe in its **clone tree**, MUST be left out: its ancestors through the
      `cloned_from_id` chain, followed to its root, and every other recipe with the same root. The walk MUST be bounded
      by a depth cap and a cycle check.
    - A candidate MAY send this recipe to a person (FR-047 rows 2, 5 and 6) only if it was **first published before
      this recipe** (`first_published_at`). A recipe never published at all is never such a candidate. This recipe's
      own date, when it has never been published, counts as now.
    - Every private recipe is searched (owner ruling 3). A private recipe that was never published can therefore
      produce no effect at all, because it can neither carry a person's decision nor be the earlier original.
- **FR-047**: **Match effects, in order.** For each candidate, the first row that applies decides its effect, and the
  rows below it are not read. Only a **person's** decision on the matched content can make anything green. The table
  is code, in one pure function (`matchEffectOf`), owner ruling 1:

    | #   | When                                                                                                                                                                                                                                              | Effect on the part (text, or one photo) |
    | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
    | 1   | The candidate is this recipe, or in its clone tree (FR-046b)                                                                                                                                                                                      | None. Shown to the reviewer only        |
    | 2   | The latest decision on the candidate's matched content is a hold: a person's hold, an upheld appeal, an audit restriction, or a `detected` outcome no person overturned. Includes a hold hash kept after erasure                                  | Not green. A person decides             |
    | 3   | The latest person decision on the candidate's matched content is a clearance, the same-items rule holds (FR-047a), and either the candidate is the same cook's, or the two share a cited page or ISBN key and the candidate is not `user_created` | Green on that ground                    |
    | 4   | The candidate is another cook's private recipe                                                                                                                                                                                                    | Not green. A person decides             |
    | 5   | The candidate is another cook's public recipe, and the two share no cited page or ISBN key, or the candidate is `user_created`: an internal copy                                                                                                  | Not green. A person decides             |
    | 6   | Anything else: only an automated check cleared it, it is the same cook's with no person decision, or it shares a cited key with no person decision                                                                                                | None                                    |

    Rows 2, 4 and 5 need the time order of FR-046b. A candidate that fails it falls through to row 6.

    Two source rules sit beside the table, because a source decision is not about any one recipe (FR-050):

    - A source decision that **blocks** one of this recipe's source keys makes the source reference not green. A person
      decides.
    - A source decision that **approves** one of this recipe's source keys makes the source reference green on that
      ground. It cannot green a citation that is not a valid link, because that has no key.

- **FR-047a**: **The same-items rule** (owner ruling 2). A match turns a part green only when the copy carries no
  evidence item, in that part, that the approved version lacked. Two items are the same when they have the same kind
  and the same normalised marker: the marker text for a list or pattern kind, a digest of the normalised text for a
  free-text kind, and for a photo the photo's own digest. A copy with a different copyright holder, or one more page
  reference, is therefore not green by the match.
- **FR-047b**: **No passing along.** The approval MUST be a person's own decision on the candidate's matched content
  digest, and the latest person decision on it. A candidate that is allowed only because a match made it green counts
  as row 6. So greening by a match is never transitive.
- **FR-047c**: **Combining.** For each part, the effects of all its candidates combine in one fixed order: "not green"
  beats "green", and "green" beats "none". A proven blocking rule item makes the outcome `detected` whatever any match
  says. The skip rule of FR-013a still holds: a recipe skips review only when every part is green.
- **FR-048**: A match inside the clone tree (FR-046b) MUST be ignored: neither a pass nor a flag. Cloning is the
  sanctioned way to build on another cook's public recipe (`001-FR-005`, `GR-014`).
- **FR-049**: The reviewer screen MUST show the recipe's own earlier decisions, and every match found: the kind (same recipe or same source), the similarity,
  the row of FR-047 that applied, and the earlier decision with its ground and date. For a match against another cook's
  **private** recipe, it MUST show the earlier decision only, never that recipe's content.
- **FR-050**: A staff reviewer MUST be able to record a decision about a **source**, apart from any one recipe:
  approve or block a source key, with a reason. Clearing or holding one recipe MUST NOT, by itself, approve or block
  its whole source. Retiring or reversing a source decision MUST NOT change an outcome already produced, and MUST NOT
  undo a person's past decision. It changes only what later checks find. A source decision is retired, never deleted.
- **FR-051**: **Another cook's private recipe is never disclosed** (owner ruling 3).
    - Private recipes MUST be searched as candidates. Their content MUST NEVER be shown to anyone but a staff reviewer,
      and to a reviewer only as FR-049 allows.
    - What the cook sees MUST NOT depend on whether a match was private, or on any cause at all. A recipe in review
      shows one generic message for every cause (FR-016c), with no part results and no field that says why anything
      is green or not.
    - **Accepted residual** (owner ruling, 2026-10-26: no random sampling for now). A cook learns only that a person
      will check, never what or whose.
    - **Timing.** The lookup runs in the worker, never in the request (FR-053). The worker runs the same steps
      whatever the lookup finds. It never skips or shortens a model call because a match already decided a part, and
      it writes the outcome only once every part is read. So the time to an outcome does not show whether a match
      exists.
    - **A floor on every outcome the worker produces.** A model answer can come from the shared cache, for example
      when a cook pastes the exact text, or uploads the exact photo, of a recipe checked before. That recipe can now
      be another cook's private recipe, and a cached answer lands in milliseconds instead of seconds. So no
      worker-produced outcome is revealed before the check began plus a fixed floor: neither the cook's view nor the
      read rule moves before it. The floor MUST be set from the measured time of an uncached check, never guessed. A
      rule-only `detected` is exempt, because it reads only the cook's own content.
    - The statement of reasons and the decision's cook-facing ground follow FR-027 and FR-029.
- **FR-052**: What is stored for the lookup MUST be kept per recipe, for its current version: the normalised match
  text, its exact fingerprint, and its source keys. These are derived from the cook's content, so they are the cook's
  data like the recipe itself (research R-17). They are written in the same transaction as the content, and removed
  when the recipe is deleted (FR-018c), purged or erased. A **hold** decision record (FR-047 row 2) MAY keep the exact
  fingerprint, a versioned hash with no text, for its retention period (`016-FR-052a`), so an exact copy of a held
  recipe is still caught after that recipe is gone. A clearance keeps no hash. A kept hash can therefore only ever
  send a recipe to a person. It never makes anything green.
- **FR-053**: The lookup MUST run in the source-check worker, after the claim and before any spend is reserved. It
  needs no model and no AI budget, so it runs even in a budget month. recipe-service writes the fingerprints and source
  keys in the content transaction, and does no lookup in the request.
- **FR-054**: The cook-facing reasons MUST NOT say which other recipe matched, whose it is, or whether a match was a
  recipe at all (FR-051).
- **FR-055**: The label of a private candidate MUST NOT be used as evidence. A near copy of another cook's private
  `imported_physical` or `imported_paid` recipe is row 4 of FR-047, like any other private match: a person decides.
  It MUST NOT make the outcome `detected`, and it MUST NOT name a book, because that lets one cook's private
  library shape another cook's outcome beyond sending it to a person.

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

- **Model Evidence Set**: what the model found in one part (the text, or one photo), under one model key (FR-005).
  Shared by every recipe with the same part. Holds no user id, no text, no quote and no photo.
- **Part Claim**: a lease on one part and one model key, so two recipes never pay for the same part (FR-005b).
- **Judged Item**: one evidence item as it applies to one recipe's outcome: kind, field, position or photo, the
  detector, its weight and its marker. Rule items are worked out on every check. The recipe's data.
- **Part Result**: green or not green for one part (the text, one photo, or the source reference), with why.
- **Source Check Outcome**: the result for one recipe and one digest: outcome, reason, each part's result, the label
  and cited host it was judged under, the enforcement stamp, any clearance with the outcome and evidence it cleared,
  and times.
- **Publication Hold**: the fact that a recipe cannot be publicly visible now. It is derived from the recipe's current
  digest, its outcome and that outcome's enforcement stamp, by one Specification. A person's clearance lifts it.
- **Referral**: a recipe sent to a staff reviewer: its origin (the check, or the cook's appeal), its age, its state
  (deferred while the cook is over the cap), and its decision.
- **Decision**: what a person decided, or what the check decided for `detected`, with a ground from a closed set,
  the facts, the reviewer's internal note and statement delivery. Kept as evidence for 016's period, then purged.
- **Enforcement Event**: one row of the append-only switch ledger: the mode moved to, who, why and which evaluation.
- **Rightsholder List**: publishers, imprints, paid-site hosts and template strings, with an audit trail.
- **Match Fingerprint**: per recipe, the normalised match text and its exact fingerprint. The cook's data.
- **Source Key**: a recipe's normalised cited source: page, registrable host, or ISBN.
- **Source Decision**: a staff reviewer's approval or block of a source key, with a reason.
- **Match**: a candidate the lookup found for one check: the matched recipe or source, the kind, the similarity, the
  row of FR-047 that applied, and the earlier decision.
- **Donation Election**: at account erasure, the recipes a cook chose to leave behind, each with its check and the
  donation deadline (FR-018a).

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
  by an automated assertion, not by sampling. Zero recipes survive account erasure as public unless the same hold
  Specification allows them.
- **SC-005**: 95% of checks reach an outcome within 60 seconds of the publish, and zero recipes stay in "checking" for
  more than 24 hours.
- **SC-006**: 100% of holds that need one have a statement of reasons that says automated means were used, delivered
  on both of 016's channels.
- **SC-007**: _Removed (owner, 2026-10-26: "we can deal with SLO/SLA later")._ Decision times are reported (FR-039),
  not targeted.
- **SC-008**: Zero model calls receive the cook's statement, label, citation or rule-based results, checked
  structurally.
- **SC-009**: Zero infringement strikes come from a hold, a person's hold or an appeal.
- **SC-010**: Zero model calls are made for a recipe that stays private, and zero for a part (the text, or one photo)
  that already has evidence under the same rules and model.
- **SC-011**: Before blocking is switched on, the shadow-mode forecast (FR-039a) has been produced and shown to the owner,
  with its three cases. It is information, not a gate.
- **SC-012**: Zero recipes are made `detected` or `clear` by a photo signal alone, checked structurally.
- **SC-013**: Zero recipes are `clear` while any judged part is not green, checked by a property test over every
  combination of part results. "Judged" means the staff view, with match effects applied. The cook's view of a part
  reads their own content only (FR-037).
- **SC-014**: Zero reviewer actions come from an account that is not a staff account, checked against the review
  scope's grant list.
- **SC-015**: On a labeled set of recipe pairs (exact copies, lightly edited copies, and different recipes for the same
  dish), the near-duplicate measure reaches at least 95% precision and at least 90% recall at its chosen thresholds,
  in shadow mode, before blocking is switched on. The pairs set holds at least 300 duplicate pairs and 300 non-duplicate
  pairs.
- **SC-016**: Zero matches make a part green unless a person's latest decision on the matched content cleared it, the
  same-items rule held, and the candidate's own allowing state did not come from a match. Checked by a property test
  over the rows of FR-047.
- **SC-017**: Zero cook-facing responses carry any detail of another cook's recipe, or differ in any field or wording
  between causes of review: a private match, a public match, a page reference, a photo signal or a spent budget.
  Checked by a contract test that runs each case and compares the responses.
- **SC-021**: Zero recipes stay in review after a person's decision, zero not-approved recipes are uncounted as
  private, and zero unchanged contents re-enter review after a decision. Checked by integration tests over every exit
  from review.
- **SC-018**: Zero outcomes change because the enforcement mode changed, and zero moves back to `shadow` are
  accepted. Checked by tests over every legal and illegal move.
- **SC-019**: Zero cleared outcomes are overwritten by a re-check, and zero clearances allow an outcome other than the
  one they cleared. Checked by a concurrency test that runs both writers against one row.
- **SC-020**: Zero model calls are made, and zero reservations taken, for a part whose claim another worker holds.

## Assumptions

- **ADR-0073 owns the slot rule.** Free cooks hold up to 50 private recipes. A slot is a private, undeleted recipe,
  counted live. 020 does not own it and only reads it.
- **A recipe in review uses no slot, and a not-approved one does** (owner ruling, 2026-10-26). ADR-0073 counts
  `visibility = 'private'` only. A recipe in review keeps its stored `public` visibility and is hidden by the read rule,
  so it uses no slot. A decision moves it to `private`, so it counts.
- **Open, for the owner: the Draft path.** A cook can move a recipe from In review back to Draft and keep it there,
  owner-only and using no slot, with no time limit. ADR-0073 counts only `visibility = 'private'`, so a public draft
  is unmetered. Counting public drafts would close it, but it changes what a slot means, which ADR-0073 calls a
  one-way door.
- **Nothing is live.** At launch there is no public corpus to check.
- **016 is planned and not built.** The statement of reasons, the reviewer dashboard and the email channel come from 016. Blocking stays in shadow mode until they exist (FR-019).
- **The reviewer dashboard inherits 016's open decision A-11** on `002`'s "no admin UI" exclusion.
- **The model is one already in ADR-0024's registry** that takes images and stays in the deploy region. The plan
  chooses it, under FR-033.
- **Reviewers are employees** (FR-026b). At launch the owner may be the only one. A second staff reviewer is what makes
  FR-026a's "a different person" possible.
- **Rule-based detectors come first.** We expect most `detected` outcomes to come from them. The model widens what is
  found. It never decides what blocks, and it never clears a photo signal.
- **Bulk import does not publish** (ADR-0072 §3). "Headed public" means the cook chose public visibility for the item.
  The check runs during the import so the cook can choose skip or stop there, as the owner ruled (FR-024, FR-025).
- **Prompt injection is possible.** A recipe or a photo can contain text aimed at the model ("ignore your
  instructions"). At worst it hides evidence, which is the same as a copy with no markers. It cannot cause a block,
  because only the rule-based detectors block. It cannot cause a clearance of a photo signal, because a photo signal
  goes to a person.

## Out of Scope

- Deciding whether any recipe is lawful. The check finds evidence of a source. It does not judge copyright.
- Checking private recipes, or recipes labelled `imported_paid` or `imported_physical`, except a private recipe
  elected for donation at account erasure (FR-018a).
- Fetching, crawling or comparing against outside sources, including cited links and reverse image search. The
  same-recipe lookup reads our own database only.
- Takedown after a notice, strikes and account termination (016).
- A re-check of the public corpus after a change of model or rules. That is a separate operator act.
- Telling the cook which published work their recipe matches. The check reports markers, not matches.
