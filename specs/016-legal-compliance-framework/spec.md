# Feature Specification: Legal Compliance Framework

**Feature Branch**: `016-legal-compliance-framework`
**Created**: 2026-08-22
**Status**: Draft
**Input**: User description: "create a feature for the legal coverage, protections, considerations, guidelines and rules and regulations within the apps, the TOS, etc. based on the context found during the initial research. One thing to research is if we can own public data without copyrighting or running into other legal issue or fines or violations - a license of sorts."

## Dependencies

| Spec                                                          | Relationship                                                                                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md)   | **Required** — owns recipe visibility (`FR-003`), public read (`FR-004`), the clone chain (`FR-005`), soft-delete/erasure (`C-007`) and the C-004 policy                       |
| [002-user-auth](../002-user-auth/spec.md)                     | **Required** — owns account creation, the only moment an agreement can be presented, and the erasure cascade. **Has no terms-acceptance, consent or age surface today**        |
| [004-recipe-importing](../004-recipe-importing/spec.md)       | **Required** — owns provenance (`FR-011`), attribution (`FR-010`), per-item attestation (`FR-014a`), photo extraction (`FR-008`), robots handling (`FR-023`)                   |
| [010-subscriptions](../010-subscriptions/spec.md)             | **Required** — owns the tier model and billing. **Has no auto-renewal disclosure or cancellation surface today**                                                               |
| [011-recipe-digitization](../011-recipe-digitization/spec.md) | **Referenced** — owns digitization provenance and its mandatory attribution (`FR-021b`)                                                                                        |
| [012-creator-profiles](../012-creator-profiles/spec.md)       | **Referenced** — currently the ONLY spec containing a DMCA route (`FR-022`). This feature takes ownership of takedown portfolio-wide; 012 becomes a consumer                   |
| [015-publishing-rewards](../015-publishing-rewards/spec.md)   | **Referenced** — its inducement hazard is a direct input here; 015's `FR-016`–`FR-018` consume the takedown process this feature specifies                                     |
| [005-ai-integration](../005-ai-integration/spec.md)           | **Referenced** — owns AI features **and the shared disclosure component**. `GR-010` owns the obligation; this feature contributes Art. 50(2) marking and cites both            |
| [017-recime-parity](../017-recime-parity/spec.md)             | **Downstream** — its video-import wedge depends on `FR-027f`'s transient-extraction permission. 017 blocked on this feature and it is resolved (C-016-002, amended 2026-08-22) |
| `GR-014` Audience and Sharing Model                           | **Governs** — owns cloning, derived copies, deletion and erasure (AC-014-e/g/h/i), amended to v3.5.0 from C-016-003. This feature cites it and MUST NOT restate it             |
| `GR-010` EU AI Act Compliance Propagation                     | **Governs** — owns the AI disclosure obligation (AC-010-a…f), amended to v3.5.0 from this feature. Group H cites it                                                            |
| `GR-003` FR Identifier Namespace                              | **Governs** — every cross-feature citation here is qualified `{feature}-FR-{NNN}`, and `cross-feature-FR-index.md` carries this feature's rows                                 |
| [009-nutrition-planning](../009-nutrition-planning/spec.md)   | **Referenced** — already flags GDPR Article 9 special-category data; this feature owns the lawful-basis surface for it                                                         |

---

## Why this feature exists

The ReciMe competitive review (2026-08-21) and the legal analysis that followed it established that **the
portfolio has no legal layer at all**. Not a thin one — an absent one:

- **There is no content licence.** Nothing anywhere gives us the right to display a user's recipe, let alone
  to let another user clone it (`001-FR-005`). Every public-corpus feature in the portfolio is built on a
  permission we never asked for.
- **There is no notice-and-action mechanism for the main recipe corpus.** DMCA appears in exactly one spec
  (`012-FR-022`) and only for creator profiles. There is no registered agent, no repeat-infringer policy, and
  no EU notice mechanism.
- **There is no terms acceptance, no consent record, and no age floor.** `002` creates accounts without any
  of them.
- **There is no auto-renewal disclosure or cancellation surface.** `010` sells subscriptions without them.

Each of those is cheap to fix and expensive to have missing. Together they are the difference between
operating a user-content platform with the standard protections and operating one without them.

### The four findings this specification is designed around

**1. Privacy does the heavy lifting; attribution is the second line — and neither is a licence.**
Making content private removes the act (communication to the public) that creates most exposure. Attribution
removes an entire independent category of claim in droit d'auteur systems — moral rights are a separate right
from the economic one, and failing to attribute is its own infringement — which is precisely where our other
defences are weakest. But **attribution is not a defence to reproduction**, and neither privacy nor attribution
gives us the right to display a user's own recipe. Only a licence from the user does that.

**2. A contract binds its parties, and the rightsholder is not one of them.**
No term we write can shift third-party liability to a user, because the third party never agreed to it. Terms
do real work — the licence grant, representations, a proportionate indemnity, and the notice-and-takedown
terms that are a _precondition_ of safe harbour — but they are hygiene, not protection. The protection comes
from safe harbour, from being the host rather than the copier, and from responding fast.

**3. Where the bytes come from decides whether we are a host or a copier.**
§512(c) protects storage "at the direction of a user." Paste (`004-FR-052`) is safest — the user brings the
bytes. Share-sheet capture is strong. **Server-side URL fetch (`004-FR-008`) is the weak one**: our server
performs the reproduction, which makes us a direct actor rather than an intermediary. This is an architecture
consequence, not a paperwork one, and the safest channels are ones we have already specified.

**4. A reward for publishing is an inducement to publish.**
`015` turns on this. It also moves §512(c)(1)(B)'s "direct financial benefit … right and ability to control"
prong from theoretical to arguable, which is an independent reason not to monetise tightly around imported
content.

### ⛔ What this feature is NOT

- **It is not legal advice, and it does not draft the documents.** Every document surface here is specified as
  _a versioned artefact the product must present, record acceptance of, and act consistently with_. The words
  in it are a lawyer's work product, and the requirements below are written so that they are testable without
  knowing those words.
- **It is not a re-implementation of erasure, provenance, attribution or billing.** Those exist. This feature
  specifies the legal _surfaces_, _records_ and _guardrails_ over them, and names the one place each is owned.
- **It is not a per-market legal opinion.** It specifies the machinery to apply a per-market posture. Which
  markets we serve, and therefore which regimes bind, is an owner decision — answered in C-016-001: **US at
  v1, global as the stated target.**

---

## Research: can we "own" the public corpus without copyrighting it?

This was the explicit research ask. **Short answer: we can never own the recipes, we can own the compilation
thinly, we probably cannot claim the one right that would actually protect the corpus, and the enforceable
fence is contractual, not proprietary.** Five layers, weakest claim to strongest:

### Layer 1 — The recipes themselves: never ours, and we do not want them to be

Authorship stays with the author. What we need is not ownership but a **licence** — non-exclusive, worldwide,
royalty-free, sublicensable (the clone chain requires sublicensing), and scoped to operating, displaying and
promoting the service. This is `FR-010`–`FR-015` below and it is the single most important item in the
feature. Taking _ownership_ (an assignment) or an exclusive licence would be worse than useless: it is the
term consumer-protection regimes treat as unfair, and it makes us the party with the "right and ability to
control" in a §512 analysis.

### Layer 2 — Compilation copyright (US): available, thin, ours

17 U.S.C. §103 protects a compilation's original **selection, coordination and arrangement** — not the
underlying facts. _Feist v. Rural Telephone_ (1991) killed sweat-of-the-brow and set the bar at a "modicum of
creative spark," which an alphabetical listing fails. Our curation, categorisation, tagging and ranking
plausibly clear it. **What this protects is our arrangement, not any recipe in it** — a competitor who
re-collected the same recipes independently infringes nothing.

### Layer 3 — EU sui generis database right: the right we want, and probably cannot have

Directive 96/9/EC Art. 7 gives the _maker_ of a database a right to prevent extraction and re-utilisation of a
substantial part, **regardless of whether the contents are copyrightable at all**, where there is substantial
investment in **obtaining, verifying or presenting** the contents. Term is 15 years (Art. 10), and a
substantial change qualifies the resulting database for **its own new term** — effectively perpetual for a
maintained corpus.

Two things decide whether it is available to us, and they cut in opposite directions:

- **The investment test favours us.** _BHB v William Hill_ (C-203/02) holds that investment in **creating**
  data does not count — only obtaining, verifying or presenting **existing** data. Our users create the
  recipes; **we** obtain, deduplicate, resolve ingredients against USDA, verify, normalise and present them.
  That is the qualifying kind of investment, and it is exactly what our pipeline spends money on.
- **⛔ The eligibility test probably excludes us.** Art. 11 restricts the right to nationals or habitual
  residents of a Member State and to companies formed under Member State law with a registered office, central
  administration or principal place of business in the Community. **Third-country makers fall outside
  automatic protection**, and no extension has been made for the US. A US-formed company most likely **cannot
  claim the EU database right at all** — it would require an EU establishment as the maker. The UK operates a
  parallel, separately-scoped right post-Brexit.

The EU Data Act (Reg. (EU) 2023/2854) Art. 43 disapplies the sui generis right only to data obtained from or
generated by connected products — **it does not affect us.**

**Consequence for the spec**: we must not build any protection strategy that assumes the database right, and
we must not tell anyone we hold one. Whether to create an EU establishment in order to hold it is a business
decision listed under Owner Decisions, not a requirement.

### Layer 4 — Contract: the fence that actually holds

_hiQ v LinkedIn_ (9th Cir. 2022), following _Van Buren_ (2021), holds the CFAA does **not** reach scraping of
publicly available data — violating terms alone is not "without authorization." **But LinkedIn won on breach
of contract**, and the case ended in a permanent injunction requiring hiQ to stop and to delete what it had
taken. The lesson is precise: **against a scraper, our terms are the cause of action and the CFAA is not.**
That makes the anti-extraction term in the ToS a real asset — and it makes it worth writing carefully, because
it only binds parties who accepted it (`FR-030`–`FR-032`).

### Layer 5 — Trade secret: for the layer nobody sees

The derived layers — ingredient-resolution mappings, per-field confidence scores, dedup keys, ranking signals
— are not published, have independent economic value, and can be protected as trade secrets if we treat them
as such. This is nearly free and it protects the part of the corpus that is genuinely ours.

### What we will NOT do

**Publish the corpus under an open licence (CC BY-SA or similar).** It is the obvious-looking answer to "own
public data" and it is backwards: it would license the corpus to our competitors in perpetuity, and it cannot
be revoked. The corpus is a strategic asset (`docs/competitive/02GapAnalysisAndStrategy.md` §0); we license
_in_, not _out_.

> **Verification note.** Layers 2–5 were verified against primary and secondary sources on 2026-08-22 and are
> cited above. The findings carried forward from the 2026-08-21 analysis — _Publications Int'l v. Meredith_
> (7th Cir. 1996) and 37 CFR §202.1(a) on recipes, Berne Art. 6bis and Australia's Copyright Act Part IX on
> moral rights, DSM Directive Art. 4's machine-readable TDM reservation, and the EU's closed list of
> exceptions — were **reasoned from, not re-verified today**. None of this is legal advice; the load-bearing
> items are listed for counsel in `FR-050`.

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

**Why this priority**: This is D24. It is the single largest missing item, it requires no product decision,
and its absence is what disqualifies us from DMCA §512 safe harbour and breaches DSA Art. 16 simultaneously.
It also has a hard prerequisite this feature cannot satisfy in software: a **registered agent**.

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

**Why this priority**: An agreement nobody can find is weak evidence of agreement, and several regimes require
the information to be _available_, not merely to exist. It is also the cheapest way to convert the legal layer
from a liability into visible trustworthiness against a competitor whose own terms contradict their marketing.

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

### User Story 5 - The system does not create exposure it cannot defend (Priority: P2)

The product declines, by construction, to do the things that generate liability: it does not copy other
people's photographs onto our storage, it prefers user-supplied bytes over server-side fetching, it records a
per-item attestation with a citation for anything not authored by the uploader, and it never grants a reward
for publishing content the user did not write.

**Why this priority**: These are the controls that make the paperwork credible. A registered agent plus a
pipeline that mass-copies third-party photographs is a worse position than no agent at all, because the
provenance data proves we knew.

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

**Why this priority**: `010` currently specifies a subscription with no disclosure or cancellation surface. The
federal US rule that would have mandated this was vacated, but the state regimes and platform rules were not,
and this is the kind of gap that turns into a regulator's example.

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

**Why this priority**: EU AI Act Art. 50 became applicable on **2 August 2026** — three weeks before this spec
was written. Its exposure is bounded and it is nearly free to satisfy for a product whose AI output is
labelled anyway, but it is live now, not future work.

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
every record safe harbour depends on is authored _here_, and a decision written under time pressure through a
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
  acknowledged, recorded and closed with a reason — silence is the failure mode regulators look for.
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
  evaluated at read time, not only at publish time.
- **The registered agent registration lapses.** It expires every three years and a lapse is a lapse in safe
  harbour. This must be an owned, alarmed calendar item, not tribal knowledge.
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
  publication surface.

#### B. The content licence — the right to display, clone and derive

- **FR-010**: Acceptance of the terms MUST grant the operator a **non-exclusive, worldwide, royalty-free,
  sublicensable** licence to host, store, reproduce, adapt for display, and publicly display the user's
  content **for the purpose of operating, securing, improving and promoting the service**. The licence MUST
  NOT be an assignment and MUST NOT be exclusive.
- **FR-011**: The licence MUST be sufficient to permit the clone chain (`001-FR-005`) — that is, it MUST
  extend to permitting other users to copy published content into their own collections — and this MUST be
  stated in terms a non-lawyer can understand at the point of publication, not only in the document.
- **FR-012**: The system MUST NOT display, syndicate or permit cloning of any content whose author has not
  granted the licence.
- **FR-012a**: The licence MUST state what happens to copies already distributed when the author deletes the
  content or erases the account, and the product MUST behave the way the licence says. **Derived copies
  survive both** (C-016-003): a clone is a modified work in the cloner's own collection, not a carbon copy of
  the original, and destroying it would take content from a user who did nothing wrong.
- **FR-012b** _(added 2026-10-29, owner ruling, ADR-0077)_: Where a source page states its own licence, for example in
  its schema.org `license` field, the product MUST follow that licence, including its attribution terms. A page whose
  licence allows it, such as some Creative Commons licences, MAY be shown in full. Any other imported web page is shown
  to other cooks only as a linked card (`021-FR-014a`). Counsel confirms which licences allow full display by a
  commercial service (`FR-050`). Markup with no stated licence is not a licence.
- **FR-013**: The terms MUST include a representation that the user has the rights necessary to upload the
  content and to grant the licence, recorded per-account at acceptance.
- **FR-014**: For content classified as **not authored by the uploader**, the per-item attestation of
  `004-FR-014a` — contemporaneous, specific, with a citation — MUST be the controlling instrument. A blanket
  terms-level representation MUST NOT be relied on in its place.
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
  externally, as a **copyright defence**. A modified copy is a **derivative work**, and a derivative of a
  protected work still infringes. What makes cloning defensible is `GR-014` AC-014-e's provenance rule and the
  licence in `FR-010`. This requirement exists because the rule reads like a defence and is not one.

#### B2. Who owns the writing: the rights label _(added 2026-10-29, owner ruling, [ADR-0077](../../docs/architecture/decisions/0077-recipe-rights-label-linked-cards-and-outside-copy-checks.md))_

Every rule in this section rests on research by the CLO agent, dated 2026-10-29. It is research, not legal advice.
Every rule here is subject to counsel review before launch (`FR-050`).

A recipe has two layers. The **dish** is the ingredient list and the bare steps. In the US nobody owns those. The
**writing** is the method in someone's words, the headnote, the tips and the story, and the photos. Those have an owner.
The rights label tells the cook who owns the writing.

- **FR-015c**: Every recipe MUST show the cook one **rights label**, on every surface that shows the recipe to its
  owner, on web and mobile. There are seven labels. This table is the one authority for who owns the writing and for
  what the cook can do under each label. Other specs cite it and do not restate it.

    | #   | Label                                                    | Who owns the writing and photos                                                       | Keep it | Share with the household | Publish                                                                                    | Export                          |
    | --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------- | ------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------- |
    | 1   | Written by you                                           | The cook                                                                              | Yes     | Yes                      | Yes, in full                                                                               | Yes                             |
    | 2   | Adapted by you from a credited source, in your own words | The cook owns their words. The source keeps its own words and photos                  | Yes     | Yes                      | Yes, in full, with "Adapted from [source]"                                                 | Yes                             |
    | 3   | Copied from a public web page                            | The page's author                                                                     | Yes     | Yes                      | Only as a linked card (`021-FR-014a`). In full only where the page's own licence allows it | Yes, as the cook's own copy     |
    | 4   | From a cookbook, magazine or paid site                   | The publisher, or the author                                                          | Yes     | Yes                      | Never (C-004)                                                                              | Yes, as the cook's own copy     |
    | 5   | From a family member or friend, with their permission    | The person who wrote it                                                               | Yes     | Yes                      | Yes, in full, after 020's check. Never open to the web (`021-FR-002`)                      | Yes                             |
    | 6   | Cloned from another Commise cook                         | That cook owns their words and photos. The cloner owns only their own changes         | Yes     | Yes                      | Only after a substantive edit (`001-FR-005b`), always with "Adapted from [cook]"           | Yes, inside the cook's own file |
    | 7   | Public domain                                            | Nobody owns the old text. A new photo, edit or note belongs to the person who made it | Yes     | Yes                      | Yes, in full. Never open to the web (`021-FR-006`)                                         | Yes                             |
    - "Keep it" means a private copy. A free cook keeps it within the 50 private slots (ADR-0073), like any private
      recipe. That includes label 3: the owner ruled on 2026-10-29 that any cook can keep a web import private, using a
      slot (ADR-0077 §6, `001` C-004). The cook always sees their own full copy while its public form is a card.
    - "Share with the household" means the cook's household under 017. Counsel confirms that sharing labels 3 and 4
      with a household is still private use (`FR-050`).
    - "Export" means the cook's own data export (`FR-034`). It is for the cook's own use. Counsel confirms that the
      licence in `FR-011` covers exporting a clone (`FR-050`).
    - A recipe from a social video is label 3. The creator owns the video, its voice-over and its caption.
    - A recipe in review or not approved under 020 keeps its label. The 020 state is a separate fact.

- **FR-015d**: The label MUST be **derived**, never stored and never chosen by a surface. One pure Policy works it out,
  a sibling of `provenancePolicy.ts`. Its inputs are the recipe's source type, its statement kind (`004-FR-014a`), its
  `cloned_from_id`, any licence its source page states (`FR-012b`), and the curator grant (ADR-0023 §1). Every surface,
  and every rule in another spec that depends on who owns the writing, MUST read that one Policy. `staff-architect`
  designs it at PLANNING.
- **FR-015e**: Commise MUST take a licence and never ownership (`FR-010`, `FR-031`). The cook keeps copyright in what the
  cook wrote. A surface, document or message MUST NOT say that Commise owns a recipe, or that a cook owns writing the label
  says is someone else's.
- **FR-015f**: The cook-facing words MUST say what the cook told us, and what Commise's own rule is. They MUST NOT make a
  legal claim we cannot back. They MUST NOT use "copyright-free", "royalty-free recipe", "legally yours", "safe to
  publish" or "we checked this". The source check is a filter, not a clearance (020).
- **FR-015g**: These are the draft words, for `staff-ux-engineer` to refine at SPECIFY and for counsel to confirm. Each
  gets a localisation key (`FR-049`).

    | #   | On the recipe                                                                  | When the cook publishes                                                                                    |
    | --- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
    | 1   | You told us you wrote this. You keep ownership of what you wrote.              | You keep ownership of what you wrote.                                                                      |
    | 2   | Your version, adapted from [source]. Your words are yours.                     | Other cooks will see "Adapted from [source]". You keep ownership of what you wrote.                        |
    | 3   | Saved from [site]. The words and photos belong to the page's author.           | Other cooks will see the ingredients and a link to [site]. The method and photos stay on [site].           |
    | 4   | From [book or site]. The words belong to [author or publisher]. Kept private.  | Recipes from books and paid sites stay private, out of respect for the people who wrote them.              |
    | 5   | From [giver], shared with their permission. Their words stay theirs.           | Other cooks will see this recipe and "From [giver]". Make sure [giver] is happy for you to share it.       |
    | 6   | Adapted from [cook]'s recipe. Their words stay theirs. Your changes are yours. | Change the ingredients or steps to make it your version first. Other cooks will see "Adapted from [cook]". |
    | 7   | From [title, year]. Its copyright has ended in the US.                         | Other cooks will see this recipe and its source.                                                           |
    - A family or friend recipe with no credit given says "From a family member or friend".
    - Label 7's words state a US fact only. Counsel confirms them for each market before it opens (`025`).

- **FR-015h**: ⛔ "You keep ownership of what you wrote" MUST be shown only for labels 1 and 2. The licence panel
  (`021-FR-040`) MUST show the line for the recipe's own label, never a blanket ownership line. This closes the research's
  gap G2, where every cook publishing a clone or a copy was told "The cook keeps ownership".
- **FR-015i**: A method rewritten by an AI feature is not the cook's own words. It MUST NOT turn a recipe into label 2.
  An AI feature MUST NOT rewrite a source's method for anyone other than the cook who saved it (`005`).
- **FR-015j**: A copy of a private source cannot be detected. A family card, a friend's email or a book that is not
  online has no page to find. For those, the controls are the cook's own statement (`FR-014`), the label, and fast
  takedown (`FR-016` to `FR-022`). The product MUST NOT claim more.

_Rationale, the owner's ruling in full, and the three blockers it surfaced are in
[Clarifications](#clarifications) C-016-003 and in [Cross-spec amendments](#cross-spec-amendments-this-feature-requires)._

#### C. Notice, action, redress and repeat infringement

- **FR-016**: The system MUST provide an electronic notice mechanism, reachable **without an account**, that
  accepts a notice identifying the specific content, the grounds, and the notifier's contact details, and MUST
  issue an acknowledgement with a reference.
- **FR-017**: Notices MUST be processed in a timely, diligent, non-arbitrary and objective manner, and each
  decision MUST record who decided, when, on what ground, and what action was taken.
- **FR-017a**: "Timely" is measurable, and tiered by grounds: a notice on **`copyright` or `illegal_content`
  MUST be decided within 24 hours** of acknowledgement — these are the grounds where "expeditiously" is
  statutory — and every other ground within **7 days**.
- **FR-017b**: The tier MUST be derived from the grounds as **finally classified**, and the clock MUST run
  from **acknowledgement**, never from reclassification. A notice a reporter filed as `other` that turns out
  to be copyright is judged against the 24-hour target from when it arrived, so a misfiling — honest or
  deliberate — can never buy an extension.
- **FR-017c**: A notice past its target MUST be surfaced as overdue and MUST raise an operational alert. An
  unmet target is visible work, not a silent statistic.
- **FR-018**: When content is removed, disabled, demoted or restricted, the system MUST deliver the uploader a
  **statement of reasons** identifying the action, the ground relied on (legal provision or terms clause), the
  facts relied on, whether automated means were used, and the redress available.
- **FR-018a**: The statement MUST be delivered over **both** channels: by **email**, which is the channel that
  discharges the obligation because it reaches an uploader who never signs in again; and **in-app**, which
  carries the full detail and the route to the counter-notice. Delivery MUST be recorded **per channel**, so a
  statement that was surfaced in-app but never emailed is visibly incomplete rather than silently counted.
- **FR-018b**: A failure to deliver the email MUST NOT be treated as delivery, MUST be retried, and MUST raise
  an operational alert if it remains undelivered. An uploader who cannot be reached is a compliance exposure,
  not a dropped notification.
- **FR-019**: The system MUST provide a counter-notice path, record it, and record the restoration decision
  and its date.
- **FR-020**: The system MUST maintain a per-account record of actioned notices and MUST terminate an account
  on its **third live strike within a rolling 12 months**, applying the policy to every account without
  exception and retaining the trail. A single threshold, one implementation, no per-case discretion — because
  inconsistent application is what costs a provider its safe harbour, not a lenient threshold.
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
- **FR-024a** _(added 2026-10-29, owner ruling, ADR-0077)_: A site MUST be able to opt out of public linked cards,
  without an account, through the notice mechanism of `FR-016` or a standing request. The opt-out list is data, with
  the admin-managed lifecycle and audit trail of `020-FR-011`. A card from an opted-out site shows only the title, the
  site's name and the link (`021-FR-014e`). The add-to actions stay for the cook who saved it. Opting out never removes
  any cook's own private copy.
- **FR-025**: The operator MUST maintain a registered designated agent and MUST treat its three-yearly renewal
  as a monitored obligation with an owner and an alert, since a lapse is a lapse in protection.
- **FR-026**: `012-FR-022`'s DMCA route MUST be re-pointed at this mechanism rather than duplicating it. There
  MUST be exactly one notice-and-action pipeline in the portfolio.

#### D. Reproduction controls — being the host, not the copier

- **FR-027**: The system MUST NOT persist a copy of a third-party photograph obtained during import to
  operator-controlled storage (C-016-002).
- **FR-027a**: An imported recipe MUST display its source photograph by **reference to the original host**.
  When the reference cannot be resolved — moved, blocked, offline — the surface MUST render a defined
  placeholder and MUST NOT render a broken image.
    > **Amended 2026-10-29 (owner ruling, ADR-0077).** The referenced source photograph is shown only to the cook who
    > saved the recipe, and to their household where it is shared. It MUST NOT be shown to any other cook, on a linked
    > card or anywhere else (`021-FR-014a`). The embedding question stays open for counsel (`FR-050`).
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
  audio all create reproductions; they are lawful here because their purpose is to **extract facts** — the
  ingredients, the quantities, the steps — rather than to reproduce expression. Every one of the following
  MUST hold, and the permission lapses if any fails:

    1. The reproduction exists only for the duration of the extraction operation and is **never persisted**.
    2. It is **never served** to any user, in any form, at any size.
    3. Only as much of the work as the extraction requires is sampled — this is sampling, not decode-and-keep.
    4. What is retained is the **extracted result** (text, quantities, steps, confidence), never the frame, the
       still, the audio, or the source media file.

- **FR-027g**: ⛔ An extracted frame or still MUST NOT become the recipe's image. It is the most tempting
  shortcut in the whole import pipeline — a good frame is right there — and taking it converts a permitted
  transient extraction into exactly the persisted third-party copy `FR-027` prohibits. Recipe images follow
  `FR-027a`/`FR-027b`: reference the source, or the user supplies their own.
- **FR-027h**: The **source media file** MUST NOT be retained after extraction completes, whether the
  extraction succeeded or failed.
- **FR-028**: Every imported item MUST record the **channel** it arrived through, and channels MUST be
  classified as _user-supplied bytes_ or _operator-performed retrieval_, with the classification queryable.
- **FR-029**: Where more than one channel can satisfy a user's intent, the product MUST prefer a
  user-supplied-bytes channel, and MUST NOT silently upgrade a user-supplied action into an
  operator-performed retrieval.
- **FR-029a**: The operator MUST NOT price, package or gate a paid tier on access to imported third-party
  content, so that no financial benefit is directly attributable to it.

    **Import guardrails** _(owner ruling 2026-10-25, restored 2026-10-27)_. Every import channel is open on every plan
    (`004-FR-028`). A book or paid-site recipe uses one of a free cook's 50 private slots, and Pro removes that limit
    for every private recipe alike ([ADR-0073](../../docs/architecture/decisions/0073-free-tier-private-slots.md)).
    So that imported content is never the draw:
    1. Pro is never marketed, priced or described in terms of importing. No "import your cookbooks with Pro", no
       import-specific offer, and no Pro benefit that names a source.
    2. When a free cook has no free slot at the moment of an import, the product shows the same out-of-slots message
       it shows for any private recipe. The free ways forward come first and Pro comes last. There is no
       import-specific upsell.
    3. No metric, experiment or target measures or optimises Pro conversion from imports.
    4. The slot limit applies identically to every private recipe, whatever its source.

    These four come from a counsel brief on the design branch, `counselBriefPrivateRoom.md`, deleted in commit
    `ba678b489` (read it with `git show ba678b489^:specs/016-legal-compliance-framework/counselBriefPrivateRoom.md`).
    That brief also described a "private room" model, which is retired (`010-FR-041g`). The guardrails do not depend
    on it. Counsel's question is in `FR-050`.

#### E. Corpus rights and anti-extraction

- **FR-030**: The terms MUST include an anti-extraction provision covering systematic extraction, scraping,
  and re-utilisation of the corpus, drafted as a contractual restriction on parties who accept the terms. The
  provision MUST NOT cover food values the operator holds under an attribution licence (ADR-0052), because such a
  licence forbids adding terms that restrict what others can do with the licensed material (owner, 2026-09-30).
- **FR-030a** _(added 2026-10-29, owner ruling, ADR-0077)_: The EU database right protects a site's catalogue against
  "repeated and systematic" re-use of small parts (Directive 96/9/EC Art 7(5)). Across many cooks, public linked cards
  could add up to that, and that act is ours, not the cook's. So:
    - Each source site MUST have a cap on the number of public linked cards. Counsel sets the number (`FR-050`). The cap
      applies to every site, because we cannot reliably tell where a site was made. Past the cap, a new card from that
      site shows only the title, the site's name and the link, as for an opted-out site (`FR-024a`).
    - A surface MUST NOT list, browse, filter, rank or search public linked cards by source site. A source name on a card
      links only to the source site, never to a Commise list.
- **FR-031**: The operator MUST NOT assert, in product surfaces, documentation or marketing, ownership of
  users' recipes, nor any database right it does not hold. Claims about the corpus MUST be limited to the
  compilation and to contractual restrictions.
- **FR-032**: Derived, non-published artefacts — ingredient-resolution mappings, per-field confidence scores,
  dedup keys and ranking signals — MUST be treated as confidential and MUST NOT be exposed through public
  surfaces or exports.
- **FR-033**: The corpus MUST NOT be published under an open content licence.

#### F. Data protection surfaces

- **FR-034**: A signed-in user MUST be able to request an export of their content and account data in a
  machine-readable form, from the app, and MUST be told the deadline and notified on completion. The deadline
  MUST be no longer than one month from the request.
- **FR-035**: The system MUST provide a consent-withdrawal surface covering every purpose recorded under
  `FR-007`, and dependent features MUST degrade gracefully rather than fail when a consent is withdrawn.
- **FR-036**: Processing of special-category data — dietary restriction, allergy, health goal, religious
  observance — MUST have an explicit, separately-recorded lawful basis, and MUST NOT be inferred from ordinary
  account use.
- **FR-037**: Where erasure lawfully retains data, the system MUST record what was retained and the reason,
  and MUST surface that to the user on completion.
- **FR-038**: The system MUST NOT make a user's own content accessible to an indefinite number of people **by
  default**; publication MUST be an act the user takes. _(This is the requirement `015` exists to satisfy;
  stated here because it is a data-protection obligation, not a product preference.)_
- **FR-039**: The operator MUST maintain a current record of processors and international transfers, and the
  privacy notice MUST name the categories of processor including any AI provider.

- **FR-039a** _(added 2026-10-29, owner ruling, ADR-0077)_: The privacy notice MUST say that, for a recipe headed
  public, a few sentences of its method are sent to a web search provider to look for copies (`020-FR-012d`). It MUST
  name the provider, or its category under `FR-039`, and say that no name, account id or other personal data is sent.
  The record of processors under `FR-039` MUST list it. Counsel and `dpo-1` confirm the wording before the search
  ships (`FR-050`).

#### G. Consumer and subscription disclosures

- **FR-040**: Before any charge, the system MUST disclose price, billing term, what renews, and how to cancel,
  in a surface the user passes through rather than one they may discover.
- **FR-041**: Cancellation MUST be available in-app and MUST NOT require more interactions than subscribing
  did; the outcome MUST be confirmed in writing.
- **FR-042**: Where a purchase was made through a platform store, cancellation MUST route the user to the
  correct store mechanism rather than dead-ending.
- **FR-043**: Where a jurisdiction confers a statutory withdrawal or cooling-off right, it MUST be disclosed
  at purchase.
- **FR-044**: Terms MUST NOT contain provisions that are unfair within the meaning of the applicable consumer
  regime in any market served. An over-aggressive risk-shift is itself a violation in at least one market
  where our other protections are weakest.

    _(2026-10-26.)_ The subscription page that carries `FR-040` to `FR-043` is specified in 010 (`010-FR-042a` to
    `FR-042k`). There are now several paid plans (010's [plan register](../010-subscriptions/spec.md#plan-register)).
    Every disclosure here applies to each plan, and to a plan change as well as a first purchase.

#### H. AI transparency — _governed by `GR-010`_

`GR-010` (EU AI Act Compliance Propagation, amended to v3.5.0 from this feature) owns the obligation and
Feature 005 owns the shared disclosure component. These requirements name what the legal surfaces must show;
they do not create a second mechanism.

- **FR-045**: Where a user interacts directly with an AI system, the system MUST inform them unless it is
  obvious from the context (Art. 50(1); `GR-010` AC-010-a…d).
- **FR-046**: Content generated or materially altered by AI MUST carry a machine-readable marking **at
  generation time** and a human-legible label where displayed, and the label MUST reflect the content's
  **current** state after human editing (Art. 50(2); `GR-010` AC-010-e). Marking cannot be retrofitted onto
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
  built at v1, and MUST be recorded as enabling work attached to the market that triggers them.
- **FR-049**: Every legal surface, document, disclaimer and notice-mechanism string MUST route through the
  localization path and MUST NOT be a hard-coded literal.
- **FR-050**: The specification MUST carry a list of items requiring counsel's confirmation before launch,
  and each MUST name what breaks if the assumption is wrong. At minimum: the availability of any database
  right claimed; the current scope of Australian safe harbour for commercial platforms; **whether recipe
  extraction is text-and-data mining for the purposes of the EU reservation** — which collides with
  `004-FR-023`'s deliberate decision to import despite a wildcard `Disallow`, and which `FR-027f` now makes
  load-bearing for **video and audio import** rather than URL import alone, since TDM is the basis on which
  frame sampling is permitted at all; and the drafting of every document surface here.
    - **The bulk-import attestation wording.** Owner ruling, 2026-10-26, recorded in
      [ADR-0072](../../docs/architecture/decisions/0072-bulk-recipe-import.md) §9. A bulk import asks for a source
      statement on every recipe, not one statement for the file. The statement has two forms: "I wrote this", with
      no citation, or "From a source", with a citation. A source is a public web page, a book or a paid site. The statement sets the recipe's provenance label, `imported_public` included, with no curator grant.
      _(2026-10-29: the two forms are now six statements, `004-FR-014a` and ADR-0077 §2. Counsel confirms all six.)_
      Counsel confirms the wording of both forms, and that this is still the "contemporaneous, specific" instrument
      `FR-014` relies on. The flow imports hundreds of recipes at once, and
      that is the doubt. **What breaks.** The per-item attestation is our evidence for every imported recipe. A
      statement that reads as a blanket one fails `FR-014` for the whole migrated library. The takedown defence for
      those recipes then rests on the terms, which `FR-014` says must not carry it. A false "I wrote this" on a copied recipe
      labels it `user_created` with no citation at all. A false "public web page" makes it publishable.
    - **The private-copy attestation.** A bulk-imported recipe kept private still carries its source statement and
      citation. An import is a reproduction, even with nobody else able to see it. Counsel confirms the wording. Counsel
      also confirms that privacy plus the statement is enough for a private copy of a paid or physical source. **What
      breaks.** Finding 1 says privacy does the heavy lifting, and that is the basis for a private copy of a cookbook
      recipe. Without it, `imported_paid` and `imported_physical` recipes need a different control. The owner ruled
      that a free cook can keep them private, so this is not limited to paying cooks. A bulk import of a library full of
      cookbook recipes is where that exposure grows fastest.
    - **The subscription page.** Added 2026-10-26 for 010 (`010-FR-042a` to `FR-042k`). Counsel confirms each part.
      **What breaks** for each is a page that charges people unlawfully, in a market we serve.
        - _Auto-renewal disclosures._ The federal rule is still not in force (see Assumptions), so the stricter
          state laws govern, such as California's Automatic Renewal Law. ROSCA still applies to online subscriptions.
          Counsel confirms the disclosure wording, the consent step, the trial-to-paid notice, and any renewal
          reminder these laws need. **What breaks:** a charge without the required consent can be void, and refunds
          are owed.
        - _Online cancellation._ The page cancels in no more steps than subscribing took (`FR-041`). Counsel confirms
          that this meets the state laws. Counsel also says whether a retention offer is allowed, and how.
        - _Withdrawal right._ In the EU and UK a consumer has 14 days to withdraw. For digital content supplied at
          once, the right ends only with express consent and an acknowledgement. Counsel confirms the wording and
          the consent step before any EU or UK market opens (`FR-043`, `FR-048b`).
        - _App store rules._ Checked 2026-10-26: Apple App Review Guideline 3.1.1(a) lets a US-storefront app link
          to an outside purchase since the court order of 30 April 2025. Elsewhere, digital subscriptions use
          in-app purchase. Google Play's US external links and alternative billing programs charge fees from
          1 October 2026. Counsel confirms what the mobile page can show and link to in each market (`010-FR-042i`).
          **What breaks:** an app rejected or removed from a store.
        - _Plan change._ What the page must say about the amount and the timing of an upgrade or a downgrade,
          before the cook confirms (`010-FR-042h`).
        - _Lifecycle notices and offers (added 2026-10-28)._ Counsel confirms six things.
            - The trial notice's lead time of 3 days and its wording (`010-FR-041h`).
            - The yearly renewal notice, 30 days before renewal, against California's 15 to 45 day window
              (`014-FR-052`).
            - Whether California's annual reminder of the terms covers monthly subscriptions too. Until counsel
              answers, every paid subscriber gets one a year, by email and in-app (`014-FR-052`).
            - That the "what you keep" screen after a cancel meets the online-cancel rules (`010-FR-042m`).
            - The wording of the one-time discount and the monthly-to-yearly offer (`010-FR-041k`, `FR-041l`).
            - That billing notices stay transactional under CAN-SPAM, and the consent for marketing email and push
              (`014-FR-049`).

            **What breaks:** a charge without a lawful notice can be void and owed back, and a marketing message
            without consent breaks CAN-SPAM or a store rule.
    - **Pro and imported recipes.** Added 2026-10-27, from the deleted counsel brief (commit `ba678b489`). A book or
      paid-site import uses a private slot, and Pro removes the slot limit. Does selling Pro give a "financial benefit
      directly attributable to the infringing activity" under 17 U.S.C. §512(c)(1)(B), for any infringing imported
      content? The product view is that the risk is low. Pro is a flat subscription paid alike by every cook. The
      imported recipe is private, so it draws no one else. And the `FR-029a` guardrails stop imports being the pitch.
      Counsel confirms this, says whether a further guardrail is needed (for example, what the product can say at the
      moment of an import), and says whether an EU or UK market needs something different. **What breaks** if the
      answer is yes: the §512(c) safe harbor is lost for that content, and our takedown defence for it goes with it.
      The fixes then are product changes, such as not counting imported book and paid-site recipes toward the
      benefit only Pro gives, or pricing that does not track the volume of imported content.
    - **Retention after erasure.** Added 2026-10-25. When a cook erases their account, some records outlive it:
      payment records for tax and accounting, and records of reports and moderation decisions. The Erase screen
      shows placeholder periods, 7 years for payments and 3 years for reports. Counsel sets the payment period, and
      confirms `FR-052a`'s 3 years, for each market we launch in. **What breaks.** A record kept too long loses the
      legal basis that let it survive erasure (`FR-052a`). A record purged too early leaves a tax filing or a
      moderation decision without its evidence.
    - **Recipe rights (added 2026-10-29, owner rulings, ADR-0077).** Research by the CLO agent of 2026-10-29 backs
      each rule below. It is research, not legal advice, and counsel confirms each before launch.
        - _The rights labels and their words_ (`FR-015c` to `FR-015h`). Counsel confirms each label's words, and "You
          keep ownership of what you wrote". **What breaks:** a promise we cannot keep, shown on every recipe.
        - _The linked card_ (`021-FR-014a`). That showing the title, servings, times, yield, step count, our own
          nutrition, our normalized ingredients, the cook's notes and photos, and a link, with no method, headnote or
          source photo, is enough for a copy of a web page. Counsel also says whether the ingredients must be hidden.
          If so, the owner's fallback applies: hide them and keep add-to-list, with words that say so
          (`021-FR-014g`). **What breaks:** public display of protected text on every web import.
        - _The per-site cap_ (`FR-030a`). Counsel sets the number, and says whether the UK needs its own.
          **What breaks:** the "cumulative" case of the EU database right, which is ours, not the cook's.
        - _Page licences_ (`FR-012b`). Which licences allow full display by a commercial service. Creative Commons
          "NonCommercial" is the main doubt. **What breaks:** a full copy shown against the licence's own terms.
        - _A stored fingerprint_ (`020-FR-012b`). Whether word-shingle hashes of a source page are a copy under
          `FR-027`. **What breaks:** the free comparison becomes a reproduction.
        - _The web search_ (`020-FR-012d`, `FR-039a`). The privacy notice line, and whether the search provider's terms
          let us keep a result as evidence. **What breaks:** an undisclosed transfer, or evidence we cannot use.
        - _Household sharing of book and paid-site recipes_ (`FR-015c` label 4). Whether a household of up to six is
          still private use. US law speaks of "a normal circle of a family and its social acquaintances" (17 U.S.C.
          §101), and a household need not be a family. **What breaks:** the household feature distributes copies.
        - _Export of a clone_ (`FR-015c` label 6). Whether `FR-011`'s licence covers a clone in the cook's own export.
          **What breaks:** export hands out another cook's words outside the licence.
        - _The review guideline_ (`FR-053j`). That it keeps review on the screening side of _Mavrix_. **What breaks:**
          the safe harbour for reviewed content.
        - _Embedding_ (`FR-027a`). Whether showing a source photo by reference is a display by Commise in the First
          Circuit. _Goldman v. Breitbart_ (S.D.N.Y. 2018) rejected the Ninth Circuit's server test. **What breaks:**
          every imported photo shown to its saving cook becomes our display.
        - _Who fetches the page._ A server that returns again and again to a site whose terms it knows fits
          _Register.com v. Verio_ (2d Cir. 2004). The cook's own capture (paste, share sheet, browser extension) is
          safer under site terms than repeated server fetches. A URL shared from the share sheet that our server then
          fetches is still a server fetch. Only pasted or shared text and the page the extension reads in the cook's own
          browser are the cook's own capture. Counsel weighs this against `004-FR-008`'s URL fetch and
          against 017's tier 5 lookup of the source page (`017-FR-005`). This spec records the risk and does not change 017. **What breaks:** a contract claim by a site, which copyright preemption does not stop.
    - **Chef terms (added 2026-10-29, from [026](../026-chef-spaces/spec.md)).** Counsel confirms the processor terms
      for a chef's email list (`FR-054`), the creator terms for the site claim and the sponsor line (`FR-055`,
      `FR-056`), and the endorsement disclosure rules (`FR-057`). **What breaks.** Without processor terms, Commise
      handles a chef's subscribers with no contract, and a regulator can treat Commise as a controller. A site claim
      read as proof of authorship clears a copy. An unlabelled affiliate link or sponsor line is a deceptive
      endorsement, and the FTC can act against the chef and against Commise.
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
  founder decides notices and 020's referrals. One paid backup reviewer covers the founder. The owner ruled on
  2026-10-27 that "the founder reviews flagged public content at launch, with a paid backup reviewer of about $555 a
  month". The rules:
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
  any audit sample (`020-FR-032`). Why: _Mavrix Photographs v. LiveJournal_ (9th Cir. 2017) held that screening for
  infringement is "accessibility-enhancing", while review "of the substance of posts" can make a post the host's own.
  That can cost the §512(c) safe harbour for it. Counsel confirms the guideline (`FR-050`).

#### J. Records and auditability

- **FR-052**: Acceptance records, consent records, attestations, notices, decisions, statements of reasons,
  counter-notices and termination decisions MUST be retained for at least as long as the content or account
  they relate to, and MUST survive the content's deletion where the record is the evidence of a decision.
- **FR-052a**: Records that survive an account's **erasure** MUST be retained for **3 years from the decision
  they evidence**, then purged. The period is the US copyright limitation period (17 U.S.C. §507(b)) — these
  records survive erasure only because GDPR Art. 17(3)(e) permits processing necessary to defend legal claims,
  and **that basis lapses when the claim period does**. Retaining them longer removes the justification for
  having retained them at all. Three years also outlasts `FR-020`'s 12-month strike window by a wide margin,
  so the repeat-infringer policy stays demonstrable.
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

Every requirement in this section is **subject to counsel review** (`FR-050`). The CLO agent's research and the FTC
pages cited under `FR-057` are the inputs. They are not legal advice.

- **FR-054** _(processor terms for a chef's email list, `026-FR-020` to `FR-026`). Subject to counsel review_: Commise MUST NOT connect a chef's
  email provider until the chef has accepted written processor terms, recorded as an acceptance under `FR-002`. The
  terms MUST cover:
    - **What Commise does.** It connects sign-ups to the chef's own provider (Kit, Mailchimp or Beehiiv at first).
      Each sign-up goes from our server to that provider and nowhere else. No provider script or form loads on the
      page (`026-FR-011`). Commise does not send email for chefs (`026-FR-025`).
    - **The data roles.** The chef is the controller of their list and of every subscriber's address. Commise is the
      chef's processor and acts only on the chef's documented instructions. Commise is the controller of the chef's own
      account data and of the reader's Commise account, which are not part of the list. The terms MUST also say what the
      chef's provider is: the chef's own processor. Counsel confirms whether it is also a sub-processor of Commise for
      the hand-off, and the privacy notice names the provider categories (`FR-039`).
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
      **What breaks:** no contract between controller and processor, which is a breach of GDPR Art. 28 where it applies, and
      a Commise that is treated as a controller of subscribers it holds for chefs.
- **FR-055** _(creator terms: the site claim, `026-FR-001`, `FR-002`, `FR-005`). Subject to counsel review_: The creator terms MUST say:
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
      **What breaks:** a claim read as proof of authorship lets a copy of another site's recipe pass the check, and
      a claim that cannot be revoked lets a sold domain keep its clearing power.
- **FR-056** _(creator terms: the sponsor line, `026-FR-048`; owner ruling, 2026-10-29, Q7: "Yes, as described"). Subject to counsel review_: The
  creator terms MUST say that a chef may sell one sponsor line per recipe or cookbook, and that:
    - The line is **chef-sold**. Commise does not sell, place or pick sponsors.
    - It is **one line**, labelled "Sponsored by", with text and a logo only. It sits under the method and **never
      above the ingredients**.
    - It uses **no ad network, no tracking and no third-party script** (`026-FR-011`). Commise reads no
      sponsor-linked behaviour about readers.
    - The chef MUST NOT make a claim the sponsor cannot support, and MUST NOT sponsor a nutrition, allergen or medical
      claim (`FR-051`). The sponsor line is paid content under `FR-057`, and the label is the disclosure.
    - Commise can remove a line that breaks these terms or the law, and tells the chef why.
      **What breaks:** an undisclosed paid placement, and a page that quietly becomes an ad surface, which the owner has
      refused.
- **FR-057** _(FTC disclosure for affiliate links and sponsor lines, `026-FR-047`, `FR-048`). Subject to counsel review_: Every affiliate link
  and every sponsor line a chef adds MUST carry a disclosure of the chef's financial connection. The disclosure MUST be:
    - **Clear and conspicuous.** The 2023 revision of the FTC's Endorsement Guides added a definition of "clearly and
      conspicuously" (16 CFR Part 255). The FTC's own FAQ says a disclosure "should be placed where it easily
      catches consumers' attention and is difficult to miss". A disclosure behind a "more" link or in a footer MUST NOT
      count.
    - **Placed with the link or line itself**, not on an About page or a settings page. The FTC's FAQ says a
      disclosure "is more likely to be seen if it's very close to, or – even better – part of, the endorsement to which
      it relates", and, for affiliate links, to disclose "in the description near the links".
    - **In plain words**, such as "Affiliate link: the chef earns a commission" or "Sponsored by". Commise chooses
      wording that says the chef is paid, because the FTC's FAQ says a financial arrangement "may be apparent to some
      people, but not to everyone". Vague or stand-alone terms such as "sp", "collab" or "thanks" MUST NOT be accepted
      ("Disclosures 101" warns against them).
    - **Shown the same way on web and mobile**, at every size and in dark mode (the cross-platform rule, `docs/CODING_STANDARDS.md` §14).
      Commise MUST add the label itself, and the chef MUST NOT be able to remove or restyle it. The chef is responsible for
      the claims they make. Commise is responsible for giving them a surface that cannot hide the label, because the FTC's FAQ says responsibility "rests with the influencer and the brand", and that its enforcement focus "usually will be on advertisers".
      **Sources (FTC pages, opened 2026-10-29):**
      [Disclosures 101 for Social Media Influencers](https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers)
      (material connection; "place it so it's hard to miss"; terms to avoid) and
      [FTC's Endorsement Guides: What People Are Asking](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking)
      (the 2023 revision; placement; affiliate links; who is responsible). Every quotation above is from those two pages. The
      rule text is 16 CFR Part 255, § 255.0 and § 255.5 ([eCFR](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-255)).
      The eCFR page would not load and the FTC's PDF of the Guides is a scan, so the rule text itself was not read. Counsel
      reads it, including the definition of "clearly and conspicuously" and the weight of "affiliate link" alone. EU and UK
      markets add their own rules, which counsel sets before those markets open (`FR-043`).
      **What breaks:** an undisclosed material connection is a deceptive endorsement, and the FTC can pursue the chef and
      Commise.

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
  database right the operator does not hold, and the corpus is under no open content licence.
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
- **SC-017** _(added 2026-10-27)_: Every notice still undecided at half its target pages both reviewers
  (`FR-053h`), and every measure of `FR-053i` is visible on the dashboard each week.

## Assumptions

- **The documents are drafted by counsel.** This specification defines the surfaces, records and behaviours; it
  does not write the words, and no requirement here depends on particular wording.
- **The operator is a US-formed entity with no EU establishment.** This is what makes the EU database right
  unavailable (Art. 11) and it is the assumption behind `FR-031`. If an EU entity is created, Layer 3 of the
  research reopens.
- **The service is treated as a hosting service for user content.** Notice-and-action obligations attach to
  hosting providers regardless of size — the micro/small-enterprise exclusion covers the _online-platform_
  section, not the hosting section — so size is not a defence here.
- **D4a and D4b land** (`docs/competitive/02GapAnalysisAndStrategy.md`): free users may set their own
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
  "whether automated means were used" is therefore expected to read "no" at launch.
- **At launch that human is the founder, with a paid backup** (`FR-053h`, owner ruling, 2026-10-27). `FR-053i`'s trigger
  starts the hire of a half-time reviewer.
- **The federal US auto-renewal rule is absent, not pending.** It was vacated in July 2025 and re-proposed in
  March 2026; `FR-040`–`FR-043` are written to the stricter state regimes and platform rules instead, which
  makes them robust to whatever replaces it. _(Checked again 2026-10-26: still not in force. The FTC still enforces
  ROSCA against online subscriptions. Counsel confirms the status before launch, `FR-050`.)_
- **AI Act Art. 50 applies to us from now.** It became applicable 2 August 2026. A transitional allowance to
  2 December 2026 for machine-readable marking of systems already on the market may apply; we do not rely on
  it, because we are not yet on the market.
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
- Insurance, contractual arrangements with counsel, or any process that lives outside the product.
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
| A-10 | `governance-rules.md` `GR-010`                                                                                   | **AC-010-e/f added** (v3.5.0) — Art. 50 corrected to _applicable since 2 August 2026_, split into 50(1) interaction disclosure and 50(2) machine-readable marking, with marking stated as a **generation-time** obligation because it cannot be retrofitted                                                                                             |
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
| A-10          | `governance-rules.md` | `GR-010` amended to v3.5.0: AC-010-e/f added, Art. 50 applicability corrected to 2 Aug 2026                                                                                                                                            |

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
  (`FR-052a`), tied to 17 U.S.C. §507(b) because GDPR Art. 17(3)(e) is what permits their survival and its
  basis lapses with the claim period; **reporter contact pseudonymised once the counter-notice window closes**
  (`FR-052b`); explicit recorded legal holds suspend the purge (`FR-052c`). Measured by `SC-016`. Confirmed in
  the same pass: no statute sets a retention minimum, and DSA Art. 24(5)'s database duty does not reach us
  (Art. 19(1) micro/small exemption).

### Session 2026-08-22 — RESOLVED by owner

- **C-016-001 — Q1 answered: US-only at v1, and global is the target.** This is deliberately _not_ the same as
  "US-only," and the difference governs `FR-048`–`FR-048c`. A global target makes the other markets a **known**
  requirement, not a presumed one, so YAGNI does not license deferring the boundary — only the capability.
  **Build to the strictest regime wherever the cost is a seam; build nothing for a market we do not serve.**
  The three items that would otherwise be unrecoverable: a licence granted under narrower terms cannot be
  widened without re-prompting every existing user; consent recorded without per-purpose granularity cannot be
  decomposed after the fact; and AI content generated without machine-readable marking can never be marked.
  Australia remains the sharpest of the target markets — neither fair use nor a commercial-platform safe
  harbour — and that is a sequencing input for when global expansion is planned, not a v1 obligation.

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
    frames from a video** — which would have killed the video-import wedge
    [`017-recime-parity`](../017-recime-parity/spec.md) is built on, since a sampled frame is a reproduction of
    a protected audiovisual work. Raised by 017, settled here, because it is 016's rule.

    **The line is not photo-versus-video. It is _persisted or served_ versus _transient and extractive_.** A
    thumbnail is prohibited because it is kept, is shown, and stands in for the source. A sampled frame is
    permitted because it is discarded, never shown, and exists to extract facts the copyright does not cover.
    `FR-027c` is restated on that axis; `FR-027f`–`FR-027h` carry the guardrails.

    **The legal basis is text-and-data mining, not the transient-copy exception** — and the distinction matters
    enough to record rather than leave to whoever plans this. The EU transient-copy exception (InfoSoc
    Art. 5(1)) looks like the obvious fit and is the weaker argument: _Infopaq_ reads its conditions narrowly,
    and "no independent economic significance" sits badly with a commercial pipeline whose entire value is the
    extraction. TDM (DSM Art. 4) is purpose-built for reproductions made to derive facts, expressly reaches
    commercial actors, and matches what we are actually doing. ⚠️ Its condition is a **machine-readable
    reservation** by the rightsholder — the _same_ open question `004-FR-023` already carries, so this inherits
    an existing risk rather than creating a new one. It is now load-bearing for the video wedge and not only for
    URL import, and is escalated in `FR-050`.

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

    ⚠️ **One accepted risk.** A clone of a public recipe defaulting to public is the same
    public-by-default pattern `FR-038` and feature `015` exist to remove. It is materially weaker here — the
    content was already public, so what is newly exposed is the _cloner's association_ with it rather than the
    content — but it is not nothing, and it is recorded rather than re-litigated.

### Session 2026-10-27: who reviews at launch (owner ruling)

- **C-016-004: the founder reviews at launch, a paid backup covers, and a half-time reviewer is hired on a volume
  trigger.** The owner ruled on 2026-10-27 that "the founder reviews flagged public content at launch, with a paid
  backup reviewer of about $555 a month, and the half-time reviewer is hired when a volume trigger is met." The
  24-hour target stays, and every legal requirement stays. Only who does the work, and when, changes. The business
  plan had budgeted a half-time employee reviewer from the first month, at about $2,773 a month. No requirement in
  this spec or in 020 asked for that. They asked only that a person decides, within `FR-017a`'s targets, and that a
  recipe reviewer is an employee (`020-FR-026b`). `FR-053h` says who reviews and how the backup is engaged.
  `FR-053i` defines the trigger. [ADR-0076](../../docs/architecture/decisions/0076-founder-reviews-at-launch-with-a-paid-backup.md)
  records the decision.

### Session 2026-10-29: who owns the writing (owner rulings)

These rulings rest on research by the CLO agent of the same day. It is research, not legal advice, and every rule it
supports is subject to counsel review (`FR-050`). [ADR-0077](../../docs/architecture/decisions/0077-recipe-rights-label-linked-cards-and-outside-copy-checks.md)
records the decision.

- **C-016-005: every recipe shows who owns its writing.** Owner, verbatim: "we'll need to make sure that we're very,
  very clear about what chefs own for public recipes and don't and who owns the recipes they don't to cover the cases
  where they copy a public recipe on another site without changes. The automated review process needs to check for
  this as well. Then we can make the messaging a little more precise and also make it very clear on if a chef actually
  owns a recipe. The same goes for a private recipe that a chef copied from a public source and either a public or
  private recipe copied verbatim from a copyrighted or private source." Section B2 adds the seven rights labels
  (`FR-015c` to `FR-015j`). Cooks keep copyright in what they write, and Commise takes a licence, never ownership.
  "The cook keeps ownership" is no longer shown for a clone or a copy (`FR-015h`, `021-FR-040`).
- **C-016-006: a web import is private in full, or public as a linked card.** The owner ruled that a recipe imported
  from someone else's web page has exactly two states. The card's contents and rules are `021-FR-014a` to `FR-014h`.
  This spec adds the legal posture: the page's own licence (`FR-012b`), the per-site opt-out (`FR-024a`), the source
  photo for the saving cook only (`FR-027a`), and the per-site cap with no browse-by-site (`FR-030a`).
- **C-016-007: outside-copy checks for public recipes.** The owner chose "Allow, public recipes only". 020 can now
  compare a recipe headed public with its own import page and search the web for its method sentences
  (`020-FR-012`). This spec adds the privacy notice line (`FR-039a`).
- **C-016-008: staff review is a rights check only** (`FR-053j`). This keeps review on the screening side of
  _Mavrix_.
- **Owed by specs this session does not edit.** 012 owed a way for a cook to prove a site is their own, so a blogger who imports their own posts is not treated as a copier (`020-FR-012g`). 026's site claim now provides it (`FR-055`, [ADR-0078](../../docs/architecture/decisions/0078-a-live-site-claim-clears-the-own-site-hit.md)). 015 still lists D4b, making `imported_public`
  private by default, as open. This ruling settles what a public web import shows to other cooks. The owner then ruled on
  2026-10-29 that any cook can keep one private, using a slot (ADR-0077 §6). 015 is aligned in its own next revision.

## Owner decisions required

All three clarifications are resolved (C-016-001 … C-016-003). These remain open, and change the work without blocking the spec:

1. **Do we create an EU establishment to hold a database right?** It is the only route to the one right that
   would protect the corpus against extraction, and it carries tax, data-protection and corporate consequences
   far outside this feature. Recommendation: **no, not for this reason alone** — Layer 4's contractual fence
   is what actually gets enforced.
2. ~~**Repeat-infringer threshold.**~~ **RESOLVED 2026-08-22** — three live strikes in a rolling 12 months
   (`FR-020`).
3. **Do we publish transparency numbers voluntarily?** Cheap, differentiating against a competitor whose
   documents contradict their marketing, and it commits us to keeping the numbers clean.
4. **Who owns the registered-agent renewal?** A named human, not a team.

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
   `FR-027f`–`FR-027h` resolve it on the persisted-or-served versus transient-and-extractive line, with the
   basis recorded as TDM rather than the transient-copy exception.

**Two prerequisites live outside software and no requirement here can satisfy them**: a registered designated
agent (`FR-025`) and counsel-drafted documents. `FR-050` carries the items needing counsel's confirmation, each
naming what breaks if the assumption is wrong.

**85 functional requirements · 7 non-functional · 17 success criteria · 8 user stories · 0 clarification markers.**
