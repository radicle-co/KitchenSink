# Product Specification: Commise - Subscriptions & Monetization

> **Out of date in part (2026-10-26).** This file models one premium tier at $6.99 a month or $59.99 a year.
> The current plans, prices and AI credits are in [`spec.md`](../spec.md) `FR-041` and its
> [plan register](../spec.md#plan-register). The subscription page is `FR-042a` to `FR-042k`.
> Read "premium" here as Pro: the plans are Free, Pro and Pro with AI (owner, 2026-10-27).

**Branch**: `010-subscriptions`
**Date**: 2026-05-09
**Last updated**: 2026-05-10
**Status**: Product decisions revalidated — implementation/test gate blocked pending V-Model regeneration and test execution
**Source**: [spec.md](../spec.md)

---

## Vision

Subscriptions in Commise should monetize advanced value without hollowing out the core free experience. Free users should be able to meaningfully cook, organize, and share; premium users should unlock leverage features that save time, improve outcomes, and support professional workflows.

**Tagline**: "Free to cook. Premium to accelerate."

**Core principles**:

- Free tier remains useful and complete for core value (`FR-040`).
- Premium unlocks differentiated capability clusters (`FR-041`).
- Upgrade prompts are clear, contextual, and respectful (`FR-042`).
- Subscription lapses never erase user trust or data (`FR-043`).

---

## Closed Decisions (Engineering Handoff Reference)

All open questions from the bootstrap revalidation are closed. The table below is the authoritative record for engineering. See [review.md](../review.md) for full rationale.

| #   | Topic                       | Decision                                                                                                                                                                                                                                  |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | Trial length                | **14-day free trial.** Stripe `trial_period_days: 14`. No credit card required during trial (Stripe default).                                                                                                                             |
| D-2 | Pricing                     | **$6.99/month or $59.99/year.** Annual plan saves ~29% ($5.00/mo effective). Both plans available at launch.                                                                                                                              |
| D-3 | Grace period                | **7 days past_due.** Premium access is retained for 7 days after a failed payment. After 7 days with no resolution, the account downgrades to free.                                                                                       |
| D-4 | Free tier recipe quota      | **Unlimited public recipes.** No count cap on the free tier. The only restriction is visibility: all free-tier recipes are public.                                                                                                        |
| D-5 | Family plan                 | **Out of scope for v1.** Family/household multi-seat plans are a future consideration. No FR, no architecture, no task. Requires a dedicated spec change.                                                                                 |
| D-6 | Web vs mobile billing       | **Web is the primary billing surface.** Stripe Checkout and Customer Portal are web-only. Mobile shows upgrade prompts (bottom sheet) and deep-links to the web checkout URL. Native IAP (App Store / Play Store) is out of scope for v1. |
| D-7 | Paywall hierarchy           | **Three-tier:** (1) contextual inline teaser at feature entry point, (2) modal/bottom-sheet on active invocation, (3) pricing page from any CTA or account settings.                                                                      |
| D-8 | Downgrade — private recipes | **Existing private recipes stay private after downgrade.** Lapsed users retain read access to their own private recipes but cannot create new private recipes until they renew.                                                           |

---

## Personas

### Primary: P8 Alex (Commise Power User)

**Archetype**: Commise Power User

**Motivation**: Multi-feature daily power use, integrations, and automation across the full Commise surface.

**Subscription-specific goals and pains**:

- Wants a clear Pro tier that unlocks AI meal planning, advanced ordering integrations, and bulk recipe operations without hunting through settings to find what's gated.
- Expects billing self-service: swap payment methods, pause, or cancel without contacting support.
- Frustrated when upgrade prompts interrupt mid-workflow rather than appearing at natural decision points.
- Needs confidence that a lapsed payment won't silently delete automation rules or custom integrations.
- Values a transparent entitlement table so he can evaluate ROI before committing to annual billing.

---

### Secondary: P3 Riley (Family Meal Planner)

**Archetype**: Family Meal Planner

**Motivation**: Quick, kid-friendly, weekly rotation meals at household scale.

**Subscription-specific goals and pains**:

- Wants a family plan that covers multiple household accounts under one bill rather than paying per seat.
- Needs the upgrade decision to feel low-risk: a free trial or grace period before the first charge.
- Frustrated when premium features like shared meal plans or household shopping lists are locked behind an individual-only tier.
- Expects downgrade to preserve all saved recipes and meal history so the family doesn't lose their rotation.
- Wants clear messaging during payment lapses so she can recover access before the weekly shop.

---

### Tertiary: P11 Robin (Recipe Creator)

**Archetype**: Recipe Creator

**Motivation**: Public creator profile (`commise.app/@robin`), food-blogger brand, and audience monetization.

**Subscription-specific goals and pains**:

- Needs a creator-tier or Pro plan that enables tip-jar payments and paid-follow revenue from her audience.
- Wants subscriber analytics (follower growth, recipe views, earnings) surfaced in a single dashboard.
- Frustrated when monetization features are buried or require a separate third-party integration.
- Expects the platform to handle payout mechanics transparently so she can focus on content, not billing ops.
- Needs assurance that canceling her own subscription won't affect her public profile or follower relationships.

---

## Epics

### Epic 1: Tier Definition and Entitlement Boundaries

Define free/premium capability boundaries with deterministic access checks and user-facing clarity.

### Epic 2: Billing Lifecycle and Access Synchronization

Implement checkout, webhook-driven state sync, and downgrade behavior that preserves trust.

### Epic 3: Upgrade Experience and Monetization UX

Ensure users encounter value-forward prompts exactly when premium unlocks matter.

---

## MoSCoW Story Map (with FR Traceability)

## Must Have

### US-010-001: Free Tier Core Access

**Story**: As a new authenticated user, I can use core recipe and planning features without paying so that I can adopt the product before deciding to upgrade.

**FRs**: [FR-040](../spec.md#functional-requirements)

### US-010-002: Premium Feature Unlocks

**Story**: As a paying user, I can access premium-only capabilities across private visibility, AI, advanced planning, ordering, and trainer nutrition workflows.

**FRs**: [FR-041](../spec.md#functional-requirements)

### US-010-003: Contextual Upgrade Prompting

**Story**: As a free-tier user attempting a premium action, I receive a clear upgrade prompt explaining what I get and how to proceed.

**FRs**: [FR-042](../spec.md#functional-requirements)

### US-010-004: Data-Safe Downgrade

**Story**: As a user whose subscription lapses or is canceled, I retain all data and non-premium functionality.

**FRs**: [FR-043](../spec.md#functional-requirements)

## Should Have

### US-010-005: Tier Comparison Transparency

**Story**: As a deciding user, I can compare free vs premium entitlements in one concise table.

**FRs**: [FR-042](../spec.md#functional-requirements)

### US-010-006: Billing Self-Service

**Story**: As a subscriber, I can manage payment method and plan changes through portal-driven self-service.

**FRs**: [FR-041](../spec.md#functional-requirements), [FR-043](../spec.md#functional-requirements)

### US-010-007: Grace-Period Recovery Messaging

**Story**: As a past-due user, I receive clear recovery messaging before premium access is fully removed.

**FRs**: [FR-043](../spec.md#functional-requirements)

## Could Have

### US-010-008: Family Plan Packaging

**Story**: As a household organizer, I can subscribe once and manage seats for family members.

**FRs**: _No explicit FR in current spec — **out of scope for v1**. Family plan requires a dedicated spec change and new FR before any implementation begins._

**Scope note**: This story is retained as a future placeholder only. It must not be estimated, tasked, or implemented in the current release cycle.

### US-010-009: Mobile Billing Parity

**Story**: As a mobile-first user, I can see my subscription status and reach the billing portal from within the mobile app.

**FRs**: _No explicit FR in current spec — **partial coverage in v1** via TASK-024 (upgrade prompts) and TASK-028 (subscription status display + portal deep-link)._

**Scope note**: Full native IAP (App Store / Play Store in-app purchase) is out of scope for v1. Mobile users subscribe via the web checkout URL (deep-linked from the app). Mobile account management is limited to status display and a deep-link to the Stripe Customer Portal in the system browser.

---

## Out of Scope (Current Feature Scope)

- New family-plan entitlement schema.
- Mandatory native in-app purchase implementation details.
- Pricing experimentation engine / offer optimization framework.
- Deep churn-prediction ML for retention interventions.

---

## Requirement Coverage Matrix

| Spec Requirement | Covered By                                        |
| ---------------- | ------------------------------------------------- |
| FR-040           | US-010-001                                        |
| FR-041           | US-010-002, US-010-006                            |
| FR-042           | US-010-003, US-010-005                            |
| FR-043           | US-010-004, US-010-006, US-010-007                |
| NFR-003          | Wireframes + prompt component accessibility rules |
| NFR-004          | Wireframes + prompt state labels (icon + text)    |

---

---

## Closed Revalidation Questions

All questions from the initial bootstrap are now closed. See [review.md](../review.md) Revision 1 for full rationale.

1. **Trial policy wording**: 14-day free trial, confirmed. User-facing copy: "Start your 14-day free trial — no credit card required during trial." After trial, the selected plan ($6.99/mo or $59.99/yr) begins automatically.
2. **Family plan scope**: Out of scope for v1. US-010-008 is a future placeholder only. No implementation in this release.
3. **Web vs mobile rollout order**: Web checkout and portal ship first (primary billing surface). Mobile upgrade prompts (TASK-024) and mobile subscription status display (TASK-028) ship in the same v1 release but do not include native IAP.
