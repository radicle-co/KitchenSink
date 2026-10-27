# V-Model Acceptance Test Plan: Subscriptions & Monetization

> **Out of date in part (2026-10-26).** This file models one premium tier at $6.99 a month or $59.99 a year.
> The current plans, prices and AI credits are in [`spec.md`](../spec.md) `FR-041` and its
> [plan register](../spec.md#plan-register). The subscription page is `FR-042a` to `FR-042k`.

**Feature Branch**: `010-subscriptions`
**Created**: 2026-05-09
**Status**: Active — updated 2026-05-10 to reflect closed product decisions (REQ-026–REQ-031)
**Source**: `specs/010-subscriptions/v-model/requirements.md`

## Overview

The Subscriptions & Monetization feature defines the free and premium tier model. The acceptance test plan defines three-tier criteria: mandatory (P1), recommended (P2), and optional (P3). Verification uses test-based verification for all P1 functional requirements, demonstration-based verification for P2, and inspection for P3.

## Acceptance Criteria

### P1 — Mandatory

| ID     | Criterion                                                                            | Scenario                                        | Pass Condition                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-001 | Every newly registered user is assigned to the free tier on account creation         | Register new account                            | User record has `tier = 'free'` immediately after account creation                                                                              |
| AC-002 | Free-tier users can create, read, update, and delete their own recipes               | CRUD operations on recipe                       | All four operations succeed; deleted recipe no longer appears in list                                                                           |
| AC-003 | Free-tier users can share and clone recipes                                          | Share recipe, clone recipe                      | Shared recipe visible to other users; cloned recipe appears in user's list                                                                      |
| AC-004 | Free-tier users can perform basic recipe importing                                   | Import recipe from URL                          | Imported recipe appears in user's recipe list with correct data                                                                                 |
| AC-005 | Free-tier users can manually assign meals to meal plan days                          | Manual meal assignment                          | Meal appears on the assigned day in meal plan view                                                                                              |
| AC-006 | Free-tier users can generate grocery lists without online ordering                   | Generate grocery list                           | Grocery list is generated with correct items; no ordering option present                                                                        |
| AC-007 | Free-tier users can use cooking mode                                                 | Enter cooking mode                              | Cooking mode activates with recipe steps and timer                                                                                              |
| AC-008 | Free-tier created recipes are always public with no private option                   | Create recipe as free user                      | Recipe is public; private toggle is absent or disabled in UI                                                                                    |
| AC-009 | Premium-tier users can set recipes to private                                        | Set recipe private                              | Recipe visibility changes to private; not visible in public search                                                                              |
| AC-010 | Premium-tier users can access AI recipe generation                                   | Use AI generation feature                       | AI-generated recipe appears in user's recipe list                                                                                               |
| AC-011 | Premium-tier users can access AI meal suggestions                                    | Request AI suggestions                          | AI suggestions are returned and can be accepted or dismissed                                                                                    |
| AC-012 | Premium-tier users can access auto-generated meal plans                              | Request auto-plan                               | Auto-generated meal plan is produced and assignable to calendar                                                                                 |
| AC-013 | Premium-tier users can access food waste optimization                                | Enable food waste optimization                  | Optimization suggestions are returned based on ingredients                                                                                      |
| AC-014 | Premium-tier users can access AI instruction optimization                            | Request AI instruction optimization             | Optimized instructions are returned for a recipe                                                                                                |
| AC-015 | Premium-tier users can access online grocery ordering                                | Access grocery ordering                         | Online ordering UI is accessible; orders can be submitted                                                                                       |
| AC-016 | Premium-tier users can access trainer nutrition planning                             | Use trainer nutrition planning                  | Trainer planning interface is accessible with goal-setting                                                                                      |
| AC-017 | Premium-tier users can clone imported recipes to private                             | Clone imported recipe privately                 | Cloned recipe appears in private section of recipe list                                                                                         |
| AC-018 | Free-tier users see upgrade prompt when accessing premium-gated feature              | Attempt premium feature                         | Upgrade prompt appears; user can dismiss or proceed to upgrade flow                                                                             |
| AC-020 | Premium features are immediately available upon upgrade                              | Complete upgrade flow                           | All premium features unlocked within one session after upgrade confirmation                                                                     |
| AC-021 | User data is retained when premium subscription lapses                               | Lapse subscription                              | All user data (recipes, meal plans, lists) remains accessible                                                                                   |
| AC-022 | Non-premium functionality remains accessible after lapse                             | Lapse subscription                              | Free-tier features remain fully functional after subscription lapse                                                                             |
| AC-023 | Premium features are locked when subscription lapses                                 | Lapse subscription                              | Premium features show upgrade prompt; data retained but access denied                                                                           |
| AC-024 | Previously private recipes remain private after lapse                                | Lapse with private recipes                      | Private recipes stay private; other free-tier features remain accessible                                                                        |
| AC-025 | Upgrade prompt appears for each premium-gated feature                                | Attempt each gated feature                      | Each feature (AI gen, AI suggestions, auto-plan, waste opt, instruction opt, ordering, trainer planning, clone-to-private) shows upgrade prompt |
| AC-026 | Upgrade prompt is dismissible                                                        | Dismiss upgrade prompt                          | Prompt dismisses; user remains on free tier; can retry upgrade flow later                                                                       |
| AC-027 | Premium users can cancel subscription                                                | Cancel subscription                             | Cancellation confirmed; subscription status changes to canceled at period end                                                                   |
| AC-028 | Canceled subscription remains active until period end                                | Check after cancel                              | Subscription stays active with full premium access until current period ends                                                                    |
| AC-031 | Premium subscription is offered at $6.99/month                                       | View pricing page                               | Monthly plan price displayed as $6.99/month                                                                                                     |
| AC-032 | Premium subscription is offered at $59.99/year                                       | View pricing page                               | Annual plan price displayed as $59.99/year (~29% savings shown)                                                                                 |
| AC-033 | New premium subscribers receive a 14-day free trial before first charge              | Start trial                                     | Trial period begins; no charge for 14 days; trial end date shown to user                                                                        |
| AC-034 | A 7-day grace period applies after a failed payment before premium access is removed | Simulate failed payment                         | Premium access remains for 7 days post-failure; access removed on day 8 if not resolved                                                         |
| AC-035 | Upgrade prompt shows inline teaser at feature entry point (tier 1)                   | Browse to gated feature                         | Inline teaser visible at feature entry point without user interaction                                                                           |
| AC-036 | Upgrade prompt shows modal/bottom-sheet on active invocation (tier 2)                | Actively invoke gated feature                   | Modal or bottom-sheet appears with upgrade CTA                                                                                                  |
| AC-037 | Pricing page is accessible from any upgrade CTA and from account settings (tier 3)   | Click upgrade CTA; navigate to account settings | Pricing page reachable from both paths                                                                                                          |
| AC-038 | Mobile upgrade CTA deep-links to web Stripe Checkout URL                             | Tap upgrade on mobile                           | Browser opens web checkout URL; no native IAP sheet appears                                                                                     |

### P2 — Recommended

| ID     | Criterion                                     | Scenario            | Pass Condition                                                              |
| ------ | --------------------------------------------- | ------------------- | --------------------------------------------------------------------------- |
| AC-019 | Upgrade prompt previews premium feature value | Show upgrade prompt | Upgrade prompt includes a teaser or preview of the gated feature capability |

### P3 — Optional

| ID     | Criterion                              | Scenario            | Pass Condition                                           |
| ------ | -------------------------------------- | ------------------- | -------------------------------------------------------- |
| AC-029 | Feature usage is tracked for analytics | Use premium feature | Usage event fired with correct feature ID and user tier  |
| AC-030 | Upgrade conversion is measurable       | Complete upgrade    | Conversion event fired on successful upgrade transaction |

### P1 — Nonfunctional, interface, and constraint coverage

| ID        | Requirement | Scenario                                                                            | Pass Condition                                                                                                                            |
| --------- | ----------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| AC-NF-001 | REQ-NF-001  | Run strict TypeScript verification for subscription feature source and test doubles | Typecheck passes with no unapproved `any` usage                                                                                           |
| AC-NF-002 | REQ-NF-002  | Inspect exported functions and interfaces introduced by subscription feature        | All exported symbols include JSDoc or approved documented exceptions                                                                      |
| AC-NF-003 | REQ-NF-003  | Run accessibility tests against subscription UI components                          | Components expose accessible names queryable by role or label                                                                             |
| AC-NF-004 | REQ-NF-004  | Inspect tier state and upgrade prompt visual states                                 | Every color state has paired icon/text or equivalent non-color cue                                                                        |
| AC-IF-001 | REQ-IF-001  | Resolve authenticated user identity after subscription state changes                | Identity object exposes current `free`/`premium` tier claim                                                                               |
| AC-IF-002 | REQ-IF-002  | Call feature-gate interface with representative feature/tier pairs                  | Interface returns correct access decision and fails closed for unknown features                                                           |
| AC-IF-003 | REQ-IF-003  | Render upgrade prompt through shared interface for representative gated features    | Prompt renders correct CTA, feature context, and accessible semantics                                                                     |
| AC-IF-004 | REQ-IF-004  | Compare web and mobile subscription flows against parity checklist                  | Core capabilities, entitlement behavior, error states, accessibility semantics, and recovery paths are equivalent or exception-documented |
| AC-CN-001 | REQ-CN-001  | Import an attributed recipe while account is free and premium                       | Imported attributed recipe remains public regardless of subscription tier                                                                 |
| AC-CN-002 | REQ-CN-002  | Inspect subscription tier model and feature-gate registry                           | Only `free` and `premium` tiers exist unless a future spec change adds more                                                               |

---

### AT-PARITY — Cross-platform parity for Subscriptions & Monetization

**Requirement**: REQ-IF-004

| ATS ID       | Scenario                     | Given                                                                                | When                                                                          | Then                                                                                                                                                                               |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ATS-PARITY-1 | Web/mobile capability parity | A user-facing Subscriptions & Monetization workflow is implemented on web and mobile | Product QA compares the web and mobile flows against the same requirement set | Both platforms expose the same core capabilities, entitlement behavior, error states, accessibility semantics, and recovery paths, or a documented V-Model parity exception exists |
| ATS-PARITY-2 | Parity regression gate       | A change modifies a Subscriptions & Monetization user-facing workflow                | The feature test plan is reviewed                                             | The change includes paired web and mobile acceptance coverage or a documented exception approved by product governance                                                             |
