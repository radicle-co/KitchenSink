# Feature Specification: Subscriptions & Monetization

**Feature Branch**: `010-subscriptions`
**Created**: 2026-04-14
**Last updated**: 2026-05-10
**Status**: Product decisions revalidated — implementation/test gate blocked pending V-Model regeneration and test execution
**Input**: Split from `001-commise-recipe-app` — free/premium tier definitions, feature gating, upgrade prompts, and subscription lifecycle.

## Dependencies

| Spec                                                        | Relationship                                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [002-user-auth](../002-user-auth/spec.md)                   | **Required** — subscription tier is a property of the authenticated user                                             |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Referenced** — gates private recipe visibility (001-FR-003)                                                        |
| [004-recipe-importing](../004-recipe-importing/spec.md)     | **Referenced** — gates clone-to-private for imported recipes (004-FR-011)                                            |
| [005-ai-integration](../005-ai-integration/spec.md)         | **Referenced** — gates AI generation and instruction optimization (005-FR-016, 005-FR-019)                           |
| [006-meal-planning](../006-meal-planning/spec.md)           | **Referenced** — gates AI meal suggestions, auto-generation, waste optimization (006-FR-025, 006-FR-026, 006-FR-027) |
| [007-grocery-lists](../007-grocery-lists/spec.md)           | **Referenced** — gates online ordering (007-FR-031)                                                                  |
| [009-nutrition-planning](../009-nutrition-planning/spec.md) | **Referenced** — gates trainer nutrition planning (009-FR-038)                                                       |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Free and Premium Subscription Tiers (Priority: P3)

New users start on a free tier that provides core functionality: creating, viewing, editing, and deleting their own recipes (all public); sharing and cloning recipes; basic recipe importing; basic meal planning (manual assignment only); grocery list generation (without online ordering); and cooking mode. Premium features (private recipe visibility, AI recipe generation, AI meal plan optimization, food waste optimization, online grocery ordering, nutrition planning for clients, and AI instruction optimization) require a paid subscription.

**Why this priority**: The monetization model must be designed early but can be built incrementally. The free tier must deliver enough value to hook users without giving away the premium differentiators.

**Independent Test**: Can be tested by verifying a free-tier user can access all basic features and sees appropriate upgrade prompts when attempting premium features.

**Acceptance Scenarios**:

1. **Given** a new user signs up, **When** their account is created, **Then** they are on the free tier with access to all basic features and all their recipes are public.
2. **Given** a free-tier user, **When** they attempt to set a recipe to private, **Then** they are prompted to upgrade to premium.
3. **Given** a free-tier user, **When** they attempt to use AI recipe generation, **Then** they see a preview or teaser of the feature with a prompt to upgrade.
4. **Given** a free-tier user, **When** they attempt to use food waste optimization in meal planning, **Then** they are prompted to upgrade.
5. **Given** a user upgrades to premium, **When** they access premium features, **Then** all premium functionality is immediately available, including the ability to set recipes to private.
6. **Given** a premium user, **When** their subscription lapses, **Then** they retain access to all their data but premium features are locked until renewal. Previously private recipes remain private (except imported/attributed recipes, which MUST remain public per source TOS and 004-FR-011), but no new recipes can be set to private until renewal.

---

### Edge Cases

- What happens when a premium user downgrades — do they lose access to AI-generated recipes they already saved?

## Requirements _(mandatory)_

### Functional Requirements

**Subscription & Monetization**

- **FR-040**: System MUST provide a free tier with access to: recipe CRUD, sharing/cloning, basic importing, manual meal planning, grocery list generation, and cooking mode. Free-tier users may create unlimited public recipes; no recipe count cap applies. All free-tier recipes are public by default; private visibility is not available on the free tier.
- **FR-041**: System MUST provide a premium tier that unlocks: private recipe visibility, AI recipe generation, AI meal suggestions, auto-generated meal plans, food waste optimization, AI instruction optimization, online grocery ordering, and trainer nutrition planning. Premium is available at **$6.99/month** or **$59.99/year** (annual saves ~29%). New subscribers receive a **14-day free trial** before the first charge.
- **FR-042**: System MUST gate premium features with clear upgrade prompts that preview the feature value for free-tier users. Prompts follow a three-tier hierarchy: (1) contextual inline teaser at the feature entry point, (2) modal/bottom-sheet on active invocation, (3) pricing page accessible from any CTA and from account settings.
- **FR-043**: System MUST retain all user data and non-premium functionality if a premium subscription lapses. Existing private recipes remain private after downgrade; the lapsed user cannot create new private recipes until they renew. A **7-day grace period** applies after a failed payment before premium access is removed.
- **FR-044**: System MUST make a user's subscription tier readable by **every** service, not only the identity service, by publishing it into the Clerk session token as a signed claim (`public_metadata`), using the same mechanism that already carries admin `scopes`/`permissions`. The claim MUST be refreshed when the tier changes, and every consumer MUST **fail closed** — treat an absent or unreadable claim as `free`, never as premium. _(**DRAFT**, added 2026-08-02.)_

    **Why this is a requirement and not an implementation note.** `accounts.subscription_tier` already ships
    (`text`, `notNull`, default `'free'`, with an `updateSubscriptionTier` DAO method), but it is **not** a
    token claim: `@kitchensink/clerk-verify` reads only `scopes` and `permissions` from signed
    `public_metadata`, and the sole cross-service account endpoint (`/api/v1/internal/account`) is
    **erasure-only**. So identity can gate on tier today and **no other service can**. Without this,
    `@RequirePremium()` is enforceable only inside the identity service, which is not where most gated
    features live.

    **What it unblocks** — all entitlement gating, none of which needs marketplace payments:
    `001-FR-003` (only premium users may set their own recipes **private** — the gate lives in the recipe
    service, not identity); `013` course access control; and
    the three rows feature 006 deferred (`006-FR-025`, `006-FR-026`, `006-FR-027`), which were parked
    citing exactly this missing mechanism. **Staleness is the design question to settle**: a signed claim
    is only as fresh as the token, so define the maximum tolerated lag between a tier change and enforcement,
    and whether downgrade requires forced token refresh or revocation.

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`; no `any` used outside explicitly marked test doubles. (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc documentation. (Principle II)
- **NFR-003**: Any UI component MUST expose an accessible name queryable via `getByRole`/`getByLabel` in Playwright tests. (Principles IV & VII)
- **NFR-004**: Color MUST NOT be the sole conveyor of state; icon or text label pairing required. (Principle VII)

### Key Entities

- **Subscription**: Tracks a user's plan (free/premium), billing cycle, and feature access permissions.

## API Contract & Input Validation (GR-015 / GR-016)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15 / §15.4 / §15.5](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[`GR-017`](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app) ·
[`GR-018`](../governance-rules.md#gr-018-one-rejection-path-and-invalid-input-is-never-retried) ·
[`GR-019`](../governance-rules.md#gr-019-identifier-integrity--no-sentinels) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md) ·
[ADR-0017](../../docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md). Full
bindings: [`plan.md` §3.0](./plan.md#30-contract-ownership-and-drift-gr-015) and
[`plan.md` §3.0a](./plan.md#30a-input-validation-gr-016--this-plan-already-stated-the-rules-sharpest-case), which
this section summarises and must not contradict. **This section applies existing portfolio rules and mints NO new
FR** (GR-003). GR-015 decides who **authors** the contract; GR-016 decides where that zod **runs**.

⛔ **010 straddles the rule, and getting the two halves backwards is the expensive mistake in this feature.** The
inbound Stripe webhook body is **STRIPE's** shape — validated at our boundary with **our own** zod, allowed its own
types, and given **NO** OpenAPI document. Our `/api/v1/billing/*` request and response shapes are **OURS** and live
in `@kitchensink/schema-identity`. One request carries one of each.

### Contract ownership (GR-015)

| Role                                      | Binding for 010                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| Owning service (**authors** the zod)      | `@kitchensink/identity-service` — `packages/services/identity/src/billing/*.schema.ts`        |
| Stripe webhook handler                    | `@kitchensink/identity-webhooks` — **not** the ECS API                                        |
| Schema package (**generated**, committed) | `@kitchensink/schema-identity` — `packages/schemas/identity`, extended, **never hand-edited** |
| Consuming client                          | the identity consumer named by **002's own OPEN item** — see the note below                   |
| Consuming apps                            | `@commise/web` (the primary billing surface), `@commise/mobile` (deep-links to web checkout)  |
| Entitlement guard                         | a **shared** package under `packages/shared/*` — never an import of the identity service      |

⚠️ **The consuming client is still 002's question, and 010 does not pre-empt it.** 002's plan carries its own 🟠
**OPEN**: either introduce `packages/clients/identity`, or have `@commise/features-account` import
`@kitchensink/schema-identity` directly and remain the only consumer. **No `packages/clients/identity` exists
today.** Whichever lands, the client obligation below is unchanged — it is about who **authors** a wire shape, not
which directory it lives in.

✅ **Ownership is decided, not TBD** (ADR-0017, 2026-08-12): the entitlement is a **column on identity's `accounts`
row** (`subscription_tier` already ships), so a separate billing service would be a **second writer** to it — the
single-writer discipline the food service holds for USDA data, inverted. The Clerk `public_metadata` claim path
`FR-044` depends on is identity's too. **No new deployable is created**, and a **schema package is per SERVICE, not
per feature** — there is no `@kitchensink/schema-billing`.

⛔ **The Stripe webhook belongs in `@kitchensink/identity-webhooks`**: it is an **unauthenticated third-party
callback** that must **not** sit behind Clerk's `AuthMiddleware`, needs the **raw request body**, must **answer while
the API is scaled down**, and needs the `webhook_events` idempotency table that **already exists in that database**
for Clerk's svix callback. ⛔ **`@RequirePremium()` / `PlanGuard` live in a SHARED package** reading the entitlement
as a **claim from the signed Clerk session token** — every gated route lives in some _other_ service, and
`packages/infra/global/__tests__/app-service-dependency.test.ts` already forbids an app importing a service package.

**The service MUST** author every checkout, portal and subscription-status request/response shape — **and the
webhook endpoint's own response** — as **zod in the service** at `src/billing/*.schema.ts`, **beside the controller
it serves**; validate its own requests with **that same zod**; and keep every `*.schema.ts` importing **only `zod`
and other `*.schema.ts` files** — notably **no Stripe SDK type**, which would drag a third-party shape into a
contract we publish. `@kitchensink/schema-identity` exports the **zod**, the **`z.infer` types**, a
**`CONTRACT_HASH`**, a **barrel**, and a **DERIVED `openapi.yaml`**.

⛔ **Three properties of that package that look wrong and are not** — do not "correct" them: it is a literal file
**COPY** (zod are **runtime values**, so they cannot be derived from themselves, and every package exports raw
`./src/*.ts`, so there is no bundle-into-`dist` path); turbo wires it with `$TURBO_ROOT$` **`inputs`**, **NOT**
`dependsOn` (that edge closes the cycle `client → schema → service → client`, and ordering was never the requirement
because the generated files are **committed**); and `openapi.yaml` is **DERIVED OUTPUT** for `oasdiff`, docs and
integrators, **NEVER a codegen input** — through JSON Schema you lose `readonly`, branded and template-literal
types, and discriminated unions flatten.

**The CLIENT's obligation — separately mandatory.** Mandating only the service half is exactly how the client half
got skipped portfolio-wide (276 + 144 lines of independently declared client wire types, agreeing with nothing).

- **No billing wire shape is declared anywhere outside the schema package** — including **type-only** declarations,
  and including `packages/apps/**` feature packages (GR-015 §15-b.4). Both the **type and the runtime zod** come
  from `@kitchensink/schema-identity`.
- ⚠️ **The `SubscriptionStatus` shape and the plan/entitlement enum are the load-bearing case.** Every gated surface
  across 001, 004, 005, 006, 007, 009, 012 and 013 branches on them; a client that re-declares that enum can drift
  by one member and **fail open** — showing a premium feature to a free user, or the reverse — with `typecheck`
  green. Imported, never re-declared.
- A divergent consumer shape (a paywall banner model, a plan-comparison row) is **DERIVED** with
  `Pick` / `Omit` / `Partial`. Reference: `packages/apps/commise/features/recipes/src/filters/model.ts`.
- ⚠️ **CLIENT WORK IS ITS OWN DELIVERABLE, with its own tasks** (GR-017 §17-e.12): schema-package additions, typed
  client methods, **response validation on receipt**, and the **contract-skew guard**. "The paywall will add the
  type" is a **contract fork, not a task**.

**Drift gates** — inherited from GR-015 §15-c, all three: the turbo `inputs` rebuild, the **regenerate-and-diff CI
gate**, and the **`CONTRACT_HASH` boot assertion** — the last one especially load-bearing here, since a released
mobile binary pinned to an older entitlement shape is exactly how a paywall silently misbehaves in production.

⛔ **THE THIRD-PARTY EXCEPTION (GR-015 §15-d) — Stripe is an API we do NOT serve. NEVER converge it.** Its inbound
webhook body **MUST** be validated at our boundary with **our own** zod, **after** signature verification and
**before** any field drives a write; the adapter **MAY declare its own types**, and our normalized
`SubscriptionStatus` **deliberately differs** from Stripe's subscription object; and **NO OpenAPI document is
written for Stripe**. Its shapes are **never** folded into `@kitchensink/schema-identity` as though we owned them.
`packages/clients/usda` is the reference implementation and must never be "converged" — **deleting a Stripe
boundary schema is a security and correctness regression**, because this is the path that decides who has paid.

### Input validation — where that zod RUNS (GR-016)

- **One mechanism, one `400`.** Every checkout, portal and subscription-status input — body, path params, query
  params — is parsed by identity's own authored zod via `createZodDto` plus **`nestjs-zod`'s** `ZodValidationPipe`.
  ⚠️ **Billing lands in the one service where this has already gone wrong**: under Nest's **OWN** `ValidationPipe` a
  `createZodDto` DTO validates **NOTHING while looking correctly wired**, which is exactly what happened to
  identity's `PATCH /users/me`. **The only way to observe it is a test that posts a known-bad body to a real billing
  route and asserts the `400`.**
- **`z.strictObject()` for every mutating body** (GR-017 §17-c, ruled 2026-08-12) — `POST /api/v1/billing/checkout`
  and `/portal` reject unknown keys. ⚠️ **Stripe's inbound body is the opposite case**: it is **their** shape, it
  gains fields without telling us, so its boundary schema tolerates unknown keys **deliberately** while still
  rejecting a missing or wrong-typed field it depends on.
- **Signature-verified is NOT shape-verified.** Signature verification authenticates the **sender** and says nothing
  about the **shape**, so each of the six routed events — `checkout.session.completed`, `invoice.paid`,
  `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`,
  `customer.subscription.trial_will_end` — is schema-validated **after** the signature check and **before** any
  field drives a write. Both controls, in that order, never one instead of the other.
- **⚠️ An entitlement decision must never branch on an unparsed field.** A webhook body whose `status` was never
  checked against the enum can **fail open** and grant premium with `typecheck` green. The enum is validated at the
  boundary and mapped **explicitly**; an unrecognised value is a **rejection plus an alarm**, never a default. Every
  consumer **fails closed** — an absent or unreadable entitlement claim is `free` (`FR-044`).
- **⛔ GR-018 IN FULL, for the Stripe webhook — and instinct gets this backwards.** There is **ONE rejection path**
  producing **one** structured shape whose **`reason`** names the cause. A **signature failure and a shape failure
  are EQUALLY invalid** and MUST NOT have two behaviours — they differ **only** in `reason`. An invalid payload is
  **NEVER retried**. And because **Stripe retries on ANY non-2xx, for 72 hours**, "not retried" means answering
  **`2xx`**, with the rejection recorded in **(1)** the response body, **(2)** structured logs with its `reason`,
  **(3)** a **per-`reason` counter**, and **(4)** an **alarm** on that counter. **Reject the content, accept the
  delivery.** ⚠️ This does **not** generalize to our own callers: `/api/v1/billing/*` returns the `400`/`403`
  GR-016 §16-a.3 requires, because our clients do not blind-retry and a `2xx` would hide a fixable bug.
    - ⛔ **010's `tasks.md` currently asserts "invalid signatures return `400`" — the exact inversion**, and it also
      splits signature failure from shape failure into two behaviours. Both are violations (GR-018 §18-c and §18-a).
      That file is owned elsewhere and is not corrected here; this is the record that it contradicts the rule.
    - **A rejected event is NOT recorded as a row** (GR-018 §18-d / GR-019). An invalid payload has **no trustworthy
      identifier**, and `webhook_events.identity_id` is `text NOT NULL` in this very database — so recording it would
      force the writer to invent an id, which is precisely the sentinel GR-019 forbids. The **log line and the
      counter are load-bearing**, not a consolation prize.
- **Requests are validated in the service; responses are validated ON RECEIPT by the consumer.** ⛔ Server-side
  **response** validation is **DEFERRED by owner decision** (GR-016 §16-g) and **MUST NOT be "completed"**. The
  Stripe-side parse is **input to us** and is unaffected — do not conflate them.
- **⛔ The storage floor — an ASSERTION, never a derivation — and 010 has the TIGHTEST real bounds of these five
  features, with a thin margin.** `webhook_events.stripe_event_id` is `VARCHAR(255)`, `event_type` is
  `VARCHAR(100)`, and `status` is `VARCHAR(20)` — ⚠️ **`'processing'` is 10 characters, so the margin is thin** and
  a longer status string is a failed `INSERT` on the money path. Meanwhile the `accounts` additions are declared
  **`varchar` with no length**, which is unbounded in PostgreSQL and therefore **not yet a floor**: ⚠️ **a length
  must be declared before it can be asserted against**. No zod is generated from the storage schema, **no storage
  type enters a wire schema**, and **no Stripe SDK type enters one either**; enforcement is the per-service parity
  test of GR-017 §17-d, its mapping asserted complete **in both directions**.
    - ⚠️ **010's data model uses TypeORM-style `@Column()` decorators while the rest of the portfolio — including the
      `accounts` and `webhook_events` tables it extends — is Drizzle.** That inconsistency is **flagged, not
      silently resolved**: it is a data-model decision for the owner, and it changes what the parity test reads.
- **Non-HTTP ingress.** Beyond the webhook, any retry queue, DLQ replay or reconciliation job this feature adds
  parses its payload against an authored zod **before acting on it** — a pipe reaches none of them, and these are
  the paths that re-drive money-relevant writes. An invalid payload is completed or dead-lettered **once**, with its
  `reason`, and the DLQ depth is alarmed (GR-018 §18-c).
- **No request-derived value reaches `sql.raw()`.**

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-005**: 80% of free-tier users engage with at least 3 core features (recipe creation, search, sharing) within their first week.
- **SC-006**: Premium conversion rate of at least 5% of active free-tier users within the first 3 months.

## Assumptions

- The free tier is designed as a conversion funnel — features are gated to demonstrate premium value, not to cripple the free experience.
- **Family plan is out of scope for v1.** Family/household multi-seat subscriptions are a future consideration only. No FR, no architecture, and no task covers family plans in this release. A dedicated spec change is required before any family-plan work begins.
- **Web is the primary billing surface.** Stripe Checkout and the Stripe Customer Portal are web-only. Mobile users see upgrade prompts and are deep-linked to the web checkout URL. Native in-app purchase (App Store / Play Store IAP) is out of scope for v1.
- Imported, attributed recipes are always public regardless of subscription tier, in compliance with source Terms of Service.
- **Marketplace payments are out of scope for v1 — but entitlement gating is NOT.** Keep these separate;
  conflating them over-blocks downstream work.
    - **In scope / available**: gating any feature on the caller's subscription tier. `FR-040` … `FR-044`
      cover it, and `FR-044` is what makes it enforceable outside the identity service.
    - **Out of scope**: anything that moves money **to a creator** — one-time payments (tips), per-item
      purchases, creator-defined subscription tiers, revenue splitting, and payouts.

    **Downstream requirements that depend on the deferred half**, surfaced by the 2026-08-02 spec sweep:
    - `012-creator-profiles` `012-FR-031`–`034` (DRAFT) — tip jar and creator-earnings surface. (An
      earlier revision also listed premium recipes and paid follows; both are **withdrawn** — recipe
      visibility is binary private/public and owned by 001, so 012 has no gated content to sell.)
    - `013-cooking-school` `013-FR-010` — "Revenue share: platform 20%, educator 80% (pro tier: 15%/85%
      via 010)", with course revenue "disbursed via 010's payout model".

    Entitlement **gating** is not blocked by this. Gating the premium tier's own features — private recipe
    visibility (`001-FR-003`), AI generation, meal suggestions — needs only `FR-044`, and 013's course
    access control gates on the learner's entitlement the same way.

    Marketplace payments need their own spec — in 010 or a dedicated payments feature — including the
    money-transmission and tax posture that splitting third-party revenue implies (e.g. Stripe Connect, 1099
    reporting). **Do not plan creator compensation against 010 as it stands.**
