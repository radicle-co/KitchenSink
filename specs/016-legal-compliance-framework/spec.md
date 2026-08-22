# Feature Specification: Legal Compliance Framework

**Feature Branch**: `016-legal-compliance-framework`
**Created**: 2026-08-22
**Status**: Draft
**Input**: User description: "create a feature for the legal coverage, protections, considerations, guidelines and rules and regulations within the apps, the TOS, etc. based on the context found during the initial research. One thing to research is if we can own public data without copyrighting or running into other legal issue or fines or violations - a license of sorts."

## Dependencies

| Spec                                                          | Relationship                                                                                                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md)   | **Required** — owns recipe visibility (`FR-003`), public read (`FR-004`), the clone chain (`FR-005`), soft-delete/erasure (`C-007`) and the C-004 policy                |
| [002-user-auth](../002-user-auth/spec.md)                     | **Required** — owns account creation, the only moment an agreement can be presented, and the erasure cascade. **Has no terms-acceptance, consent or age surface today** |
| [004-recipe-importing](../004-recipe-importing/spec.md)       | **Required** — owns provenance (`FR-011`), attribution (`FR-010`), per-item attestation (`FR-014a`), photo extraction (`FR-008`), robots handling (`FR-023`)            |
| [010-subscriptions](../010-subscriptions/spec.md)             | **Required** — owns the tier model and billing. **Has no auto-renewal disclosure or cancellation surface today**                                                        |
| [011-recipe-digitization](../011-recipe-digitization/spec.md) | **Referenced** — owns digitization provenance and its mandatory attribution (`FR-021b`)                                                                                 |
| [012-creator-profiles](../012-creator-profiles/spec.md)       | **Referenced** — currently the ONLY spec containing a DMCA route (`FR-022`). This feature takes ownership of takedown portfolio-wide; 012 becomes a consumer            |
| [015-publishing-rewards](../015-publishing-rewards/spec.md)   | **Referenced** — its inducement hazard is a direct input here; 015's `FR-016`–`FR-018` consume the takedown process this feature specifies                              |
| [005-ai-integration](../005-ai-integration/spec.md)           | **Referenced** — owns AI features; this feature owns the disclosure obligations attached to them                                                                        |
| [009-nutrition-planning](../009-nutrition-planning/spec.md)   | **Referenced** — already flags GDPR Article 9 special-category data; this feature owns the lawful-basis surface for it                                                  |

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
be revoked. The corpus is a strategic asset (`docs/competitive/02-gap-analysis-and-strategy.md` §0); we license
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
   that image is persisted to our storage (Q2 governs whether it is referenced or omitted).
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
- **Erasure collides with the licence.** A user erases their account; their published recipe has clones. Q3
  decides whether the clones survive.
- **A user in one market is served content lawful in another.** If markets are gated (Q1), the gate must be
  evaluated at read time, not only at publish time.
- **The registered agent registration lapses.** It expires every three years and a lapse is a lapse in safe
  harbour. This must be an owned, alarmed calendar item, not tribal knowledge.
- **A minor creates an account and publishes.** The age floor must be enforced before the first publication,
  not only at signup, or the floor is decorative.
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
  content or erases the account, and the product MUST behave the way the licence says. [NEEDS CLARIFICATION:
  see Q3 — do clones survive deletion and erasure]
- **FR-013**: The terms MUST include a representation that the user has the rights necessary to upload the
  content and to grant the licence, recorded per-account at acceptance.
- **FR-014**: For content classified as **not authored by the uploader**, the per-item attestation of
  `004-FR-014a` — contemporaneous, specific, with a citation — MUST be the controlling instrument. A blanket
  terms-level representation MUST NOT be relied on in its place.
- **FR-015**: Any indemnity taken from a consumer MUST be limited to what is proportionate and MUST NOT
  purport to make the user liable for the operator's own acts.

#### C. Notice, action, redress and repeat infringement

- **FR-016**: The system MUST provide an electronic notice mechanism, reachable **without an account**, that
  accepts a notice identifying the specific content, the grounds, and the notifier's contact details, and MUST
  issue an acknowledgement with a reference.
- **FR-017**: Notices MUST be processed in a timely, diligent, non-arbitrary and objective manner, and each
  decision MUST record who decided, when, on what ground, and what action was taken.
- **FR-018**: When content is removed, disabled, demoted or restricted, the system MUST deliver the uploader a
  **statement of reasons** identifying the action, the ground relied on (legal provision or terms clause), the
  facts relied on, whether automated means were used, and the redress available.
- **FR-019**: The system MUST provide a counter-notice path, record it, and record the restoration decision
  and its date.
- **FR-020**: The system MUST maintain a per-account record of actioned notices and MUST terminate accounts
  that cross a defined repeat-infringer threshold, applying the policy consistently and retaining the trail.
  The threshold value and window are an owner decision (Owner decisions #2); the requirement is that a single
  defined threshold is applied to every account without exception.
- **FR-021**: The repeat-infringer policy MUST be published and users MUST be informed of it; the threshold
  itself MAY remain unpublished.
- **FR-022**: When a notice is actioned against content that has been cloned, the system MUST identify the
  derived copies and make them actionable in the same decision. Removing only the original MUST NOT be
  recorded as compliance.
- **FR-023**: An actioned notice MUST propagate to `015`'s reward ledger, reversing the grant that publication
  earned.
- **FR-024**: The system MUST rate-limit or otherwise resist abuse of the notice mechanism **without** refusing
  to receive notices, and MUST record any notice it declines to process along with the reason.
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
- **FR-027b**: The user MUST be able to replace a referenced photograph with one of their own from any surface
  the recipe is shown on. A replacement is user content: it is stored by us, covered by the user's licence
  (`FR-010`), and the reference is dropped once it exists.
- **FR-027c**: ⛔ The system MUST NOT produce any **derived rendition** of a referenced photograph —
  thumbnail, crop, re-encode, colour sample, cached copy or preview. Producing one requires fetching and
  copying the image, which is the reproduction `FR-027` exists to prevent. Referenced images are rendered by
  the client from the original host, at whatever size that host serves.
- **FR-027d**: A request for a referenced photograph MUST NOT carry account identifiers, credentials, cookies
  or a referrer beyond the bare origin, and the fact that viewing an imported recipe discloses the viewer's
  network address to the source host MUST be stated in the privacy notice.
- **FR-027e**: Referenced photographs MUST be treated as unavailable offline. An offline surface MUST render
  the placeholder; a user-supplied replacement MUST be available offline like any other user content. This is
  a known interaction with offline cook mode and MUST NOT be resolved by caching the referenced image.
- **FR-028**: Every imported item MUST record the **channel** it arrived through, and channels MUST be
  classified as _user-supplied bytes_ or _operator-performed retrieval_, with the classification queryable.
- **FR-029**: Where more than one channel can satisfy a user's intent, the product MUST prefer a
  user-supplied-bytes channel, and MUST NOT silently upgrade a user-supplied action into an
  operator-performed retrieval.
- **FR-029a**: The operator MUST NOT price, package or gate a paid tier on access to imported third-party
  content, so that no financial benefit is directly attributable to it.

#### E. Corpus rights and anti-extraction

- **FR-030**: The terms MUST include an anti-extraction provision covering systematic extraction, scraping,
  and re-utilisation of the corpus, drafted as a contractual restriction on parties who accept the terms.
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

#### H. AI transparency

- **FR-045**: Where a user interacts directly with an AI system, the system MUST inform them unless it is
  obvious from the context.
- **FR-046**: Content generated or materially altered by AI MUST carry a machine-readable marking at rest and
  a human-legible label where displayed, and the label MUST reflect the content's **current** state after
  human editing.
- **FR-047**: AI-derived fields MUST be distinguishable from user-authored ones by more than colour.

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
  right claimed; the current scope of Australian safe harbour for commercial platforms; whether recipe
  extraction is text-and-data-mining for the purposes of the EU reservation, which collides with
  `004-FR-023`'s deliberate decision to import despite a wildcard `Disallow`; and the drafting of every
  document surface here.
- **FR-051**: Nutrition figures and allergen-relevant content MUST carry a reachable disclaimer, and the
  product MUST NOT state or imply a medical claim.

#### J. Records and auditability

- **FR-052**: Acceptance records, consent records, attestations, notices, decisions, statements of reasons,
  counter-notices and termination decisions MUST be retained for at least as long as the content or account
  they relate to, and MUST survive the content's deletion where the record is the evidence of a decision.
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
- **SC-003**: 100% of removal actions have a delivered statement of reasons; the count of removals without one
  is zero, not low.
- **SC-004**: For any published item, the full compliance history — publisher, terms version, attestation,
  channel, provenance, notices — can be produced on demand as one record, in under 5 seconds.
- **SC-005**: Zero third-party photographs obtained through import — and zero derived renditions of one — are
  present in operator-controlled storage, verified by an automated, continuously-run assertion rather than by
  periodic inspection.
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

## Assumptions

- **The documents are drafted by counsel.** This specification defines the surfaces, records and behaviours; it
  does not write the words, and no requirement here depends on particular wording.
- **The operator is a US-formed entity with no EU establishment.** This is what makes the EU database right
  unavailable (Art. 11) and it is the assumption behind `FR-031`. If an EU entity is created, Layer 3 of the
  research reopens.
- **The service is treated as a hosting service for user content.** Notice-and-action obligations attach to
  hosting providers regardless of size — the micro/small-enterprise exclusion covers the _online-platform_
  section, not the hosting section — so size is not a defence here.
- **D4a and D4b land** (`docs/competitive/02-gap-analysis-and-strategy.md`): free users may set their own
  recipes private, and imported public content becomes private-to-the-importer by default. `FR-038` assumes
  the first; the reproduction controls are materially cheaper under the second.
- **Erasure, provenance, attribution and billing exist.** This feature adds surfaces and records over them and
  owns none of their mechanics.
- **A human decides notices.** Volume is low; no automated adjudication is specified, and `FR-018`'s
  "whether automated means were used" is therefore expected to read "no" at launch.
- **The federal US auto-renewal rule is absent, not pending.** It was vacated in July 2025 and re-proposed in
  March 2026; `FR-040`–`FR-043` are written to the stricter state regimes and platform rules instead, which
  makes them robust to whatever replaces it.
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

## Clarifications

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

## Owner decisions required

Distinct from the three clarifications below, these change the work but are not blocking the spec:

1. **Do we create an EU establishment to hold a database right?** It is the only route to the one right that
   would protect the corpus against extraction, and it carries tax, data-protection and corporate consequences
   far outside this feature. Recommendation: **no, not for this reason alone** — Layer 4's contractual fence
   is what actually gets enforced.
2. **Repeat-infringer threshold.** A number and a window. It must be consistently applied; the value is a
   policy call.
3. **Do we publish transparency numbers voluntarily?** Cheap, differentiating against a competitor whose
   documents contradict their marketing, and it commits us to keeping the numbers clean.
4. **Who owns the registered-agent renewal?** A named human, not a team.

---

## Clarifications needed

One question remains open. Q1 (market scope) and Q2 (import photographs) are resolved — see C-016-001 and C-016-002.

## Question 3: What survives deletion — the licence's duration

**Context**: `FR-012a` and the interaction between the content licence, `001-FR-005`'s clone chain, and
`001-C-007`'s erasure. A user publishes a recipe; it is cloned by ten people; the user then deletes it, or
erases their account.

**What we need to know**: Do the clones survive?

**Suggested Answers**:

| Option | Answer                                                                         | Implications                                                                                                                                                                                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | **Clones survive; the licence for already-distributed copies is irrevocable**  | Standard platform posture and the only one that makes cloning safe to offer — a clone the author can destroy is not a copy the cloner can rely on. Costs: it is the term users most object to, and it sits awkwardly against an erasure promise. Requires saying so plainly at the point of publication, not only in the document. |
| B      | **Erasure removes the clones too**                                             | The strongest privacy promise in the category and a real differentiator. Costs: it breaks other users' collections through no act of theirs, and the cascade is expensive to build and to reason about.                                                                                                                            |
| C      | **Clones survive but are de-attributed and de-linked from the erased account** | Keeps the cloner's copy working while removing the erased user's identity from it. Middle cost. The content itself still exists, so it is not full erasure and must not be described as such.                                                                                                                                      |
| Custom | Provide your own answer                                                        | Including a split: deletion (author's choice) behaves one way, erasure (a right) behaves another.                                                                                                                                                                                                                                  |

**Your choice**: _[Wait for user response]_
