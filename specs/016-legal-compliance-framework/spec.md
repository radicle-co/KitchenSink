# Feature Specification: Legal Compliance Framework

**Feature Branch**: `016-legal-compliance-framework`
**Created**: 2026-08-22
**Status**: Draft
**Input**: User description: "create a feature for the legal coverage, protections, considerations, guidelines and rules and regulations within the apps, the TOS, etc. based on the context found during the initial research. One thing to research is if we can own public data without copyrighting or running into other legal issue or fines or violations - a license of sorts."

## Dependencies

| Spec                                                                            | Relationship                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md)                     | **Required** — owns recipe visibility (`FR-003`), public read (`FR-004`), the clone chain (`FR-005`), soft-delete/erasure (`C-007`) and the C-004 policy                       |
| [002-user-auth](../002-user-auth/spec.md)                                       | **Required** — owns account creation, the only moment an agreement can be presented, and the erasure cascade. **Has no terms-acceptance, consent or age surface today**        |
| [004-recipe-importing](../004-recipe-importing/spec.md)                         | **Required** — owns provenance (`FR-011`), attribution (`FR-010`), per-item attestation (`FR-014a`), photo extraction (`FR-008`), robots handling (`FR-023`)                   |
| [010-subscriptions](../010-subscriptions/spec.md)                               | **Required** — owns the tier model and billing. **Has no auto-renewal disclosure or cancellation surface today**                                                               |
| [011-recipe-digitization](../011-recipe-digitization/spec.md)                   | **Referenced** — owns digitization provenance and its mandatory attribution (`FR-021b`)                                                                                        |
| [012-creator-profiles](../012-creator-profiles/spec.md)                         | **Referenced** — currently the ONLY spec containing a DMCA route (`FR-022`). This feature takes ownership of takedown portfolio-wide; 012 becomes a consumer                   |
| [015-publishing-rewards](../015-publishing-rewards/spec.md)                     | **Referenced** — its inducement hazard is a direct input here; 015's `FR-016`–`FR-018` consume the takedown process this feature specifies                                     |
| [005-ai-integration](../005-ai-integration/spec.md)                             | **Referenced** — owns AI features **and the shared disclosure component**. `GR-010` owns the obligation; this feature contributes machine-readable AI marking and cites both   |
| [017-recime-parity](../017-recime-parity/spec.md)                               | **Downstream** — its video-import wedge depends on `FR-027f`'s transient-extraction permission. 017 blocked on this feature and it is resolved (C-016-002, amended 2026-08-22) |
| `GR-014` Audience and Sharing Model                                             | **Governs** — owns cloning, derived copies, deletion and erasure (AC-014-e/g/h/i), amended to v3.5.0 from C-016-003. This feature cites it and MUST NOT restate it             |
| `GR-010` EU AI Act Compliance Propagation                                       | **Governs** — owns the AI disclosure obligation (AC-010-a…f), amended to v3.5.0 from this feature. Group H cites it                                                            |
| `GR-003` FR Identifier Namespace                                                | **Governs** — every cross-feature citation here is qualified `{feature}-FR-{NNN}`, and `cross-feature-FR-index.md` carries this feature's rows                                 |
| [009-nutrition-planning](../009-nutrition-planning/spec.md)                     | **Referenced** — already flags special-category data; this feature owns the lawful-basis surface for it                                                                        |
| [021-public-discovery-and-sharing](../021-public-discovery-and-sharing/spec.md) | **Downstream** _(added 2026-11-03, ADR-0082)_. Owns what is open to the web. It cites `FR-015c`, `FR-015k`, `FR-030a`, `FR-033` and `FR-072` to `FR-082`                       |

---

## Why this feature exists

Before this feature, the portfolio had none of the following:

- **A content licence.** Nothing gave Commise the right to display a user's recipe, or to let another user clone it
  (`001-FR-005`).
- **Notice and action for the main recipe corpus.** Notices appeared only in `012-FR-022`, for creator profiles.
  There was no designated agent, no repeat-infringer policy and no EU notice route.
- **Terms acceptance, a consent record and an age floor.** `002` created accounts without them.
- **An auto-renewal disclosure and a cancellation surface.** `010` sold subscriptions without them.

### The four product rules this specification is designed around

**1. Only a licence from the cook lets Commise show the cook's recipe.** Keeping a copy private and showing a credit
are both required where they apply, but neither replaces the licence (`FR-010` to `FR-015`).

**2. Terms bind the people who accept them.** The terms carry the licence grant, the user's representations and the
notice-and-takedown terms. They never stand in for notice and action, which this feature builds.

**3. The cook supplies the content.** Commise never fetches a page (`004-FR-064`). The cook pastes, shares or uploads
it, and the copy Commise keeps and shows is decided by `FR-077`.

**4. Rewards follow the cook's own work.** Only "Written by you" recipes earn rewards (`015`), and a Commise-written
version never earns one. No paid tier is priced or packaged on imported content (`FR-029a`).

### ⛔ What this feature is NOT

- **It does not draft the documents.** Every document surface here is specified as _a versioned artefact the product
  must present, record acceptance of, and act consistently with_. The requirements are testable without knowing the
  documents' words.
- **It is not a re-implementation of erasure, provenance, attribution or billing.** Those exist. This feature
  specifies the _surfaces_, _records_ and _guardrails_ over them, and names the one place each is owned.
- **It does not choose markets.** It specifies the machinery to apply a per-market posture. Which markets we serve is
  an owner decision, answered in C-016-001: **US at v1, global as the stated target.**

---

## What Commise claims in the public corpus

- **The recipes are never Commise's.** Authorship stays with the author. Commise takes a **licence**: non-exclusive,
  worldwide, royalty-free, sublicensable (the clone chain needs sublicensing), and scoped to operating, displaying and
  promoting the service (`FR-010` to `FR-015`). Commise never takes an assignment or an exclusive licence.
- **Commise does not claim an EU database right**, and never tells anyone it holds one. Whether to create an EU
  establishment is a business decision listed under Owner Decisions, not a requirement.
- **The terms forbid bulk extraction by account holders** (`FR-030` to `FR-032`). Technical controls, such as rate
  limits and bot management, cover visitors who have not accepted the terms (`FR-030`). The terms never forbid what a
  Creative Commons licence on a layer allows (`FR-033`).
- **The derived layers stay unpublished.** Ingredient-resolution mappings, per-field confidence scores, dedup keys and
  ranking signals are treated as confidential.

### Open and closed layers

`FR-033` is the authority.

- **Open:** "free to read" on every open page. CC BY-SA 4.0, credited "Commise and contributors", on text Commise
  itself writes (`FR-078`, Owner ruling, 2026-11-15, which replaces CC0 for that text). CC BY 4.0, opt-in per recipe,
  for a cook's checked "Written by you" recipe (`FR-010`). The Creative Commons Public Domain Mark on label 7 text
  (`FR-015k`).
- **No open licence on collected facts as a class.** Ingredient lists are never marked with an open licence on their
  own.
- **Still closed:** the app, the code, ranking, ingredient-matching mappings and confidence scores, the food catalog
  (ADR-0052 unchanged), user data, the brand, and 018's paid chef content. Third-party text and photos are never
  licensed by us.

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 - We have the right to show what we show (Priority: P1)

A person creating an account is presented with the terms and privacy notice before the account is usable, and
their acceptance — which version, when — is recorded. That acceptance is what grants the licence the product
needs to display their recipes, let other users clone them, and generate derived content from them. When the
terms change materially, they are asked again, and the product can tell at any time which version each user
agreed to.

**Why this priority**: Without this, every public-corpus feature already specified is operating on a
permission we never obtained. It is the cheapest item in the feature and the one everything else assumes.
Nothing else in this spec is worth doing first.

**Independent Test**: Create an account, verify acceptance is blocked from being skipped and is recorded with
a version; publish a recipe and verify it is displayable; publish a material terms revision and verify the
account is re-prompted and the new acceptance recorded alongside the old one.

**Acceptance Scenarios**:

1. **Given** a new account, **When** the user reaches the first authenticated surface, **Then** the current
   terms and privacy notice are presented and acceptance is required before any content-creating action.
2. **Given** an accepted set of terms, **When** the record is inspected, **Then** it shows the document
   version identifier, the timestamp, and the locale the user was shown — and it is retained after the
   documents change.
3. **Given** a material revision, **When** an existing user next opens the app, **Then** they are asked to
   accept the new version, and declining leaves their account readable and exportable but blocks new
   publication.
4. **Given** a user who has never accepted terms, **When** any other user attempts to view or clone their
   recipe, **Then** the recipe is not publicly displayable.
5. **Given** a user about to publish, **When** the publication surface is shown, **Then** what the licence
   permits — including that other users may copy the recipe into their own collections — is stated in plain
   language on that surface, not only in the document.

---

### User Story 2 - Anyone can report content, and we act on it and can prove it (Priority: P1)

A rightsholder, a regulator, or any member of the public can submit a notice about specific content without
holding an account. The notice is acknowledged, triaged, and decided. When content is removed, the person who
posted it is told **why**, in a statement they can read and challenge, and the decision is recorded. Users
whose content is repeatedly removed on valid notices are terminated under a written, consistently applied
policy.

**Why this priority**: This is D24. It is the single largest missing item, and it requires no product decision.
It has one prerequisite this feature cannot meet in software: a **registered designated agent**.

_(amended 2026-11-03, owner ruling, ADR-0082)_ The EU notice route is live from launch day, because an app listed in
EU app stores can be reached from the EU. The designated agent is registered, in the company's legal name, before
launch (`FR-025`).

**Independent Test**: Submit a notice as a signed-out party against a published recipe; verify acknowledgement,
removal, a statement of reasons delivered to the uploader, a working counter-notice path, and an incremented
strike on the uploader's record. Verify the repeat-infringer threshold terminates an account.

**Acceptance Scenarios**:

1. **Given** a signed-out member of the public, **When** they submit a notice identifying specific content and
   the grounds, **Then** it is accepted electronically, acknowledged, and assigned a reference.
2. **Given** an actioned notice, **When** the uploader is notified, **Then** they receive a statement of the
   reason, the legal ground or terms clause relied on, and the means of redress.
3. **Given** an uploader who disputes removal, **When** they submit a counter-notice, **Then** it is recorded
   and routed, and the restoration decision and its date are recorded.
4. **Given** a user who reaches the repeat-infringer threshold, **When** the next valid notice is actioned,
   **Then** their account is terminated under the policy and the decision trail is retained.
5. **Given** any actioned notice, **When** `015`'s reward ledger is inspected, **Then** the grant that
   publication earned has been reversed.

---

### User Story 3 - The rules are readable, in the app, on both platforms (Priority: P2)

A user can find and read the terms, the privacy notice, the community rules, the attribution of any recipe
they are looking at, and the disclaimers that apply to nutrition and allergens — in their own language,
without leaving the app, on web and on mobile, with a screen reader.

**Why this priority**: An agreement nobody can find is weak evidence of agreement, and the information must be
_available_, not merely exist. Readable rules are also a visible sign of trustworthiness.

**Independent Test**: Reach every legal surface from the app on both platforms in a non-English locale, with a
screen reader, and verify each renders the currently effective version and its effective date.

**Acceptance Scenarios**:

1. **Given** any authenticated surface, **When** the user navigates to the legal section, **Then** terms,
   privacy notice, community rules, and licence information are reachable and show effective dates.
2. **Given** a non-English locale, **When** a legal surface is opened, **Then** it renders in that locale or
   states plainly which language version governs.
3. **Given** a recipe with a source, **When** it is displayed anywhere, **Then** its attribution is displayed
   with it.
4. **Given** any nutrition figure or allergen-relevant content, **When** it is displayed, **Then** the
   applicable disclaimer is reachable from that surface.

---

### User Story 4 - A user can exercise the rights the law gives them (Priority: P2)

A user can see what data is held about them, export it in a portable form, withdraw a consent they gave,
and erase their account — from the app, without contacting support, and within a stated time.

**Why this priority**: Erasure already exists (`001-C-007`, `002`, `006`); portability and consent withdrawal
do not, and none of it has a _surface_. This story is the surface and the record, not a re-implementation.

**Independent Test**: From a live account, request an export and receive a machine-readable copy; withdraw the
special-category consent and verify the dependent feature degrades rather than fails; erase the account and
verify the cascade plus the retained legal-basis record for anything lawfully kept.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they request their data, **Then** they receive a machine-readable
   export of the content and account data they contributed, within the stated period.
2. **Given** a user who consented to special-category processing (dietary, health, religious observance),
   **When** they withdraw it, **Then** processing stops, the dependent feature degrades gracefully, and the
   withdrawal is recorded with its timestamp.
3. **Given** an erasure request, **When** it completes, **Then** their content is erased per `001-C-007`, and
   anything lawfully retained is listed with the reason it was retained.
4. **Given** any of the above, **When** the request is made, **Then** the user is told the deadline and is
   notified on completion.

---

### User Story 5 - The system never copies what it cannot show (Priority: P2)

The product declines, by construction, to copy other people's work: it does not copy other
people's photographs onto our storage, it prefers user-supplied bytes over server-side fetching, it records a
per-item attestation with a citation for anything not authored by the uploader, and it never grants a reward
for publishing content the user did not write.

**Why this priority**: These are the controls that make the notice-and-action process meaningful. A pipeline
that copied third-party photographs in bulk would undo it.

**Independent Test**: Import from each channel and verify: no third-party image bytes are persisted to our
storage; the channel used is recorded on the item; an attestation with a citation exists for every non-
`user_created` item; and no reward grant exists for any item whose provenance is not `user_created`.

**Acceptance Scenarios**:

1. **Given** an import that yields a source photograph, **When** the recipe is created, **Then** no copy of
   that image is persisted to our storage; it is displayed by reference to the original host, and the user can
   replace it with their own (C-016-002).
2. **Given** the available import channels, **When** an item is created, **Then** the channel is recorded, and
   any channel classified as server-side reproduction is distinguishable in the record.
3. **Given** content from an external source, **When** it is created, **Then** an attestation and a citation
   exist, per `004-FR-014a`.
4. **Given** a publication of content that is not `user_created`, **When** `015`'s eligibility runs, **Then**
   no benefit is granted.

---

### User Story 6 - Buying and cancelling are honest (Priority: P3)

Before a user is charged, they are told the price, the renewal term, what recurs, and how to stop it — and
stopping it is available in the app, in no more steps than starting it took.

**Why this priority**: `010` currently specifies a subscription with no disclosure or cancellation surface. State
rules and platform rules require both.

**Independent Test**: Complete a purchase and verify each disclosure appears before the charge; cancel from
the app and verify the step count and that access persists to the end of the paid term.

**Acceptance Scenarios**:

1. **Given** a purchase flow, **When** the user reaches the point of charge, **Then** the price, term,
   renewal behaviour and cancellation route have been disclosed in a form the user must pass through.
2. **Given** an active subscription, **When** the user cancels in the app, **Then** it takes no more
   interactions than subscribing did, and the outcome is confirmed in writing.
3. **Given** a purchase made through a platform store, **When** the user cancels, **Then** they are routed to
   the correct store-owned mechanism rather than dead-ended.
4. **Given** a jurisdiction with a statutory withdrawal period, **When** a user in that jurisdiction purchases,
   **Then** the withdrawal right is disclosed.

---

### User Story 7 - AI is disclosed where it must be (Priority: P3)

Where the user is interacting with an AI system, they are told. Where content was generated or materially
altered by AI rather than written by a person, it is labelled to the reader and marked in the content itself.

**Why this priority**: The AI disclosure duty applies from **2 August 2026**, so this is live now, not future
work. It is nearly free for a product whose AI output is labelled anyway.

**Independent Test**: Trigger each AI-facing feature and verify the interaction disclosure; produce
AI-generated recipe content and verify both the human-visible label and the machine-readable marking.

**Acceptance Scenarios**:

1. **Given** a feature where the user interacts directly with an AI system, **When** it is used, **Then** the
   user is informed unless it is obvious from context.
2. **Given** content generated or materially altered by AI, **When** it is stored and when it is displayed,
   **Then** it carries a machine-readable marking and a human-legible label.
3. **Given** an AI-derived field alongside a user-authored one, **When** both are displayed, **Then** the
   distinction is conveyed by more than colour.

---

### User Story 8 - A reviewer can adjudicate without leaving one place (Priority: P2)

An operator opens a queue of notices ordered by age and state, reads the reporter's statement and the target
content, authors a decision with its ground and facts, and sees the statement of reasons go out. From the same
place they can open the uploader's account, see the strike history, and act on the repeat-infringer policy's
recommendation.

**Why this priority**: US2's mechanism can ship and be operated through its API, so this does not block P1. But
every record notice and action depends on is authored _here_, and a decision written under time pressure through a
raw API is where incomplete grounds and missing facts come from. The dashboard is what makes `SC-003`'s
zero-tolerance realistic rather than aspirational.

**Independent Test**: With a queue of notices in mixed states, take one from received to a delivered statement
of reasons entirely within the dashboard; then open the uploader's account and confirm the strike history and
the policy's recommendation are both visible.

**Acceptance Scenarios**:

1. **Given** a reviewer with the review scope, **When** they open the dashboard, **Then** they see every
   notice awaiting action, its age and its state, and nothing that requires a second tool to interpret.
2. **Given** a decision in progress, **When** the reviewer attempts to save it without an action, a ground or
   the facts relied on, **Then** it cannot be saved — an incomplete decision is never persisted.
3. **Given** an actioned decision, **When** the reviewer views it, **Then** the delivery state of the
   statement of reasons is visible per channel, and an undelivered email is visibly outstanding.
4. **Given** an account at the repeat-infringer threshold, **When** the reviewer opens it, **Then** the
   policy's recommendation and the strike history that produced it are both shown, and termination is a
   deliberate act rather than an automatic one.
5. **Given** any evidentiary record — an acceptance, a reporter's statement, a delivered statement of reasons
   — **When** a reviewer views it, **Then** it is read-only and no dashboard path can alter it.
6. **Given** a signed-in user without the review scope, **When** they request any dashboard route, **Then**
   they are refused.

---

### Edge Cases

- **A user declines the new terms.** Their account must not be silently degraded or deleted. They keep read
  and export access; publication and new content creation stop. This is the only humane resolution and it is
  specified (`FR-006`).
- **A notice targets content that has already been deleted, or was never ours.** It must still be
  acknowledged, recorded and closed with a reason. It is never left unanswered.
- **A notice is abusive or automated at volume.** The mechanism must remain available while resisting being
  used as a denial-of-service against a creator. Rate limiting must not become a refusal to receive notices.
- **A takedown lands on a recipe that has been cloned N times.** `001-FR-005` means removal of the original
  does not remove the clones. The notice must be actionable against the derived set, or we have not complied.
- **Erasure collides with the licence.** A user erases their account; their published recipe has clones. The
  clones survive as the cloners' own modified works, de-identified (`GR-014` AC-014-i, `001-FR-005d`).
- **A clone is created and never edited.** It sits private and unpublishable indefinitely. That is the
  designed resting state, not a stuck one, and the surface must say so rather than appearing broken.
- **A recipe becomes non-clonable after clones already exist** — a source restriction is discovered later.
  Existing clones are not retroactively destroyed; the notice-and-action path (`FR-022`) is what reaches them.
- **A user in one market is served content lawful in another.** Markets are gated (C-016-001: US at v1), and
  the gate must be
  evaluated at read time, not only at publish time. _(amended 2026-11-03, ADR-0082)_ An app listed in EU or UK
  app stores serves those markets (`FR-048c`). Open-web pages cannot be gated by market,
  which is why the public-domain gate is one global rule (`FR-015k`).
- **The registered agent registration lapses.** It expires every three years, and a lapse leaves notices
  without a registered agent. This must be an owned, alarmed calendar item, not tribal knowledge.
- **A minor creates an account and publishes.** The age floor must be enforced before the first publication,
  not only at signup, or the floor is decorative.
- **A record reaches 3 years while its dispute is live.** The legal hold (`FR-052c`) suspends the purge, and
  the hold itself is recorded — so "why is this still here" always has an answer.
- **A notice's grounds are reclassified during review.** The final classification sets the tier and the clock
  still runs from acknowledgement (`FR-017b`), so reclassification can shorten a deadline but never extend it.
- **A `privacy` report concerns personal data published about someone.** It sits in the 7-day tier by the
  classification above. Flagged as worth revisiting if such reports turn out to be urgent in practice — it is
  the one ground where the slow lane may be the wrong call.
- **A strike ages out between accrual and the next decision.** The window is evaluated at decision time
  (`FR-020b`), so the account is not terminated. This is the intended behaviour of a rolling window, not a
  miss.
- **A third notice is actioned while an earlier strike is still under counter-notice.** The earlier strike is
  live until reversed, so the threshold is met — and if the counter-notice later succeeds, the strike is
  reversed but the termination it contributed to is not automatically undone. Reinstatement is a deliberate
  operator act, and the trail must show both.
- **A user withdraws special-category consent while a meal plan depends on it.** The plan must degrade, not
  break or silently keep using the data.
- **AI marking on content later edited by a human.** The label must reflect the current state, not the origin
  forever.

## Requirements _(mandatory)_

### Functional Requirements

#### A. Agreements, acceptance and consent

- **FR-001**: The system MUST present the currently effective terms of service and privacy notice before an
  account can be used for any content-creating action, and MUST NOT allow that presentation to be bypassed.
- **FR-002**: The system MUST record each acceptance with the document version identifier, the timestamp, and
  the locale presented, and MUST retain superseded acceptance records for as long as the account exists.
- **FR-003**: Every legal document MUST carry a version identifier and an effective date, and the system MUST
  be able to render any version a given user accepted.
- **FR-004**: The system MUST distinguish **material** revisions (which require re-acceptance) from
  non-material ones (which require notice only), and MUST record which classification was applied to each
  revision.
- **FR-005**: On a material revision, the system MUST prompt every existing account for acceptance at the next
  authenticated session.
- **FR-006**: A user who declines a revision MUST retain read, export and erasure access, and MUST be blocked
  from publishing and from creating new content. Declining MUST NOT delete or suspend the account.
- **FR-007**: The system MUST record consents separately from terms acceptance, one record per purpose, each
  independently withdrawable, and MUST NOT treat terms acceptance as consent for any purpose requiring it.
- **FR-008**: The system MUST enforce a minimum account age and MUST record the basis on which the account
  was determined to meet it. The floor is the higher of the applicable local digital-consent age and 13.
- **FR-009**: The system MUST NOT present a user under the applicable age of digital consent with any
  publication surface. _(Amended, Owner ruling, 2026-11-15.)_ Publishing needs age 16 or over everywhere (`FR-072`).

#### B. The content licence — the right to display, clone and derive

- **FR-010**: Acceptance of the terms MUST grant the operator a **non-exclusive, worldwide, royalty-free,
  sublicensable** licence to host, store, reproduce, adapt for display, and publicly display the user's
  content **for the purpose of operating, securing, improving and promoting the service**. The licence MUST
  NOT be an assignment and MUST NOT be exclusive.
  _(amended 2026-11-03, owner ruling, ADR-0082)_ Two more rules bind this licence and the CC BY grant below.
    - **Drafting standard.** The cook licence and the CC BY grant MUST state each right, its scope, its place and its
      duration, and MUST be fair to a consumer. They are drafted once, to that standard, for every market.
    - **The cook's open licence (CC BY 4.0).** A cook can choose to license a recipe under CC BY 4.0. The cook is the
      licensor, not Commise. The choice is per recipe and opt-in. It is offered only on a label 1 ("Written by you")
      recipe that passed 020's outside-copy check. It is not offered on labels 2 to 7 at v1. It is a separate, clear
      choice at publish: off by default, or asked once with buttons of equal weight. A separate choice covers the
      cook's photos. Only an adult can make it (`FR-008`). The cook warrants that the recipe is their own work. The
      publish screen MUST say that copies others make cannot be recalled, that CC BY lets the cook ask re-users to
      remove their name, and that the grant is "irrevocable as far as the law allows". Public pages carry the licence in
      schema.org `license` ([data-model.md §11](./data-model.md)).
    - **Erasure after CC BY.** Where a cook's name was made public under CC BY and the cook asks for erasure,
      Commise MUST take reasonable steps to tell other controllers, for example a deletion signal on
      any feed.

- **FR-011**: The licence MUST be sufficient to permit the clone chain (`001-FR-005`) — that is, it MUST
  extend to permitting other users to copy published content into their own collections — and this MUST be
  stated in terms a non-lawyer can understand at the point of publication, not only in the document.
- **FR-012**: The system MUST NOT display, syndicate or permit cloning of any protected expression a user
  contributed, unless that user granted the licence. _(amended 2026-11-03, owner ruling, ADR-0082: the earlier text
  said "any content whose author has not granted the licence".)_ A label 7 text (`FR-015k`) can be shown without one. The words,
  headnote and photos of a third party are never licensed by us.
- **FR-012a**: The licence MUST state what happens to copies already distributed when the author deletes the
  content or erases the account, and the product MUST behave the way the licence says. **Derived copies
  survive both** (C-016-003): a clone is a modified work in the cloner's own collection, not a carbon copy of
  the original, and destroying it would take content from a user who did nothing wrong.
- **FR-012b** _(added 2026-10-29, owner ruling, ADR-0077)_: Where a source page states its own licence, for example in
  its schema.org `license` field, the product MUST follow that licence, including its attribution terms. A page whose
  licence allows it, such as some Creative Commons licences, MAY be shown in full. Any other imported web page is shown
  to anyone else only as a Commise-written public version (`FR-077`, Owner ruling, 2026-11-15, which retires the
  linked card). Markup with no stated licence is not a licence.
  _(amended 2026-11-03, owner ruling, ADR-0082)_ A page shown in full under its licence is open to the web, with its
  attribution, only if the licence allows commercial use and the curator recorded the licence or the import detected it in the page's structured data (`FR-073`). The
  import reads only a STATED licence (schema.org `license`, a Creative Commons mark). A surface or document MUST NOT
  say that Commise checks a page's rights.
- **FR-012c** _(added 2026-11-09, owner ruling on 003A Q6)_: The terms MUST state, in words a non-lawyer understands,
  that a comment on a public recipe is public. It is shown with the commenter's display name, and anyone can read it,
  signed-out readers included, on any public page that shows the recipe (`021-FR-070`, `003A-FR-025`). By commenting, the commenter agrees that their name and words are public. The
  licence in `FR-010` covers showing the comment.
- **FR-013**: The terms MUST include a representation that the user has the rights necessary to upload the
  content and to grant the licence, recorded per-account at acceptance.
- **FR-014**: For content classified as **not authored by the uploader**, the per-item attestation of
  `004-FR-014a` — contemporaneous, specific, with a citation — MUST be the controlling instrument. A blanket
  terms-level representation MUST NOT be relied on in its place. _(Amended, Owner ruling, 2026-11-15.)_ When the
  statement is asked, how it is recorded and how long it is kept are `FR-073` to `FR-076`.
- **FR-015**: Any indemnity taken from a consumer MUST be limited to what is proportionate and MUST NOT
  purport to make the user liable for the operator's own acts.

**Cloning and derived copies** — _ratified as governance, not owned here_

C-016-003's ruling is now **`GR-014` AC-014-g/h/i** (Audience and Sharing Model, v3.5.0) and is implemented by
**`001-FR-005a`–`001-FR-005d`**. GR-014's `AC-014-b` prohibits a feature from declaring its own sharing
primitive, so this feature does **not** restate the rules — it carries only the two things that are legal
posture rather than sharing model:

- **FR-015a**: The user content licence (`FR-010`) MUST be sufficient to cover a derived copy that survives
  the author's deletion or erasure, and the licence MUST say so in terms a non-lawyer can read at the point of
  publication. Without that, `GR-014` AC-014-i describes behaviour we have no permission for.
- **FR-015b**: ⛔ The requirement to modify a clone (`GR-014` AC-014-g) MUST NOT be presented, internally or
  externally, as making a copy the cloner's own. A modified copy still contains the original cook's work. Cloning
  rests on `GR-014` AC-014-e's provenance rule and the licence in `FR-010`.

#### B2. Who owns the writing: the rights label _(added 2026-10-29, owner ruling, [ADR-0077](../../docs/architecture/decisions/0077-recipe-rights-label-linked-cards-and-outside-copy-checks.md))_

A recipe has two layers. The **dish** is the ingredient list and the bare steps. Commise treats them as free. The
**writing** is the method in someone's words, the headnote, the tips and the story, and the photos. Those have an owner.
The rights label tells the cook who owns the writing.

- **FR-015c**: Every recipe MUST show the cook one **rights label**, on every surface that shows the recipe to its
  owner, on web and mobile. There are seven labels. This table is the one authority for who owns the writing and for
  what the cook can do under each label. Other specs cite it and do not restate it.

    | #   | Label                                                    | Who owns the writing and photos                                                       | Keep it | Share with the household                       | Publish                                                                                                                                                                      | Export                                         |
    | --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
    | 1   | Written by you                                           | The cook                                                                              | Yes     | Yes                                            | Yes, in full                                                                                                                                                                 | Yes                                            |
    | 2   | Adapted by you from a credited source, in your own words | The cook owns their words. The source keeps its own words and photos                  | Yes     | Yes                                            | Yes, in full, with "Adapted from [source]"                                                                                                                                   | Yes                                            |
    | 3   | Copied from a public web page                            | The page's author                                                                     | Yes     | Yes                                            | Only as a Commise-written public version (`FR-077`), never the page's own words, unless the page is on the copy-outright allowlist (`FR-077`). Never from an aggregator site | Yes, as the cook's own copy                    |
    | 4   | From a cookbook, magazine or paid site                   | The publisher, or the author                                                          | Yes     | Yes, except a paid site's own words (`FR-080`) | Its words and photos, never. A paid-site recipe only as a fully Commise-written page that names no site (`FR-080`). The cook can publish their own version under label 2     | Yes, except a paid site's own words (`FR-080`) |
    | 5   | From a family member or friend, with their permission    | The person who wrote it                                                               | Yes     | Yes                                            | Yes, in full, after 020's check, and open to the web when the giver's permission covers the web (`021-FR-002`)                                                               | Yes                                            |
    | 6   | Cloned from another Commise cook                         | That cook owns their words and photos. The cloner owns only their own changes         | Yes     | Yes                                            | Only after a substantive edit (`001-FR-005b`), always with "Adapted from [cook]"                                                                                             | Yes, inside the cook's own file                |
    | 7   | Public domain                                            | Nobody owns the old text. A new photo, edit or note belongs to the person who made it | Yes     | Yes                                            | Yes, in full, and open to the web, only under the curator grant with a passing `FR-015k` record (`021-FR-006`)                                                               | Yes                                            |
    - _(Amended, Owner ruling, 2026-11-15.)_ Rows 3 and 4 changed. Facts cards and the linked card are retired. A web
      or paid-site recipe goes public only as a Commise-written version (`FR-077`, `FR-080`). Rows 5 and 7 open to the
      web, under their conditions (2026-11-03).
    - Label 3's source type, `imported_public`, means "copied from a publicly reachable page". It is not public
      domain. Public domain text is label 7, and only `FR-015k` makes it so.
    - A verbatim copy from a book, magazine, paid site or other non-public source stays private. The cook can
      publish their own version, in their own words, with credit, under label 2. The method must be rewritten, not
      trimmed (`FR-015b`). Family recipes are the exception and can be public as themselves (label 5).
    - "Keep it" means a private copy. A free cook keeps it within the 50 private slots (ADR-0073), like any private
      recipe. That includes label 3: the owner ruled on 2026-10-29 that any cook can keep a web import private, using a
      slot (ADR-0077 §6, `001` C-004). The cook always sees their own full copy, with the source author's name (`FR-077`). _(Amended, Owner ruling, 2026-11-15.)_ The 2026-11-03 rule that a recipe with a public facts card uses no slot fell with the facts card. Whether a recipe whose public form is a Commise-written version uses a private slot is an open owner question ([Owner decisions](#owner-decisions-required) item 6).
    - "Share with the household" means the cook's household under 017. The household sees a read-only view
      (`017-FR-030d`). For a paid site's own words it sees the Commise-written version if
      one exists, otherwise nothing (`FR-080`, Owner ruling, 2026-11-15).
    - "Export" means the cook's own data export (`FR-034`). It is for the cook's own use. A paid site's own words are
      not exported (`FR-080`, Owner ruling, 2026-11-15; see [Owner decisions](#owner-decisions-required) item 7).
    - A recipe from a social video is label 3. The creator owns the video, its voice-over and its caption.
    - A recipe in review or not approved under 020 keeps its label. The 020 state is a separate fact.
    - _(amended 2026-11-03, owner ruling O16, ADR-0082)_ The owner statement "This is my recipe, from my site or
      account" (`004-FR-014a` statement 1a) gives label 1 on paste, URL and social import. The statement gives the label.
      A site claim does not, and no claim is needed for it. A claim only clears one hit in 020's check (`FR-069`,
      `020-FR-012g`).

- **FR-015d**: The label MUST be **derived**, never stored and never chosen by a surface. One pure Policy works it out,
  a sibling of `provenancePolicy.ts`. Its inputs are the recipe's source type, its statement kind (`004-FR-014a`), its
  `cloned_from_id`, any licence its source page states (`FR-012b`), the curator grant (ADR-0023 §1) and its public-domain record (`FR-015k`, added 2026-11-03,
  ADR-0082). _(amended 2026-11-03, owner ruling O16, ADR-0082)_ The own origin of statement 1a is part of the
  statement kind. A site claim is NOT an input, so a claim that fails never changes a label. Every surface,
  and every rule in another spec that depends on who owns the writing, MUST read that one Policy. `staff-architect`
  designs it at PLANNING.
- **FR-015e**: Commise MUST take a licence and never ownership (`FR-010`, `FR-031`). The cook keeps copyright in what the
  cook wrote. A surface, document or message MUST NOT say that Commise owns a recipe, or that a cook owns writing the label
  says is someone else's.
- **FR-015f**: The cook-facing words MUST say what the cook told us, and what Commise's own rule is. They MUST NOT make a
  claim about rights that Commise has not checked. They MUST NOT use "copyright-free", "royalty-free recipe", "legally yours", "safe to
  publish" or "we checked this". The source check is a filter, not a clearance (020).
- **FR-015g**: These are the draft words, for `staff-ux-engineer` to refine at SPECIFY and to be confirmed before launch (`FR-050`). Each
  gets a localisation key (`FR-049`).

    | #   | On the recipe                                                                            | When the cook publishes                                                                                                                                         |
    | --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | 1   | You told us you wrote this. You keep ownership of what you wrote.                        | You keep ownership of what you wrote.                                                                                                                           |
    | 2   | Your version, adapted from [source]. Your words are yours.                               | Other cooks will see "Adapted from [source]". You keep ownership of what you wrote.                                                                             |
    | 3   | Saved from [site]. The words and photos belong to the page's author. Private to you.     | Anyone will see a version Commise wrote, with a link to [site] and "Not affiliated." The page's own words and photos stay private.                              |
    | 4   | From [book or site]. The words belong to [author or publisher]. Your copy stays private. | From a book: to share your own version, rewrite the method in your own words. From a paid site: anyone will see only a page Commise wrote, which names no site. |
    | 5   | From [giver], shared with their permission. Their words stay theirs.                     | Anyone will see this recipe, on Commise and on the web. Make sure [giver] agreed to sharing it publicly, on Commise and on the web.                             |
    | 6   | Adapted from [cook]'s recipe. Their words stay theirs. Your changes are yours.           | Change the ingredients or steps to make it your version first. Other cooks will see "Adapted from [cook]".                                                      |
    | 7   | Public domain: first published [year], author died [year].                               | Anyone will see this recipe and its source, on Commise and on the web.                                                                                          |
    - _(amended 2026-11-03, owner ruling, ADR-0082)_ Rows 3, 4, 5 and 7 have new words. _(Amended, Owner ruling, 2026-11-15.)_
      Rows 3 and 4 now describe the Commise-written public version (`FR-077`, `FR-080`). Row 5's permission now covers the open web. Naming the giver is
      optional and needs the giver's permission, because a name can be personal data. Row 7 shows the basis the
      `FR-015k` record holds, for example "Public domain: first published 1919, author died 1915". A book with no named
      author shows "Public domain: first published [year], no named author".
    - A family or friend recipe with no credit given says "From a family member or friend".
    - Label 7's words come from the `FR-015k` record. They are true in every market, because that gate is one
      global rule. Commise's own notes on a public-domain page are CC BY-SA 4.0 (`FR-078`). The old text carries the Creative
      Commons Public Domain Mark.

- **FR-015h**: ⛔ "You keep ownership of what you wrote" MUST be shown only for labels 1 and 2. The licence panel
  (`021-FR-040`) MUST show the line for the recipe's own label, never a blanket ownership line. This closes the research's
  gap G2, where every cook publishing a clone or a copy was told "The cook keeps ownership".
- **FR-015i**: A method rewritten by an AI feature is not the cook's own words. It MUST NOT turn a recipe into label 2.
  An AI feature MUST NOT rewrite a source's method for anyone other than the cook who saved it (`005`).
  _(Amended, Owner ruling, 2026-11-15.)_ The first sentence stands. The second sentence is replaced: the import writes a
  Commise version of an imported recipe's instructions for its public form (`FR-077`, spec 003B, public versions of
  imported recipes, planned). That text is Commise's, never the cook's, so it never makes a recipe label 2. The cook's
  own "Adapted by you" version stays a public form too. A cook's opt-in to AI-rewritten steps on their own copy is a
  separate planned feature, spec 027 (Flow Steps).
  _(amended 2026-11-03, owner ruling, ADR-0082 §9)_ **An accepted rewording suggestion.** A
  step from an accepted rewording suggestion (`020-FR-075` to `FR-078`) is "Adapted by you". This fits the first
  sentence. The suggested text is AI text, so it is never the cook's own words, and a recipe that holds an
  accepted suggestion can never show label 1, "Written by you". The cook's acceptance of a fresh restatement of a
  method makes the whole recipe label 2, "Adapted by you". The label stays one derived label per recipe (`FR-015c`,
  `FR-015d`). No step carries a label of its own. The Policy reads "holds an accepted suggestion" as one more input.
  Label 2 stays eligible to be public in full (`021-FR-002`). It is not eligible for CC BY 4.0, because CC BY needs
  label 1 (`021-FR-040a`). Label 2's credit names the source the check matched, where the flag named a page. Where the
  flag named no page the cook can be shown (a private match, `020-FR-047`), the label shows no "Adapted from" line
  _(owner-accepted 2026-11-03)_.
  `FR-015g` row 2 says "Your words are yours", and `FR-015h` shows "You keep ownership of what you wrote". Neither is
  true of the suggested text, so for this case both MUST be replaced by words that do not claim it. The wording is
  OPEN for `staff-ux-engineer` at SPECIFY. This does not reverse the second sentence: the cook asks for
  the suggestion on their own recipe, and Commise publishes nothing for anyone else.
- **FR-015j**: A copy of a private source cannot be detected. A family card, a friend's email or a book that is not
  online has no page to find. For those, the controls are the cook's own statement (`FR-014`), the label, and fast
  takedown (`FR-016` to `FR-022`). The product MUST NOT claim more.
  _(amended 2026-11-03, owner ruling, ADR-0082)_ A copy-check flag MUST hold the
  recipe from publication until a person decides, and a person MUST NOT publish a confirmed copy. The cook cannot
  click past the hold. ADR-0074 already holds a recipe that is not all green. Where a document says an outside hit is
  "never blocking", it means this: the hit does not reject the recipe automatically, and it holds it for a person.
- **FR-015k** _(added 2026-11-03, owner ruling, ADR-0082)_: **The public-domain gate.** This requirement is the one
  authority for when an old text is public domain on Commise. Every other spec, ADR and surface cites it and MUST NOT
  restate its years. It replaces the earlier "open both" ruling, which tested only that the authors died 70 years ago.
  A text opens in full to the web as label 7 only when ALL of these hold. The rule rolls forward each 1 January.
    1. **Published.** The work was first published in or before the current year minus 96 (1930 or earlier, as of
       2026). The test uses the FIRST publication date, never a manuscript date.
       The product MUST NOT infer renewal status for a later work. Those stay closed.
    2. **People.** Every named author, translator and illustrator died in or before the current year minus 81 (1945
       or earlier, as of 2026). A translation carries the translator's own date.
    3. **France.** No author is recorded as "mort pour la France".
    4. **No named person.** For an anonymous, corporate or test-kitchen book, test 1 alone is enough.
    5. **The old text only.** The text comes from the old edition. Modern notes, introductions and a modern edition's
       layout stay out.
    6. **The record.** The curator records, per book, the public-domain record of ADR-0023's curator grant (amended by
       ADR-0082, [data-model.md §10](./data-model.md)). It holds the first publication year and place, each creator
       with their role and death year (or "no named author"), the "mort pour la France" check per creator, the edition
       used, the markets checked, who checked and when, and the rule version it was judged under. Label 7 is derived
       from the grant plus a passing record (`FR-015d`). There is no new source type.

    The open web cannot be gated by market, so the gate is one global rule. The rule table is confirmed once before
    the first public page, and again each year (`FR-050`). The label shows the basis (`FR-015g` row 7).

_Rationale, the owner's ruling in full, and the three blockers it surfaced are in
[Clarifications](#clarifications) C-016-003 and in [Cross-spec amendments](#cross-spec-amendments-this-feature-requires)._

#### B3. Imported recipes, sources, age and the Commise licence _(added 2026-11-15, Owner ruling, 2026-11-15)_

[ADR-0093](../../docs/architecture/decisions/0093-imported-recipes-go-public-only-as-a-commise-written-version.md) records the decision. This section is the one authority for the rules below. Other
specs cite these ids and do not restate them. Import itself is `004`. The rewrite is spec 003B (public versions of
imported recipes, planned). The reviewer check that flags a source and "Report a problem" are `020`.

- **FR-072**: **Age.** A person aged 13 or over may hold an account and use it privately. Publishing needs age 16 or
  over: choosing Public or Both at import, setting a recipe Public, and every other publication surface. The age basis
  is recorded under `FR-008`. A cook under 16 sees no publication surface.
- **FR-073**: **Detected source evidence.** Source evidence the import detects (`004`) is stored on the recipe,
  append-only. The cook cannot edit or clear it, and no control lets them.
- **FR-074**: **The cook's statement.** The cook's own statement of where a recipe is from stays editable. Each change
  is recorded under `FR-076`. How this meets the lock on the source after first publish (ADR-0089 §6) is open
  ([Owner decisions](#owner-decisions-required) item 8).
- **FR-075**: **When we ask.** The app asks "Where is this recipe from?" only when part of the recipe was pasted and the
  cook gave no statement. The choices are: I wrote this; From a web page; From a cookbook or magazine; From another
  person; Keep it private. Every other Public action shows a passive confirmation line instead of a question. Its
  words are `staff-ux-engineer`'s, with a localisation key (`FR-049`).
- **FR-076**: **Attestation records.** Each statement and each confirmation is recorded with the account, the time and
  the version of the wording shown. The record is kept while the recipe is public, plus 6 years. At account erasure,
  the owner id on recipes the cook leaves public under `FR-012a` and on their attestations is replaced with a random
  token that links to no other record.
- **FR-077**: **Public versions of imported recipes.** The decision is ADR-0093. In brief:
    - The private copy keeps the source's wording, with food matching, and shows the source author's name. A recipe
      made in the manual single-recipe editor is never rewritten automatically.
    - At import the cook chooses Private, Public (a Commise-written version) or Both. If the rewrite cannot run, only
      Private is offered.
    - The import rewrites the instructions of every public-facing recipe from a source that is not on the copy-outright
      allowlist, or that `020`'s reviewer check flags. The allowlist is: the cook's own verified site (`FR-067`), an open
      licence stated in the page's structured data (`FR-012b`), public-domain works (`FR-015k`), and US government works.
    - Every public version: the writer sees the facts only, never the source wording. A similarity check runs on every
      save, with a two-way fact and safety check. The cook confirms before it publishes. "Report a problem" hides it
      until staff look (`020`). It uses no source photos and has a descriptive title. AI is disclosed plainly, for
      example "Steps written by Commise with AI, checked by {cook}" (wording to be confirmed, `FR-046`). A free-site
      version names and links the domain, with "Not affiliated."
- **FR-078**: **The Commise licence.** Text Commise writes, including the instructions of a public version, is
  licensed CC BY-SA 4.0 and credited "Commise and contributors". It replaces CC0 for that text. A cook's opt-in CC BY
  4.0 on their own recipe (`FR-010`) and the Public Domain Mark (`FR-015k`) are unchanged.
- **FR-079**: **The source record.** Every public version keeps an internal source record: the source it came from,
  the detected evidence and the cook's statement it was made under, and which allowlist rule or rewrite made it
  public. The record is append-only and is never shown to readers.
- **FR-080**: **Paid sites.** A site is paid when its page data says `isAccessibleForFree` is false, or its domain is
  on the paid list (data, kept by staff), or it has a metered paywall.
    - A paid-site recipe goes public only as a fully Commise-written page that names no site.
    - Where the dish exists in free or independent sources, a consensus recipe is preferred.
    - A paid site's signature recipe is never published from that single source.
    - Publisher opt-outs are honoured (`FR-081`).
    - Paid content is held back from public versions for 6 months (the start of the period is open,
      [Owner decisions](#owner-decisions-required) item 9).
    - Per-publisher caps count only distinctive recipes (`FR-030a`).
    - The cook's private copy keeps the site's wording. That wording is not exported and not shared with the
      household. The household sees the Commise-written version if one exists, otherwise nothing.
- **FR-081**: **Publisher opt-outs.** A publisher opts out through a form, reachable without an account, or by staff
  adding it to the opt-out list. The list is data, with an audit trail. An opt-out leaves every cook's private import
  unaffected, and withdraws every public version from that site.
- **FR-082**: **Takedown and a false statement.** The takedown process stands: a designated agent (`FR-025`, `FR-059`),
  notice and counter-notice (`FR-016` to `FR-019`, `FR-058`, `FR-061`), and the repeat-infringer policy (`FR-020`,
  `FR-021`, `FR-062`). A cook whose source statement is found false meets three steps in order: the recipe is
  removed, then the cook's publishing is restricted, then the account is suspended (ADR-0081). Each step sends a
  statement of reasons (`FR-018`).

#### C. Notice, action, redress and repeat infringement

- **FR-016**: The system MUST provide an electronic notice mechanism, reachable **without an account**, that
  accepts a notice identifying the specific content, the grounds, and the notifier's contact details, and MUST
  issue an acknowledgement with a reference.
- **FR-017**: Notices MUST be processed in a timely, diligent, non-arbitrary and objective manner, and each
  decision MUST record who decided, when, on what ground, and what action was taken.
- **FR-017a**: "Timely" is measurable, and tiered by grounds: a notice on **`copyright` or `illegal_content`
  MUST be decided within 24 hours** of acknowledgement, and every other ground within **7 days**.
- **FR-017b**: The tier MUST be derived from the grounds as **finally classified**, and the clock MUST run
  from **acknowledgement**, never from reclassification. A notice a reporter filed as `other` that turns out
  to be copyright is judged against the 24-hour target from when it arrived, so a misfiling — honest or
  deliberate — can never buy an extension.
- **FR-017c**: A notice past its target MUST be surfaced as overdue and MUST raise an operational alert. An
  unmet target is visible work, not a silent statistic.
- **FR-018**: When content is removed, disabled, demoted or restricted, the system MUST deliver the uploader a
  **statement of reasons** identifying the action, the ground relied on (legal provision or terms clause), the
  facts relied on, whether automated means were used, and the redress available.
  _(amended 2026-11-03, owner ruling, ADR-0082)_ A statement of reasons covers every restriction of visibility, at
  any company size, not only a removal after a notice. So a statement of reasons MUST also go to the cook for each
  restriction that does not start from a notice:
    - a refusal to publish, or a hold, under 020's source check (including "Not approved").
    - a demotion or a visibility limit, for example a recipe left out of discovery.
    - a public version withdrawn because its site opted out (`FR-081`), or a Public choice refused because a cap was
      reached (`FR-030a`).

    Each statement carries an "automated: yes/no" flag. 020's automated hold reads "yes". A person's decision reads
    "no". These statements are recorded in their own record, not in a notice decision ([data-model.md §14](./data-model.md)).

- **FR-018a**: The statement MUST be delivered over **both** channels: by **email**, which is the channel that
  discharges the obligation because it reaches an uploader who never signs in again; and **in-app**, which
  carries the full detail and the route to the counter-notice. Delivery MUST be recorded **per channel**, so a
  statement that was surfaced in-app but never emailed is visibly incomplete rather than silently counted.
- **FR-018b**: A failure to deliver the email MUST NOT be treated as delivery, MUST be retried, and MUST raise
  an operational alert if it remains undelivered. An uploader who cannot be reached is open work,
  not a dropped notification.
- **FR-019**: The system MUST provide a counter-notice path, record it, and record the restoration decision
  and its date. _(amended 2026-11-03, owner ruling, ADR-0082)_ Each restriction that `FR-018` now covers without a
  notice MUST also offer a route to challenge it, and the outcome MUST be recorded with its date.
- **FR-020**: The system MUST maintain a per-account record of actioned notices and MUST terminate an account
  on its **third live strike within a rolling 12 months**, applying the policy to every account without
  exception and retaining the trail. A single threshold, one implementation, no per-case discretion: the policy
  is applied the same way to everyone.
- **FR-020a**: A strike is **live** when it was accrued within the window and has not been reversed. A strike
  reversed by a successful counter-notice MUST NOT count toward the threshold, and MUST NOT be resurrected by
  a later notice.
- **FR-020b**: The window MUST be evaluated at the moment of the decision that would accrue the third strike,
  not on a schedule. A strike that has aged out before that moment does not count, and no background job may
  terminate an account on an anniversary.
- **FR-021**: The repeat-infringer policy MUST be published and users MUST be informed of it; the threshold
  itself MAY remain unpublished.
- **FR-022**: When a notice is actioned against content that has been cloned, the system MUST identify the
  derived copies and make them actionable in the same decision. Removing only the original MUST NOT be
  recorded as compliance.
- **FR-023**: An actioned notice MUST propagate to `015`'s reward ledger, reversing the grant that publication
  earned.
- **FR-024**: The system MUST rate-limit or otherwise resist abuse of the notice mechanism **without** refusing
  to receive notices, and MUST record any notice it declines to process along with the reason.
  _(Amended 2026-11-03, ADR-0082.)_ `FR-066` states how a misuse finding can delay processing without refusing to
  receive.
- **FR-024a** _(added 2026-10-29; replaced, Owner ruling, 2026-11-15)_: Publisher opt-outs are `FR-081`. Commise
  never fetches a recipe page (`004`), so no fetch-time signal is read or logged, and the fetch-signal log is withdrawn
  ([data-model.md §13](./data-model.md)).

- **FR-025**: The operator MUST maintain a registered designated agent and MUST treat its three-yearly renewal
  as a monitored obligation with an owner and an alert, so the registration never lapses.
  _(amended 2026-11-03, owner ruling, ADR-0082)_ The agent is registered in the company's legal name before launch
  (`FR-068`). The repeat-infringer policy MUST be actually applied, not only written.
  _(Amended 2026-11-03, owner ruling O13, ADR-0082.)_ The founder owns the three-year renewal of the registration. The renewal goes on the operations doc's recurring tasks, with an alarm set well before
  the due date. This was an open question and is now decided.
- **FR-026**: `012-FR-022`'s DMCA route MUST be re-pointed at this mechanism rather than duplicating it. There
  MUST be exactly one notice-and-action pipeline in the portfolio.

_The requirements FR-058 to FR-066 below were added 2026-11-03 (owner ruling, ADR-0082) to complete the notice path.
They fill gaps in FR-016 to FR-026 and do not repeat them._

- **FR-058**: **What a notice must contain.** The notice form (`FR-016`) MUST ask for every element both laws name,
  as separate fields, so a notice is complete by construction.
    - A DMCA notice has six elements:
        1. a physical or electronic signature of a person who can act for the owner
        2. the work claimed to be infringed
        3. the material and where it is, with enough to find it (the page address)
        4. the notifier's contact details
        5. a statement of good-faith belief that the use is not authorised
        6. a statement that the notice is accurate and, under penalty of perjury, that the notifier can act for the
           owner
    - A DSA notice needs a reasoned explanation, the exact electronic location, the notifier's
      name and email, and a statement of good-faith belief that it is accurate and complete.
    - A notice that fails some elements but meets the work, the material and the contact details is not
      ignored. We MUST promptly try to contact the notifier, or take other reasonable steps, to get the rest.
    - Each notice gets a confirmation of receipt without undue delay, and a decision notice that names the
      redress. Where automated means helped the decision, the decision says so.
- **FR-059**: **The designated agent page.** A public page, reachable without an account and linked from
  every page footer, MUST name the designated agent: name, postal address, phone number and email. The
  same details MUST be filed in the US Copyright Office's online directory. The filing MUST be renewed every three
  years. The page and the filing MUST match, and `FR-025`'s alert watches the renewal.
  _(Amended 2026-11-03, owner ruling O13, ADR-0082.)_ The founder owns the renewal and records it as a recurring task
  in the operations doc.
    - **Owed by the founder, not by software:** the agent registration in the company's legal name, before
      launch (`FR-068`).
- **FR-060**: **Expeditious removal, with a stated target.** On a valid notice we MUST remove or disable access
  expeditiously. The internal target is `FR-017a`'s 24 hours from
  acknowledgement. "Removed" means every public surface answers not-available within `021-FR-061`'s purge bound. That
  includes clones (`FR-022`), public versions, preview images, the embed widget and the CDN copy. A decision recorded with
  a surface still serving MUST raise an alert.
- **FR-061**: **Counter-notice and restore.** This completes `FR-019`.
    - A counter-notice has four elements:
        1. a signature
        2. the material removed, and where it was
        3. a statement, under penalty of perjury, of good-faith belief that it was removed by mistake or
           misidentification
        4. the person's name, address and phone. It also gives consent to the jurisdiction of the federal district
           court, and to accept service from the notifier. For an address outside the US, the court is any district
           where we can be found.
    - We MUST take reasonable steps to tell the uploader promptly about a removal.
    - On a valid counter-notice we MUST promptly send a copy to the notifier. We MUST tell them we will
      restore in 10 business days.
    - We MUST restore 10 to 14 business days after we receive the counter-notice. The one exception is a
      notice to our agent, first, that the notifier filed a court action.
    - Business days are US federal working days. On arrival of the counter-notice, we compute the restore
      date and store it on the record. A sweep restores on that date, and a missed restore raises an alert.
    - A restore lifts the strike (`FR-020a`) and supersedes the takedown block in 020 (`020-FR-066`).
    - _(amended 2026-11-03, owner ruling O16, ADR-0082)_ **A site claim is evidence, not a defence.** A notice against
      a recipe whose cook held a live claim on its own origin goes through this same path. A valid notice is
      acted on expeditiously whatever the cook's claim says. The reviewer sees the claim and the cook's
      statement. The cook can cite the claim in a counter-notice as evidence of good faith. The restore timing does not
      change.
- **FR-062**: **Repeat infringers: counting and appeal.** This completes `FR-020` and `FR-021`.
    - A strike is one actioned copyright notice against one account. Notices on the same work in one
      decision count once. The threshold is `FR-020`'s third live strike, counted over a rolling 12 months.
    - A termination MUST be open to one appeal, decided by a different reviewer where one is available
      (`020-FR-026a`). The appeal confirms that each strike was live and was a valid notice. It does not reweigh the
      policy. A reversed strike falls out of the count (`FR-020a`).
    - The policy MUST be applied as written to every account. A new sign-up is refused where it matches a terminated account's verified email or
      payment instrument. Only that match key is kept after erasure, under `FR-052a`.
    - A termination carries a statement of reasons.
    - _(added 2026-11-03, owner ruling, ADR-0082 §9)_ **What is and is not a strike.** A cook who rewords
      a recipe that 020 flagged, before any takedown, earns no strike. That covers a reword at import and in review,
      with or without an accepted suggestion (`020-FR-075` to `FR-078`). A flag is not a notice, and nothing was
      removed. An upheld takedown is a strike: a valid notice that led to removal, including a removal on a
      site-owner claim (`FR-067`). It stays a strike unless a counter-notice restores the content (`FR-061`) or an
      appeal reverses it, as `FR-020a` already says.
- **FR-063**: **Which notice duties apply at our size.** Notice and action (`FR-016`) and statements of reasons
  (`FR-018`) apply at every company size. At micro or small size, the online-platform duties do not bind: an internal
  complaint system, out-of-court dispute settlement, trusted flaggers and measures against misuse. We still build
  three of them:

    - the challenge path (`FR-019`)
    - the fast lane (`FR-065`)
    - the misuse rules (`FR-066`)

    When we stop qualifying as small, the online-platform duties bind. Then the challenge path MUST meet the internal
    complaint rules, and each statement of reasons MUST name the certified out-of-court dispute bodies. The size test
    MUST be a dated record on the market posture (`FR-048c`), reviewed each year.

- **FR-064**: **UK complaints.** Users and affected persons MUST be able to report illegal content easily, and to
  complain about content, about a restriction of the user's own content, or about our use of technology. Each
  complaint MUST get a response and an outcome, and the procedure MUST be in the terms. A copyright notice stays in
  the notice path of `FR-016`. The two paths share `FR-016`'s one form. This duty binds at the UK launch. It binds from day
  one where the app store serves the UK (`FR-048c`).
- **FR-065**: **A fast lane for large publishers.** The trusted-flagger duty does not bind at small size (`FR-063`). A
  verified rightsholder with many works can still apply for a fast lane. A fast-lane notice goes to the top of the
  queue. It is judged by the same standard and the same person rules as every notice. It never removes anything
  automatically. The lane is revoked after `FR-066`'s misuse finding. When the trusted-flagger duty binds, a certified
  trusted flagger gets the same lane.
- **FR-066**: **Misuse of the notice process.** This reconciles `FR-024`.
    - The notice form and the counter-notice form MUST warn that a person who knowingly and materially misstates that
      material is unauthorised, or that it was removed by mistake, can be made to pay for the harm it causes.
    - A notifier who often sends manifestly unfounded notices gets a warning
      first. After the warning, we can suspend processing of their notices for a stated period. The same rule covers
      a user who often sends manifestly unfounded counter-notices or challenges. Each step is recorded with its
      reason, and the person can challenge it.
    - We MUST NOT refuse to RECEIVE a complete notice (`FR-058`). A suspension delays processing only, and a
      compliant notice about a new work is still logged and acknowledged. This keeps `FR-024`'s rule.
    - The misuse duty of `FR-063` replaces this rule on the day it binds.

#### D. Reproduction controls — being the host, not the copier

- **FR-027**: The system MUST NOT persist a copy of a third-party photograph obtained during import to
  operator-controlled storage (C-016-002).
- **FR-027a**: An imported recipe MUST display its source photograph by **reference to the original host**.
  When the reference cannot be resolved — moved, blocked, offline — the surface MUST render a defined
  placeholder and MUST NOT render a broken image.
    > **Amended 2026-10-29 (owner ruling, ADR-0077).** The referenced source photograph is shown only to the cook who
    > saved the recipe, and to their household where it is shared. It MUST NOT be shown to any other cook, on a linked
    > card or anywhere else (`021-FR-014a`). Whether a referenced photo is shown at all stays open (`FR-050`).
- **FR-027b**: The user MUST be able to replace a referenced photograph with one of their own from any surface
  the recipe is shown on. A replacement is user content: it is stored by us, covered by the user's licence
  (`FR-010`), and the reference is dropped once it exists.
- **FR-027c**: ⛔ The system MUST NOT produce any **persisted or served derived rendition** of third-party
  media — thumbnail, crop, re-encode, colour sample, cached copy or preview. Referenced images are rendered by
  the client from the original host, at whatever size that host serves. _(Restated 2026-08-22: the prohibition
  is on reproductions that are **kept or shown**, not on every byte that transits memory — see `FR-027f`.)_
- **FR-027d**: A request for a referenced photograph MUST NOT carry account identifiers, credentials, cookies
  or a referrer beyond the bare origin, and the fact that viewing an imported recipe discloses the viewer's
  network address to the source host MUST be stated in the privacy notice.
- **FR-027e**: Referenced photographs MUST be treated as unavailable offline. An offline surface MUST render
  the placeholder; a user-supplied replacement MUST be available offline like any other user content. This is
  a known interaction with offline cook mode and MUST NOT be resolved by caching the referenced image.
- **FR-027f**: **Transient reproduction for extraction is permitted**, and is the basis on which video and
  audio import operate. Decoding a video, sampling frames, running OCR or vision over them, and transcribing
  audio all create reproductions. They are permitted only to **extract facts** (the ingredients, the quantities,
  the steps), never to reproduce the work. Every one of the following
  MUST hold, and the permission lapses if any fails:

    1. The reproduction exists only for the duration of the extraction operation and is **never persisted**.
    2. It is **never served** to any user, in any form, at any size.
    3. Only as much of the work as the extraction requires is sampled — this is sampling, not decode-and-keep.
    4. What is retained is the **extracted result** (text, quantities, steps, confidence), never the frame, the
       still, the audio, or the source media file.

    _(amended 2026-11-03, owner ruling, ADR-0082)_ Whether server-side extraction runs in a market is read from that
    market's posture (`FR-048`). A publisher opt-out is honoured (`FR-081`), and copies made for extraction are kept
    no longer than the extraction needs. _(Owner ruling, 2026-11-15: the import never fetches a page, so the per-market
    URL-import switch of `004-FR-008` is withdrawn. A cook's private copy keeps the source's wording, `FR-077`.)_
    - Commise MUST NOT train or fine-tune any model on imported third-party content. The terms MUST say what Commise
      does with content before it does it.
    - Extraction MUST NOT run face recognition on video frames or photos.

- **FR-027g**: ⛔ An extracted frame or still MUST NOT become the recipe's image. It is the most tempting
  shortcut in the whole import pipeline — a good frame is right there — and taking it converts a permitted
  transient extraction into exactly the persisted third-party copy `FR-027` prohibits. Recipe images follow
  `FR-027a`/`FR-027b`: reference the source, or the user supplies their own.
- **FR-027h**: The **source media file** MUST NOT be retained after extraction completes, whether the
  extraction succeeded or failed. _(amended 2026-11-03, owner ruling, ADR-0082)_ A page image the cook uploaded is
  deleted after extraction unless the cook asks to keep it. A page photo the cook took and chose to keep is
  user-provided content, stored like a replacement photo (`FR-027b`). `FR-027` and `SC-005` cover media our pipeline
  obtains from a third party's host, so a kept page photo does not breach them. Video frames and audio are never kept, and a kept page photo
  in which people appear is kept no longer than the cook keeps the recipe.
- **FR-028**: Every imported item MUST record the **channel** it arrived through, and channels MUST be
  classified as _user-supplied bytes_ or _operator-performed retrieval_, with the classification queryable.
  _(amended 2026-11-03, owner ruling, ADR-0082)_ Stored text MUST keep its source, its credit and any copyright notice.
  The product never strips them.
- **FR-029**: Where more than one channel can satisfy a user's intent, the product MUST prefer a
  user-supplied-bytes channel, and MUST NOT silently upgrade a user-supplied action into an
  operator-performed retrieval.
- **FR-029a**: The operator MUST NOT price, package or gate a paid tier on access to imported third-party
  content. _(amended 2026-11-03, owner ruling,
  ADR-0082)_ The rule is unchanged. _(Amended, Owner ruling, 2026-11-15.)_ The public versions of labels 3 and 4 (`FR-077`,
  `FR-080`) are free to anyone and never sit behind a paid tier. The one exception to "no import upsell" is the
  import dead end, which `010` owns: its main button is "Upgrade to Pro", beside "Compare plans" and an equal-size
  "Not now".

    **Import guardrails** _(owner ruling 2026-10-25, restored 2026-10-27)_. Every import channel is open on every plan
    (`004-FR-028`). A book or paid-site recipe kept private uses one of a free cook's 50 private slots, and Pro removes that limit
    for every private recipe alike ([ADR-0073](../../docs/architecture/decisions/0073-free-tier-private-slots.md)). Whether a recipe with a public Commise-written version uses a slot is open ([Owner decisions](#owner-decisions-required) item 6).
    So that imported content is never the draw:
    1. Pro is never marketed, priced or described in terms of importing. No "import your cookbooks with Pro", no
       import-specific offer, and no Pro benefit that names a source.
    2. When a free cook has no free slot at the moment of an import, the product shows the same out-of-slots message
       it shows for any private recipe. _(Amended, Owner ruling, 2026-11-15.)_ On the import dead end the main button
       is "Upgrade to Pro", with "Compare plans" and an equal-size "Not now" (`010`). This changes that one screen
       only.
    3. No metric, experiment or target measures or optimises Pro conversion from imports.
    4. The slot limit applies identically to every private recipe, whatever its source.

    The "private room" model is retired (`010-FR-041g`). The guardrails do not depend on it.

#### E. Corpus rights and anti-extraction

- **FR-030**: The terms MUST include an anti-extraction provision covering systematic extraction, scraping,
  and re-utilisation of the corpus, drafted as a contractual restriction on parties who accept the terms. The
  provision MUST NOT cover food values the operator holds under an attribution licence (ADR-0052), because such a
  licence forbids adding terms that restrict what others can do with the licensed material (owner ruling, 2026-09-30).
  _(amended 2026-11-03, owner ruling, ADR-0082)_ The provision MUST also carve out everything a Creative Commons
  licence on an open layer allows (`FR-033`), because those licences bar added restrictions. The provision is backed
  by technical controls for visitors who never accepted the terms: rate limits on public reads, bot management at the edge, and no bulk listing of public versions.
- **FR-030a** _(added 2026-10-29; rewritten, Owner ruling, 2026-11-15)_: Public versions from one source are capped.
    - Each source site, book and paid site MUST have a cap on the number of public versions made from it. The cap is
      counted over time, across every public version from that source, never per import
      ([data-model.md §12](./data-model.md)). The numbers are configuration.
    - A per-publisher cap counts only distinctive recipes (`FR-080`). How a recipe is judged distinctive is spec 003B
      work (public versions of imported recipes, planned).
    - What the import offers for a source past its cap is an open owner question. If a Public choice is refused, a
      restriction statement is written (`FR-018`).
    - Whether a user-recipe aggregator site can get a public version is an open owner question (ADR-0093 §8). Until
      it is answered, a cook's import from one stays private, or the cook publishes it in their own words as "Adapted
      by you" (`FR-015b`).
    - A surface MUST NOT list, browse, filter, rank or search public versions by source. A source name links only to
      the source site, never to a Commise list.
    - A book's recipes are never shown in the book's order or as the book's collection.
    - Two cooks' texts are never merged into one.

- **FR-031**: The operator MUST NOT assert, in product surfaces, documentation or marketing, ownership of
  users' recipes, nor any database right it does not hold. Claims about the corpus MUST be limited to the
  compilation and to contractual restrictions.
- **FR-032**: Derived, non-published artefacts — ingredient-resolution mappings, per-field confidence scores,
  dedup keys and ranking signals — MUST be treated as confidential and MUST NOT be exposed through public
  surfaces or exports.
- **FR-033**: The corpus MUST NOT be published under an open content licence, except for the open layers below.
  _(amended 2026-11-03, owner ruling, ADR-0082: the earlier text had no exception.)_ This requirement is the one
  authority for which layers are open.
    - **Open.** Every open page is "free to read". CC BY-SA 4.0, credited "Commise and contributors", applies to text
      Commise itself writes: its own notes, the nutrition text it writes, and the instructions of every Commise-written
      public version (`FR-078`, Owner ruling, 2026-11-15, which replaces CC0).
      CC BY 4.0 applies, opt-in, to a cook's checked label 1 recipe, with the cook as licensor (`FR-010`). The
      Creative Commons Public Domain Mark applies to label 7 text (`FR-015k`).
    - **No open licence on collected facts as a class**, or on ingredient lists on their own.
    - **Closed.** The app, the code, ranking, ingredient-matching mappings and confidence scores (`FR-032`), the food
      catalog (ADR-0052 unchanged), user data, the brand, and 018's paid chef content. Third-party text and photos
      are never licensed by us.
    - **Bulk download.** A cook's bulk download of their own recipes is `FR-034`. _(Amended 2026-11-03, owner ruling O12, ADR-0082.)_ There is NO public bulk download and NO public API of the open
      layers for now. This is decided. A cook's own export stays (`FR-034`). A public bulk download or API of the
      library would need a new ruling. If one is ever built, it carries only the open layers, keeps every credit, and never
      carries third-party text, photos, 018 content or a "by site" slice.

#### F. Data protection surfaces

- **FR-034**: A signed-in user MUST be able to request an export of their content and account data in a
  machine-readable form, from the app, and MUST be told the deadline and notified on completion. The deadline
  MUST be no longer than one month from the request.
  _(amended 2026-11-03, owner ruling, ADR-0082)_ The export is offered from launch. _(Amended 2026-11-03, owner ruling O12, ADR-0082.)_ The personal
  export of a cook's own recipes stays. It is not a public bulk download, and no public bulk route exists for now. It includes the cook's private imported
  copies, which is fine because it goes to that cook. It never includes another cook's private recipe.
- **FR-035**: The system MUST provide a consent-withdrawal surface covering every purpose recorded under
  `FR-007`, and dependent features MUST degrade gracefully rather than fail when a consent is withdrawn.
- **FR-036**: Processing of special-category data — dietary restriction, allergy, health goal, religious
  observance — MUST have an explicit, separately-recorded lawful basis, and MUST NOT be inferred from ordinary
  account use.
- **FR-037**: Where erasure lawfully retains data, the system MUST record what was retained and the reason,
  and MUST surface that to the user on completion.
- **FR-038**: The system MUST NOT make a user's own content accessible to an indefinite number of people **by
  default**; publication MUST be an act the user takes. _(This is the requirement `015` exists to satisfy;
  it is a data-protection rule, not a product preference.)_
- **FR-039**: The operator MUST maintain a current record of processors and international transfers, and the
  privacy notice MUST name the categories of processor including any AI provider.

- **FR-039a** _(added 2026-10-29, owner ruling, ADR-0077)_: The privacy notice MUST say that, for a recipe headed
  public, a few sentences of its method are sent to the web search vendor, once chosen _(amended 2026-11-03, owner ruling, ADR-0082)_ to look for copies (`020-FR-012d`). It MUST
  name the provider, or its category under `FR-039`, and say that no name, account id or other personal data is sent.
  The record of processors under `FR-039` MUST list it. `dpo-1` confirms the wording before the search ships
  (`FR-050`).
- **FR-071** _(added 2026-11-03, owner ruling, ADR-0082 §9)_: **The privacy notice covers linked accounts and the
  commerce record.** The notice MUST state each purpose, its legal basis and its retention. It MUST add three entries:
    1. **A linked social account** (`026-FR-061`, `FR-069`). The data is the platform's account id and the OAuth
       tokens. The purpose is to prove that the cook owns the posts they import. The basis is the contract the cook
       asks for when they link. The data is kept until the cook unlinks or erases the account. The notice
       MUST name the platform as the source of the data and say that tokens are revoked at
       unlink.
    2. **The commerce transaction record** (`018-FR-029l`). The notice MUST list its purposes and the basis for each:
       contract for purchases, subscriptions, downloads and refunds, legal obligation for tax,
       accounting and payouts, and legitimate interest for takedown notices, fraud detection,
       chargebacks, legal holds, audit and aggregated analytics. It MUST say that financial events
       survive erasure under a pseudonymous id, with the link to the person removed. Retention is
       stated per purpose, and the periods are open (`FR-050`).
    3. **Files kept for buyers after a creator leaves** (`018-FR-029i`). The notice MUST say that when a creator
       erases their account, Commise keeps only the files their buyers are owed, for 30 days, on legitimate interest, and then deletes them.
       The record of processing (`FR-039`) MUST list all three. Analytics use follows `023`'s measurement rules and reads
       only aggregated or pseudonymised data. `dpo-1` confirms the wording, including each legitimate-interest
       balancing test (`FR-050`).

#### G. Consumer and subscription disclosures

- **FR-040**: Before any charge, the system MUST disclose price, billing term, what renews, and how to cancel,
  in a surface the user passes through rather than one they may discover.
- **FR-041**: Cancellation MUST be available in-app and MUST NOT require more interactions than subscribing
  did; the outcome MUST be confirmed in writing.
- **FR-042**: Where a purchase was made through a platform store, cancellation MUST route the user to the
  correct store mechanism rather than dead-ending.
- **FR-043**: Where a jurisdiction confers a statutory withdrawal or cooling-off right, it MUST be disclosed
  at purchase.
- **FR-044**: Terms MUST NOT contain provisions that are unfair to a consumer in any market served. The terms do
  not shift onto the user what the operator is responsible for.

    _(2026-10-26.)_ The subscription page that carries `FR-040` to `FR-043` is specified in 010 (`010-FR-042a` to
    `FR-042k`). There are now several paid plans (010's [plan register](../010-subscriptions/spec.md#plan-register)).
    Every disclosure here applies to each plan, and to a plan change as well as a first purchase.

#### H. AI transparency — _governed by `GR-010`_

`GR-010` owns the obligation and
Feature 005 owns the shared disclosure component. These requirements name what the legal surfaces must show;
they do not create a second mechanism.

- **FR-045**: Where a user interacts directly with an AI system, the system MUST inform them unless it is
  obvious from the context (`GR-010` AC-010-a…d).
- **FR-046**: Content generated or materially altered by AI MUST carry a machine-readable marking **at
  generation time** and a human-legible label where displayed, and the label MUST reflect the content's
  **current** state after human editing (`GR-010` AC-010-e). Marking cannot be retrofitted onto
  content already produced, which is why it is a generation-time obligation and not a display concern.
- **FR-047**: AI-derived fields MUST be distinguishable from user-authored ones by more than colour
  (`NFR-004`).

#### I. Per-market posture and governance

- **FR-048**: The system MUST be able to vary publication, discovery and feature availability by the market a
  user is served in, evaluated at read time as well as at publication time. At v1 it is configured to a single
  served market (US), and that configuration MUST be a value, not an assumption baked into the surrounding
  code (C-016-001).
- **FR-048a**: Serving a market the product is not configured for MUST fail closed — an unserved market gets
  no publication and no discovery surface, rather than the US posture applied to a user the US posture does
  not fit.
- **FR-048b**: Every obligation in this specification whose cost is a **seam** rather than a **capability**
  MUST be built to the strictest regime among the target markets at v1, even while only the US is served.
  This binds at minimum: the licence scope and duration (`FR-010`–`FR-015`), the notice-and-action shape
  including the statement of reasons (`FR-016`–`FR-019`), per-purpose consent records (`FR-007`), the recorded
  age basis (`FR-008`), machine-readable AI marking at rest (`FR-046`), and localization (`FR-049`). Each is
  either impossible to retrofit or requires re-prompting the entire existing user base to correct.
- **FR-048c**: Obligations whose cost is a **capability** — an EU representative, a hosting-service point of
  contact, market-specific accessibility conformance statements, per-market document variants — MUST NOT be
  built for a market that is not served, and MUST be recorded as enabling work attached to the market that triggers
  them. _(amended 2026-11-03, owner ruling, ADR-0082: the earlier text said "MUST NOT be built at v1".)_ Each of
  these is a precondition of serving its market. The product MUST NOT serve a market until its list is met.
    - **EU:** an EU representative, a GDPR representative, DSA contact points for authorities and for users, and
      statements of reasons for removal, demotion and visibility limits at any company size (`FR-018`).
    - **UK:** a UK GDPR representative, the Online Safety Act duties (an illegal-content risk assessment, a children's
      access assessment, and age assurance where eating-disorder content can appear), and an unfair-terms review.
    - **Australia:** the under-16 social media self-assessment.
    - **Canada:** notice-and-notice, with records kept for six months.
    - **A store listing is a market.** An app listed in EU or UK app stores serves those markets. So the product MUST
      either restrict its store territories and record that it did, or treat the UK as a day-one market for the light
      duties.
    - _(Amended 2026-11-03, owner ruling O9, ADR-0082.)_ **At launch the app is listed only in US app stores.** That
      is the restriction, and it is recorded here and in `025`. The EU and UK
      lists above MUST be met before the app is listed in any EU or UK store, and `025` gates that listing on them.
      The web site is a separate matter and follows the market posture in `FR-048a`.

- **FR-049**: Every legal surface, document, disclaimer and notice-mechanism string MUST route through the
  localization path and MUST NOT be a hard-coded literal.
- **FR-050**: Before launch, the wording of every document surface, rights label, attestation, notice and
  counter-notice form, and subscription disclosure, and every retention period, MUST be confirmed and recorded as
  confirmed. Until an item is confirmed, the surface it governs does not launch. The confirmation list is kept outside
  this specification.
- **FR-051**: Nutrition figures and allergen-relevant content MUST carry a reachable disclaimer, and the
  product MUST NOT state or imply a medical claim.

#### I2. The reviewer dashboard

- **FR-053a**: The system MUST provide a reviewer dashboard presenting the notice queue with each notice's
  state, age and target, ordered by **time remaining against its `FR-017a` deadline** rather than by raw age —
  a 20-hour-old copyright notice is more urgent than a 3-day-old terms report, and an age-sorted queue would
  hide that.
- **FR-053b**: A decision MUST be authorable in the dashboard, and MUST NOT be persistable without an action,
  a ground and the facts relied on. An incomplete decision is never saved as a draft that could be mistaken
  for a decision.
- **FR-053c**: The dashboard MUST show the per-channel delivery state of every statement of reasons
  (`FR-018a`), and MUST surface an undelivered email as outstanding work rather than a completed action.
- **FR-053d**: The dashboard MUST present an account's strike history and the repeat-infringer policy's
  recommendation together, and termination MUST remain a deliberate operator act — the policy recommends, it
  does not execute.
- **FR-053e**: ⛔ Evidentiary records MUST be **read-only** from the dashboard: an acceptance record, a
  reporter's statement, and a delivered statement of reasons can be viewed and never edited. A record that an
  operator can rewrite is not evidence, and this surface is where that would be easiest.
- **FR-053f**: Every dashboard action MUST be attributed to the individual authenticated operator and
  recorded. Shared or role credentials MUST NOT be able to reach it, because `FR-017` requires knowing **who**
  decided.
- **FR-053g**: The dashboard MUST be gated by a dedicated review scope, distinct from any other administrative
  capability, so reviewing notices does not confer unrelated administrative power.
- **FR-053h** _(added 2026-10-27, owner ruling,
  [ADR-0076](../../docs/architecture/decisions/0076-founder-reviews-at-launch-with-a-paid-backup.md))_: At launch, the
  founder decides notices and 020's referrals. One paid backup reviewer covers the founder. Owner ruling,
  2026-10-27. The rules:
    - **The backup** is a named, part-time, hourly employee of the operator, so `020-FR-026b` holds for referrals. The
      budget is about 4 hours a week at $32.01 an hour, which is about $555 a month. The rate is the BLS 43-4051 median
      wage times a 1.429 employer load. Extra hours are paid at the same rate.
    - **Each reviewer** has their own account with the review scope (`FR-053f`, `FR-053g`), and is trained on the
      written review guideline before the scope is granted.
    - **Scheduled hours.** The backup's regular hours are review on days the founder is off.
    - **Planned absence.** The founder records each planned absence in a rota before it starts. During it, the
      backup is the first reviewer.
    - **Unplanned absence.** A notice still undecided at half its `FR-017a` target MUST page the founder and the
      backup together: at 12 hours for the 24-hour tier, and at 3.5 days for the 7-day tier. If it is still undecided
      2 hours after the page, the backup decides it. This page comes before the deadline. `FR-017c`'s alert comes
      only after it.
    - **Both unavailable.** The notice goes overdue and `FR-017c` alerts. The miss counts toward `FR-053i`. No timer
      publishes or removes anything.
    - The 24-hour and 7-day targets of `FR-017a`, and every other requirement of this spec, are unchanged. Only who
      does the work changes.
- **FR-053i** _(added 2026-10-27, owner ruling, ADR-0076)_: A volume trigger MUST start the hire of the half-time
  reviewer (0.5 FTE, an employee). This FR is the one place the trigger is defined. Any one of these fires the trigger:
    - **Review load** is above 20 hours a week for 4 weeks in a row. A week's review load is the number of items
      decided that week (notices, 020 referrals and appeals) times the median handling minutes per item. At 3
      minutes an item, 20 hours is 400 items a week.
    - **The notice target.** Fewer than 95% of `copyright` and `illegal_content` notices are decided within 24 hours
      over any rolling 4 weeks (`SC-015`).
    - **Backup hours** are above 8 a week, twice the budget, for 4 weeks in a row.
    - **Referral wait.** The median time from a 020 referral to its decision is above 72 hours for 4 weeks in a row.
      This is a staffing signal only. It is not a decision time target, it promises the cook nothing, and
      `020-FR-030` is unchanged.

    The dashboard MUST record the handling minutes of each decision, from the moment a reviewer opens the item to the
    moment the decision is saved. It MUST show each measure every week. When a trigger fires, it MUST raise an
    operational alert to the owner. The owner starts the hire. Until the new reviewer starts, the backup works more
    hours at the hourly rate. The numbers above are a first setting from the 2026-10-27 path-to-success analysis and
    from `SC-015`, not from measured load. Shadow mode (`020-FR-039a`) gives the first forecast of that load.

- **FR-053j** _(added 2026-10-29, owner ruling, ADR-0077)_: Staff review MUST be a **rights check only**. A reviewer
  decides one question: is this someone else's work, shared without the right to share it? A reviewer MUST NOT judge
  quality, taste, style, accuracy or fit, MUST NOT edit a recipe, and MUST NOT feature, rank or promote one. The review
  guideline says so, in writing, where reviewers work. This applies to notices, to 020's referrals and appeals, and to
  any audit sample (`020-FR-032`). The guideline is confirmed before launch (`FR-050`).

#### J. Records and auditability

- **FR-052**: Acceptance records, consent records, attestations, notices, decisions, statements of reasons,
  counter-notices and termination decisions MUST be retained for at least as long as the content or account
  they relate to, and MUST survive the content's deletion where the record is the evidence of a decision.
- **FR-052a**: Records that survive an account's **erasure** MUST be retained for **3 years from the decision
  they evidence**, then purged. They survive erasure only for the period in which a claim about the decision can
  still be brought, and are not kept longer. Three years also outlasts `FR-020`'s 12-month strike window by a wide margin,
  so the repeat-infringer policy stays demonstrable.
    - _(Amended, Owner ruling, 2026-11-15.)_ Attestation records follow `FR-076` instead: while the recipe is
      public, plus 6 years.
- **FR-052b**: A **reporter's name and email** MUST be pseudonymised once the counter-notice window on their
  notice has closed, leaving the notice, its grounds and its decision intact. The reporter is a third party
  who never accepted our terms, nothing requires keeping their contact details past the dispute, and the
  decision record does not need them to remain evidence.
- **FR-052c**: A record under an active dispute, investigation or legal hold MUST NOT be purged on schedule.
  The hold MUST be explicit and recorded — a record kept past its period without a recorded reason is a
  retention defect, not a safety margin.
- **FR-053**: It MUST be possible to answer, for any published item: who published it, under which terms
  version, with what attestation, through which channel, with what provenance, and whether any notice has
  been actioned against it — without reconstructing it from logs.

#### Next batch: a claim flow for site owners, and launch preconditions (FINAL, owner ruling 2026-11-03)

FINAL, owner ruling 2026-11-03. It follows `020-FR-075` to `020-FR-078`.

- **FR-067** _(FINAL, owner ruling 2026-11-03)_: **A claim flow for site owners.** A
  site owner who finds their text or photos in a recipe MUST have a way to ask for removal that is a complete notice
  (`FR-058`). This adds a claim form on top of the notice form (`FR-016`, `FR-058`). It does not replace them.
    - The form asks for every notice element `FR-058` lists. It adds a field for the page the owner says
      is theirs.
    - The owner can also prove the site is theirs with ADR-0078's live-site proof (`020-FR-012g`). The
      proof makes the claim faster to act on. It is not required for a valid notice, because a complete notice MUST be received and acted on without it (`FR-066`).
    - A removal made on a claim follows `FR-060` (every public surface) and sends the cook a statement of reasons
      (`FR-018`).
    - The cook can send a counter-notice (`FR-019`, `FR-061`). The 10 to 14 business-day rule is unchanged.
    - _(amended 2026-11-03, owner ruling O16, ADR-0082)_ **A verified owner can file from their account.** A cook who
      holds a live site claim (`026-FR-001`) can file this claim against copies of their site's recipes elsewhere on
      Commise. The live claim is attached as the ownership proof, and the notice elements are still required. The
      flow can name only content that the claimant can see on a public surface. It MUST NOT search, list or reveal
      another cook's private recipe, and it offers no "find every copy of my site" feature (ADR-0074, `020-FR-047`).
      A claim does not prove authorship of each post (ADR-0078 §3), so a person still decides each notice.
    - **Reword-to-restore.** The cook can instead replace the claimed text with their own words. The new
      text is a new version that passes `020` like any edit, including the suggestions of `020-FR-075`. If it is green
      or cleared by a person, the recipe is restored with the new text and the owner is told. This is not a
      counter-notice and does not wait 10 to 14 business days, because the claimed text is gone.
    - **The strike.** _(resolved 2026-11-03, owner ruling, ADR-0082 §9. Was: "Conflict to settle", for the founder to
      confirm.)_ A removal on a claim is an upheld takedown, so it is a strike (`FR-062`). A
      reword-to-restore after the removal MUST NOT erase that strike, and MUST NOT let the cook restore the old text.
      Only a counter-notice that restores the content (`FR-061`), or an appeal, reverses it. A reword made before any
      takedown, while the recipe is only flagged by 020, is not a strike.
- **FR-068** _(FINAL, owner ruling 2026-11-03)_: **Launch preconditions while the copy check is
  unbuilt.** Until `020`'s copy check at import (`020-FR-075`) is built and on, public launch MUST NOT
  happen unless all of these hold:
    - the DMCA agent is registered and the agent page matches the filing (`FR-025`, `FR-059`)
    - the notice form and the counter-notice form work end to end (`FR-058`, `FR-061`)
    - the repeat-infringer policy is live and its strike counting runs (`FR-020`, `FR-062`)
    - the rest of `020`'s public-door hold is on (`020-FR-057`)
    - `SC-009` has a green record for each item.
- **FR-069** _(added 2026-11-03, owner ruling O16, ADR-0082)_: **"This is my recipe".** A cook can mark that they own the
  recipe, for example when importing from a web page they own, and the review process uses that mark. It builds on ADR-0078 and 026's site claim. It adds no second way to verify.
    - **The statement.** At paste, URL or social import the cook can state "This is my recipe, from my site or
      account" (`004-FR-014a` statement 1a). It is a per-recipe attestation under `FR-014`. It gives label 1, "Written by
      you" (`FR-015c`). The terms make the cook responsible for a false statement (`FR-055`), and `FR-082` sets the steps. A bare
      statement never clears a copy flag, because anyone can claim (`020-FR-012g`).
    - **Verified ownership is 026's live site claim**, and only that (`026-FR-001`). Its proof is a DNS TXT record,
      a meta tag in the home page, or a recipe plugin token. A live claim clears one hit in 020's check: the hit on the
      page the recipe was imported from (ADR-0078 §1).
    - **A linked social account** _(amended 2026-11-03, owner ruling, ADR-0082 §9. Was: "No proof exists for a social
      account yet (`026` OQ-026-S1)", with a code in the account's bio as a candidate.)_ The proof for a social account
      is NOT a code in the bio. The cook links the account to their Commise profile through the platform's own sign-in
      (OAuth), as `026-FR-061` specifies: Instagram, TikTok, YouTube, Pinterest, Facebook and X, where available. A
      linked account proves ownership of that account's posts. An import from a post whose author id, read from the
      platform's official API, matches the linked account id clears the own-post copy match in 020's check. This is the
      social twin of ADR-0078's own-origin hit (`020-FR-012g`). The link asks only for the platform's
      minimal identity scope, chosen at build (the profile id only). Tokens are stored encrypted, used only to re-check
      identity, and revoked at unlink. The link is re-checked on each import and when a token is revoked. Unlinking
      stops clearing new imports. A recipe already public stays public (ADR-0078 §2). A platform with no usable OAuth
      identity API, or with no official way to read a post's author id, is OPEN for that platform. The link and its
      tokens are personal data (see **Erasure** below, and `FR-071`).
    - **What a verified owner's recipe can do**, once 020 allows it. A recipe imported from the owner's verified site,
      with the statement, is label 1. It can be public in full, with its own method text and the owner's own photos,
      and open to the web (`021-FR-002`). A photo still needs its own statement (`026-FR-004`). It can instead be kept
      private and sold, but not both at once (`018-FR-026`, `018-FR-029c`). The cook can offer it under CC BY 4.0
      (`021-FR-040a`). Each of these reads the label and 020's outcome. None reads the claim itself.
    - **The tension, kept in view.** A claim proves control of a site, not authorship of each post (ADR-0078 §3).
      A guest post on the owner's blog passes the claim. So the per-recipe statement carries authorship, and the other
      020 signals and takedown (`FR-016` to `FR-022`) still apply.
    - **Disputes.** A notice against a verified owner's recipe goes through the normal notice and counter-notice flow,
      with the claim as evidence (`FR-061`). A verified owner can file `FR-067`'s site-owner claim against copies of
      their site elsewhere on Commise.
    - **Erasure.** The site claim is personal data tied to the cook. The cook's account erasure
      deletes it (`FR-037`). A decision record that cited it is kept de-identified under `FR-052a` and
      `020-FR-063`. It keeps the claim's opaque id, method and last check time. It drops the claim's domain,
      because a personal blog's domain can name a person. A claim the cook
      removes (`026-FR-009`) is kept in the removed state while the account exists, because a cleared outcome cites it.
      _(amended 2026-11-03, owner ruling, ADR-0082 §9)_ Erasure also deletes every linked social account and its
      tokens, and revokes the tokens with the platform where the platform allows it. A decision record that cited the
      link keeps only the link's opaque id, the platform name and the last check time.
- **FR-070** _(added 2026-11-03, owner ruling, ADR-0082 §9)_: **What every user agrees to about removed downloads.**
  The terms of service (`FR-001`) MUST say three things to every user:
    - Users are told when content they downloaded from Commise is removed for legal reasons (`018-FR-029k`).
    - Users agree to delete content they are told is illegal or infringing.
    - A user who knowingly keeps or uses such content after that notice accepts responsibility for it.
      The clause binds account holders through acceptance (`FR-002`). It is a contract term, not a technical
      control. Commise cannot reach into a device, and the notice does not claim it can. The buyer and seller terms of
      `018-FR-029m` carry the same clause, with the seller's clawback and indemnity. A material revision that adds it
      follows `FR-004` and `FR-005`. The clause MUST pass the consumer fairness rule of `FR-044` and MUST NOT shift to the user what Commise is
      responsible for. The clause wording is confirmed before launch (`FR-050`).

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`; no `any` used outside explicitly marked test
  doubles. (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc documentation. (Principle II)
- **NFR-003**: Every legal surface, consent control and notice form MUST expose an accessible name queryable
  via `getByRole`/`getByLabel`. (Principles IV & VII)
- **NFR-004**: Colour MUST NOT be the sole conveyor of state; an AI label, a consent state and a takedown
  state each require an icon or text label. (Principle VII)
- **NFR-005**: Every surface in this feature MUST ship to web and mobile in the same release. (Principle VIII)
- **NFR-006**: The notice mechanism MUST remain reachable when the authenticated application is degraded; an
  outage of the app MUST NOT be an outage of the ability to receive notices.
- **NFR-007**: Legal documents MUST be readable at the accessibility standard the product already commits to,
  including at increased text size and with a screen reader, in every locale shipped.

#### K. Chef terms: the email list, the site claim, the sponsor line and endorsement disclosure _(added 2026-10-29, [026](../026-chef-spaces/spec.md))_

The wording of every term in this section is confirmed before launch (`FR-050`).

- **FR-054** _(processor terms for a chef's email list, `026-FR-020` to `FR-026`)_: Commise MUST NOT connect a chef's
  email provider until the chef has accepted written processor terms, recorded as an acceptance under `FR-002`. The
  terms MUST cover:
    - **What Commise does.** It connects sign-ups to the chef's own provider (Kit, Mailchimp or Beehiiv at first).
      Each sign-up goes from our server to that provider and nowhere else. No provider script or form loads on the
      page (`026-FR-011`). Commise does not send email for chefs (`026-FR-025`).
    - **The data roles.** The chef is the controller of their list and of every subscriber's address. Commise is the
      chef's processor and acts only on the chef's documented instructions. Commise is the controller of the chef's own
      account data and of the reader's Commise account, which are not part of the list. The terms MUST also say what the
      chef's provider is: the chef's own processor. Whether it is also a sub-processor of Commise for the hand-off is
      confirmed before launch (`FR-050`), and the privacy notice names the provider categories (`FR-039`).
    - **Consent capture.** Each sign-up MUST record the time, the page, the consent text shown and the reader's
      market (`026-FR-022`). The consent text MUST name the chef and say what the chef will send. Signing up MUST be a
      separate act from following (`026-FR-021`) and MUST NOT be a pre-ticked box. Where a market's law needs it, a
      confirmation link in an email must confirm the sign-up before it counts (`026-FR-022`). Commise records the consent. The chef answers for
      what they send afterwards, including the postal address CAN-SPAM needs (`026-FR-026`).
    - **What Commise keeps.** Commise MUST keep only the sign-up record and its consent record, and only so the chef
      can export them and so Commise can show the consent. It MUST NOT use the addresses for itself, share them, or
      add them to any Commise list. The terms say how long Commise keeps them and what happens on disconnect.
    - **The chef's export right.** The chef MUST be able to export every sign-up Commise holds for them, with its
      consent record, as CSV, at any time (`026-FR-024`). On request, or when the chef closes their account, Commise
      MUST delete or return the records, and say so. The terms also cover security, confidentiality, help with a
      subscriber's own rights requests, notice of a breach, and the chef's right to audit by asking for the record of
      processors (`FR-039`).
    - **The reader's side.** The sign-up MUST link to the chef's privacy notice (`026-FR-021`). A reader's request to
      delete their address goes to the chef, and Commise carries out the chef's instruction.
- **FR-055** _(creator terms: the site claim, `026-FR-001`, `FR-002`, `FR-005`)_: The creator terms MUST say:
    - **What a claim asserts.** The chef states that they control the website. It is not a statement that the chef
      wrote any recipe on it. A recipe still needs the chef's own statement at the moment it is brought in
      (`FR-014`, `026-FR-002`). A blanket statement for a whole site MUST NOT replace it.
    - **How it is verified.** By one of three methods: a DNS TXT record, a meta tag in the home page, or a token from
      a recipe plugin the chef runs. A site has at most one live claim. The chef MUST be told which methods exist and
      what each one proves.
    - **How it is rechecked and revoked.** The claim is checked again on a schedule. A claim that fails stops new
      bring-ins, and the chef sees the reason and the fix. It does not remove recipes already brought in. The chef can
      release a claim at any time. Commise can revoke a claim that fails its check, that another party disputes with
      evidence, or that a takedown (`FR-016` to `FR-022`) shows was false.
    - **What a live claim does.** It clears one hit: a match with the recipe's own origin page in the content check
      (`020-FR-012g`, [ADR-0078](../../docs/architecture/decisions/0078-a-live-site-claim-clears-the-own-site-hit.md)).
      It clears nothing else, and it does not change the recipe's rights label.
- **FR-056** _(creator terms: the sponsor line, `026-FR-048`; owner ruling, 2026-10-29, Q7: "Yes, as described")_: The
  creator terms MUST say that a chef may sell one sponsor line per recipe or cookbook, and that:
    - The line is **chef-sold**. Commise does not sell, place or pick sponsors.
    - It is **one line**, labelled "Sponsored by", with text and a logo only. It sits under the method and **never
      above the ingredients**.
    - It uses **no ad network, no tracking and no third-party script** (`026-FR-011`). Commise reads no
      sponsor-linked behaviour about readers.
    - The chef MUST NOT make a claim the sponsor cannot support, and MUST NOT sponsor a nutrition, allergen or medical
      claim (`FR-051`). The sponsor line is paid content under `FR-057`, and the label is the disclosure.
    - Commise can remove a line that breaks these terms or the law, and tells the chef why.
      A page never becomes an ad surface (owner ruling, 2026-10-29).
- **FR-057** _(disclosure for affiliate links and sponsor lines, `026-FR-047`, `FR-048`)_: Every affiliate link
  and every sponsor line a chef adds MUST carry a disclosure of the chef's financial connection. The disclosure MUST be:
    - **Clear and hard to miss.** A disclosure behind a "more" link or in a footer MUST NOT count.
    - **Placed with the link or line itself**, not on an About page or a settings page.
    - **In plain words**, such as "Affiliate link: the chef earns a commission" or "Sponsored by". Vague or
      stand-alone terms such as "sp", "collab" or "thanks" MUST NOT be accepted.
    - **Shown the same way on web and mobile**, at every size and in dark mode (the cross-platform rule,
      `docs/CODING_STANDARDS.md` §14). Commise MUST add the label itself, and the chef MUST NOT be able to remove or
      restyle it. The chef is responsible for the claims they make.
    - Markets outside the US add their own rules, set before those markets open (`FR-043`).

### Key Entities

- **Legal Document**: a versioned artefact (terms, privacy notice, community rules, repeat-infringer policy)
  with an identifier, version, effective date, locale set, and materiality classification per revision.
- **Acceptance Record**: which account accepted which document version, when, in which locale. Immutable;
  superseded records retained.
- **Consent Record**: one per purpose per account, with grant and withdrawal timestamps and the lawful basis.
- **Content Licence Grant**: the derived fact that a given account's content may be displayed and cloned,
  traceable to an Acceptance Record. Not a separate user-facing object.
- **Attestation**: per-item, contemporaneous statement of authorship or right-to-upload, with a citation.
  Owned by `004-FR-014a`; referenced here.
- **Notice**: a report about specific content — reporter contact, target, grounds, timestamps, state.
- **Decision**: the outcome of a Notice — action taken, ground, decider, whether automated means were used.
- **Statement of Reasons**: the communication of a Decision to the affected uploader, and its delivery record.
- **Counter-Notice**: an uploader's challenge to a Decision, and the restoration decision it produced.
- **Infringement Strike**: the per-account tally of actioned notices that drives termination.
- **Provenance Channel**: how an item's bytes reached us, classified user-supplied or operator-retrieved.
- **Market Posture**: the per-market configuration governing publication, discovery and feature availability.
  _(2026-11-03)_ It also holds the market preconditions (`FR-048c`).
- **Public-Domain Record** _(added 2026-11-03, ADR-0082)_: the curator's per-book record behind label 7 (`FR-015k`).
- **Recipe Licence Choice** _(added 2026-11-03, ADR-0082)_: a recipe's licence (`commise` or `cc-by-4.0`), its
  version, and a separate photo licence (`FR-010`).
- **Restriction Statement** _(added 2026-11-03, ADR-0082)_: a statement of reasons for a restriction that did not
  start from a notice (`FR-018`).
- **Source Cap Count** _(added 2026-11-03, ADR-0082; amended, Owner ruling, 2026-11-15)_: the per-source count of
  public versions, over time (`FR-030a`).
- **Source Record** _(added 2026-11-15)_: the internal, append-only, never-shown record of how a public version was
  made (`FR-079`).
- **Source Evidence** _(added 2026-11-15)_: the detected evidence of where a recipe came from, append-only (`FR-073`).
- **Publisher Opt-Out** _(added 2026-11-15)_: a publisher on the opt-out list, with how it was added (`FR-081`).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of accounts that have published content have a retained acceptance record naming the terms
  version in force at the time of each publication. Any published item without one is a defect.
- **SC-002**: A member of the public with no account can submit a notice and receive an acknowledgement in
  under 3 minutes of first arriving at the app, on web and on mobile.
- **SC-003**: 100% of removal actions have a delivered statement of reasons **on both channels** — email
  accepted by the provider and an in-app record present. The count of removals missing either is zero, not
  low.
- **SC-004**: For any published item, the full compliance history — publisher, terms version, attestation,
  channel, provenance, notices — can be produced on demand as one record, in under 5 seconds.
- **SC-005**: Zero third-party photographs, video frames, stills, audio or source media obtained through
  import — and zero persisted renditions of any of them — are present in operator-controlled storage, verified
  by an automated, continuously-run assertion rather than by periodic inspection. A sampled frame that outlives
  its extraction operation is a defect.
- **SC-005a**: Every surface that can display an imported recipe offers the replace-photo affordance, and a
  replaced photograph is available offline. Measured on both platforms.
- **SC-006**: 100% of user-facing legal strings resolve through the localization path in every shipped locale,
  enforced automatically rather than by review.
- **SC-007**: A user can cancel a subscription in no more interactions than it took to start one, measured on
  both platforms.
- **SC-008**: A user can export their data and receive it within the stated period, with a 100% completion
  rate for requests that reach the system.
- **SC-009**: The registered agent's registration never lapses; time-to-expiry is monitored and alerts at
  least 90 days out.
- **SC-010**: 100% of AI-generated content carries both a machine-readable marking and a visible label at
  display time.
- **SC-011**: Zero product surfaces, documents or marketing claims assert ownership of users' recipes or a
  database right the operator does not hold, and the corpus is under no open content licence beyond the open
  layers `FR-033` names (amended 2026-11-03, ADR-0082). The food catalog stays under none (ADR-0052).
- **SC-012**: Zero published clones exist without a substantive edit, and zero clones exist of a recipe whose
  provenance forbids redistribution. Both are defects, not data-quality issues.
- **SC-013**: After an account erasure, no surviving derived copy names the erased user, and 100% of them
  still resolve and remain readable by the user who cloned them.
- **SC-014**: A reviewer can take a notice from the queue to a delivered statement of reasons without leaving
  the dashboard, and zero decisions exist that were saved without an action, a ground or facts.
- **SC-015**: 95% of `copyright` and `illegal_content` notices are decided within 24 hours of acknowledgement,
  and 95% of all others within 7 days. Every breach is visible as overdue rather than discovered later.
- **SC-016**: Zero records persist past their retention period without a recorded legal hold, and zero
  reporter contact details survive a closed counter-notice window.
- **SC-018** _(added 2026-11-15)_: Zero accounts under 16 can make any recipe public, and zero public versions show
  a source's own wording, photos, or (for a paid site) the site's name (`FR-072`, `FR-077`, `FR-080`).
- **SC-019** _(added 2026-11-15)_: 100% of statements and confirmations have a record with the wording version, and
  zero pieces of detected source evidence can be changed or cleared by a cook (`FR-073`, `FR-076`).
- **SC-020** _(added 2026-11-15)_: Within one day of an opt-out, zero public versions from that site are served, and
  every cook's private import from it is unchanged (`FR-081`).
- **SC-017** _(added 2026-10-27)_: Every notice still undecided at half its target pages both reviewers
  (`FR-053h`), and every measure of `FR-053i` is visible on the dashboard each week.

## Assumptions

- **The documents are drafted outside this specification.** This specification defines the surfaces, records and behaviours; it
  does not write the words, and no requirement here depends on particular wording.
- **The operator is a US-formed entity with no EU establishment.** This is the assumption behind `FR-031`. If an EU
  entity is created, `FR-031` is revisited.
- **The service is treated as a hosting service for user content.** Notice and action applies at every company
  size (`FR-063`).
- **D4a and D4b land**: free users may set their own
  recipes private, and imported public content becomes private-to-the-importer by default. D4a landed as a
  ruling on 2026-10-26: a free cook holds up to 50 private recipes (ADR-0073). `FR-038` assumes
  the first; the reproduction controls are materially cheaper under the second.
- **Erasure, provenance, attribution and billing exist.** This feature adds surfaces and records over them and
  owns none of their mechanics.
- **Outbound email is in scope for this feature and does not exist yet.** No notification or email capability
  ships in the tree today — `packages/services/` holds food, food-service, identity, identity-webhooks,
  recipe-service and recipe-workers, and `014-notification-service` is specified but unbuilt. `FR-018a`
  therefore brings a transactional email sender (and its domain/DKIM verification) into this feature's scope.
  When `014` ships it subsumes the channel; the requirement is the channel, not the sender.
- **The dashboard lives in the existing web app, behind the review scope — not in a new workspace.** The plan
  commits to no new workspace, and an operator tool does not justify reversing that.
- **The dashboard is web-only, and this is not a cross-platform violation.** The parity rule governs
  _user-facing_ features; this is operator tooling. Recorded so nobody "fixes" it by building a mobile
  adjudication surface.
- **A human decides notices.** Volume is low; no automated adjudication is specified, and `FR-018`'s
  "whether automated means were used" is therefore expected to read "no" at launch for a notice decision.
  _(amended 2026-11-03, ADR-0082)_ A hold placed by 020's automated source check reads "yes" (`FR-018`).
- **At launch that human is the founder, with a paid backup** (`FR-053h`, owner ruling, 2026-10-27). `FR-053i`'s trigger
  starts the hire of a half-time reviewer.
- **`FR-040` to `FR-043` follow the stricter state and platform rules for subscriptions.** Their status is
  confirmed before launch (`FR-050`).
- **The AI disclosure rules apply from now.** Commise does not rely on any transitional allowance for
  machine-readable marking.
- **Accessibility obligations are already met by the portfolio's own standard.** `NFR-003`/`NFR-004` and the
  constitution already require more than the statutory floor; this feature adds no new accessibility work
  beyond applying it to legal surfaces.

## Out of Scope

- Drafting the legal documents, or any statement of what they should say.
- Choosing an entity structure, forming an EU establishment, or registering trademarks.
- Automated content moderation or classifier-driven takedown.
- Trusted-flagger status, out-of-court dispute settlement bodies, or transparency reporting at
  online-platform scale — these attach above our size and can be added when they bind.
- Patent, trademark and brand enforcement.
- Insurance, outside advisers, or any process that lives outside the product.
- Payment-card and tax compliance (owned by `010` and its processor).

## Cross-spec amendments this feature required — APPLIED

C-016-003 lands on specs other than this one. Each is stated exactly, so the edit is mechanical and nothing
drifts. **All ten were applied on 2026-08-22** — A-9 and A-10 were added _during_ application, when GR-014 and GR-010 turned out to already own ground this feature was restating — see the application record below the table.

| #    | Spec                                                                                                             | Change                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-1  | `001-FR-005`                                                                                                     | Cloning itself now requires a substantive edit before publication, and the Pro gate on making a clone private goes away (it is D4a's to remove). Today the requirement reads that a clone "can only be made private by a premium user AND only after making a substantive edit" — the substantive-edit condition moves from _privacy_ to _publication_. |
| A-2  | `001-FR-005`                                                                                                     | Add: a public recipe is clonable only where its provenance carries no restriction incompatible with redistribution (`001-FR-005a`). Today any authenticated user may clone any public recipe.                                                                                                                                                           |
| A-3  | `001-FR-005`                                                                                                     | Add: a private recipe is copyable only by its owner, and the copy is private (`001-FR-005c`). No cross-user private cloning exists today.                                                                                                                                                                                                               |
| A-4  | `001/data-model.md` §C-004 matrix and `evaluateVisibility(sourceType, isPremium, hasSubstantiveEdit, requested)` | The matrix row "Any user, `imported_public` → `public` only — unless premium AND `has_substantive_edit = true`" must change with A-1. The policy signature may need a provenance-restriction input for A-2.                                                                                                                                             |
| A-5  | `001-FR-002`                                                                                                     | No change, but cite it: the tombstone is what makes a deleted private recipe disappear for the circle it was shared with. That behaviour is load-bearing for C-016-003 and currently incidental.                                                                                                                                                        |
| A-6  | `004`                                                                                                            | `has_substantive_edit` keeps its meaning; only the gate it feeds moves. The shipped-columns table needs no change — record that explicitly so nobody re-adds a column.                                                                                                                                                                                  |
| A-7  | `011`                                                                                                            | No change. The `circle` primitive and `circle` audience scope already provide read-only sharing of a private recipe; C-016-003's rule 5 is satisfied by it plus A-5.                                                                                                                                                                                    |
| A-8  | `015`                                                                                                            | Unaffected in substance, but its assumption that D4a lands is now shared with A-1.                                                                                                                                                                                                                                                                      |
| A-9  | `governance-rules.md` `GR-014`                                                                                   | **AC-014-g/h/i added** (v3.5.0) — the clone model is ratified as governance. GR-014 owns the audience and sharing model and `AC-014-b` forbids a feature declaring its own, so this feature must not restate it. Carries the normative prohibition on citing the modification rule as a copyright defence                                               |
| A-10 | `governance-rules.md` `GR-010`                                                                                   | **AC-010-e/f added** (v3.5.0) — the AI disclosure rule corrected to _applicable since 2 August 2026_, split into interaction disclosure and machine-readable marking, with marking stated as a **generation-time** obligation because it cannot be retrofitted                                                                                          |
| A-11 | `002-user-auth`                                                                                                  | **NOT APPLIED — needs an owner decision in `002`.** Its Out of Scope says "No admin UI for viewing, searching, editing, or bulk-managing users"; `FR-053a`–`FR-053g` introduce exactly such a UI for notice review and account termination. Either `002` narrows the exclusion to _user management_, or this feature's dashboard contradicts it         |

**These are a coherent unit of work and were applied together** — `001-FR-005`, the C-004 matrix, and the
policy function encode the same rule in three places, and amending one would leave the other two lying.

### Application record (2026-08-22)

| Amendment     | Applied to            | Result                                                                                                                                                                                                                                 |
| ------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-1, A-2, A-3 | `001/spec.md`         | `FR-005` rewritten; `FR-005a` (provenance-gated cloneability), `FR-005b` (substantive edit gates publication, Pro gate removed), `FR-005c` (owner-only private copy), `FR-005d` (clones survive deletion; erasure de-identifies) added |
| A-4           | `001/data-model.md`   | C-004 matrix `imported_public` row rewritten; the two `visibilityPolicy.ts` deltas specified in place                                                                                                                                  |
| A-5           | `001/spec.md`         | `FR-002`'s tombstone cited from `FR-005d` — the behaviour is now load-bearing rather than incidental                                                                                                                                   |
| A-6           | `004/spec.md`         | Amendment note: `has_substantive_edit` keeps its meaning and its column; only the gate it feeds moves                                                                                                                                  |
| A-7           | `011/spec.md`         | Note that the `circle` scope is load-bearing for C-016-003, and that copy-on-share would invert the specified behaviour                                                                                                                |
| A-8           | `015/spec.md`         | Cross-reference recording the shared D4a dependency, 016's ownership of the takedown process, and `FR-029a`'s answer to the inducement gap                                                                                             |
| A-9           | `governance-rules.md` | `GR-014` amended to v3.5.0: AC-014-g/h/i added, plus the copyright-defence prohibition                                                                                                                                                 |
| A-10          | `governance-rules.md` | `GR-010` amended to v3.5.0: AC-010-e/f added, AI disclosure applicability corrected to 2 Aug 2026                                                                                                                                      |

⛔ **The code was deliberately NOT changed.** `evaluateVisibility` and `defaultCloneVisibility`
(`recipe-service/src/recipes/domain/visibilityPolicy.ts`) still implement the pre-amendment rule. Both deltas
are specified in `001/data-model.md`, and both are implementation work requiring failing tests first.

### Three blockers surfaced by applying the amendments

1. **`001-FR-005a`'s gap is narrow, not total.** ⚠️ Corrected — the first statement of this blocker was
   wrong. `GR-014` AC-014-e **already** governs sources "marked or licensed against republication … or a
   licence forbidding redistribution **or derivatives**", and expresses it by classifying such a source into a
   private-only `sourceType` at ingestion; a private recipe is then unclonable under AC-014-h. The concept
   exists and has a mechanism. The residual gap is one case: a source that is genuinely public and freely
   available but whose licence forbids **derivatives** specifically — which a modified clone is. That case has
   no `sourceType` behind it today.
2. **`001-FR-005b` collides with `001-FR-003`.** FR-003 still says free-tier users' recipes are always public,
   so "not yet publishable" is unrepresentable for a free-tier user as a `private` visibility. It needs either
   D4a to land or a distinct **unpublished-draft** state that is not `visibility = private`. _Both now exist:
   D4a is decided within 50 private slots (ADR-0073, 2026-10-26), and a clone is created as a draft._
3. **`001-FR-003a`'s PRO-badge derivation is invalidated.** It infers "uses a premium capability" from
   _private AND `user_created`/`imported_public`_. Once a clone can be private without Pro, privacy stops
   implying Pro. FR-003a promises exactly one authoritative derivation, so it is a single-site fix — but it
   MUST land with FR-005b, not after.

## Clarifications

### Session 2026-08-22 — `/speckit-clarify`

- Q: How is the statement of reasons delivered to the uploader? → A: **Both in-app and email** — email
  discharges the obligation, in-app carries the detail and the counter-notice route (`FR-018a`, `FR-018b`,
  `SC-003`). Surfaced that no email capability exists in the tree, so a transactional sender enters this
  feature's scope.

- Q: What surface does the notice reviewer use? → A: **A full admin dashboard** — triage queue, decision
  authoring, account view with strike history and termination. Added as User Story 8 (P2) and `FR-053a`–`FR-053g`,
  with `SC-014`. ⚠️ **This reverses `002`'s recorded exclusion of an admin UI** ("No admin UI for viewing,
  searching, editing, or bulk-managing users… backend/API operations"), which needs a corresponding amendment
  in `002` — recorded below under Cross-spec amendments, not applied here.

- Q: What is the repeat-infringer threshold and window? → A: **Three live strikes in a rolling 12 months**
  (`FR-020`), with a reversed strike never counting (`FR-020a`) and the window evaluated at decision time
  rather than on a schedule (`FR-020b`). Closes Owner decision #2.

- Q: What is the target time from acknowledgement to decision? → A: **24 hours for `copyright` and
  `illegal_content`, 7 days for every other ground** (`FR-017a`), with the clock running from acknowledgement
  regardless of reclassification (`FR-017b`), overdue notices alerting (`FR-017c`), the dashboard queue sorted
  by time-to-deadline rather than age (`FR-053a`), and `SC-015` measuring it.

- Q: How long do legal records that survive account erasure persist? → A: **3 years from the decision**
  (`FR-052a`), the period in which a claim about the decision can be brought; **reporter contact pseudonymised once the counter-notice window closes**
  (`FR-052b`); explicit recorded legal holds suspend the purge (`FR-052c`). Measured by `SC-016`.

### Session 2026-08-22 — RESOLVED by owner

- **C-016-001 — Q1 answered: US-only at v1, and global is the target.** This is deliberately _not_ the same as
  "US-only," and the difference governs `FR-048`–`FR-048c`. A global target makes the other markets a **known**
  requirement, not a presumed one, so YAGNI does not license deferring the boundary — only the capability.
  **Build to the strictest regime wherever the cost is a seam; build nothing for a market we do not serve.**
  The three items that would otherwise be unrecoverable: a licence granted under narrower terms cannot be
  widened without re-prompting every existing user; consent recorded without per-purpose granularity cannot be
  decomposed after the fact; and AI content generated without machine-readable marking can never be marked.

    > **Amended 2026-11-03 (owner ruling, ADR-0082).** The ruling stands, but "US at v1" does not keep the other
    > markets out by itself. An app listed in EU or UK app stores serves them. So either the store territories are
    > restricted and recorded, or the UK is a day-one market for its light duties (`FR-048c`).

- **C-016-002 — Q2 answered: reference the source photograph, and let the user replace it.** No third-party
  image bytes reach our storage (`FR-027`); the image is rendered from the original host, and a one-tap
  replacement converts it into user content we do own (`FR-027b`). Three consequences are accepted rather than
  solved. **(a)** No derived renditions — a thumbnail is a copy, so list views render whatever size the source
  serves (`FR-027c`), which is a real performance cost. **(b)** Referencing discloses the viewer's network
  address to the source host, which is a privacy-notice item, not a bug (`FR-027d`). **(c)** Referenced images
  do not work offline and MUST NOT be cached to make them work, which is a standing conflict with offline cook
  mode that the replace affordance is the intended answer to (`FR-027e`).

    ⚠️ **Amended 2026-08-22 — video was not considered when this was ruled.** C-016-002 reasoned entirely about
    photographs, and `FR-027c`'s original "no derived renditions" wording, read literally, forbade **sampling
    frames from a video** — which would have blocked the video import
    [`017-recime-parity`](../017-recime-parity/spec.md) is built on. Raised by 017, settled here, because it is 016's rule.

    **The line is not photo-versus-video. It is _persisted or served_ versus _transient and extractive_.** A
    thumbnail is prohibited because it is kept, is shown, and stands in for the source. A sampled frame is
    permitted because it is discarded, never shown, and exists only to extract facts.
    `FR-027c` is restated on that axis; `FR-027f`–`FR-027h` carry the guardrails.

    > **Amended 2026-11-03 (owner ruling, ADR-0082).** Whether extraction runs is read per market (`FR-027f`). A
    > `robots.txt` `*` group binds Commise when no group names it.

- **C-016-003 — Q3 answered, and the model replaced the question.** The owner did not pick from the options;
  they changed what a clone _is_. **A clone must be modified, references its source, and is therefore not a
  carbon copy — so clones survive the deletion or erasure of the original.** The full ruling, verified against
  PR 91: cloning requires a modification (`001-FR-005b`); the clone references the original source (already
  shipped — `cloned_from_id` plus retained attribution); deleting the original leaves clones standing
  (`001-FR-005d`); this holds for public and private recipes alike; a private recipe shared read-only and then
  deleted becomes invisible to the people it was shared with (already satisfied by `001-FR-002`'s immediate
  tombstone over 011's `circle` audience scope); a private recipe may be copied **only by its owner** and the
  copy is private (`001-FR-005c`), publishable later only where no restriction applies; a clone of a public recipe
  is public by default and may be made private where no restriction applies; and **a public recipe may be
  cloned only where its source carries no legal restriction** (`001-FR-005a`).

    Two things are recorded as derived rather than stated, and both need confirmation: **(a)** the enforcement
    shape of "modify before you clone" — an unmodified clone exists as a private, unpublishable draft, because
    a thing must exist before it can be edited (`001-FR-005b`); and **(b)** what erasure does to a surviving clone's
    attribution — identity stripped, non-identifying lineage kept (`001-FR-005d`), reasoning that the recipe text is
    generally not personal data while the attribution is.

    ⚠️ **One accepted trade-off.** A clone of a public recipe defaulting to public is the same
    public-by-default pattern `FR-038` and feature `015` exist to remove. It is materially weaker here — the
    content was already public, so what is newly exposed is the _cloner's association_ with it rather than the
    content — but it is not nothing, and it is recorded rather than reopened.

### Session 2026-10-27: who reviews at launch (owner ruling)

- **C-016-004: the founder reviews at launch, a paid backup covers, and a half-time reviewer is hired on a volume
  trigger.** Owner ruling, 2026-10-27. The
  24-hour target stays, and every other requirement stays. Only who does the work, and when, changes. The business
  plan had budgeted a half-time employee reviewer from the first month, at about $2,773 a month. No requirement in
  this spec or in 020 asked for that. They asked only that a person decides, within `FR-017a`'s targets, and that a
  recipe reviewer is an employee (`020-FR-026b`). `FR-053h` says who reviews and how the backup is engaged.
  `FR-053i` defines the trigger. [ADR-0076](../../docs/architecture/decisions/0076-founder-reviews-at-launch-with-a-paid-backup.md)
  records the decision.

### Session 2026-10-29: who owns the writing (owner rulings)

[ADR-0077](../../docs/architecture/decisions/0077-recipe-rights-label-linked-cards-and-outside-copy-checks.md)
records the decision.

- **C-016-005: every recipe shows who owns its writing.** Owner ruling, 2026-10-29: the product
  makes clear what a cook owns and what they do not, for public and private recipes, including a copy of another site's
  recipe, and the automated review checks for unchanged copies. Section B2 adds the seven rights labels
  (`FR-015c` to `FR-015j`). Cooks keep copyright in what they write, and Commise takes a licence, never ownership.
  "The cook keeps ownership" is no longer shown for a clone or a copy (`FR-015h`, `021-FR-040`).
- _(Superseded, Owner ruling, 2026-11-15; see Session 2026-11-15.)_ **C-016-006: a web import is private in full, or public as a linked card.** The owner ruled that a recipe imported
  from someone else's web page has exactly two states. The card's contents and rules are `021-FR-014a` to `FR-014h`.
  This spec adds the legal posture: the page's own licence (`FR-012b`), the per-site opt-out (`FR-024a`), the source
  photo for the saving cook only (`FR-027a`), and the per-site cap with no browse-by-site (`FR-030a`).
- **C-016-007: outside-copy checks for public recipes.** The owner chose "Allow, public recipes only". 020 can now
  compare a recipe headed public with its own import page and search the web for its method sentences
  (`020-FR-012`). This spec adds the privacy notice line (`FR-039a`).
- **C-016-008: staff review is a rights check only** (`FR-053j`).

    > **Amended 2026-11-03 (owner ruling, ADR-0082).** C-016-006's two states stand for the cook's copy. The linked
    > card is now readable signed out, by anyone. _(Further amended 2026-11-03, owner ruling O2, ADR-0082.)_ The
    > `noindex` house rule for facts cards is removed. A facts card is indexable under the public rule, with `Recipe`
    > data built only from our own facts (`021-FR-023`). The per-site cap, the visible credit and the facts-only field
    > list stay.

- **Owed by specs this session does not edit.** 012 owed a way for a cook to prove a site is their own, so a blogger who imports their own posts is not treated as a copier (`020-FR-012g`). 026's site claim now provides it (`FR-055`, [ADR-0078](../../docs/architecture/decisions/0078-a-live-site-claim-clears-the-own-site-hit.md)). 015 still lists D4b, making `imported_public`
  private by default, as open. This ruling settles what a public web import shows to other cooks. The owner then ruled on
  2026-10-29 that any cook can keep one private, using a slot (ADR-0077 §6). 015 is aligned in its own next revision.

### Session 2026-11-03: recipes are an open library (owner rulings)

ADR-0082 records the decision. It amends ADR-0077, ADR-0072, ADR-0023, ADR-0073 and ADR-0052.

- _(Superseded, Owner ruling, 2026-11-15; see Session 2026-11-15.)_ **C-016-009: the facts of any recipe are public and free, signed out, for anyone.** The facts card replaces the
  signed-out source card. _(Amended 2026-11-03, owner ruling O2, ADR-0082.)_ It is indexable under the public rule
  (`021-FR-020`), with the caps, the credit and the facts-only list kept (`FR-015c` row 3, `FR-012`).
- _(Superseded, Owner ruling, 2026-11-15; see Session 2026-11-15.)_ **C-016-009a: a public card uses no private slot, and reading is never paid for** (owner rulings O1 and O5,
  2026-11-03, ADR-0082). A recipe with a public facts card is a public recipe and uses no slot, even when the cook
  keeps the full text privately. A recipe kept private with no card still uses a slot. No Pro plan or other paywall
  applies to reading a PUBLIC recipe or collection. _(Amended 2026-11-03, owner ruling O14, ADR-0082.)_ A creator can
  sell PRIVATE recipes and collections they own (`012-FR-034a`). Only content the creator owns can be sold (`FR-029a`) and every sold recipe passes 020's hold (`020-FR-057`).
- **C-016-010: family recipes and gated public-domain text open to the web** (`FR-015c` rows 5 and 7, `FR-015g`).
  The public-domain gate is `FR-015k`. It replaces the earlier "open both" ruling.
- _(Superseded, Owner ruling, 2026-11-15; see Session 2026-11-15.)_ **C-016-011: open licences on the open layers** (`FR-033`, `FR-010`). CC0 on Commise's own text, CC BY 4.0 opt-in
  for a cook's checked own recipe, the Public Domain Mark on old text. The terms carve them out (`FR-030`).
- _(Superseded, Owner ruling, 2026-11-15; see Session 2026-11-15.)_ **C-016-012: the Commise version is not at launch.** It is a gated pilot ([Owner decisions](#owner-decisions-required)
  item 5, `FR-015i`).
- _(Superseded, Owner ruling, 2026-11-15; see Session 2026-11-15.)_ **C-016-013: book and paid-site recipes get a facts card** under a per-source cap (`FR-015c` row 4, `FR-030a`).
- _(Superseded, Owner ruling, 2026-11-15; see Session 2026-11-15.)_ **C-016-014: URL import is per market.** The EU and UK keep facts and a link only. The US keeps a private full copy
  (`FR-027f`).
- _(Superseded, Owner ruling, 2026-11-15; see Session 2026-11-15.)_ **C-016-015: aggregator sites get no facts cards** (O6, `FR-030a`, `FR-015c` row 3). Their recipes are other users'
  work. A cook's import stays private, or the cook adapts it in their own
  words. This replaced "the tightest cap, or no public cards at all". Decided _(owner rulings 2026-11-03, ADR-0082)_.
- _(Superseded, Owner ruling, 2026-11-15; see Session 2026-11-15.)_ **C-016-016: creator pages list recipes the cook wrote or adapted, never facts cards, and licensed and public domain
  pages are indexable** (O7, O8, `021-FR-015`, `021-FR-014f`, `021-FR-020`). Decided _(owner rulings 2026-11-03, ADR-0082)_.
- **C-016-017: at launch the app is listed only in US app stores** (O9, `FR-048c`, `025-FR-088`). The EU and UK
  duties are met before any listing there. Decided _(owner rulings 2026-11-03, ADR-0082)_.
- **C-016-018: an edited public recipe shows its last approved version while it is checked, and bios and avatars get
  no outside-copy check** (O10, O11, `020-FR-064`, `020-FR-071`). Notice-and-takedown covers bios and
  avatars. Decided _(owner rulings 2026-11-03, ADR-0082)_.
- **C-016-019: no public bulk download and no public API of the open layers for now, and the founder owns the DMCA
  agent renewal** (O12, O13, `FR-033`, `FR-034`, `FR-025`, `FR-059`). A cook's own export stays. The renewal is a
  recurring task in the operations doc. Decided _(owner rulings 2026-11-03, ADR-0082)_.
- **C-016-020: an accepted rewording makes the recipe "Adapted by you", and a reword before any takedown is not a
  strike** (`FR-015i`, `FR-062`, `FR-067`). The label stays one derived label per recipe. An upheld takedown is a
  strike. This answers `FR-067`'s "Conflict to settle". Decided _(owner rulings 2026-11-03, ADR-0082 §9)_.
- **C-016-021: social ownership is proved by linking the account through the platform's own sign-in, never by a code
  in the bio** (`FR-069`, `FR-071`, `026-FR-061`). It answers `026` OQ-026-S1 for the method. Which platforms offer a
  usable identity API and a post's author id stays OPEN per platform. Decided _(owner rulings 2026-11-03, ADR-0082
  §9)_.
- **C-016-022: paid content, refunds and removed downloads** (`FR-070`, `FR-071`, `018-FR-029` to `018-FR-029m`). A
  public recipe involves no payment, so it has no refund. A purchase gives the sold version and a file to keep. A
  subscription gives the creator's current versions. A creator removal gives a 30-day download and no refund. A
  takedown gives a full refund, a clawback from the seller and no download, and every past downloader is told and
  asked to delete. The user agreement says so (`FR-070`). A private bulk-imported recipe is usable at once, and only
  public or sale waits for review (`020-FR-003b`). Decided _(owner rulings 2026-11-03, ADR-0082 §9)_.

### Session 2026-11-15: imported recipes, sources and age (Owner ruling, 2026-11-15)

ADR-0093 records the decision. Section B3 (`FR-072` to `FR-082`) holds the rules. These earlier entries are
replaced, and their text above is history only:

- C-016-006, C-016-009 and C-016-013: facts cards and the linked card are retired. A web or paid-site recipe goes public
  only as a Commise-written version (`FR-077`, `FR-080`).
- C-016-009a: the rule that a public card uses no slot fell with the card. Whether a public version uses a slot is open
  (Owner decisions item 6). The no-paywall-on-reading rule stands.
- C-016-011: Commise's own text is CC BY-SA 4.0, not CC0 (`FR-078`).
- C-016-012: the Commise version is no longer a gated pilot. It is the public form of an imported recipe.
- C-016-014: the import never fetches a page (`004`). The private copy keeps the source's wording (`FR-077`).
- C-016-015: whether aggregator sites can get a public version is open (`FR-030a`).
- C-016-016: creator pages list recipes the cook wrote or adapted.

### Session 2026-11-09: comments on public recipes are public (owner ruling)

- **Ruling.** Feature 003A asked whether comments show on signed-out public pages. Owner ruling, 2026-11-09: by commenting, a
  commenter agrees that their name and words are public, and the terms say so. `FR-012c` puts it in the terms. `021-FR-070` and `003A-FR-025` show the
  comments with the commenter's display name.

## Owner decisions required

All three clarifications are resolved (C-016-001 … C-016-003). These remain open, and change the work without blocking the spec:

1. **Do we create an EU establishment to hold a database right?** It carries tax, data-protection and corporate
   consequences far outside this feature. Recommendation: **no, not for this reason alone**. _(amended 2026-11-03,
   ADR-0082)_ The terms bind account holders, and technical controls cover the rest (`FR-030`).
2. ~~**Repeat-infringer threshold.**~~ **RESOLVED 2026-08-22** — three live strikes in a rolling 12 months
   (`FR-020`).
3. **Do we publish transparency numbers voluntarily?** It is cheap, and it commits us to keeping the numbers clean.
4. **Registered-agent renewal.** _(Decided 2026-11-03, owner ruling O13, ADR-0082.)_ The founder owns the renewal every
   three years, as a recurring task in the operations doc. The first registration is also still
   owed by the founder (`FR-025`).
5. **The Commise version pilot.** _(Withdrawn, Owner ruling, 2026-11-15.)_ The Commise-written version is now the
   public form of an imported recipe (`FR-077`, ADR-0093), not a gated pilot.
6. **Slots and public versions.** Does a recipe whose public form is a Commise-written version use one of a free cook's
   private slots? The 2026-11-03 "a public card uses no slot" rule fell with the facts card. OPEN.
7. **Export of a paid site's wording.** `FR-080` says a paid site's wording is not exported. `FR-034` gives the cook an
   export of their content. Is the site's wording left out of that export, or is `FR-034` the exception? OPEN.
8. **The statement after first publish.** `FR-074` keeps the cook's statement editable. ADR-0089 §6 locks the source
   after the first publish. Which wins, and does an edit after publish withdraw or re-check the public version? OPEN.
9. **The 6-month hold on paid content.** Does the 6 months start at the recipe's own publication on the site, at the
   cook's import, or at the first import of that recipe by any cook? OPEN.

---

## Status: READY for `/speckit-plan`

All three clarifications are resolved, all ten cross-spec amendments are applied, and the one conflict another
feature raised against this one is settled. Nothing here blocks planning.

**Carried forward — four items, none blocking:**

1. **Two derived decisions await owner confirmation.** `001-FR-005b`'s enforcement shape (an unmodified clone
   is a private, unpublishable draft) and `001-FR-005d`'s erasure behaviour (identity stripped, non-identifying
   lineage kept). Both are flagged in place and in C-016-003, and both now live in `GR-014` AC-014-g/i —
   outside this feature.
2. **The amendments A-1 … A-10 are applied — documents only.** `evaluateVisibility` and
   `defaultCloneVisibility` still implement the pre-amendment rule by design; both code deltas are specified in
   `001/data-model.md` and are implementation work requiring failing tests first.
3. **Two blockers remain in `001`, and they are `001`'s to clear, not this feature's.** `001-FR-005b` is
   unrepresentable for a free-tier user while `001-FR-003` says free-tier recipes are always public — it needs
   D4a or an unpublished-draft state distinct from `visibility = private`; and `001-FR-003a`'s PRO-badge
   derivation infers Pro from privacy and must be fixed in the **same** change. _Since 2026-10-26 001
   carries both answers: FR-003 holds up to 50 free private recipes, and FR-003a marks only private
   `imported_public` (ADR-0073)._ _(A third — "no
   provenance-restriction signal exists" — was withdrawn: `GR-014` AC-014-e already covers it. The residual is
   one narrow case, a public and freely-available source whose licence forbids **derivatives** specifically.)_
4. **`017-recime-parity` is unblocked.** Its video wedge conflicted with `FR-027c`'s original wording;
   `FR-027f`–`FR-027h` resolve it on the persisted-or-served versus transient-and-extractive line.

**Two prerequisites live outside software and no requirement here can satisfy them**: a registered designated
agent (`FR-025`) and the drafted documents. `FR-050` requires each item to be confirmed before launch.

**105 functional requirements · 7 non-functional · 17 success criteria · 8 user stories · 0 clarification markers.**
_(2026-11-03: `FR-015k` added, ADR-0082. The earlier figure of 85 was stale before that. A grep over the bold `FR-`
IDs counts 105.)_ _(The founder still owes the agent registration.)_
