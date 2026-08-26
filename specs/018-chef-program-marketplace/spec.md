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
   ⚠️ **Advertising is not among them**, and the research bears the omission out: the owner's question —
   _can we monetize traffic to chef pages and public recipes, and share it with the chef?_ — has a recorded
   answer that is **commerce**, not **attention**, and commerce needs one to two orders of magnitude less
   traffic to pay. ⭐ **The widened research found a third answer the plan gestures at but does not name**:
   the product sits on **pre-basket meal intent**, which is the asset a $69bn retail-media industry is built
   on owning only _after_ the purchase. See
   [C-018-003](#c-018-003--the-free-user-revenue-allocation-assets-compounding-and-where-the-tier-stops).

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

**H4 — The free user is an asset with five value channels, and the obvious ways to monetize them are the
worst ones.** Monetizing attention buys revenue with the consent surface `016` has not budgeted — third-party
tracking means per-purpose consent records (`016-FR-007`), a recorded age basis (`016-FR-008`) and a
data-sharing disclosure, on a product whose free tier exists to _"build trust and retention"_. Monetizing
behavioural data reaches for allergen and dietary information first, which is health-adjacent and is a hard
stop (`FR-062f`). And monetizing psychology reaches for manufactured urgency, which **EU DSA Art. 25
prohibits outright** and which `015-FR-027` already forbids by requirement.

⚠️ **Meanwhile the actual asset is being under-read.** A free user is not a 2.1% chance of a subscription;
they are `conversion + corpus + liquidity + social proof + referral`, and four of those five shrink the moment
reach shrinks (`FR-058i`). ⭐ **And the most valuable thing they generate is not attention at all — it is
_pre-basket meal intent_**, the signal an entire $69bn retail-media industry is built on owning _after_ the
fact. Section H is where this is worked out; it is the largest open surface in this specification, and the
owner directed the balance of specification effort to it.

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

**Why this priority**: P3 because it is the only story here that is **strategy before scope** — its legal
surface differs by an order of magnitude between the candidate mechanisms, and it is the one part of this
feature that changes what the product _is_ to a free user. It is specified last on purpose. Research
(2026-08-26, widened twice on owner direction) reframed this into five questions and catalogued 27 options
across six payer groups; the selection is
[C-018-003](#c-018-003--the-free-user-revenue-allocation-assets-compounding-and-where-the-tier-stops) and the reasoning
is [`research/free-visitor-monetization.md`](./research/free-visitor-monetization.md).

**Independent Test**: For whichever mechanism is selected — drive a revenue-generating action from a chef's
public content as a signed-out or free visitor, and verify the chef's earnings surface shows the attributed
amount, the share rate and the period, reconciling against the same ledger as a direct sale. ⚠️ `FR-058f`'s
recognition layer is separately and independently testable **today**, with no payer involved at all.

**Acceptance Scenarios**: The mechanism-specific scenarios follow the C-018-003 selection. What is **already
fixed regardless of the answer**:

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
- **FR-003a** — ⛔ **earnings honesty**: the program MUST NOT state or imply a typical, expected or achievable
  income from chef standing without **substantiation held on file and produced on request**. ⚠️ This is not
  caution, it is arithmetic: across the creator economy the **top 1% capture an estimated 97% of
  platform-derived revenue**, only **~4% earn over $100k**, roughly **half earn under $15k**, and about
  **1.3% reach full-time viability**. Any "earn money as a chef" framing is therefore an earnings claim about
  an outcome almost no participant reaches. ⚠️ The FTC has an active earnings-claims rulemaking whose scope is
  expected to reach **money-making opportunities generally, not only MLMs**, and which requires substantiation
  to be provided on request. Aspirational imagery paired with an income implication is the exact pattern under
  enforcement. **The honest framing is the marketplace's terms — the commission, the payout, the controls —
  never a number a chef might earn.**
- **FR-003b** — **impersonation of a real person is the application's sharpest fraud**: where an applicant
  asserts a real-world professional identity, trades on a name, or claims an association with a restaurant,
  publication or brand, the system MUST verify that assertion before admitting them, and MUST record what was
  verified and how. ⚠️ A marketplace that mints a public, badged, _sellable_ identity is a far more attractive
  impersonation target than a profile page, and `012-FR-001`'s handle rules govern **string uniqueness**, not
  **identity truth**. An unverifiable claim MUST be refused or the claim removed — never admitted unchecked.
- **FR-004**: An application MUST be durably recorded on submission, with the content the applicant supplied
  and the version of the program terms in force at that moment, and MUST survive any subsequent edit to those
  terms.
- **FR-005**: Every application MUST reach a recorded decision — admitted or refused — carrying who decided,
  when, on what ground, and what action followed. A decision MUST NOT be automatic; admission MUST require a
  human reviewer holding the review capability (`FR-019`).
- **FR-005b** — **a chef status tier, if one exists, MUST be EARNED and never purchased** (`FR-063`). Its
  criteria MUST be published, objective, and **attainable by a good chef with modest volume**. ⚠️ Two recorded
  lessons from the closest comparable programme: Etsy reports that Star Sellers _"made more in sales and got
  more listing views, on average, than similar non-Star Sellers,"_ and the badge _"can boost the quality score
  of listings in search"_ — ⭐ **an EARNED ranking effect, which is a materially different thing from the
  purchased one `C-018-003b` asks about, and a legitimate middle ground**. And the failure mode: sellers
  widely describe those thresholds as unattainable, which converts a motivator into a demotivator and a
  support burden. **A tier nobody can reach is worse than no tier.**
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
- **FR-014a** — **the empty directory is a real state, not an edge case**: with zero or few chefs the
  directory MUST render honestly and MUST NOT be padded with non-chefs, placeholder entries, or creators who
  have not been admitted. ⚠️ A marketplace's hardest problem is the cold start, and the tempting fixes —
  auto-enrolling creators, back-filling the page with public recipes, implying a roster that does not exist —
  each violate `FR-001` (standing is an explicit, recorded transition), `FR-013` (only active standing
  appears) or `FR-003a` (no implied claim). **The correct answer to an empty directory is a seeded roster of
  genuinely admitted chefs, not a fuller-looking page.**
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

#### D. What may be sold — ✅ resolved by C-018-001 (owner, 2026-08-26)

> ✅ **A purchase acquires a COPY; it does not unlock a paywall.** The owner selected the licensed-copy model.
> **`GR-014`'s binary visibility rule stands, `AC-014-d`'s prohibition on a priced recipe audience stands, and
> `012`'s withdrawal of the premium-recipe model stands.** Buying a chef's recipe is the digital form of
> buying a cookbook: the buyer receives their own copy, privately, attributed — not access to a paywalled row
> in someone else's collection. ⛔ Do not "simplify" this back into a paid visibility state; that is the model
> `012` withdrew and burned `012-FR-035`…`012-FR-039` to stop from silently returning.

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
- **FR-029** _(resolved 2026-08-26 — `C-018-001`)_: A chef's sellable catalogue is exactly two things:
  `013`'s video lessons and courses (already specified at `013-FR-001`…`013-FR-003`), and an **authored recipe
  sold as a licensed copy**. Purchasing a recipe MUST create a **new recipe in the buyer's own collection**,
  private to the buyer, attributed to the chef, and marked as acquired by purchase. The chef's own recipe MUST
  be unchanged by the sale. **No paid, paywalled or third visibility state is created**, and `GR-014`'s binary
  rule is not amended.
- **FR-029a** — _the purchased copy is bounded by provenance, not by a new mechanism_: the copy MUST carry a
  provenance class that is **private-only and never publishable**. The shipped `sourceType` taxonomy
  (`004-FR-011`) already contains exactly this — `imported_paid`, which `GR-014` AC-014-e states **"may never
  be public"**. The purchased copy MUST therefore be unpublishable, un-resellable, and unclonable by anyone
  other than its owner (`001-FR-005c`), and shareable only through the read-only `circle` scope its owner
  already has for their own private content. ⚠️ **This is why the licensed-copy model needs no new visibility
  state**: the constraint it requires is one the system already enforces for content acquired from a paid
  source — which is precisely what this is.
- **FR-029b**: Selling a recipe MUST NOT change that recipe's visibility, its cloneability, or its eligibility
  under `015`. A chef who sells a recipe earns money; whether that same recipe also earns a `015` reward
  depends only on whether they **published** it, exactly as for any other user (`FR-064`).
- **FR-029c**: A recipe MUST NOT be simultaneously **public** and **for sale** — a recipe any signed-in user
  may already read and clone (`001-FR-004`, `001-FR-005`) cannot honestly be sold. A chef MUST choose, per
  recipe. Moving between the two MUST be permitted in both directions, MUST NOT invalidate a copy a buyer
  already holds, and the possibility MUST be disclosed at purchase (`FR-046`).
- **FR-030**: The purchase model MUST be describable, without exception, by `001`'s visibility policy,
  `001-FR-005`…`005d`'s clone chain, and `GR-014` simultaneously. ⛔ A model that leaves the cloneability,
  publishability or survivability of a purchased item undefined MUST NOT be implemented — that ambiguity is
  what `012`'s withdrawn model actually failed on.
- **FR-031**: Pricing MUST be bounded by a stated minimum and maximum, MUST be in a currency the platform
  settles, and a price change MUST NOT alter the amount owed on a purchase already in progress.

#### E. The money — seller of record, commission, ledger and payouts — ✅ resolved by C-018-002

> ✅ **The split model, resolved by the owner on 2026-08-26.** The chef holds the **contract**; the platform
> holds the **money, the tax and the buyer's remedy**. This is the shape Amazon Marketplace actually uses, and
> each of the four rows below is a separate decision — the common error is assuming they travel together.
> ⛔ In particular: **"the chef is the seller, so tax is their problem" is NOT available.** US
> marketplace-facilitator laws attach the collection duty to the **platform** regardless of who the seller of
> record is. Choosing the chef as seller buys us distance from money transmission and from the content
> liability of a seller; it buys us **nothing** on tax.

- **FR-032** _(resolved 2026-08-26 — `C-018-002`)_: The **chef is the seller of record** for their content;
  the platform acts as their **limited agent** for collecting payment and disbursing proceeds. The four
  responsibilities MUST be allocated as follows, and the allocation MUST be stated in the terms, the seller
  agreement, and the buyer-facing disclosure:

    | Responsibility                                        | Holder                                                                            |
    | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
    | The sales **contract** with the buyer                 | **The chef**                                                                      |
    | Collection, holding and disbursement of the **money** | **The platform**, as the chef's agent                                             |
    | Collection and remittance of **transaction tax**      | **The platform**, as marketplace facilitator                                      |
    | Seller **identity, KYC and tax reporting**            | **The platform**, discharged through the processor's connected-account onboarding |
    | The **buyer's refund** (`FR-049`)                     | **The platform**, guaranteed and then recovered from the chef                     |

- **FR-032a — the buyer guarantee**: The platform MUST honour a valid refund to the buyer **directly and
  first**, and recover the amount from the chef afterwards (`FR-042`). ⚠️ This is the deliberate departure
  from a pure agency model, and it exists because a marketplace in which a buyer must pursue a stranger for a
  refund loses the demand side — which is the scarce side early. The guarantee MUST be stated to the buyer at
  purchase and MUST be stated to the chef in the seller agreement, including the recovery.
- **FR-032b — the limit of the agency**: The platform MUST NOT hold chef funds for longer than the stated
  payout schedule requires, MUST NOT offer any service on those funds beyond collection and disbursement, and
  MUST NOT permit a chef to direct funds to a third party. ⚠️ These bounds are what keep the arrangement a
  payment-agency relationship rather than something requiring a money-transmission licence; they are
  requirements, not implementation notes.
- **FR-032c — one seller, named**: The buyer MUST be told **who they are contracting with** before paying, and
  the same identity MUST appear on the receipt (`FR-048`). A purchase that cannot name its seller MUST NOT
  complete.
- **FR-032d — content liability posture is unchanged**: Acting as the chef's payment agent MUST NOT be
  presented, internally or externally, as the platform selling the content. The platform's posture toward the
  content remains the **hosting-service** posture `016` is built on (`016-FR-016`…`019`'s notice-and-action),
  and nothing in this feature MUST be drafted in a way that undermines it.
- **FR-033**: A chef MUST complete **seller onboarding** — identity, tax status, and a payout destination —
  before any item of theirs may be listed for sale. A listing attempted without it MUST be refused with the
  remedy stated.
- **FR-034**: The platform's commission MUST be a **stated rate disclosed before listing**, with a worked
  example. `013-FR-010`'s 20% platform / 80% educator (15%/85% at the pro tier) is the rate this feature
  ratifies unless the owner sets another; a single rate MUST govern every product type unless a differing
  rate is stated per type.
- **FR-034a**: [NEEDS CLARIFICATION: `C-018-004` — **what is the commission, measured against the STACK
  rather than in isolation?** `FR-034` inherits `013-FR-010`'s **20%**, but the evidence says that is at the
  high end for creator content: pure creator platforms take **5–12%** (Substack 10%, Gumroad 10%, Patreon
  8–12%, Ko-fi 0% on one-time sales and 5% on memberships), while flat-fee platforms (Kajabi, Teachable,
  ~$69–$399/month) take **0%** of revenue. Etsy's oft-quoted **25.7%** is an *effective* rate across physical
  goods, payments **and** seller-funded advertising — not a content commission. ⛔ **And it does not stack
  alone**: on any storefront where a platform's in-app purchase is required, 20% on top of a **30% (or 15%
  small-business) store commission** leaves the chef roughly **half** of what the buyer paid, which is not a
  marketplace a serious chef joins. See Section M.]
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
- **FR-039a** — **a payout reserve is a control, not a cash-flow convenience**: the system MUST be able to
  withhold a stated portion of a chef's balance for a stated period before release, and the rule MUST be
  disclosed at seller onboarding. ⚠️ **`FR-032a`'s buyer guarantee makes this load-bearing**: without a
  reserve, every guaranteed refund on an already-disbursed sale becomes an unsecured debt from a chef who may
  never earn again (`FR-042`). This is why the comparable marketplaces hold funds on a rolling basis, and it
  is the single cheapest control against both refund abuse and seller default.
- **FR-040**: Payout initiation MUST be **idempotent per period per chef**. A retry MUST NOT be able to pay
  the same balance twice, under any concurrency, and the guarantee MUST be enforced by the system rather than
  by the caller's discipline.
- **FR-041**: Money owed to a chef MUST survive: withdrawal from the program (`FR-008`), suspension of
  standing (`FR-009`), deactivation of their profile (`012-FR-004`), and lapse of any subscription. Only an
  upheld infringement finding (`FR-065`) or a refund/chargeback (`FR-049`) MUST be able to reverse it.
- **FR-042**: A negative balance MUST be represented explicitly and recovered by a stated rule, and MUST NOT
  be silently zeroed or silently carried. ⚠️ **`FR-032a`'s buyer guarantee makes this a routine state, not an
  exceptional one** — every guaranteed refund on an already-paid-out sale creates one. The recovery rule, the
  order in which it is applied against future earnings, and what happens when a chef never earns again MUST
  each be stated; "we'll deal with it if it happens" is not a rule.
- **FR-042a** — **chargeback liability MUST be allocated explicitly**, in the seller agreement and in the
  ledger: who bears the disputed amount, who bears the network's dispute fee, and what happens when the chef's
  balance cannot cover it. An unallocated chargeback becomes an unbooked platform loss.
- **FR-042b** — **currency**: the system MUST settle only in currencies it holds and pay out only to
  destinations it supports; where a buyer's currency differs from a chef's, the conversion basis and who bears
  it MUST be stated before the sale and recorded on the transaction. ⛔ Silent FX is an undisclosed fee.
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
  chef's net together — neither reversible without the other. Per `FR-032a` the platform MUST honour a valid
  refund to the buyer **first** and recover from the chef afterwards; the buyer MUST NOT be made to wait on
  the chef's cooperation, their balance, or their responsiveness.
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
  before any sale, never retroactively. Per `FR-032` this is discharged through the payment processor's
  connected-account onboarding, which is the reason that model was chosen; the **obligation** remains ours
  even though the **collection** is the processor's, and the specification MUST state which party holds which
  half rather than assuming the processor covers it entirely. ⚠️ `016-FR-048b`'s seam-versus-capability test puts this on the
  **seam** side: collecting a seller's tax identity after the fact means re-prompting every chef, which is
  precisely the retrofit that rule exists to prevent.
- **FR-054**: The system MUST be able to determine, per transaction, who is responsible for collecting and
  remitting any transaction tax, and MUST record that determination with the transaction. ⛔ **The default is
  that we are** — US marketplace-facilitator laws attach the duty to the platform irrespective of `FR-032`'s
  seller of record, so a design that routes the question to the chef is wrong before it is built. ⚠️ The
  taxability of a **digital** good varies by state; that variation is a per-transaction determination, not a
  single global answer.
- **FR-055**: The system MUST be able to produce, per chef per reporting period, the totals a reporting
  obligation requires, and MUST make the same totals visible to the chef.
- **FR-056**: Where a reporting threshold is reached and the required information is absent, payouts MUST be
  withheld with the reason and remedy stated to the chef, rather than failing opaquely or paying regardless.
- **FR-057**: Market posture MUST follow `016-FR-048`: the served market is a **value**, an unserved market
  fails closed (`016-FR-048a`), and obligations whose cost is a **capability** rather than a seam MUST NOT be
  built at v1 but MUST be recorded as enabling work attached to the market that triggers them
  (`016-FR-048c`).

#### H. The free user — revenue, allocation, assets, compounding, and where the free tier stops

**Full evidence — 5 questions, 6 payer groups, 27 options, the unit economics, the rejected list and the
sources**: [`research/free-visitor-monetization.md`](./research/free-visitor-monetization.md) (researched and
widened twice on owner direction, 2026-08-26). This section carries the requirements; the research file
carries the reasoning and the numbers.

> ⛔ **This is five questions, and the first pass answered one.**
>
> - **Q-A** — how does a **visit that buys nothing** produce revenue? _(revenue)_
> - **Q-B** — how do free users become **worth** something to a chef? _(allocation)_
> - **Q-C** — what do free users **produce** that has value? _(asset)_
> - **Q-D** — do free users make **paid users more valuable**, and do they **manufacture** paid users?
>   _(compounding)_
> - **Q-E** — are we **giving too much away**? Where should the free tier stop? _(design)_

##### H.1 ⚠️ The reframe that reorders everything: we are UPSTREAM of the retailer

Retail media is the most profitable thing in retail — first-party purchase data becomes a media business at
**60–70% margins against 5–10% on core retail**, which is why Chase and PayPal both stood up **Financial**
Media Networks on the same logic. What those businesses monetize is **demonstrated purchase intent**.

> **A retailer knows what you bought. We know what you are planning to cook on Thursday** — before the basket
> exists, before the store is chosen, while the ingredient list is still editable. A recipe is **a shopping
> list that has not been written yet**, and that pre-basket intent is generated **overwhelmingly by free
> users**.

This is the "retail platform" reading, and it **promotes** what a media-only reading files under "later":
CPG sponsorship and aggregated insight become the strategic core when delivered as **meal-intent commerce
media through a data clean room**, with grocery affiliate as the **closed loop** proving the signal converts.
⚠️ It also raises the privacy stakes by an order of magnitude — see `FR-062e` and `FR-062f`, which are hard
boundaries, not aspirations.

##### H.2 What a free user produces, and what may never be sold

| Asset                                                     | Value                                                                                                                              | Constraint                                                                             |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Public recipe corpus**                                  | The base capability every other capability sits on                                                                                 | `016-FR-010`'s licence is for **operating the service** — not sublicensing (`FR-062a`) |
| **Meal intent** — what will be cooked, when, for how many | ⚠️ The most valuable asset here; pre-basket, pre-brand, pre-store                                                                  | Consent, aggregation, clean-room delivery (`FR-062e`)                                  |
| **Structured ingredient resolution + nutrition**          | The hard part of the corpus                                                                                                        | ⛔ `016-FR-032` classes it **confidential** — never exposed                            |
| **Cook events, save rate, substitutions**                 | A **>2% save rate is the strongest purchase-intent signal in food content**, and a save is a first-party event we already generate | Aggregate only                                                                         |
| **Ratings, reviews, photos**                              | Social proof that converts other users                                                                                             | Moderation cost (`016`)                                                                |
| **Search / query stream**                                 | Unmet-demand signal                                                                                                                | Highly sensitive; aggregate only                                                       |
| **Allergens, dietary constraints, household composition** | Powerful targeting                                                                                                                 | ⛔ **Health-adjacent. NOT inventory, at any margin** (`FR-062f`)                       |

##### H.3 The arithmetic that should decide the Q-A lead

One grocery-affiliate conversion at ~3% of a ~$150 basket is worth roughly **90 page views at a premium food
ad RPM and ~2,250 at a generic one** — and the strong food RPM belongs to premium networks whose traffic
minimums this product will not clear for some time, leaving the low band, a **~6× haircut** on the number that
makes display look attractive. ⛔ **Commerce needs one to two orders of magnitude less traffic than
advertising, at the smallest consent surface of any option.** Display advertising is the **highest-cost option
at exactly the scale where it pays least.**

##### H.4 Recommended portfolio

| Tier                                          | Mechanisms                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Now**                                       | Attribution-only recognition (`FR-058f`) · **reverse trial + experimentation discipline** (the two largest conversion levers in the evidence, both entirely honest) · **a real referral programme** · **grocery affiliate shared with the chef** · chef-sold sponsorship · reduced commission as a paid upgrade |
| **Next**                                      | The subscription-funded **chef pool**, allocated user-centrically, funded on measured lift · off-platform attributed commission (promoted placement's revenue **without touching ranking**) · seat-limited chef cohorts                                                                                         |
| **Strategic**                                 | **Meal-intent commerce media through a clean room**, expressed as platform-sold CPG sponsorship, with contextual in-recipe commerce as the vendor-shaped fallback. The only option whose margin structure is categorically different — and the asset is generated by free users                                 |
| **Not without reopening a ratified decision** | Display advertising at current scale · corpus / AI-training licensing (`FR-062a`) · un-consented behavioural insight (`FR-062c`) · everything in the research file's rejected table                                                                                                                             |

---

- **FR-058**: [NEEDS CLARIFICATION: `C-018-003a` — **which mechanisms ship, and in which tier.** The research
  recommends the "Now" row above, advertising excluded at v1. The owner may compress, reorder, or ship
  **none** at v1 and treat free traffic purely as an acquisition asset.]
- **FR-058a**: The **attribution rule MUST be stated before it is built**, and a chef MUST be able to read it.
  An attribution a chef cannot understand is an earnings statement they cannot check.
- **FR-058a-i** — ⚠️ **why the pool matters more than the sales do, for almost every chef**: creator revenue
  follows a brutal power law — the **top 1% capture an estimated 97% of platform-derived revenue**, and about
  **1.3% reach full-time viability**. Direct sales therefore pay a small number of chefs and **nothing at all**
  to the rest, while an engagement-attributed pool pays the long tail something for content that is genuinely
  being used. ⛔ This does not make the pool a substitute for honesty (`FR-003a`); it makes the pool the only
  mechanism whose distribution is not winner-take-all by construction.
- **FR-058b**: A pool mechanism MUST state whether allocation is **pro-rata** or **user-centric**, MUST NOT
  leave it implicit, and MUST record the reason. ⚠️ The music industry has argued this for a decade; a silent
  pool will be built pro-rata by default and be indefensible to the chefs it under-pays. **User-centric is the
  only form legible to the payer** — _"your subscription went to the chefs you cooked from."_
- **FR-058c**: A pool mechanism MUST NOT create an incentive whose optimum is publishing **more** rather than
  **better** (`015-FR-025`, `015-FR-026`, `015-FR-007g`). Engagement counted MUST be an act with cost to the
  user — cooking, saving, returning — never a view.
- **FR-058d**: No mechanism here MUST be conditioned on, or capable of altering, a chef's **organic ranking**
  in discovery (`FR-014`) or their standing. ⚠️ **organic** is load-bearing and is the subject of `FR-058e`.
- **FR-058e**: [NEEDS CLARIFICATION: `C-018-003b` — **is ranking for sale?** Seller-funded promoted placement
  contradicts `FR-014` and `FR-058d`, and is the largest and fastest-growing revenue line in the closest
  comparable marketplace. Three coherent positions — absolute integrity, segregated-and-labelled, or
  blended-and-labelled — are set out in the Clarifications section, along with a middle path (off-platform
  attributed commission) that survives even the strictest.]
- **FR-058f**: The **attribution and recognition layer MUST be built regardless of `C-018-003a`** — a chef
  MUST be able to see the conversions, returns and cooks their content caused, whether or not money is
  attached. It is the instrumentation the pool-funding case depends on, it delivers value alone, and
  `015-FR-007f`'s cook signal is the pattern it extends.
- **FR-058g**: Every mechanism producing a chef share MUST state that share as a **rate disclosed before the
  chef relies on it**, on `FR-034`'s terms. A share that can change silently is not a share.

**Q-D / Q-E — the free tier itself**

- **FR-058h**: [NEEDS CLARIFICATION: `C-018-003c` — **where does the free tier stop?** `010-FR-040` currently
  gives free users unlimited public recipes, unlimited importing, manual planning, grocery lists and cooking
  mode, and `015`'s D4a adds private recipes — so the free tier is being asked to be corpus engine,
  acquisition engine **and** complete product at once. The research recommends gating where **marginal cost is
  real and value is high** — AI generation and inference volume (`ADR-0024` already proves inference cost
  binds), automation, multi-week planning horizon, export and scale — and **never the core plan-shop-cook
  loop the corpus and referral engine run on**. ⛔ **And the repo's own competitive analysis argues the
  OPPOSITE direction on the tier as a whole** — see the correction below. `010` owns the tier definition, so
  this decides what `018` may **ask** `010` to change.]
- **FR-058h-i** — ⛔ **CORRECTION, and it overrides an earlier line in this section**: **per-recipe nutrition
  MUST NOT be a gate.** [`docs/competitive/02-gap-analysis-and-strategy.md`](../../docs/competitive/02-gap-analysis-and-strategy.md)
  D5 makes the point directly: USDA-backed nutrition is the sharpest differentiator we have, and gating it
  means **a free user never meets the reason to choose us**. An earlier revision of that document made exactly
  this mistake and corrected itself. "Nutrition depth" is therefore **removed** from the candidate gate list
  above.
- **FR-058i** — ⛔ **the precondition on any tightening**: a free user's value MUST be measured across **all
  five channels** before the free tier is narrowed — (1) direct conversion, (2) corpus and data network
  effects, (3) marketplace liquidity, (4) social proof, (5) referral and acquisition. ⚠️ **Channels 2–5 all
  shrink when reach shrinks**, and a tightening justified on channel 1 alone — the ~2.1% conversion rate — is
  a decision made on one fifth of the evidence. The measurement MUST exist before the decision, not after.
- **FR-058j**: If a **reverse trial** is adopted (full access for a disclosed window, then the free tier), it
  MUST be disclosed at the start, MUST occur **once**, MUST NOT reset or repeat, and ⛔ **MUST NOT be applied
  retroactively to users who are already on the free tier** — that would be a removal, which `FR-061` forbids.
  ⚠️ The distinction is load-bearing: changing what a **new** user is **given** is permitted; taking back what
  an **existing** user **has** is not.
- **FR-058k**: If a **referral programme** is adopted, its reward MUST NOT be, confer, or be exchangeable for
  anything in `015`'s recognition layer (`FR-063`, `015-FR-030`). ✅ Referral rewards are otherwise unowned —
  `015` explicitly out-of-scopes _"rewarding any activity other than publishing a recipe (rating, cloning,
  commenting, referring)"_ — so `015-FR-007`'s non-monetary rule, which governs **publishing** rewards, does
  not bind here.

**Boundaries**

- **FR-059**: Any revenue attributed to a chef's page or content MUST be visible to that chef at `FR-038`'s
  fidelity — attributed amount, share rate, period, state — in the **same** earnings surface, never a second.
- **FR-060**: A mechanism requiring consent MUST degrade to a **fully working** experience when consent is
  absent or refused, and refusal MUST NOT reduce any capability, alter ranking, or change price.
- **FR-061**: This feature MUST NOT remove or degrade any capability a free user has today in order to create
  room for this revenue. ⚠️ The temptation is quantified: a hard paywall converts roughly **5× better** than
  freemium — but it buys that by **destroying the reach** channels 2–5 of `FR-058i` depend on. (`015-FR-014`
  states the same principle in a different currency.)
- **FR-062**: Any paid placement — advertiser, retailer, brand or chef — MUST be **labelled as paid** wherever
  it appears, and MUST NOT be presentable as an organic recommendation, ranking result, or editorial choice.
- **FR-062a**: ⛔ **Licensing the corpus to a third party, including for AI training, is OUT OF SCOPE.**
  `016-FR-010`'s licence is granted **"for the purpose of operating, securing, improving and promoting the
  service"**, which does not cover sublicensing it to train someone else's model; `016`'s recorded posture is
  **"we license _in_, not out"**; `016-FR-033` forbids open publication and `016-FR-030`'s anti-extraction
  term exists to keep others out. It would need a licence amendment and, honestly, **per-user opt-in** — a
  separate decision with its own consent design.
- **FR-062b**: A **chef-facing paid product** (Pro tier, reduced-commission upgrade, priority review) MAY sell
  **capability** and MUST NOT sell **placement** — otherwise it evades `FR-058e` rather than answering it.
- **FR-062c**: Revenue derived from **aggregate behavioural data** MUST be aggregate-only and
  non-re-identifiable, MUST clear `016-FR-007`'s consent regime, and MUST NOT expose anything `016-FR-032`
  classes as confidential — ingredient-resolution mappings, per-field confidence scores, dedup keys, ranking
  signals. ⚠️ This sits one careless step from selling user data and MUST NOT be built without counsel.
- **FR-062d** — ⛔ **the pressure-signal rule**: every urgency, scarcity, progress or social-proof signal shown
  to a user MUST be **TRUE, VERIFIABLE and NON-RESETTING**. A real quota, a real one-time deadline, a real
  cohort seat count, a real cook count are all permitted; an invented or resetting countdown, a fabricated
  scarcity claim on an unlimited digital good, fabricated activity counts, confirmshaming and obstructed
  cancellation are **forbidden**. ⚠️ **The test is simple**: if the fact would still be true with the counter
  removed, the counter is honest; if the counter **creates** the fact, it is a dark pattern.
  This is `015-FR-027`/`015-FR-028` and `016-FR-041`/`016-FR-044` restated at the point they will be
  tempted — and **EU DSA Art. 25 prohibits it outright**, with the Consumer Rights Directive amendments
  applying from **19 June 2026** and a Digital Fairness Act expected. ⚠️ `016-FR-048` puts v1 in the US only,
  but `016-FR-048b` requires **seams** to be built to the strictest regime now, and an interface pattern is a
  seam: retrofitting honesty into a conversion funnel means rebuilding it and re-earning the trust it spent.
- **FR-062e**: Any monetization of **meal-intent** data MUST be aggregate, non-re-identifiable, consented, and
  delivered through a mechanism that never exposes raw per-user records to a counterparty. The individual user
  MUST NOT be identifiable to any buyer, and consent MUST be per-purpose (`016-FR-007`) with refusal costing
  the user nothing (`FR-060`).
- **FR-062f**: ⛔ **Allergen, dietary-restriction and household-composition data MUST NEVER be monetized,
  segmented for a third party, or used to target a paid placement — in any form, aggregated or not.** It is
  health-adjacent and special-category-adjacent, and it is the first thing a creative reading of "monetize the
  data" reaches for. This is a hard stop, not a risk to be managed.

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

#### L. Trust, fraud and abuse — ⚠️ a dimension the first four passes did not carry

> ⛔ **This section exists because `FR-032a` made us the party who pays first.** The Amazon-style guarantee is
> the right buyer decision and it moves the entire fraud surface onto the platform. A marketplace in digital
> goods is a **preferred** fraud target, not an incidental one: there is no shipping delay, so the attacker
> gets **instant value**, and the goods cannot be recovered.

- **FR-075** — **refund abuse is the primary threat, not payment fraud**: the buyer guarantee (`FR-032a`) MUST
  carry a **stated abuse limit** — per account, per period — beyond which a refund is reviewed rather than
  granted automatically, with the limit disclosed to buyers. ⚠️ Refund and policy abuse has **displaced
  payment fraud as merchants' top-reported threat**, and the most common form is a **false claim that the item
  was never received (52% of merchants)** — a claim that, for a digital good delivered instantly to an
  account, we can actually disprove from our own delivery record. **That evidence MUST be retained and MUST be
  consulted before a guarantee payout**, or the guarantee is an open tap.
- **FR-076** — **self-dealing is the marketplace's laundering vector, and it is not hypothetical**: the system
  MUST detect and block a chef being the economic beneficiary of purchases of their own listings, whether
  directly, through a linked account, or through a pattern of purchases with no other buyer. ⛔ Buying your own
  listing with a stolen instrument and withdrawing the proceeds converts a marketplace into a cash-out rail;
  this is the risk that turns a payment-agency arrangement into an AML problem, and `FR-032b`'s bounds do not
  address it.
- **FR-077** — **first-sale and velocity controls**: a newly onboarded chef's first sales MUST be subject to
  stated velocity limits and a longer reserve (`FR-039a`) than an established one, and the transition MUST be
  rule-based and legible to the chef rather than discretionary.
- **FR-078** — **card testing**: purchase endpoints MUST be protected against enumeration attacks, which have
  risen **~175% year over year** and which target low-value digital goods precisely because a successful
  authorization validates a stolen credential instantly. A failed-authorization pattern MUST be rate-limited
  and alarmed, and MUST NOT be treated purely as a conversion problem.
- **FR-079** — **sanctions and prohibited-party screening** MUST occur at seller onboarding and MUST be
  re-run on a stated cadence, not once. Paying a sanctioned party is a strict-liability failure; discharging
  it through the payment processor's connected-account programme (`FR-053`) is acceptable, but the
  **obligation remains ours** and the specification MUST state which party performs which half.
- **FR-080** — **the fraud controls MUST NOT silently become a second suspension mechanism**: any control that
  withholds money, blocks a sale, or restricts an account MUST produce a reason the affected party can read,
  an appeal path, and a record (`FR-069`) — the same discipline `FR-009` requires of program decisions.
  ⚠️ Fraud systems that act without explanation are how legitimate sellers are lost silently.
- **FR-081** — **AI-assisted abuse is the current shape of this threat**: generated receipts, images and
  identity documents make false claims cheap to produce at volume, so a control that depends on a human
  reviewing an artefact for plausibility MUST NOT be the only control. **Prefer evidence we generate
  ourselves** — delivery records, access logs, purchase velocity — over evidence the claimant supplies.

#### M. Payment rails and the platform stores — ⚠️ the constraint that can make the marketplace unviable on mobile

> ⛔ **A 20% commission is not 20% when a store takes its cut first.** `FR-073` and Constitution Principle VIII
> require every user-facing surface to ship on **both** web and mobile in the same release — so the
> marketplace's economics must work on mobile, and on mobile they are not ours alone to set.

- **FR-082** — **the stacked take MUST be computed before the commission is set**: where a purchase is made
  through a platform store's in-app purchase, the platform's commission (**30%**, or **15%** under a
  small-business programme) applies **before** ours. A 20% platform commission stacked on a 30% store
  commission leaves a chef roughly **half** of what the buyer paid. `FR-034a` MUST be decided against the
  **stack**, per storefront, not against our rate in isolation.
- **FR-083** — **the v1 rail is external web checkout, and it is available because v1 is US-only**: App Store
  Review Guideline **§3.1.1(a)** states that the entitlements _"are **not required** for developers to include
  buttons, external links, or other calls to action in their **United States storefront** apps,"_ while for
  every other storefront such calls to action are prohibited absent IAP or the External Purchase Link
  Entitlement. ✅ `016-FR-048` configures v1 to the **US market only**, so external web checkout is compliant
  for v1 — and this is recorded so the first non-US storefront does not discover it at launch.
- **FR-084** — **any storefront beyond the US requires a rail decision before it is served** (`016-FR-048a`
  already requires an unserved market to fail closed). The options are IAP with its commission, the External
  Purchase Link Entitlement with its own commission, or not offering purchase in that storefront. This is
  `016-FR-048c` enabling work attached to the market that triggers it — **not** a v1 build.
- **FR-085** — ⛔ **selling "promotion" to a chef inside a mobile app is IAP-bound, and this is not obvious**:
  Apple's guidance names **buying advertising to display in the same app** — "sales of _boosts_ for posts in a
  social media app" — as requiring in-app purchase. ⚠️ **This lands directly on `C-018-003b`**: if seller-funded
  promoted placement is adopted, it is subject to the store's commission on mobile, which changes both its
  economics and its cross-platform parity story. A mechanism that only works on web is a mechanism that fails
  `FR-073`.
- **FR-086** — **the rail MUST NOT change what the buyer is told**: whichever rail is used, `FR-046`'s
  pre-purchase disclosure, `FR-048`'s receipt, `FR-049`'s refund path and `FR-052`'s cancellation route MUST
  be equivalent. ⚠️ Where a purchase was made through a store, cancellation MUST route to that store's
  mechanism rather than dead-ending (`016-FR-042`) — a rule that already exists and now has a second subject.

#### N. The chef's product — why anyone pays, when recipes are free

> ⛔ **The premise this feature had accepted without testing.** `001-FR-004` makes every public recipe readable
> by any signed-in user and `001-FR-005` makes it cloneable; the open web is saturated with free recipes. So
> **why would anyone pay a chef for one?** The question is answerable, but the answer changes what the
> sellable unit should be.

✅ **People demonstrably pay for recipes in a world of free recipes.** Cookbook sales run **over $4bn**
globally; the paper cookbook market alone was **~$7.7bn in 2024, forecast to ~$11.8bn by 2032 (6.2% CAGR)**;
cookbooks are around **27% of the book publishing market**. That market exists _entirely_ in the presence of
free online recipes, so free substitutes are not the objection they appear to be.

⚠️ **But what people buy is not a recipe.** The stated reasons are **curation and credibility**, variety,
step-by-step reliability, ingredients that are actually findable, design, and the author's voice. **A cookbook
is a bounded, opinionated, trustworthy set — a recipe is a commodity.**

⭐ **And the highest-converting axis is a CONSTRAINT, not a cuisine.** Specialty-diet collections reportedly
outsell general ones by **~300%** in the digital creator market (gluten-free dessert collections are the cited
case). **The constraint is the product** — and it is exactly where this platform can build something the free
web structurally cannot, because the constraint can be **machine-verified** against resolved ingredients and
USDA nutrition rather than asserted by an author. That is the differentiator `docs/competitive/` calls our
sharpest weapon, expressed as something a chef can sell.

- **FR-087** — **the sellable unit is a COLLECTION first, a recipe second**: a chef MUST be able to sell a
  **named collection of their authored recipes** as a single product, and this MUST be the primary sellable
  form. Selling a single recipe (`FR-029`) remains permitted and is the weaker unit. ⚠️ `012-FR-017`…
  `012-FR-019` already own collections as a **surfacing** concept for public recipes; a **sellable** collection
  is that entity given a price and a provenance gate, not a second collections model (`GR-014` AC-014-b).
- **FR-088** — ⛔ **a stated constraint on a paid product MUST be verified, not asserted**: where a collection
  claims a dietary, allergen, nutritional or ingredient constraint, the system MUST evaluate that claim against
  the resolved ingredient and nutrition data and MUST NOT publish the claim where it cannot be evaluated. A
  claim the system cannot verify MUST be either removed or displayed as the **chef's unverified statement**,
  clearly marked as such. ⚠️ **This is a safety requirement before it is a marketing one**: an allergen claim
  on a product someone paid for is a consumer-protection exposure and a physical-harm risk, and `016-FR-051`
  already requires allergen-relevant content to carry a reachable disclaimer. ⛔ It also MUST NOT be read as a
  medical claim (`016-FR-051`).
- **FR-089** — **a collection purchase delivers every member recipe as a licensed copy** under `FR-029a`, as
  one atomic act. Partial delivery MUST NOT be an observable state.
- **FR-090** — **a collection's membership can change, and the buyer MUST be told what that means before
  paying**: whether recipes added later are included, and what happens to a buyer's copies when a recipe is
  removed. ⚠️ Copies already delivered are the buyer's under `FR-029a` and MUST NOT be revoked by a later
  edit to the collection; the open question is only **future** members, and it MUST be answered on the
  purchase surface rather than in the terms.
- **FR-091** — **the chef's own free recipes MUST remain free**: offering a collection for sale MUST NOT
  change the visibility of any recipe already public (`FR-029c` forbids a recipe being public and for sale at
  once, and `FR-067` forbids this feature publishing anything on its own). A chef assembling a paid collection
  from previously public recipes MUST be told, per recipe, that it will leave public view — and the recipes
  cloned from it while it was public remain their cloners' work (`001-FR-005d`).

#### O. Households — the collision nobody has looked at

> ⛔ **`017-FR-030`…`017-FR-034` make a household a first-class entity with a seat count, and `017-FR-031`
> scopes meal plans to it. `FR-029a` makes a purchased recipe PRIVATE to the buyer. Put those together and a
> household meal plan can reference a recipe the other members cannot read.** This has not been specified
> anywhere, and it is the kind of gap that surfaces as a support ticket on day one.

- **FR-092** — **a purchase entitles the buyer's HOUSEHOLD, at the seat count in force when the purchase was
  made** — not the individual account. ⚠️ **Recommended resolution, owner confirmation invited**, on three
  grounds: `017-FR-030` makes every user a household (a solo user is a household of one), so household-scoping
  needs no "no household" branch; meal planning and grocery lists are **already** household-scoped, so an
  account-scoped entitlement breaks the one workflow the purchase exists to serve; and a per-person licence on
  a family's dinner is unenforceable and hostile. ⛔ The consequence is real and must be priced, not hidden:
  **one sale can serve a household of six**, and `FR-046`'s pre-purchase disclosure MUST state the scope so a
  chef prices for it knowingly.
- **FR-093** — **a household-derived entitlement is not portable**: a member who leaves a household loses
  access to content that household bought, and **keeps everything they bought themselves**. The distinction
  MUST be visible to the member before they leave, and MUST NOT be silent.
- **FR-094** — **seat count changes do not retroactively expand a purchase**: growing a household after a
  purchase MUST NOT grant new seats access to previously purchased content unless the terms say so, and
  whichever rule applies MUST be the one disclosed at `FR-046`.
- **FR-095** — **household seats are a pricing lever this feature does not own but must not contradict**:
  `017-FR-034` already requires the subscription to carry a seat count, landing on `010`. `C-018-003c` should
  treat seats as a candidate gate — it is the clean case of "value is high and marginal cost is real" — but
  `010` decides it.

#### P. Instrumentation — `FR-058i` is a requirement with no events behind it

> ⚠️ **`FR-058i` forbids narrowing the free tier until all five value channels are measured. Nothing in this
> specification says how any of them is measured**, which makes it an unenforceable requirement — the exact
> shape of a control that reads green because nothing is checking.

- **FR-096** — each of the five channels MUST have **named, first-party events with written definitions**
  before the channel may be reported: (1) **conversion** — a free account becoming paid, attributed to prior
  chef-content interactions within a stated window; (2) **corpus** — recipes authored, rated, photographed and
  corrected by free accounts, and the use of that content by **paid** accounts; (3) **liquidity** — chef
  supply and listing depth as a function of demand-side actives; (4) **social proof** — cook counts and
  ratings surfaced on a path that preceded a conversion; (5) **referral** — invites sent, accepted, and the
  resulting k-factor.
- **FR-097** — **attribution windows and the multi-touch rule MUST be stated, never defaulted.** Last-touch is
  the default that appears when nobody chooses, and it systematically under-credits the corpus and social-proof
  channels — which are early-touch by nature and are precisely the channels a tightening decision would
  destroy.
- **FR-098** — ⛔ **an unmeasured channel MUST report as UNMEASURED, never as zero.** ⚠️ This is the single
  most important line in this section: a dashboard that shows four channels and a silent zero looks like five
  channels were measured, and `FR-058i` would be satisfied on the face of it while being violated in fact.
  A decision taken against an unmeasured channel MUST record that the channel was unmeasured.
- **FR-099** — **measurement MUST NOT create a tracking surface it does not have consent for**: these are
  first-party, aggregate, product-analytics events on our own users, bounded by `FR-062c` and `FR-062e`, and
  MUST NOT become a per-user profile sold or shared under any of Section H's mechanisms.

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
- **ChefListing**: A chef's item offered for sale — its type (a `013` course/lesson, or an authored recipe
  sold as a licensed copy per `FR-029`), price, what a buyer receives, provenance attestation reference, and
  availability state. A recipe listing and a `public` visibility state are mutually exclusive (`FR-029c`).
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
  **not permitted** until `C-018-003` is answered and, if it ever selects advertising, until the consent
  surface `016` requires is specified. Research recommends excluding it at v1 (`FR-058`).
- **Licensing the corpus to any third party, including for AI training** (`FR-062a`). It is a separate
  decision with its own licence amendment and its own consent design — not a revenue lever this feature pulls.
- **Platform-sold CPG sponsorship** at v1 — it needs a sales function that does not exist. Recorded as the
  **strategic tier** in [`research/free-visitor-monetization.md`](./research/free-visitor-monetization.md),
  not as a gap.
- **Monetizing allergen, dietary-restriction or household-composition data** — `FR-062f`. Not deferred; a
  hard stop.
- **Any pressure signal that is not true** — invented or resetting urgency, fabricated scarcity or activity
  counts, confirmshaming, obstructed cancellation (`FR-062d`).
- **Retroactively narrowing the free tier** — `FR-061`. `C-018-003c` may propose gating **new** capability;
  it may never take back what a free user already has.
- **Defining the subscription tiers themselves** — `010` owns `010-FR-040`/`010-FR-041`. `C-018-003c` decides
  only what `018` **asks** `010` to change.

---

## Cross-spec amendments this feature will require

Stated now so the cost is visible before planning, per the precedent `016` set. **None is applied by this
document** — each lands on its owner spec, and `GR-003` AC-003-b requires
[`cross-feature-FR-index.md`](../cross-feature-FR-index.md) to be updated in the same change set.

| Target                                                 | Amendment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Gated on      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `GR-014` (Audience & Sharing Model)                    | **Minor amendment only** — `C-018-001` resolved to the licensed-copy model. `AC-014-h`'s "a private recipe is copyable only by its owner" gains a **narrow, stated exception for a purchased copy**, which is _created in the buyer's collection_ under a private-only provenance rather than _cloned out of the chef's_. `AC-014-d` (no priced recipe audience), the binary-visibility rule, and `012`'s withdrawal all **stand unchanged**.                                                                                                                                   | ✅ resolved   |
| `012-creator-profiles`                                 | `012-FR-031`…`012-FR-034` move from **DRAFT/merchant-blocked** to active, citing this feature as the marketplace-payments owner. `012`'s dependency note is updated to name `018`.                                                                                                                                                                                                                                                                                                                                                                                              | ✅ resolved   |
| `013-cooking-school`                                   | `013-FR-010`'s "⚠️ Blocked on marketplace payments" is cleared and the 20%/80% split cites `018-FR-034`. ⚠️ **And `C-018-004` may change the rate itself**: 20% sits above every comparable creator platform (5–12%) and becomes ~50% once a platform store's commission stacks on it (`018-FR-082`). `013` owns `013-FR-010`, so `018` may only ask.                                                                                                                                                                                                                           | ⚠️ C-018-004  |
| `010-subscriptions`                                    | `010`'s Out of Scope is amended to state that **money-out** is owned by `018`, so the boundary is recorded rather than inferred. `010-FR-044`'s staleness question gains a money-weighted case (`018-FR-020`). ⚠️ **And `C-018-003c` may ask `010` to narrow `010-FR-040`'s free tier and to add a reverse trial to `010-FR-041`** — `010` owns the tier definition, so `018` may only ask. Any such change is gated on `018-FR-058i`'s five-channel measurement and bounded by `018-FR-058j` and `018-FR-061`.                                                                 | ⚠️ C-018-003c |
| `016-legal-compliance-framework`                       | `016`'s Out of Scope line _"Payment-card and tax compliance (owned by `010` and its processor)"_ is inaccurate once `018` exists and must name `018` for the marketplace half. **`016-FR-050`'s counsel list gains three items**: the `FR-032b` payment-agency bounds (the thing standing between us and a money-transmission licence), the marketplace-facilitator tax posture, and whether `FR-032a`'s buyer guarantee is consistent with the chef holding the sales contract. `016-FR-040`…`044`'s consumer disclosures must cover a purchase whose **seller is not us**.    | ✅ resolved   |
| `002-user-auth`                                        | The capability model (`018-FR-018`…`FR-025`) generalises `002-FR-037`'s single "admin role permissions". `002`'s Out of Scope currently excludes an admin UI; `018` needs reviewer and finance surfaces, so the boundary must be restated rather than silently crossed.                                                                                                                                                                                                                                                                                                         | —             |
| `015-publishing-rewards`                               | No change required — `FR-063`/`FR-064` are stated **here** so `015`'s controls bind on this feature without `015` having to know about it.                                                                                                                                                                                                                                                                                                                                                                                                                                      | —             |
| `v1-launch-plan.md`                                    | `M6`'s open item _"Decide the marketplace-payments question"_ is answered: a dedicated feature, `018`. `M7`'s `012`/`013` monetization blockers point here.                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅ resolved   |
| `executive/04-product-plan.md` · `05-business-plan.md` | The business plan's four revenue layers do not name **commerce media on meal intent** (`018-FR-062e`), which the research puts in the strategic tier, nor a **referral programme** (`018-FR-058k`). Both are additions to the recorded model rather than departures from it, and should be recorded there rather than living only in a feature spec.                                                                                                                                                                                                                            | ⚠️ C-018-003a |
| `docs/competitive/02-gap-analysis-and-strategy.md`     | **D5** and **D23** are load-bearing inputs to `C-018-003c` and `C-018-004` and are cited here rather than restated. No amendment needed — recorded so the contradiction between D5's "more generous free tier" and the tightening instinct is resolved in one place, not twice.                                                                                                                                                                                                                                                                                                 | —             |
| `017-recime-parity` / `006` / `010`                    | ⛔ **A collision `017` cannot see.** `017-FR-030`…`017-FR-034` make a household first-class with a seat count and scope meal plans to it; `018-FR-029a` makes a purchased recipe **private to the buyer**. A household meal plan can therefore reference a recipe the other members cannot read. `018-FR-092`…`018-FR-095` resolve it **household-scoped**, which needs `017`/`006` to know a household's readable set includes household-purchased content, and `010` to know that `017-FR-034`'s seat count now bounds a **purchased** entitlement as well as a subscription. | ⚠️ confirm    |
| `cross-feature-consistency-report.md` §9               | No new personas — this feature uses P1, P5, P9, P11, P12, P13 (`GR-013` AC-013-a).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | —             |

---

## Clarifications

Three questions are open. Each is scope-level or one-way; none has a defensible default.

### C-018-001 — What may a chef actually sell?

**Status**: ✅ **RESOLVED by owner, 2026-08-26 — model (b), the licensed copy.** Implemented at `FR-029`…`FR-030`.

Videos and courses are already purchasable and already specced (`013-FR-001`…`FR-003`). **Recipes were the
question**, and the standing answer was "not at all": `GR-014` says visibility is binary and `AC-014-d` says a
priced recipe audience is a violation. `012` drafted the paid-recipe model in this same PR and withdrew it,
burning `012-FR-035`…`012-FR-039`.

| Model                                       | What a buyer gets                                                                                         | Governance cost                                                                                                                                     | The problem it leaves                                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **(a) Video/courses only**                  | `013` lessons and courses; recipes stay free and binary                                                   | **None.** `GR-014` untouched, `012`'s withdrawal stands, `013` already specifies it                                                                 | Does not deliver "buy recipes from them". A chef with no video has nothing to sell.                                                              |
| **(b) A purchase delivers a licensed copy** | An owned copy of the chef's recipe lands in the buyer's own collection, private to them, with attribution | **Narrow.** Visibility stays binary; `AC-014-h` ("a private recipe is copyable only by its owner") needs an explicit exception for a purchased copy | Nothing stops a buyer republishing the copy — so `001-FR-005b`'s substantive-edit rule and the licence must carry the weight.                    |
| **(c) A paid recipe state**                 | Access to a recipe that is neither private nor public                                                     | **Large.** `GR-014` amended at a major version; the withdrawn `012` model is effectively reinstated under a new number                              | Re-opens every question `012`'s withdrawal closed, and `001-FR-004`/`FR-005`'s read-and-clone rights must be re-specified against a third state. |

✅ **The owner selected (b).** It delivers the ask _without_ reversing a ratified rule, because it reframes
the purchase as **acquiring a copy** rather than **unlocking a paywall** — which is what a cookbook purchase
actually is.

⚠️ **A finding that emerged while writing the requirement, and it makes (b) cheaper than the table above
suggests.** The constraint a purchased copy needs — _private-only, never publishable, never re-sellable_ — is
one the system **already enforces**: `GR-014` AC-014-e states that the shipped `sourceType` value
`imported_paid` **"may never be public"**, and `004-FR-011` already owns that vocabulary. A recipe bought from
a chef **is** content acquired from a paid source. So the resale/republication path the table flagged as (b)'s
open cost is closed by an **existing** rule rather than a new one, and the only `GR-014` change left is a
**narrow exception to `AC-014-h`** — a purchased copy is _created in the buyer's collection_, never _cloned
out of the chef's private recipe_. `AC-014-d` and the binary-visibility rule are untouched.

### C-018-002 — Who is the seller of record?

**Status**: ✅ **RESOLVED by owner, 2026-08-26 — the split ("Amazon Marketplace") model.** Implemented at
`FR-032`…`FR-032d`, with consequences at `FR-042`, `FR-049`, `FR-053` and `FR-054`.

**What resolved it was noticing that "seller of record" is not one decision.** Amazon Marketplace splits it
four ways, and the split is the answer:

| Layer                              | Amazon Marketplace                                                                                                        | Us (`FR-032`)                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| The sales **contract**             | The third-party seller. Amazon's Business Solutions Agreement makes Amazon the seller's **agent** for payment processing. | **The chef**                                                           |
| The **money**                      | Amazon collects, holds on a rolling reserve, nets its fees, and disburses on a schedule.                                  | **The platform**, as agent                                             |
| **Transaction tax**                | Amazon, as **marketplace facilitator**.                                                                                   | **The platform**                                                       |
| **Seller identity / KYC / 1099-K** | Amazon, via Seller Identity Verification.                                                                                 | **The platform**, through the processor's connected-account onboarding |
| The **buyer's refund**             | Amazon pays the buyer under the A-to-z Guarantee and charges the seller back.                                             | **The platform** (`FR-032a`)                                           |

**Two facts changed the shape of the decision, and both are recorded because they will otherwise be
re-litigated:**

1. ⛔ **The tax escape does not exist.** Every US state with a sales tax passed marketplace-facilitator
   legislation between 2018 and 2021, attaching collection and remittance to the **platform** regardless of
   who the seller of record is. "The chef is the seller, so tax is their problem" was never available. What
   the chef-as-seller choice actually buys is distance from **money transmission** and from the content
   liability of a **seller** rather than a host — which is what keeps `016`'s hosting-service posture intact
   (`FR-032d`).
2. ⚠️ **Amazon takes the buyer-facing refund anyway.** Structurally the seller owes it; operationally Amazon
   pays first and claws back — because a marketplace where the buyer chases a stranger for a refund does not
   work. That is `FR-032a`, and it is the deliberate departure from a pure agency model.

**Recorded counterpoint, so it is not mistaken for an oversight**: for **digital** goods Amazon flips —
on Kindle Direct Publishing **Amazon is the seller of record** and pays a royalty, as do the Apple App Store
and Google Play. A chef selling a recipe or a video is closer to KDP than to a marketplace shipping physical
goods, so the platform-as-seller model had a genuine argument. It was not selected because it would place the
platform in a **seller's** content-liability posture, which is materially different from the hosting-service
framing the whole of `016` is built on — a cost that lands far outside this feature.

⚠️ **Residual risk to carry into planning**: `FR-032b`'s bounds (no holding beyond the payout schedule, no
services on held funds, no third-party direction) are what keep this a payment-agency arrangement rather than
one requiring a money-transmission licence. They are **requirements**, and `016-FR-050`'s counsel list must
gain this arrangement as an item.

### C-018-003 — The free user: revenue, allocation, assets, compounding, and where the tier stops

**Status**: OPEN, and **widened twice on owner direction (2026-08-26)** — first past the initial three-option
shortlist (_"I think this is too narrow"_), then into the service/retail/data/psychology framing. Now **three
decisions**: `C-018-003a` (which mechanisms ship), `C-018-003b` (is ranking for sale), `C-018-003c` (where the
free tier stops). Blocks `FR-058`, `FR-058e`, `FR-058h` and User Story 7.
**Evidence — 5 questions, 6 payer groups, 27 options, unit economics, the rejected list, sources**:
[`research/free-visitor-monetization.md`](./research/free-visitor-monetization.md).

#### What the widening changed — five findings, each of which moved the answer

1. **It is five questions, and the first pass answered one.** **Q-A** revenue from a non-buying visit ·
   **Q-B** allocation to a chef · **Q-C** what free users _produce_ · **Q-D** whether free users make paid
   users more valuable and manufacture new ones · **Q-E** where the free tier should stop. Answering only Q-A
   is what makes a product reach for advertising before it has the traffic for advertising to pay.

2. ⭐ **We are UPSTREAM of the retailer, and that reorders the catalogue.** Retail media turns first-party
   purchase data into a **60–70% margin** business against **5–10%** on core retail — the logic that made
   Chase and PayPal stand up Financial Media Networks. What those businesses sell is demonstrated purchase
   intent. **A retailer knows what you bought; we know what you are planning to cook on Thursday** — pre-basket,
   pre-brand, pre-store, while the ingredient list is still editable. **A recipe is a shopping list that has
   not been written yet**, and that intent is generated overwhelmingly by **free users**. This promotes CPG
   sponsorship and aggregate insight from "later" to the **strategic core**, delivered as **meal-intent
   commerce media through a data clean room** (**<48% of retail media networks offer clean rooms** — white
   space), with grocery affiliate as the **closed loop** proving the signal converts.

3. **The productive axis is the payer, and two of six were missing.**
    - ⚠️ **P4, the chef.** Seller-funded advertising is **~$985M/yr at Etsy, +18% YoY, 40%+ of active sellers,
      and the acknowledged driver of take-rate expansion to 25.7%**. At real marketplace scale the **seller**
      is a bigger and more willing payer than the visitor.
    - **P5, another business.** The nearest analogue in this category — **Whisk, now Samsung Food** — already
      sells CPG sponsored placement across **~500M monthly recipe impressions** _and_ a **B2B recipe
      content-management tool** on a usage fee. Same asset class this portfolio has already built.

4. ⭐ **Q-D has a concrete answer, and it changes what a free user is worth.** A free user's value is
   `conversion + corpus + liquidity + social proof + referral` — **five channels, not one**. Only the first
   is the ~2.1% conversion rate. The corpus is the base capability every other capability sits on; free users
   are the **demand side** that makes chef supply worth having; their ratings and cook counts convert other
   users; and referral is the **highest-leverage under-built item in the catalogue** — referrals convert
   **3–5× better than paid acquisition at ~25% lower CAC**, k-factor moves from **0.2–0.4 to 0.5–0.8** with a
   real programme, and share-prompt placement alone lifts share rate **>30%**. ✅ `015` explicitly leaves
   referral rewards unowned. **`FR-058i` makes measuring all five a precondition of any tightening.**

5. **The unit economics settle the Q-A lead.** One grocery conversion (~3% of a ~$150 basket ≈ **$4.50**) is
   worth ~**90 views at a premium food RPM** and ~**2,250 at a generic one** — and the premium RPM is gated
   behind traffic minimums we will not clear for some time. **Commerce needs one to two orders of magnitude
   less traffic than advertising**, at the smallest consent surface of any option.

#### `C-018-003a` — which mechanisms ship, and when

| Tier                                          | Mechanisms                                                                                                                                                                                                                                                                                                                                                                    | Why here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Now**                                       | Attribution-only recognition · **reverse trial + experimentation discipline** · **a real referral programme** · **grocery affiliate shared with the chef** · chef-sold sponsorship · reduced commission as a paid upgrade                                                                                                                                                     | None of these needs a new payer relationship, a sales function, or a legal amendment. ⭐ **The two largest conversion levers in all of the evidence are in this row and neither is a gate**: running experiments at all is worth up to **40×**, and getting trial length right is worth **45.7% vs 26.8%**. ⭐ **Referral is the highest-leverage under-built item in the catalogue** — referrals convert **3–5× better than paid acquisition at ~25% lower CAC**, and `015` explicitly leaves referral rewards unowned. Affiliate is the revenue lead, and the closed loop the strategic tier needs. |
| **Next**                                      | Chef pool, allocated **user-centrically**, funded on measured lift · off-platform attributed commission · seat-limited chef cohorts                                                                                                                                                                                                                                           | The pool is the Q-B answer and the only mechanism paying a chef for content a **free** user loved — but it is a **cost line**, so it waits for the "Now" tier's measurement. Off-platform commission captures promoted placement's revenue **without touching ranking**. Cohort seats are **real** scarcity, so they sit on the right side of `FR-062d`.                                                                                                                                                                                                                                              |
| **Strategic**                                 | **Meal-intent commerce media through a clean room** · platform-sold CPG sponsorship as its sales expression · contextual in-recipe commerce as the vendor-shaped fallback                                                                                                                                                                                                     | The owner's reframe, and the largest prize here. Retail media earns **60–70% margins** on this class of asset against 5–10% on core retail; the US market is **$69.33bn in 2026 (+17.9%)** with CPG at **39%** of ad budgets; **<48% of retail media networks offer clean rooms**, which the trade calls white space. ⚠️ Needs consent design, counsel and a sales function — and `FR-062e`/`FR-062f` are hard boundaries on it.                                                                                                                                                                      |
| **Not without reopening a ratified decision** | Display advertising at current scale · corpus / AI-training licensing (`FR-062a`) · un-consented behavioural insight (`FR-062c`) · selling user data · monetizing allergen/dietary/household data (`FR-062f`) · paywalling public recipes · retroactive free-tier removal (`FR-061`) · invented urgency and fabricated scarcity (`FR-062d`) · purchasable standing (`FR-063`) | Each is refused for a stated reason in the research file, not by omission.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**The decision needed**: accept the "Now" row, compress it, reorder it — or ship **none** at v1 and treat free
traffic purely as an acquisition asset.

#### `C-018-003b` — ⚠️ is ranking for sale?

**The specification currently answers this "no" by implication (`FR-014`, `FR-058d`) rather than by decision,
and that is not good enough for a trade this size.** Seller-funded promoted placement contradicts both — and
it is **~$985M/yr at Etsy, +18% YoY, used by 40%+ of active sellers, and the acknowledged driver of its
take-rate expansion to 25.7% (Q1 2026)**.

| Position                               | What it means                                                                                                                                                          | What it costs                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Ranking integrity is absolute**      | `FR-014` / `FR-058d` stand unchanged; promoted placement permanently out.                                                                                              | Forgoes the line Etsy calls its take-rate engine. Buys a discovery surface a buyer can trust without reading the fine print. |
| **Promotion permitted but segregated** | Paid placement only in **clearly demarcated, labelled slots**, never mixed into or re-ordering organic results. `FR-014`/`FR-058d` amended to say **organic** ranking. | Most of the revenue, most of the trust. The discipline must be enforced by test, not by intent.                              |
| **Promotion blended and labelled**     | The Etsy / Amazon model.                                                                                                                                               | Highest yield. Makes discovery a paid surface — a different product than `FR-013`–`FR-017` describe.                         |

⚠️ **Two middle paths, and they are different from each other:**

1. **Off-platform attributed commission** (Etsy's Offsite Ads shape — **15%** on a sale attributed within a
   window) captures much of the same revenue **without touching on-platform ranking at all**, and survives
   even the absolute position.
2. ⭐ **EARNED ranking is not BOUGHT ranking** (`FR-005b`). Etsy's own Star Seller badge _"can boost the
   quality score of listings in search"_ — a ranking effect obtained by **behaviour**, not by payment. That is
   compatible with `FR-014`'s "stated and identical for every chef" as long as the criteria are published and
   objective, and it delivers much of promoted placement's _discovery_ benefit with none of its trust cost.
   **The question `C-018-003b` actually asks is narrower than it first appears: not "may ranking ever vary",
   but "may ranking be BOUGHT."** ⛔ Whatever is decided, `FR-062b` holds: a chef-facing paid product
   sells **capability**, never **placement**.

#### `C-018-003c` — ⚠️ where does the free tier stop? _(new, from the owner's widening)_

**The instinct is supported by the data, and the answer is not "no".** `010-FR-040` currently gives the free
tier unlimited public recipes, unlimited importing, manual planning, grocery lists and cooking mode — and
`015`'s D4a adds private recipes. **The free tier is being asked to be corpus engine, acquisition engine and
complete product at once**, which is a real problem. It resolves into three sub-decisions with very different
risk:

| Sub-decision                              | Recommendation                                                                                                                                                                                                                                                                                                                                                                                      | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Should the free tier be narrower?**     | **Probably yes, at the margin.**                                                                                                                                                                                                                                                                                                                                                                    | ⛔ Gated on `FR-058i` — measure all five value channels first. A free user is `conversion + corpus + liquidity + social proof + referral`, and **four of those shrink when reach shrinks**. Deciding on the ~2.1% conversion figure alone is deciding on one fifth of the evidence.                                                                                                                                                                                      |
| **Where should new gates go?**            | Where **marginal cost is real and value is high** — AI generation, automation, multi-week planning horizon, nutrition depth, export, scale. ⛔ **Never the core plan-shop-cook loop**, which is what the corpus and the referral engine run on.                                                                                                                                                     | Low, if `FR-061` holds: gate what is **new**, never remove what free users **have**.                                                                                                                                                                                                                                                                                                                                                                                     |
| **May we use urgency, tension and FOMO?** | ⭐ **Only the true kinds** — and the true kinds are high-yield. A **reverse trial** is the best fit in the whole catalogue: cooking value compounds over a plan-shop-cook cycle, so a 3–7 day trial cannot demonstrate it (**17–32 day trials convert 45.7% vs 26.8%**); the loss is **real**, so the urgency is truthful; and it preserves the reach a hard paywall destroys. `FR-058j` bounds it. | ⛔ Invented or resetting urgency, fabricated scarcity and confirmshaming are forbidden by `015-FR-027`/`015-FR-028` and **prohibited outright by EU DSA Art. 25**, with UCPD alongside it, Consumer Rights Directive amendments applying **19 June 2026**, and a Digital Fairness Act expected. An FTC/ICPEN/GPEN sweep found **75.7% of 642 sites and apps used at least one dark pattern** — that is the population regulators select from. `FR-062d` states the line. |

⛔ **The distinction that keeps this both legal and consistent with `015`**: the enforcement guidance makes
**truthfulness decisive** — a genuine, time-limited offer is legitimate; the same notice becomes a violation
when the urgency is invented or simply **resets**. `FR-062d`'s test: _if the fact would still be true with the
counter removed, the counter is honest; if the counter creates the fact, it is a dark pattern._

⭐ **And the finding that should settle the tone of this decision**: the two largest levers in all of the
conversion evidence — **experimentation (up to 40×)** and **trial length (45.7% vs 26.8%)** — require
manufacturing nothing, taking nothing away, and going nowhere near that line.

⛔ **A direct contradiction inside this repo, and it must be resolved rather than averaged.** The owner's
instinct here is _"maybe we're giving too much to free users."_ This repo's own competitive analysis
([`docs/competitive/02-gap-analysis-and-strategy.md`](../../docs/competitive/02-gap-analysis-and-strategy.md),
**P4** and **D5**) concludes the **inverse**: _"hold or raise price, and buy the position with a far more
generous free tier,"_ with **nutrition-truth free** because it is the proof of the differentiator. Its
reasoning is specific and survives scrutiny:

- **We are at price parity with the leader, not above it** — ReciMe runs an A/B-tested range of roughly
  **$29.99–$99**, not the $39.99 gifting SKU an earlier revision anchored to.
- **Our pipeline costs more than theirs** (frame OCR and vision inference vs caption scraping), so competing
  on price loses money on exactly the power users who generate word of mouth. `ADR-0024` exists because
  inference cost already binds.
- **The $60–80 "category ceiling" anchors to a failing category** — MacroFactor charges **$71.99/yr with no
  free tier at all**; MyFitnessPal Premium+ is **$99.99/yr**.
- **"No forced subscription" is the #9 stated churn reason** in their users' own words, with **D23** proposing
  a one-time or lifetime tier (Paprika $29.99 once, Recipe Fox $10 once, Copy Me That $65 lifetime, Crouton's
  $24.99-once-plus-optional-sub are the proven shapes).

⚠️ **The two positions are reconcilable, and the reconciliation is the actual recommendation**: be **more**
generous on the differentiator and the core loop — nutrition truth, privacy (D4a), the plan-shop-cook cycle —
and **raise price and gate volume, AI, automation, horizon, export and household seats** instead. That is
"give less" and "give more" pointing at different things: **less breadth of unlimited scale, more depth of the
thing that proves we are right.** ⛔ What it is not is a general tightening — which `FR-058i` forbids deciding
without measuring, and which the competitive evidence says would surrender the position.

### C-018-004 — What is the commission, measured against the whole stack? _(new)_

**Status**: OPEN — blocks `FR-034a`. Ratified elsewhere as **20%** (`013-FR-010`), and the evidence says that
number was set without the stack in view.

**Benchmarks for creator content — we are at the high end, not the middle:**

| Platform                               | Take                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Ko-fi                                  | **0%** on one-time sales; 5% on memberships                                                          |
| Buy Me a Coffee                        | 5% flat                                                                                              |
| Substack · Gumroad                     | **10%**                                                                                              |
| Patreon                                | **8–12%**                                                                                            |
| Kajabi · Teachable · Thinkific · Podia | **0% of revenue** — flat **$69–$399/month** instead                                                  |
| **`013-FR-010` / `FR-034` today**      | **20%**                                                                                              |
| Apple / Google in-app purchase         | **30%**, or **15%** under a small-business programme                                                 |
| Etsy _effective_                       | 25.7% — ⚠️ **not a content commission**: physical goods, payments **and** seller-funded ads combined |

⛔ **And it stacks.** On any storefront where in-app purchase is required, the store takes its cut **first**.
20% on top of 30% leaves the chef about **half** of what the buyer paid — a split no serious chef accepts, and
one that makes `FR-073`'s web-and-mobile parity requirement an economic problem rather than a delivery one.
✅ For **v1 this is survivable**: `016-FR-048` serves the **US only**, and App Store Guideline **§3.1.1(a)**
expressly permits external links and calls to action in **United States storefront** apps. **The trap is the
first non-US storefront** (`FR-084`).

**Three shapes to choose between:**

| Shape                                           | Means                                                                                                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hold 20%**                                    | Matches `013-FR-010` as ratified; simplest; **but** sits above every comparable creator platform and is punishing once a store commission stacks on it.                       |
| **Move to the creator-platform band (~10–15%)** | Competitive with Substack/Gumroad/Patreon, survives a stacked store commission, and makes the chef program materially easier to recruit into. Requires amending `013-FR-010`. |
| **Per-storefront rate**                         | Our rate flexes so the chef's _net_ is stable across web and mobile. Honest to the chef; more machinery, and the rate is no longer a single legible number (`FR-034`).        |

⚠️ **A fourth option the evidence raises and this specification has not costed**: a **flat chef subscription
instead of a commission** (the Kajabi/Teachable shape) — 0% of revenue for $X/month. It inverts who bears the
risk, it is the `4d`/`4e` mechanism in Section H taken to its conclusion, and it interacts with
`C-018-003b`: a platform that takes no commission has a much stronger reason to sell promotion.

---

## Status

**Two clarifications are resolved by owner ruling (2026-08-26)** — `C-018-001` (the licensed-copy model) and
`C-018-002` (the split seller-of-record model).

**Six passes of widening have taken this from 74 requirements in eleven sections to 133 in sixteen.** Each
addition was forced by evidence, not by scope creep:

| Added                       | Why it was not optional                                                                                                                                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H** — the free user       | Owner directed the balance of specification effort here. Five questions, six payer groups, 27 options.                                                                                                                                                                                         |
| **L** — trust, fraud, abuse | ⛔ `FR-032a`'s buyer guarantee made **us** the party who pays first. Refund abuse has displaced payment fraud as merchants' top-reported threat; card testing +175% YoY; digital goods are the preferred target because value is instant and unrecoverable; self-dealing is a laundering rail. |
| **M** — payment rails       | ⛔ 20% is not 20% once a platform store takes 30% first, and `FR-073` makes mobile economics mandatory rather than optional.                                                                                                                                                                   |
| **N** — the chef's product  | ⛔ **The premise had never been tested**: why pay for a recipe when recipes are free? It is answerable — cookbooks are a **$4bn+** market existing **inside** a world of free recipes — but the answer moves the sellable unit from a **recipe** to a **constraint-verified collection**.      |
| **O** — households          | ⛔ A collision between `017-FR-031` (meal plans are household-scoped) and `FR-029a` (a purchased recipe is private to the buyer) that neither spec can see from its own side.                                                                                                                  |
| **P** — instrumentation     | ⛔ `FR-058i` forbade narrowing the free tier until five channels are measured, and **nothing said how any of them is measured** — an unenforceable control that would have read green.                                                                                                         |

**Four decisions remain open:**

- **`C-018-003a`** — which free-user mechanisms ship, and in which tier.
- **`C-018-003b`** — ⚠️ **may ranking be BOUGHT?** ⭐ Narrower than it first looked: `FR-005b` establishes that
  **earned** ranking (Etsy's Star Seller effect on search quality score) is a different thing from purchased
  ranking, and delivers much of the discovery benefit at none of the trust cost. ⛔ And selling a "boost"
  inside a mobile app is **IAP-bound** (`FR-085`), which changes both its economics and its parity story.
- **`C-018-003c`** — ⚠️ **where does the free tier stop?** Carries a direct contradiction inside this repo —
  the tightening instinct against the competitive analysis's D5. The reconciliation is stated; the choice is
  not ours. ⛔ And under `FR-058i` it may not honestly be decided at all until `FR-096`–`FR-098` exist.
- **`C-018-004`** — ⚠️ **what is the commission, measured against the whole stack?**

**One recommendation awaiting confirmation rather than a decision**: `FR-092` scopes a purchase to the buyer's
**household**, not their account. It is defensible on three grounds and is stated as the resolution — but it
means **one sale can serve a household of six**, and a chef must be told that before they price.

⚠️ **Un-gated and buildable now**, whatever the four decisions land on: `FR-058f` (the recognition layer),
`FR-096`–`FR-099` (the instrumentation `FR-058i` depends on), `FR-062d`/`FR-062e`/`FR-062f` (the boundaries),
all of **Section L** (fraud controls are a consequence of `FR-032a`, not of any open question), and `FR-088`
(constraint verification, which is a **safety** requirement before it is a commercial one).

⚠️ **A note on sequencing that planning should not have to rediscover.** User Stories 1, 2, 5 and 6 move no
money and depend on **none** of the open questions. They are shippable, testable, and would tell us whether
the chef program has takers before the platform incurs a single tax, payout, refund, fraud or
money-transmission obligation. The recorded strategy says the same thing in its own words — _"Build
marketplace/network loops only after supply and demand behaviors are visible."_
