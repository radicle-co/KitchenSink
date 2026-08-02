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
    `012-FR-034`, `012-FR-035`, `012-FR-039` (premium recipe visibility); `013` course access control; and
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
    - `012-creator-profiles` `012-FR-031`–`033`, `012-FR-036`–`038`, `012-FR-040` (DRAFT) — tip jar,
      purchased access, creator-priced follow tiers, earnings surface.
    - `013-cooking-school` `013-FR-010` — "Revenue share: platform 20%, educator 80% (pro tier: 15%/85%
      via 010)", with course revenue "disbursed via 010's payout model".

    Their **gating-only** siblings (`012-FR-034`, `012-FR-035`, `012-FR-039`, and 013 course access control)
    are **not** blocked by this — they need only `FR-044`.

    Marketplace payments need their own spec — in 010 or a dedicated payments feature — including the
    money-transmission and tax posture that splitting third-party revenue implies (e.g. Stripe Connect, 1099
    reporting). **Do not plan creator compensation against 010 as it stands.**
