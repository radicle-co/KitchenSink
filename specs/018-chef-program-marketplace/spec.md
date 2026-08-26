# Feature Specification: Chef Program & Marketplace Monetization

**Feature Branch**: `chore/code-quality-enforcement-phase-1-2` (PR 91 — no new branches, per standing directive)
**Feature Directory**: `specs/018-chef-program-marketplace`
**Created**: 2026-08-26
**Status**: Draft — 3 owner clarifications open (see [Clarifications](#clarifications))
**Input**: User description: "a special kind of user named a 'chef' … sign up to become a chef as part of the chef program … discoverable in the chefs page or via the recipes they create … their own dedicated public page that features their recipes and other content … users can buy recipes from them or videos, etc. we get a commission on purchases … we'll have other user types that enable different things or give permissions, like admin, developer, superuser … can we generate revenue from users going to the chef page and any public recipes the chef has and share the money with the chef and us … this kind of touches the question of how to monetize free users too."

---

## Dependencies

| Spec                                                                        | Relationship                                                                                                                                                                      |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [002-user-auth](../002-user-auth/spec.md)                                   | **Required** — identity, the signed `public_metadata` scopes/permissions channel, suspension, impersonation audit (`002-FR-036`, `002-FR-037`)                                    |
| [010-subscriptions](../010-subscriptions/spec.md)                           | **Required** — owns the payment processor relationship, the subscriber tier, and the entitlement claim (`010-FR-044`). This feature adds the **money-out** half it lacks.         |
| [012-creator-profiles](../012-creator-profiles/spec.md)                     | **Required** — owns `CreatorProfile`, `@handle`, the public page, follows, collections, the tip jar (`012-FR-031`…`033`) and the earnings surface (`012-FR-034`)                  |
| [013-cooking-school](../013-cooking-school/spec.md)                         | **Required** — owns video lessons/courses and the purchase flow; `013-FR-010`'s 20%/80% split is settled here                                                                     |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md)                 | **Required** — owns recipe visibility (`001-FR-003`), public read (`001-FR-004`) and the clone chain (`001-FR-005`…`005d`)                                                        |
| [004-recipe-importing](../004-recipe-importing/spec.md)                     | **Required** — owns the `sourceType` provenance vocabulary (`004-FR-011`) and per-item attestation (`004-FR-014a`); nothing a chef did not author may be sold                     |
| [015-publishing-rewards](../015-publishing-rewards/spec.md)                 | **Constraining** — rewards are non-monetary and non-purchasable by requirement (`015-FR-007`, `015-FR-030`). This feature must not become the paid route around them.             |
| [016-legal-compliance-framework](../016-legal-compliance-framework/spec.md) | **Constraining** — consumer disclosure (`016-FR-040`…`044`), the content licence (`016-FR-010`…`015b`), notice-and-action (`016-FR-016`…`019`), per-market posture (`016-FR-048`) |
| [014-notification-service](../014-notification-service/spec.md)             | **Referenced** — application decisions, payout events, dispute deadlines and takedown notices need a delivery channel                                                             |

---

## Why this feature exists

Three recorded facts converge on this specification.

1. **The portfolio has a named, unowned decision, and two features are blocked on it.**
   [`v1-launch-plan.md`](../v1-launch-plan.md) `M6` carries the item verbatim: _"Decide the
   marketplace-payments question … Either bring it into `010`'s scope here or stand up a dedicated payments
   feature."_ `012`'s own spec says the same: _"Marketplace payments need their own spec — in 010 or a
   dedicated payments feature — including the money-transmission and tax posture that splitting third-party
   revenue implies."_ Blocked today: `012-FR-031`…`012-FR-034` (tip jar + earnings) and `013-FR-010` (the
   20%/80% revenue share). **This feature is that spec.** `010` stays the **money-in** feature (a first-party
   subscription we sell to our own user); `018` is the **money-out** feature (money we collect on behalf of a
   third party and remit, minus a commission). Those are different legal and operational animals and the
   portfolio has been treating them as one.

2. **`012` already gives every user a public creator page — and that is precisely the problem.**
   `012-FR-001` lets _any_ user claim an `@handle`. There is therefore no supply-side signal: nothing marks a
   vetted professional, nothing gates who may transact, and nothing tells a buyer whose recipe they are about
   to pay for. **"Chef" is that signal.** It is a _program membership with obligations_, not a bigger profile
   — the chef page IS `012`'s `CreatorProfile` page, and this feature adds no second profile entity
   (`GR-014` AC-014-b forbids one).

3. **The recorded business model already contains this layer, and already bounds it.**
   [`executive/05-business-plan.md`](../executive/05-business-plan.md) names four revenue layers: free
   household utility, consumer subscription, **creator monetization** ("paid content/courses,
   affiliate/shoppable recipes, and revenue share"), and **commerce upside** ("affiliate/partner revenue").
   ⚠️ **Advertising is not among them.** The user's question — _can we monetize traffic to chef pages and
   public recipes, and share it with the chef?_ — has a recorded answer that is _commerce_, not _attention_.
   Choosing display advertising instead would be a departure from the recorded model, not an extension of it.
   That is [Clarification C-018-003](#c-018-003--attention-vs-commerce-how-a-free-visitor-generates-revenue).

### ⛔ The four hazards this specification is designed around

**H1 — A marketplace is a legally different entity than a publisher, and none of that apparatus exists.**
Today the product sells one thing: its own subscription, to its own user (`010`). The moment a buyer pays for
a _third party's_ content and we keep a cut, the product acquires obligations no spec currently owns: who the
**seller of record** is, whether we are a payment facilitator or a money transmitter, marketplace-facilitator
sales-tax/VAT collection, **seller identity and tax-status collection** (US `1099-K`; EU `DAC7`;
EU DSA trader traceability), refund and chargeback liability, and consumer withdrawal rights.
`016` explicitly out-of-scopes this — _"Payment-card and tax compliance (owned by `010` and its processor)"_ —
and `010`'s scope is `010-FR-040`…`044`, which contains none of it. **The gap is real, it is here, and the
cheapest moment to be right about it is before the first cent moves.**

**H2 — A purchasable recipe is currently a governance violation, and reversing that is a one-way door.**
`GR-014` states it flatly: _"Recipe visibility is binary … There is no premium, paywalled, or purchasable
recipe state, and no feature may introduce one."_ `AC-014-d` adds: _"`price_cents` appears **only** on a
`published-lesson` audience … recipes and collections are not [purchasable]. A priced recipe audience is a
violation."_ `012` drafted exactly this feature's recipe half and **withdrew** it, burning `012-FR-035`…
`012-FR-039` so the IDs can never silently resolve to something else. The user is now asking for
"users can buy recipes from them". ⛔ **This specification does not quietly reverse a ratified governance
rule.** It states the collision, sets out the three ways to satisfy the ask, and puts the choice to the owner:
[C-018-001](#c-018-001--what-may-a-chef-actually-sell).

**H3 — A commission is an inducement, and `015` was built to remove inducements.**
`015`'s central hazard is stated in its own words: _"A reward for publishing is an inducement to publish, and
an inducement to publish content the user does not own is precisely what creates contributory liability and
can forfeit safe-harbour protection."_ `015` answered it by making every reward **non-monetary,
non-transferable, and non-purchasable** (`015-FR-007`, `015-FR-030`) and restricting earning to content the
publisher **authored** (`015-FR-001`). **Money is a far stronger inducement than a private-recipe slot.**
Every eligibility control `015` and `004` built therefore binds _harder_ here, not softer — and the chef
program must never become the paid path around them.

**H4 — Monetizing free users with attention buys revenue with the consent surface `016` has not budgeted.**
Display advertising at any meaningful yield means third-party tracking, which means per-purpose consent
records (`016-FR-007`), a recorded age basis (`016-FR-008`), and a data-sharing disclosure — on a product
whose recorded positioning is _"your cooking operating system"_ and whose free tier exists to _"build trust and
retention"_ ([`04-product-plan.md`](../executive/04-product-plan.md): _"free users must get real cooking
utility before seeing upgrade pressure"_). The commerce alternative already in the business plan —
affiliate/shoppable ingredients, which `007` already contemplates adapters for — carries a fraction of that
surface. See [C-018-003](#c-018-003--attention-vs-commerce-how-a-free-visitor-generates-revenue).

---

## What this feature owns, and what it deliberately does not

| Concern                                                                 | Owner                                   |
| ----------------------------------------------------------------------- | --------------------------------------- |
| Chef program: application, review, approval, standing, revocation       | **018 (here)**                          |
| Chef badge, chef directory, chef attribution on recipes                 | **018 (here)**                          |
| Capability-grant model (staff privileges + program memberships)         | **018 (here)**                          |
| Seller onboarding, payout account, commission, ledger, payouts          | **018 (here)**                          |
| Buyer purchase record, entitlement to purchased items, refunds          | **018 (here)**                          |
| Seller tax identity, reporting thresholds, statements                   | **018 (here)**                          |
| The public page a chef is featured on (`@handle`), follows, collections | 012 — extended here, never re-declared  |
| Video lessons, courses, transcode, enrollment, progress                 | 013 — priced and settled here           |
| Recipe entity, visibility, clone chain                                  | 001                                     |
| Subscriber tier, first-party billing, entitlement claim                 | 010                                     |
| Terms, licence, notice-and-action, consumer disclosure text             | 016                                     |
| Non-monetary publishing rewards and contributor standing                | 015 — this feature must not monetize it |

⛔ **No second profile entity, no second sharing primitive, no second follow graph, no second video pipeline.**
`GR-014` AC-014-b prohibits it and the chef page would fork from the creator page within one release.

---

## Personas

Sourced from the canonical library (`GR-013`, `cross-feature-consistency-report.md` §9). No one-off personas.

- **Primary (supply) — P9 Drew** (Professional Chef): has a brand and a body of original work, wants a
  credible public presence and to be paid for it.
- **Primary (supply) — P11 Robin** (Recipe Creator): already has `012`'s profile; the chef program is the
  step from "has a page" to "has a business".
- **Primary (demand) — P5 Morgan** (Discovery Seeker): finds chefs, decides whom to trust, buys.
- **Secondary — P12 Jamie** (Cooking Student) and **P13 Reese** (Cooking Educator): the `013` course pair,
  whose compensation path this feature unblocks.
- **Secondary — P1 Casey** (Beginner Cook): the _free_ visitor whose monetization is question three.

**Internal stakeholders** (not user personas): Support/Admin Operator, Compliance Reviewer (adjudicates
`016`'s notices and this feature's program appeals), Finance Operator (reconciles the ledger, resolves
disputes), Operations Engineer.

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Apply to the Chef Program and be admitted (Priority: P1)

A cook with a body of original work applies to become a chef. They are told, before they start, exactly what
the program requires of them, what it grants, and what the platform's cut will be on anything they later sell.
They submit an application. A reviewer decides it. They are notified either way, with a reason and — on
refusal — a stated path to reapply. On approval their existing `@handle` page gains chef standing.

**Why this priority**: It is the entire supply side, and it is the only story here that moves no money — so it
is the one slice that can ship, be observed, and prove the program has takers before a single payments,
tax or commission obligation is incurred. Everything else in this feature depends on there being chefs.

**Independent Test**: Submit an application from a non-chef account, decide it from a reviewer account, and
verify the applicant's standing, notification, and public page change exactly as stated — with no payment
capability present anywhere.

**Acceptance Scenarios**:

1. **Given** a signed-in user who is not a chef, **When** they open the chef program, **Then** the system
   states the eligibility criteria, the obligations accepted on admission, the benefits granted, and the
   platform's commission rate, before any application field is presented.
2. **Given** a completed application, **When** it is submitted, **Then** it is durably recorded with its
   submitted content, the applicant sees a pending state with a stated decision target, and the application
   appears in the reviewer queue.
3. **Given** a pending application, **When** a reviewer approves it, **Then** the applicant's chef standing
   becomes active, the decision is recorded with who decided and when, and the applicant is notified.
4. **Given** a pending application, **When** a reviewer refuses it, **Then** the applicant is notified with
   the ground for refusal and the earliest date they may reapply, and no chef capability is granted.
5. **Given** an account that has not accepted the current terms, or is suspended (`002-FR-041`), **When** it
   attempts to apply, **Then** the application is refused with the reason stated.
6. **Given** an approved chef, **When** they withdraw from the program, **Then** chef standing ends, their
   recipes and profile survive unchanged, and any money already owed to them remains owed.

---

### User Story 2 - Be discovered as a chef (Priority: P1)

A signed-out or signed-in visitor browses a chefs directory, filters it, opens a chef, and lands on that
chef's page. Separately, a visitor who arrives at a public recipe can see that a chef authored it and can
reach that chef in one action.

**Why this priority**: Discovery is the other half of supply having any point, and — like US1 — it involves no
money. It is also the story that determines whether the program produces the acquisition and SEO value the
business plan attributes to creator-led distribution.

**Independent Test**: With a set of approved chefs and their public recipes, verify the directory lists them,
filters them, and that every public recipe authored by a chef links to that chef's page and back.

**Acceptance Scenarios**:

1. **Given** approved chefs exist, **When** an unauthenticated visitor opens the chefs directory, **Then**
   they see chefs with active standing, in a stated and reproducible order, without signing in.
2. **Given** the directory, **When** the visitor filters or searches it, **Then** results reflect only chefs
   whose standing is active and whose page is not deactivated or suspended.
3. **Given** a public recipe authored by a chef, **When** any visitor views it, **Then** the chef's identity is
   shown with a link to their page, using `012-FR-010`'s existing attribution surface rather than a new one.
4. **Given** a chef whose standing is suspended or withdrawn, **When** the directory is rendered, **Then** they
   do not appear, their page follows `012-FR-004`/`012-FR-020`, and their recipes remain readable per `001`.
5. **Given** a chef and a non-chef with equally matching content, **When** discovery ranks them, **Then** the
   ranking rule applied is stated and identical for both — chef standing may be a _label_, and whether it is
   also a _ranking input_ is a stated, reviewable rule, never an unstated boost.

---

### User Story 3 - A chef can be paid, and the split is honest (Priority: P1)

A chef sets up the ability to receive money: they provide the identity and tax information required of a
seller, and confirm a payout destination. They see the commission rate that will apply, before they list
anything. After sales occur they can see, per transaction: what the buyer paid, what the platform kept, what
processing cost, and what is owed to them — and they can see when it will be paid and when it was paid.

**Why this priority**: This is the blocked capability the portfolio has been waiting on. It is P1 because
`012-FR-031`…`034` and `013-FR-010` cannot ship without it — and because a marketplace that cannot show a
seller their own numbers, to the cent, is not shippable at any scale.

**Independent Test**: Onboard a chef to seller status, record a purchase against them, and verify the ledger
entry reconciles exactly (gross = commission + processing + net), the statement shows it, and a payout moves
the net with a recorded reference.

**Acceptance Scenarios**:

1. **Given** an approved chef with no seller record, **When** they attempt to list anything for sale, **Then**
   the action is refused until seller onboarding — identity, tax status, and payout destination — is complete.
2. **Given** a chef beginning seller onboarding, **When** the commission is displayed, **Then** it is the exact
   rate that will apply, expressed as both a percentage and a worked example on a stated price.
3. **Given** a completed purchase, **When** the chef opens their earnings, **Then** they see gross amount,
   platform commission, payment-processing cost, net owed, and the current state of that amount, and the four
   figures reconcile to the gross exactly.
4. **Given** net earnings above the payout minimum, **When** the payout schedule elapses, **Then** a payout is
   initiated, recorded with a reference, and reflected in the chef's balance — and a failed payout is
   surfaced to the chef with the reason and does not silently retry forever.
5. **Given** a chef who has not completed tax-status collection, **When** they reach a reporting threshold,
   **Then** payouts are withheld with the reason stated and the remedy given, rather than failing opaquely.
6. **Given** any ledger entry, **When** it is inspected, **Then** it names the purchase, the buyer-facing
   amount, every deduction with its reason, and cannot be edited in place — corrections are new entries.

---

### User Story 4 - Buy something from a chef (Priority: P1)

A buyer sees a chef's paid item with its price and exactly what they will receive, before paying. They pay.
Access is granted immediately and is durable. They receive a receipt. If something is wrong, they can seek a
refund through a stated path, and if the item disappears they are not left having paid for nothing.

**Why this priority**: The demand side of the same transaction. It cannot be split from US3 in a release —
taking money without the ability to give it back is the failure mode with the largest blast radius here.

**Independent Test**: Purchase a chef item as a buyer, verify immediate durable access, a receipt, the
recorded consumer disclosures, and that a refund reverses both the entitlement and the chef's net.

**Acceptance Scenarios**:

1. **Given** a paid chef item, **When** a buyer views it before purchase, **Then** the price, what is
   received, whether it recurs, and how to obtain a refund are all disclosed on the surface they pass
   through — satisfying `016-FR-040` — and any statutory withdrawal right is disclosed (`016-FR-043`).
2. **Given** a completed payment, **When** the buyer returns, **Then** their access is present, survives
   sign-out and device change, and is not dependent on their subscription tier.
3. **Given** a completed payment, **When** it settles, **Then** the buyer receives a receipt naming the seller,
   the item, the amount, the date, and the reference.
4. **Given** a purchased item that the chef later unpublishes or the platform removes on a valid notice
   (`016-FR-016`…`019`), **When** the buyer opens it, **Then** the outcome is the one the terms state, it is
   the same outcome in every such case, and the buyer is told which it is.
5. **Given** a refund is granted, **When** it completes, **Then** the buyer's entitlement and the chef's net
   both reverse, the reversal is a new ledger entry rather than an edit, and both parties are notified.
6. **Given** a payment that fails, is disputed, or is charged back, **When** the outcome is known, **Then** the
   entitlement state matches the money state — there is never durable access to an unpaid item, nor a paid
   item with no access.

---

### User Story 5 - Staff capability is a grant, not a user type (Priority: P2)

An operator is given exactly the capabilities their job needs — reviewing chef applications, adjudicating
notices, issuing refunds, inspecting the ledger, using a developer diagnostic — each granted explicitly, each
recorded, each revocable, and each independent of whether that person is also a chef, a subscriber, or a buyer.

**Why this priority**: P2 because US1–US4 can be demonstrated with a single hard-coded reviewer, but no
further — the moment refunds and payouts exist, "who may move money" must be a first-class, audited answer.
It is specified here because this feature is the first to need more than one privileged role.

**Independent Test**: Grant one capability to an account, verify exactly that capability is permitted and
every other privileged action is refused, revoke it, and verify the refusal and the audit record.

**Acceptance Scenarios**:

1. **Given** an account with no capability grants, **When** it requests any privileged operation, **Then** the
   operation is refused and the refusal is recorded.
2. **Given** an account granted a single capability, **When** it exercises that capability, **Then** the action
   succeeds and is attributed to that account; **When** it attempts any other privileged operation, **Then**
   that operation is refused.
3. **Given** a capability grant, **When** it is created, changed or revoked, **Then** who granted it, to whom,
   which capability, when, and why are recorded immutably, and the grant takes effect within a stated bound.
4. **Given** a chef account, **When** its chef standing changes, **Then** no staff capability changes — the two
   axes are independent, and neither is derivable from the other.
5. **Given** an operator with a capability that can move money, **When** they exercise it, **Then** the action
   requires a recorded reason and appears in the affected chef's and buyer's own records, not only in an
   internal log.
6. **Given** an operator acting as another user (`002-FR-036`, `002-FR-037`), **When** they do so, **Then** they MUST NOT be
   able to initiate a payout, a refund, a program decision, or a purchase in that user's name.

---

### User Story 6 - A chef's standing can be lost, and the money question is answered (Priority: P2)

A chef who repeatedly publishes or sells content they had no right to loses program standing. The process is
the one `016` already defines for notices — same queue, same deadlines, same statement of reasons, same
appeal. Buyers who already paid are not silently stranded, and money already earned on content that was not
theirs is handled by a stated rule rather than an improvised one.

**Why this priority**: P2 because it is not needed to demonstrate the happy path, and P2-not-P3 because a
marketplace with no removal path is a liability that grows with every sale. `015`'s equivalent
(`015-FR-016`…`019`) already sets the shape; money makes the stakes higher, not the design different.

**Independent Test**: File a valid infringement notice against a sold chef item, run it to a decision, and
verify the item's availability, the buyer's position, the chef's standing, the withheld or reversed earnings,
and the appeal path all behave as stated.

**Acceptance Scenarios**:

1. **Given** an unresolved infringement notice against a chef item, **When** earnings from it would become
   payable, **Then** they are withheld rather than paid, and the chef is told why and for how long.
2. **Given** a notice decided against the chef, **When** the item is removed, **Then** buyers are handled by
   the stated rule (US4 scenario 4), the corresponding earnings are reversed, and both sides are notified.
3. **Given** a chef exceeding the stated number of upheld notices, **When** the threshold is crossed, **Then**
   chef standing is suspended, the reason and appeal path are given, and pending payouts of _unaffected_
   earnings are not confiscated.
4. **Given** a suspended chef, **When** they appeal successfully, **Then** standing is restored and withheld
   earnings become payable, with the whole sequence reconstructable from the record.
5. **Given** any program decision — admission, refusal, suspension, restoration — **When** it is made, **Then**
   it carries who decided, when, on what ground, and what action followed, per `016-FR-017`.

---

### User Story 7 - A free visitor generates revenue, and the chef shares in it (Priority: P3)

A visitor who pays for nothing still arrives at a chef page or a public recipe. That visit generates revenue,
and a stated share of it reaches the chef whose content drew the visitor.

**Why this priority**: P3 because it is the only story here that is **strategy before scope** — its mechanism
is not yet chosen, its legal surface differs by an order of magnitude between the candidate mechanisms, and it
is the one part of this feature that changes what the product _is_ to a free user. It is specified last on
purpose and gated on [C-018-003](#c-018-003--attention-vs-commerce-how-a-free-visitor-generates-revenue).

**Independent Test**: Not yet defined — the test depends on the mechanism chosen. Recorded as blocked rather
than guessed at.

**Acceptance Scenarios**: Deferred to C-018-003. What is **already fixed** regardless of the answer:

1. **Given** any revenue attributed to a chef's page or content, **When** it is calculated, **Then** the chef
   can see the attributed amount, the share rate, and the period, at the same fidelity as US3's ledger.
2. **Given** a mechanism requiring consent under `016-FR-007`, **When** consent is absent or refused, **Then**
   the surface degrades to a state that still works, and refusal is not penalized in any way.
3. **Given** a free visitor, **When** they use the product, **Then** no capability they had before this
   feature is removed in order to create room for this revenue (`015-FR-014`'s principle, applied to a
   different currency).

---

### Edge Cases

- **A chef sells a recipe, and public recipes are cloneable.** `001-FR-005` lets any authenticated user clone
  a public recipe. If a sellable recipe is also public, the clone chain is a free copy of the paid good; if it
  is private, `001-FR-005c` forbids anyone but the owner copying it, so a _buyer_ cannot receive one at all.
  **There is no consistent behaviour available under the current model** — this is H2 in concrete form and is
  exactly what C-018-001 must resolve.
- **A chef publishes a recipe and also sells it.** Which price does a buyer who already has free access see?
  Does publishing after selling refund anyone?
- **A chef's recipe is a clone of another user's** (`001-FR-005b` permits publication after a substantive
  edit). A derivative work may be publishable and still not be _sellable_.
- **A chef imports a recipe from a public web source** (`004`, `sourceType = imported_public`). `015-FR-001`
  already says it earns nothing; selling it must be refused outright, not merely unrewarded.
- **A chef account is erased under GDPR** while holding an unpaid balance, unsettled disputes, and live
  buyers. Erasure obligations, retention obligations for financial records, and buyers' entitlements pull in
  three directions.
- **A buyer erases their account** after purchasing. Their entitlement disappears; the chef's earned money and
  the transaction record must not.
- **A chargeback arrives after the chef has been paid out**, and the chef's balance is now zero or negative.
- **A payout fails permanently** because the destination is closed, and the balance has nowhere to go.
- **A chef is admitted, sells, and is then found to have misrepresented their identity at application.**
- **A price is changed while a buyer is mid-checkout**, or an item is unpublished mid-checkout.
- **Currency and market**: a buyer in a market the product is not configured to serve (`016-FR-048a` requires
  fail-closed) attempts a purchase, or a chef requests payout in a currency we do not settle.
- **Two accounts claim the same real-world chef identity**, or a chef's `@handle` is transferred.
- **A staff operator is also a chef** — a reviewer approving their own application, or issuing a refund
  against their own sale.
- **A capability grant is revoked mid-request**, or an operator's token still carries a capability that was
  revoked seconds ago (the staleness question `010-FR-044` already names, with money attached).
- **The commission rate changes** while items are listed and while unpaid balances exist.
- **A chef with zero sales** — the program must be worth joining before any money exists, or supply never forms.
- **Sales tax / VAT is owed on a purchase** in a jurisdiction where the marketplace, not the seller, is the
  collector of record.

---

## Requirements _(mandatory)_

### Functional Requirements

#### A. The Chef Program — standing and lifecycle

- **FR-001**: The system MUST model chef standing as an explicit lifecycle with exactly these states:
  `none`, `applied`, `active`, `suspended`, `withdrawn`. Every transition MUST be an explicit, recorded event;
  standing MUST NOT be inferable from any other attribute (subscription tier, follower count, recipe count).
- **FR-002**: Chef standing MUST be a **program membership**, not a permission bundle. Any capability it
  grants MUST be expressed as a capability under Section C, so that the question "what may this account do"
  has exactly one answer regardless of how the account obtained it.
- **FR-003**: The system MUST state, before an application begins: the eligibility criteria, the obligations
  accepted on admission, the benefits granted, the commission rate that will apply to sales, and the grounds
  on which standing can be lost. A term first disclosed _after_ admission MUST NOT be enforceable against the
  chef for content published before it was disclosed.
- **FR-004**: An application MUST be durably recorded on submission, with the content the applicant supplied
  and the version of the program terms in force at that moment, and MUST survive any subsequent edit to those
  terms.
- **FR-005**: Every application MUST reach a recorded decision — admitted or refused — carrying who decided,
  when, on what ground, and what action followed. A decision MUST NOT be automatic; admission MUST require a
  human reviewer holding the review capability (`FR-019`).
- **FR-006**: A refused applicant MUST be told the ground for refusal and the earliest date they may reapply.
  Refusal MUST NOT remove any capability the account already had.
- **FR-007**: An account MUST be ineligible to apply while it is suspended (`002-FR-041`), while it has not
  accepted the terms in force (`016-FR-001`…`FR-009`), or while it stands within the repeat-infringement
  threshold of `FR-066`.
- **FR-008**: A chef MUST be able to withdraw from the program at any time, in one action. Withdrawal MUST end
  chef standing and remove the chef from discovery, MUST NOT delete or unpublish any recipe or profile, and
  MUST NOT extinguish money already owed to them (`FR-041`).
- **FR-009**: Chef standing MUST be revocable by the platform on the grounds stated at `FR-003`, following the
  process, deadlines and statement-of-reasons shape `016-FR-016`…`016-FR-019` already define. This feature
  MUST NOT create a second adjudication queue or a second appeal path.
- **FR-010**: Loss of chef standing MUST NOT retroactively alter the visibility, attribution or ownership of
  any recipe the chef authored. Standing governs the program, not the corpus.

#### B. Chef identity, page and discovery

- **FR-011**: A chef's public page MUST be the `CreatorProfile` page `012` owns (`012-FR-006`…`012-FR-008`),
  extended with chef standing. This feature MUST NOT introduce a second profile entity, a second `@handle`
  namespace, a second follow graph, or a second collections model (`GR-014` AC-014-b).
- **FR-012**: An `@handle` MUST be a precondition of chef standing: an account without an active
  `CreatorProfile` MUST NOT hold `active` standing.
- **FR-013**: The system MUST provide a chef directory, viewable without authentication, listing every chef
  with `active` standing and an active, unsuspended profile — and no others.
- **FR-014**: The directory's ordering MUST be a **stated, reproducible rule**. Whether chef standing
  influences ranking anywhere outside the directory MUST be stated explicitly and MUST be the same rule for
  every chef; an unstated ranking advantage MUST NOT exist.
- **FR-015**: The directory MUST be filterable and searchable on stated attributes, and MUST NOT expose any
  attribute of a chef that the chef has not chosen to make public.
- **FR-016**: Every public recipe authored by an `active` chef MUST surface that chef's identity and a link to
  their page, using `012-FR-010`'s existing attribution surface. Chef standing MUST NOT alter `012-FR-011`'s
  or `012-FR-012`'s attribution of imported or forked content.
- **FR-017**: Discovery surfaces MUST be reachable and complete for an unauthenticated visitor, and MUST NOT
  require a purchase, a subscription, or an account to browse.

#### C. Capabilities — two axes, never one enum

> ⛔ **This is the section most likely to be built wrong.** "Chef", "admin", "developer" and "superuser" are
> not four values of one field. **Chef is a public, applied-for, revocable program membership held by a
> customer. Admin/developer/superuser are internal privilege grants held by staff.** A single `userType`
> enum makes the two mutually exclusive (a chef cannot be an admin), makes each account hold exactly one
> (a support operator cannot also review notices), and makes a public-facing customer status share a field
> with the most dangerous privileges in the system. **Two independent axes, one capability vocabulary.**

- **FR-018**: Authorization MUST be decided from **capabilities**, never from a role name. A role name MUST be
  a _label for a set of capabilities_, and every enforcement point MUST test a capability.
- **FR-019**: The system MUST define a closed, enumerated capability vocabulary. At minimum it MUST include
  distinct capabilities for: reviewing chef applications; deciding notices and appeals; issuing refunds;
  inspecting the financial ledger; initiating or releasing payouts; suspending an account or a profile;
  acting as another user (`002-FR-036`, `002-FR-037`); and access to developer diagnostics. Each MUST be independently
  grantable — no capability MUST imply another by side effect.
- **FR-020**: A capability MUST be granted to a **specific account**, by an account holding the capability to
  grant it, with a recorded reason. Grants MUST be revocable, and revocation MUST take effect within a stated
  bound that the specification names. ⚠️ Where a capability is carried in a signed token, the staleness
  question `010-FR-044` raises binds harder here, because the stale window is a window in which revoked
  privilege still moves money.
- **FR-021**: Every privileged action MUST record the acting account, the capability relied on, the target,
  the time, and the reason, in an append-only record (`002-FR-036`'s immutable audit log is the mechanism;
  this feature adds subjects to it rather than a second log).
- **FR-022**: Program membership (chef standing) and staff privilege MUST be **independently assignable**.
  Neither MUST be derivable from the other, and changing one MUST NOT change the other.
- **FR-023**: A privileged operator MUST NOT decide, adjudicate, refund or pay out on a matter in which they
  are the counterparty — their own application, their own sale, their own dispute. The system MUST refuse it,
  rather than relying on policy.
- **FR-024**: While acting as another user (`002-FR-036`, `002-FR-037`), an operator MUST NOT be able to initiate a
  purchase, a refund, a payout, a program application, or a program decision.
- **FR-025**: Authorization MUST **fail closed**. An absent, unreadable, or unrecognised capability MUST be
  treated as _not granted_, never as granted, and never as a default set.

#### D. What may be sold — ⛔ blocked on C-018-001

> ⛔ **This section collides with ratified governance and cannot be written until the owner rules.**
> `GR-014` forbids any purchasable recipe state; `AC-014-d` forbids `price_cents` on anything but a
> `published-lesson`; `012` withdrew and burned `012-FR-035`…`012-FR-039` for exactly this. The requirements
> below state what is true under **every** candidate answer. The answer itself is `C-018-001`.

- **FR-026**: A chef MUST only be able to sell content whose provenance records them as its **author**
  (`004-FR-011`'s `user_created`), attested per item at the moment of listing under `004-FR-014a`'s
  contemporaneous, specific, citation-bearing form. A blanket terms-level representation MUST NOT substitute
  for it (`016-FR-014`). Imported, digitised, paid-source and cloned content MUST NOT be sellable under any
  circumstances.
- **FR-027**: Eligibility to sell MUST be decided by a **single authoritative rule**, evaluated at listing, at
  purchase, and at delivery, so that the three can never disagree. It MUST reuse the **existing** provenance
  policy rather than state a second one: `GR-014` AC-014-e already binds a single shipped policy as the sole
  implementation of that rule, and `ADR-0023` establishes that a decision of this class is a policy concern
  rather than a route-level check.
- **FR-028**: What a buyer receives MUST be stated in terms of a durable outcome — what they can see, do, and
  keep — before payment, and the delivered outcome MUST match it exactly.
- **FR-029**: [NEEDS CLARIFICATION: `C-018-001` — a chef's **sellable catalogue**. Video lessons and courses
  are already purchasable and already specced (`013-FR-001`…`FR-003`); the open question is **recipes**, which
  `GR-014` and `AC-014-d` presently forbid selling. Three candidate models with materially different
  consequences are set out in the Clarifications section: (a) recipes are not sellable — chefs sell only
  `013` video/course products; (b) a purchase delivers an owned, licensed **copy** into the buyer's own
  collection, leaving recipe visibility binary; (c) governance is amended to admit a paid recipe state.]
- **FR-030**: Whatever `C-018-001` decides, a purchase MUST NOT create a recipe state that `001`'s visibility
  policy, `001-FR-005`'s clone chain and `GR-014` cannot each describe consistently. A model that leaves the
  cloneability of a paid item undefined MUST NOT be implemented.
- **FR-031**: Pricing MUST be bounded by a stated minimum and maximum, MUST be in a currency the platform
  settles, and a price change MUST NOT alter the amount owed on a purchase already in progress.

#### E. The money — seller of record, commission, ledger and payouts

- **FR-032**: [NEEDS CLARIFICATION: `C-018-002` — the **seller of record**, and therefore the money-flow
  model. Either (a) the chef is the seller and the platform acts as a limited agent collecting on their
  behalf, or (b) the platform is the seller/reseller of record and pays the chef a share. The choice
  determines who owes consumer-refund duties, who is the sales-tax/VAT collector, whether we are a payment
  facilitator or approaching money transmission, whose name appears on the buyer's statement, and which tax
  forms are owed to whom. It is a one-way door and it must precede any implementation.]
- **FR-033**: A chef MUST complete **seller onboarding** — identity, tax status, and a payout destination —
  before any item of theirs may be listed for sale. A listing attempted without it MUST be refused with the
  remedy stated.
- **FR-034**: The platform's commission MUST be a **stated rate disclosed before listing**, with a worked
  example. `013-FR-010`'s 20% platform / 80% educator (15%/85% at the pro tier) is the rate this feature
  ratifies unless the owner sets another; a single rate MUST govern every product type unless a differing
  rate is stated per type.
- **FR-035**: A commission-rate change MUST NOT apply retroactively to a completed sale, and MUST be disclosed
  to affected chefs before it takes effect, with the effective date stated.
- **FR-036**: Every money movement MUST produce an entry in an **append-only ledger**. Entries MUST NOT be
  edited or deleted; a correction MUST be a new, linked entry. Each entry MUST name the purchase, the gross
  amount, every deduction with its reason, the net, and the resulting balance.
- **FR-037**: For every transaction, `gross = platform commission + payment-processing cost + chef net`, and
  the identity MUST hold exactly, in integer minor currency units, with a stated and consistent rounding rule.
  ⚠️ A rounding rule chosen per call site is how a marketplace ledger stops reconciling.
- **FR-038**: A chef MUST be able to see, for any period: gross, commission, processing cost, net, amount
  paid, amount pending, and amount withheld — with the reason for anything withheld. This is the surface
  `012-FR-034` describes and MUST be the only such surface.
- **FR-039**: Payouts MUST occur on a stated schedule above a stated minimum balance, MUST carry a reference
  the chef can quote, and MUST have exactly one terminal state per attempt. A failed payout MUST be surfaced
  to the chef with its reason and MUST NOT retry indefinitely without bound.
- **FR-040**: Payout initiation MUST be **idempotent per period per chef**. A retry MUST NOT be able to pay
  the same balance twice, under any concurrency, and the guarantee MUST be enforced by the system rather than
  by the caller's discipline.
- **FR-041**: Money owed to a chef MUST survive: withdrawal from the program (`FR-008`), suspension of
  standing (`FR-009`), deactivation of their profile (`012-FR-004`), and lapse of any subscription. Only an
  upheld infringement finding (`FR-065`) or a refund/chargeback (`FR-049`) MUST be able to reverse it.
- **FR-042**: A negative balance — caused by a refund or chargeback after payout — MUST be represented
  explicitly and recovered by a stated rule, and MUST NOT be silently zeroed or silently carried.
- **FR-043**: Purchase, ledger and payout operations MUST be resilient to duplicate delivery: the same
  external payment event MUST NOT create two purchases, two entitlements, or two ledger entries. ⚠️ Signature
  verification authenticates the sender and says nothing about the shape or the repetition — both controls are
  required, as `010`'s webhook section already establishes.
- **FR-044**: A payment outcome and the corresponding entitlement MUST be consistent at every observable
  moment: durable access MUST NOT exist for an unpaid item, and a paid item MUST NOT lack access.
- **FR-045**: Financial records MUST be retained for the period the applicable tax and accounting regime
  requires, and that retention MUST be reconciled explicitly with the account-erasure obligation of
  `002`/`016` — the specification MUST state which fields are erased and which are retained, and why.

#### F. Buyer protection

- **FR-046**: Before any charge, the system MUST disclose price, what is received, whether anything recurs,
  and how to obtain a refund, on a surface the buyer passes through rather than one they may discover
  (`016-FR-040`).
- **FR-047**: Where a jurisdiction confers a statutory withdrawal or cooling-off right, it MUST be disclosed
  at purchase (`016-FR-043`), and the product MUST behave the way the disclosure says.
- **FR-048**: A buyer MUST receive a receipt naming the seller, the item, the amount, the date and a
  reference, through a channel that does not depend on their remaining signed in.
- **FR-049**: A refund path MUST exist, MUST be stated at purchase, and MUST reverse the entitlement and the
  chef's net together. Neither MUST be reversible without the other.
- **FR-050**: A purchased item that is later unpublished by the chef, or removed by the platform on a valid
  notice, MUST resolve to a **single stated outcome** applied identically in every such case, and the buyer
  MUST be told which outcome applies at purchase time, not at removal time.
- **FR-051**: Purchased entitlements MUST be **independent of subscription tier**. A buyer who cancels a
  subscription MUST NOT lose access to anything they separately bought.
- **FR-052**: Cancellation of anything recurring MUST require no more interactions than starting it did, and
  MUST be confirmed in writing (`016-FR-041`); a purchase made through a platform store MUST route to that
  store's mechanism rather than dead-ending (`016-FR-042`).

#### G. Seller identity, tax and reporting

- **FR-053**: The system MUST collect and retain the seller identity and tax-status information required to
  pay a third party and to meet reporting obligations in every served market, **at seller onboarding** —
  before any sale, never retroactively. ⚠️ `016-FR-048b`'s seam-versus-capability test puts this on the
  **seam** side: collecting a seller's tax identity after the fact means re-prompting every chef, which is
  precisely the retrofit that rule exists to prevent.
- **FR-054**: The system MUST be able to determine, per transaction, who is responsible for collecting and
  remitting any transaction tax, and MUST record that determination with the transaction.
- **FR-055**: The system MUST be able to produce, per chef per reporting period, the totals a reporting
  obligation requires, and MUST make the same totals visible to the chef.
- **FR-056**: Where a reporting threshold is reached and the required information is absent, payouts MUST be
  withheld with the reason and remedy stated to the chef, rather than failing opaquely or paying regardless.
- **FR-057**: Market posture MUST follow `016-FR-048`: the served market is a **value**, an unserved market
  fails closed (`016-FR-048a`), and obligations whose cost is a **capability** rather than a seam MUST NOT be
  built at v1 but MUST be recorded as enabling work attached to the market that triggers them
  (`016-FR-048c`).

#### H. Revenue from free visitors — ⛔ blocked on C-018-003

- **FR-058**: [NEEDS CLARIFICATION: `C-018-003` — how a visit that involves no purchase generates revenue,
  and whether it does at all at v1. The recorded business model names **commerce** (affiliate / shoppable
  ingredients, partner revenue) and does **not** name advertising. The candidates and their very different
  consequences — for the consent surface (`016-FR-007`), the recorded age basis (`016-FR-008`), product
  positioning, and whether this becomes its own feature — are set out in the Clarifications section.]
- **FR-059**: Whatever mechanism is chosen, any revenue attributed to a chef's page or content MUST be
  visible to that chef at the same fidelity as `FR-038`: attributed amount, share rate, period, and state.
- **FR-060**: A mechanism requiring consent MUST degrade to a **fully working** experience when consent is
  absent or refused, and refusal MUST NOT reduce any capability, alter ranking, or change price.
- **FR-061**: This feature MUST NOT remove or degrade any capability a free user has today in order to create
  room for this revenue. (`015-FR-014` states the same principle for a different currency: a reward must not
  be the restoration of something taken away.)
- **FR-062**: Any placement that is paid for MUST be **labelled as paid** wherever it appears, and MUST NOT be
  presentable as an organic recommendation, a ranking result, or an editorial choice.

#### I. Boundaries — the controls this feature must not weaken

- **FR-063**: This feature MUST NOT make any `015` reward, standing, milestone or recognition purchasable,
  sellable, transferable, or obtainable through chef standing (`015-FR-007`, `015-FR-030`). Chef standing
  MUST NOT be purchasable either.
- **FR-064**: Chef standing MUST NOT alter `015`'s earning eligibility in any direction. A chef publishing an
  authored recipe earns exactly what any user earns; a chef publishing imported content earns nothing, exactly
  as `015-FR-001` requires.
- **FR-065**: A grant, a payout, or an earned balance MUST be withheld while an unresolved infringement notice
  stands against the content that produced it, and reversed if the notice is upheld — the money analogue of
  `015-FR-017`.
- **FR-066**: A chef whose sales or publications are reversed for infringement more than a stated number of
  times MUST lose chef standing, with the reason and appeal path given (`015-FR-018`, `016-FR-019`).
- **FR-067**: This feature MUST NOT introduce any mechanism that makes a recipe public other than an explicit,
  per-recipe, opt-in act by its owner (`015-FR-020`). Admission to the chef program MUST NOT publish anything.
- **FR-068**: The content licence (`016-FR-010`…`016-FR-015b`) MUST be sufficient for whatever this feature
  causes to be hosted, displayed, sold, delivered and retained — including what happens to a buyer's copy when
  the chef deletes the item or erases their account. Where it is not, that is a **blocker on this feature**,
  recorded as such, and MUST NOT be resolved by assuming the licence already covers it.

#### J. Records, notification and auditability

- **FR-069**: Every program decision, capability change, money movement, tax determination and dispute outcome
  MUST be reconstructable after the fact from an append-only record naming actor, subject, time, ground and
  effect.
- **FR-070**: A chef MUST be able to inspect their own program record — applications, decisions, standing
  changes, withheld amounts and the reasons — without asking support.
- **FR-071**: Notifications for application decisions, payout events, dispute deadlines and standing changes
  MUST route through the shared notification path (`GR-011`, `014-FR-001`) rather than a channel invented
  here, and MUST NOT be the only place a fact exists — every notified fact MUST also be inspectable in-product.
- **FR-072**: Program and financial records MUST be included in the account-erasure design explicitly:
  the specification MUST name, per record type, whether it is erased, de-identified, or retained under a
  stated legal basis — and MUST NOT leave any record type unclassified.

#### K. Delivery obligations

- **FR-073**: Every user-facing surface introduced by this feature MUST ship on **both** web and mobile in the
  same release (Constitution Principle VIII; `015-FR-023`).
- **FR-074**: Every user-facing string introduced by this feature MUST route through the shared localization
  path and MUST NOT be a hard-coded literal (`016-FR-049`).

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`; no `any` used outside explicitly marked test
  doubles. (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc documentation. (Principle II)
- **NFR-003**: Any UI component MUST expose an accessible name queryable via `getByRole`/`getByLabel` in
  Playwright tests. (Principles IV & VII)
- **NFR-004**: Color MUST NOT be the sole conveyor of state; icon or text label pairing required.
  (Principle VII) — this binds on chef badges, paid labels (`FR-062`) and withheld-balance states.
- **NFR-005**: Monetary amounts MUST be represented as integers in minor currency units end to end. No
  floating-point value MUST ever hold money.
- **NFR-006**: Every surface a chef or buyer uses to see money MUST be reconcilable against the ledger by a
  test, not by inspection.

### Key Entities

- **ChefProgramMembership**: An account's standing in the program. Attributes: the account, current state
  (`none` | `applied` | `active` | `suspended` | `withdrawn`), the terms version accepted, when each
  transition occurred and who caused it. **One per account.** Distinct from `CreatorProfile`, which `012`
  owns and which every user may have.
- **ChefApplication**: A submitted application and its decision. Attributes: applicant, submitted content,
  terms version in force, state, decider, decision ground, decided-at, earliest reapply date. Immutable once
  decided.
- **CapabilityGrant**: A single capability granted to a single account. Attributes: account, capability,
  granter, reason, granted-at, revoked-at. The **only** source of privileged authorization (`FR-018`).
- **SellerAccount**: A chef's ability to receive money. Attributes: the chef, onboarding state, identity and
  tax-status collection state, payout destination reference, withheld reason if any. Absent for a chef who
  has not onboarded (`FR-033`).
- **ChefListing**: A chef's item offered for sale — its type, price, what a buyer receives, provenance
  attestation reference, and availability state. Its permitted _types_ are gated on `C-018-001`.
- **Purchase**: A buyer's completed acquisition. Attributes: buyer, listing, amount charged, currency, tax
  determination, payment reference, state, and the entitlement it produced.
- **Entitlement**: What a buyer may access as a result of a purchase, and for how long. Independent of
  subscription tier (`FR-051`).
- **LedgerEntry**: One append-only financial fact. Attributes: purchase or payout reference, chef, gross,
  each deduction with its reason, net, resulting balance, and the entry it corrects if it is a correction.
- **Payout**: One attempt to move a chef's net balance to their destination. Attributes: chef, period,
  amount, reference, terminal state, failure reason. Idempotent per chef per period (`FR-040`).

---

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A qualified cook can complete a chef application in **under 5 minutes**, and can state
  afterwards — unprompted — what the platform's cut is and what would cost them their standing.
- **SC-002**: **100%** of chef applications reach a recorded decision within the stated decision target, and
  every decision carries a ground the applicant can read.
- **SC-003**: A visitor who lands on a public recipe by a chef can reach that chef's page in **one action**,
  and reach a second chef from the directory in **under 30 seconds**.
- **SC-004**: **Every** transaction reconciles exactly: gross equals the sum of commission, processing cost
  and chef net, to the minor unit, with **zero** unreconciled entries across a full period.
- **SC-005**: A chef can answer "what am I owed, what was deducted, and when will I be paid" from the product
  alone, in **under 60 seconds**, with **zero** support contacts required to obtain a number.
- **SC-006**: **100%** of purchases result in access that matches the money state — **zero** instances of
  durable access without payment, and **zero** instances of payment without access.
- **SC-007**: A refund completes end to end — entitlement reversed, chef net reversed, both parties notified —
  with **no manual ledger edit**, in **100%** of cases.
- **SC-008**: **Zero** privileged actions occur without an attributable capability grant and a recorded
  reason, measured across a full audit period.
- **SC-009**: Revoking a capability removes the ability to use it within the stated bound, in **100%** of
  cases, verified by test rather than by inspection.
- **SC-010**: **Zero** items are listed for sale whose provenance is anything other than authored-by-the-seller
  with a contemporaneous per-item attestation.
- **SC-011**: **100%** of upheld infringement findings against a sold item result in the withheld or reversed
  earnings the rule states, with **zero** payouts of affected balances in the interim.
- **SC-012**: Every user-facing surface of this feature is present on web and mobile in the same release —
  **parity measured as a count, not asserted**.
- **SC-013**: A free visitor's experience is **not measurably degraded** by whatever `C-018-003` selects:
  no capability removed, and consent refusal changes nothing but the revenue.
- **SC-014**: **Zero** `015` rewards, standings or recognitions become obtainable by paying, by selling, or by
  holding chef standing.

---

## Assumptions

Reasonable defaults taken where the description did not specify. Each is a decision the owner can overturn;
none is load-bearing enough to warrant one of the three clarification slots.

1. **Chef admission is by application and human review, not self-declaration.** A self-serve toggle would make
   "chef" a synonym for "has a profile", which `012` already provides for free, and would put an unvetted
   seller in front of a buyer. Review is also what makes `FR-053`'s identity collection meaningful.
2. **Chef standing is free.** Charging to join would make standing purchasable, which collides with the spirit
   of `015-FR-030` and inverts the incentive: the platform earns from a chef succeeding, not from applying.
   The business plan's "Creator: revenue share + optional subscription" line leaves room for a _paid tier_ of
   the program later; that is not v1.
3. **The commission rate is `013-FR-010`'s 20% platform / 80% chef** until the owner sets otherwise, applied
   uniformly across product types so a chef cannot be surprised by a different cut per item.
4. **Chef standing is a label, not a ranking boost, at v1.** `FR-014` requires the rule to be stated either
   way; the default is the one that cannot be gamed and does not quietly demote every non-chef.
5. **The served market is the US only at v1**, per `016-FR-048`. Non-US buyers and non-US chefs fail closed
   rather than being served under a posture that does not fit them.
6. **Staff capabilities at v1 cover exactly the operations this feature creates** — application review, notice
   adjudication, refunds, ledger inspection, payout control, suspension, impersonation, developer
   diagnostics. "Superuser" is modelled as _a named grant of every capability, still recorded per action_,
   never as a bypass of the check.
7. **Payments run on the processor `010` already selected**, extended to a connected-account model rather
   than a second processor relationship. A second processor would double the reconciliation surface for no
   product benefit.
8. **Purchases are one-time by default.** A chef _subscription_ (recurring payment to a chef) is a materially
   different product — recurring consumer-contract duties, dunning, proration — and is out of scope for v1.
9. **Buyers must be authenticated.** Entitlements attach to accounts; a guest checkout would create a
   purchase with nowhere durable to deliver it.
10. **`014` notification delivery is a dependency, not a substitute.** Where `014` is unavailable, every fact
    it would have delivered remains inspectable in-product (`FR-071`).
11. **This feature does not draft any legal document.** It states what a surface must disclose and what the
    product must do; the text is `016`'s and counsel's (`016-FR-050`).

---

## Out of Scope

- **Drafting the terms, the seller agreement, the licence, or the tax guidance.** This feature states the
  obligations; `016` and counsel own the words.
- **Choosing an entity structure, registering as a money transmitter, or obtaining any licence.** The
  specification names the posture that must be decided; it does not decide the corporate answer.
- **Recurring subscriptions payable to a chef** (Assumption 8). One-time purchases only at v1.
- **A second video pipeline, player, transcode path or course model.** `013` owns all of it.
- **A second profile, handle namespace, follow graph, or collections model.** `012` owns all of it.
- **Changing the recipe visibility policy itself** — `001` and `GR-014` own it. `C-018-001` may _request_ an
  amendment; this feature does not make one unilaterally.
- **Changing subscription tiers or first-party pricing** — `010` owns it.
- **Non-monetary publishing rewards, contributor standing and recognition** — `015` owns them, and `FR-063`
  forbids monetizing them.
- **Automated infringement detection, or adjudicating claims** — `016-FR-016`…`019` owns the process; this
  feature supplies subjects to it.
- **Physical goods, meal kits, in-person events, catering, or anything requiring fulfilment.**
- **Chef-to-chef transactions, agency, or multi-party splits on a single item.** One seller per listing.
- **Ad-network integration, audience segmentation, or any tracking technology** — not merely unbuilt but
  **not permitted** until `C-018-003` is answered and, if it selects advertising, until the consent surface
  `016` requires is specified.

---

## Cross-spec amendments this feature will require

Stated now so the cost is visible before planning, per the precedent `016` set. **None is applied by this
document** — each lands on its owner spec, and `GR-003` AC-003-b requires
[`cross-feature-FR-index.md`](../cross-feature-FR-index.md) to be updated in the same change set.

| Target                                   | Amendment                                                                                                                                                                                                                                                               | Gated on  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `GR-014` (Audience & Sharing Model)      | If `C-018-001` selects model (c): `AC-014-d`'s "a priced recipe audience is a violation" and the binary-visibility statement must be amended, at a **major** version. If it selects (a) or (b), `GR-014` is **unchanged** — which is itself a reason to prefer them.    | C-018-001 |
| `012-creator-profiles`                   | `012-FR-031`…`012-FR-034` move from **DRAFT/merchant-blocked** to active, citing this feature as the marketplace-payments owner. `012`'s dependency note is updated to name `018`.                                                                                      | C-018-002 |
| `013-cooking-school`                     | `013-FR-010`'s "⚠️ Blocked on marketplace payments" is cleared and the 20%/80% split cites `018-FR-034`.                                                                                                                                                                | C-018-002 |
| `010-subscriptions`                      | `010`'s Out of Scope is amended to state that **money-out** is owned by `018`, so the boundary is recorded rather than inferred. `010-FR-044`'s staleness question gains a money-weighted case (`018-FR-020`).                                                          | —         |
| `016-legal-compliance-framework`         | `016`'s Out of Scope line _"Payment-card and tax compliance (owned by `010` and its processor)"_ is inaccurate once `018` exists and must name `018` for the marketplace half. `016-FR-050`'s counsel list gains the seller-of-record and money-transmission items.     | C-018-002 |
| `002-user-auth`                          | The capability model (`018-FR-018`…`FR-025`) generalises `002-FR-037`'s single "admin role permissions". `002`'s Out of Scope currently excludes an admin UI; `018` needs reviewer and finance surfaces, so the boundary must be restated rather than silently crossed. | —         |
| `015-publishing-rewards`                 | No change required — `FR-063`/`FR-064` are stated **here** so `015`'s controls bind on this feature without `015` having to know about it.                                                                                                                              | —         |
| `v1-launch-plan.md`                      | `M6`'s open item _"Decide the marketplace-payments question"_ is answered: a dedicated feature, `018`. `M7`'s `012`/`013` monetization blockers point here.                                                                                                             | C-018-002 |
| `cross-feature-consistency-report.md` §9 | No new personas — this feature uses P1, P5, P9, P11, P12, P13 (`GR-013` AC-013-a).                                                                                                                                                                                      | —         |

---

## Clarifications

Three questions are open. Each is scope-level or one-way; none has a defensible default.

### C-018-001 — What may a chef actually sell?

**Status**: OPEN — blocks `FR-029`, `FR-030`, the `ChefListing` entity, and any `GR-014` amendment.

Videos and courses are already purchasable and already specced (`013-FR-001`…`FR-003`). **Recipes are the
question**, and today the answer is "not at all": `GR-014` says visibility is binary and `AC-014-d` says a
priced recipe audience is a violation. `012` drafted the paid-recipe model in this same PR and withdrew it,
burning `012-FR-035`…`012-FR-039`.

| Model                                       | What a buyer gets                                                                                         | Governance cost                                                                                                                                     | The problem it leaves                                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **(a) Video/courses only**                  | `013` lessons and courses; recipes stay free and binary                                                   | **None.** `GR-014` untouched, `012`'s withdrawal stands, `013` already specifies it                                                                 | Does not deliver "buy recipes from them". A chef with no video has nothing to sell.                                                              |
| **(b) A purchase delivers a licensed copy** | An owned copy of the chef's recipe lands in the buyer's own collection, private to them, with attribution | **Narrow.** Visibility stays binary; `AC-014-h` ("a private recipe is copyable only by its owner") needs an explicit exception for a purchased copy | Nothing stops a buyer republishing the copy — so `001-FR-005b`'s substantive-edit rule and the licence must carry the weight.                    |
| **(c) A paid recipe state**                 | Access to a recipe that is neither private nor public                                                     | **Large.** `GR-014` amended at a major version; the withdrawn `012` model is effectively reinstated under a new number                              | Re-opens every question `012`'s withdrawal closed, and `001-FR-004`/`FR-005`'s read-and-clone rights must be re-specified against a third state. |

⚠️ **A staff-level observation, offered rather than assumed**: model **(b)** is the only one that delivers the
ask _without_ reversing a ratified rule, because it reframes the purchase as **acquiring a copy** rather than
**unlocking a paywall** — which is also what a cookbook purchase actually is. It is not free: `AC-014-h` needs
an exception and the resale/republication path needs the licence. But (c) buys the same product outcome at
several times the governance cost.

### C-018-002 — Who is the seller of record?

**Status**: OPEN — blocks `FR-032` and every downstream tax, refund and licensing question. **One-way door.**

| Model                                             | Consequences                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a) Chef is the seller; platform is an agent**  | Buyer contracts with the chef. Platform collects on their behalf and remits, minus commission. Lower money-transmission exposure via a processor's connected-account model. **But**: consumer-refund duty sits with a stranger, and the buyer's trust surface is weaker.                                                                                   |
| **(b) Platform is the seller/reseller of record** | Buyer contracts with us; we pay the chef a share. Cleanest buyer experience, one refund path, one name on the statement. **But**: we take on the consumer contract, the marketplace-facilitator tax collection, and the content liability of a _seller_ rather than a host — which is a materially different posture from `016`'s hosting-service framing. |

Nothing else in this feature — refunds, tax, statements, the licence, the terms — can be written until this is
chosen, which is why it takes a slot despite reading like a legal detail.

### C-018-003 — Attention vs commerce: how a free visitor generates revenue

**Status**: OPEN — blocks `FR-058` and User Story 7. May become its own feature (`019`) rather than part of
this one.

The recorded business model ([`05-business-plan.md`](../executive/05-business-plan.md)) names four layers, and
**advertising is not one of them** — the non-subscription layers are creator monetization
("paid content/courses, **affiliate/shoppable recipes**, and revenue share") and commerce upside
("**affiliate/partner** revenue"). The user's question is a real one and has more than one recorded answer.

| Option                                                                                         | Yield                                  | Consent / legal surface                                                                                                                                                                          | Fit with the recorded strategy                                                                            |
| ---------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **(a) Nothing at v1** — free traffic is an acquisition asset                                   | Zero direct                            | None                                                                                                                                                                                             | Matches `04-product-plan.md`: _"free users must get real cooking utility before seeing upgrade pressure"_ |
| **(b) Commerce** — affiliate / shoppable ingredients, shared with the chef                     | Modest, and grows with grocery quality | Disclosure of paid links (`FR-062`); no third-party tracking required                                                                                                                            | **Already in the plan**, and `007` already contemplates grocery adapters                                  |
| **(c) Chef-set sponsorship** — the chef sells their own placement, we take the same commission | Chef-dependent                         | Labelling only                                                                                                                                                                                   | Consistent with the marketplace this feature already builds                                               |
| **(d) Display advertising**                                                                    | Highest at scale, negligible below it  | **Largest.** Third-party tracking → per-purpose consent records (`016-FR-007`), recorded age basis (`016-FR-008`), data-sharing disclosure, and an ad-tech vendor surface `016` has not budgeted | A departure from the recorded model, on the product's own trust promise                                   |

These are not exclusive — (b) and (c) compose, and either can precede (d).

---

## Status

**BLOCKED for `/speckit-plan`** on the three clarifications above. Sections A, B, C, F, G, I, J and K are
independent of all three and are complete; Section D is gated on C-018-001, Section E on C-018-002, and
Section H on C-018-003.

⚠️ **A note on sequencing that planning should not have to rediscover.** User Stories 1, 2, 5 and 6 move no
money and depend on **none** of the three open questions. They are shippable, testable, and would tell us
whether the chef program has takers before the platform incurs a single tax, payout, refund or
money-transmission obligation. The recorded strategy says the same thing in its own words —
_"Build marketplace/network loops only after supply and demand behaviors are visible."_
