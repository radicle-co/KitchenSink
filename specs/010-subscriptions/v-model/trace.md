# V-Model Traceability Matrix: Subscriptions & Monetization

**Feature Branch**: `010-subscriptions`
**Created**: 2026-05-09
**Status**: Draft
**Source Artifacts**: `requirements.md` (2026-05-09), `acceptance-plan.md` (2026-05-09), `unit-test.md` (2026-05-09)

---

## Artifact Information

| Artifact           | Requirement Count               | AT Count    | UTP Count    | UTS Count        |
| ------------------ | ------------------------------- | ----------- | ------------ | ---------------- |
| requirements.md    | 31 (20 FR + 4 NF + 3 IF + 4 CN) | —           | —            | —                |
| acceptance-plan.md | —                               | 30 AT cases | —            | —                |
| unit-test.md       | —                               | —           | 32 UTP cases | 78 UTS scenarios |

---

## Matrix A: Forward Traceability (REQ → ATP)

### Functional Requirements

| REQ-ID  | Requirement                                                             | ATP-ID | Acceptance Test                      | Verification  | Status               |
| ------- | ----------------------------------------------------------------------- | ------ | ------------------------------------ | ------------- | -------------------- |
| REQ-001 | New users assigned free tier on account creation                        | AC-001 | User has tier='free' on creation     | Test          | ⬜ Pending Execution |
| REQ-002 | Free-tier users can CRUD their own recipes                              | AC-002 | All four operations succeed          | Test          | ⬜ Pending Execution |
| REQ-003 | Free-tier users can share and clone recipes                             | AC-003 | Share visible; clone appears         | Test          | ⬜ Pending Execution |
| REQ-004 | Free-tier users can perform basic recipe importing                      | AC-004 | Imported recipe in list              | Test          | ⬜ Pending Execution |
| REQ-005 | Free-tier users can manually assign meals to meal plan days             | AC-005 | Meal appears on assigned day         | Test          | ⬜ Pending Execution |
| REQ-006 | Free-tier users can generate grocery lists (no ordering)                | AC-006 | List generated; no ordering option   | Test          | ⬜ Pending Execution |
| REQ-007 | Free-tier users can use cooking mode                                    | AC-007 | Cooking mode activates               | Test          | ⬜ Pending Execution |
| REQ-008 | Free-tier created recipes are public by default; no private option      | AC-008 | Recipe public; private toggle absent | Test          | ⬜ Pending Execution |
| REQ-009 | Premium-tier users can set recipes to private                           | AC-009 | Recipe visibility changes to private | Test          | ⬜ Pending Execution |
| REQ-010 | Premium-tier users can access AI recipe generation                      | AC-010 | AI recipe in list                    | Test          | ⬜ Pending Execution |
| REQ-011 | Premium-tier users can access AI meal suggestions                       | AC-011 | AI suggestions returned              | Test          | ⬜ Pending Execution |
| REQ-012 | Premium-tier users can access auto-generated meal plans                 | AC-012 | Auto-plan produced                   | Test          | ⬜ Pending Execution |
| REQ-013 | Premium-tier users can access food waste optimization                   | AC-013 | Optimization suggestions returned    | Test          | ⬜ Pending Execution |
| REQ-014 | Premium-tier users can access AI instruction optimization               | AC-014 | Optimized instructions returned      | Test          | ⬜ Pending Execution |
| REQ-015 | Premium-tier users can access online grocery ordering                   | AC-015 | Ordering UI accessible               | Test          | ⬜ Pending Execution |
| REQ-016 | Premium-tier users can access trainer nutrition planning                | AC-016 | Trainer planning accessible          | Test          | ⬜ Pending Execution |
| REQ-017 | Premium-tier users can clone imported recipes to private                | AC-017 | Cloned recipe in private section     | Test          | ⬜ Pending Execution |
| REQ-018 | Free-tier users see upgrade prompt when accessing premium-gated feature | AC-018 | Upgrade prompt appears               | Test          | ⬜ Pending Execution |
| REQ-019 | Upgrade prompt previews premium feature value                           | AC-019 | Teaser visible in prompt             | Demonstration | ⬜ Pending Execution |
| REQ-020 | Premium features immediately available upon upgrade                     | AC-020 | All features unlocked within session | Test          | ⬜ Pending Execution |

### Non-Functional Requirements

| REQ-ID     | Requirement                                                            | ATP-ID   | Acceptance Test           | Verification | Status               |
| ---------- | ---------------------------------------------------------------------- | -------- | ------------------------- | ------------ | -------------------- |
| REQ-NF-001 | TypeScript compiles with `strict: true`; no `any` outside test doubles | AT-010-A | `npx tsc --strict` passes | Inspection   | ⬜ Pending Execution |
| REQ-NF-002 | All exported functions/interfaces have JSDoc                           | AT-010-A | JSDoc on all exports      | Inspection   | ⬜ Pending Execution |
| REQ-NF-003 | UI components expose accessible name via `getByRole`/`getByLabel`      | AT-010-B | Playwright a11y audit     | Test         | ⬜ Pending Execution |
| REQ-NF-004 | Color not sole conveyor of tier state; icon or text accompanies        | AT-010-B | Icon + text with color    | Inspection   | ⬜ Pending Execution |

### Interface Requirements

| REQ-ID     | Requirement                                                                | ATP-ID   | Acceptance Test                 | Verification | Status               |
| ---------- | -------------------------------------------------------------------------- | -------- | ------------------------------- | ------------ | -------------------- |
| REQ-IF-001 | Integration with Clerk (002) for user identity and tier management         | AT-010-C | Auth integration for tier       | Test         | ⬜ Pending Execution |
| REQ-IF-002 | Integration with Recipe App (001) for recipe visibility and access control | AT-010-C | Recipe visibility gated by tier | Test         | ⬜ Pending Execution |
| REQ-IF-003 | Integration with Stripe for subscription payment and lifecycle             | AT-010-D | Stripe lifecycle management     | Test         | ⬜ Pending Execution |

### Constraint Requirements

| REQ-ID     | Requirement                                                                       | ATP-ID   | Acceptance Test                   | Verification | Status               |
| ---------- | --------------------------------------------------------------------------------- | -------- | --------------------------------- | ------------ | -------------------- |
| REQ-CN-001 | Subscription state changes processed within 5 seconds of event                    | AT-010-E | State change latency ≤ 5s         | Test         | ⬜ Pending Execution |
| REQ-CN-002 | Upgrade prompt blocks premium feature access until dismissed or upgrade completes | AC-018   | Upgrade prompt blocks access      | Test         | ⬜ Pending Execution |
| REQ-CN-003 | Subscriptions feature cannot deploy independently of Clerk (002)                  | AT-010-F | Deployment blocked without 002    | Inspection   | ⬜ Pending Execution |
| REQ-CN-004 | Subscription management UI accessible only to authenticated users                 | AT-010-C | Auth required for subscription UI | Test         | ⬜ Pending Execution |

---

## Matrix B: Backward Traceability (ATP → REQ)

| ATP-ID   | Acceptance Test                               | REQ-ID                             | Requirement                             | Justification                                                             |
| -------- | --------------------------------------------- | ---------------------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| AC-001   | Free tier on creation                         | REQ-001                            | New users start free                    | Business rule: all new users begin on free tier by default                |
| AC-002   | Free-tier recipe CRUD                         | REQ-002                            | CRUD for own recipes                    | Core recipe management is a free-tier entitlement per FR-040              |
| AC-003   | Free-tier share/clone                         | REQ-003                            | Share and clone recipes                 | Sharing and cloning are free-tier entitlements per FR-040                 |
| AC-004   | Free-tier basic import                        | REQ-004                            | Basic recipe importing                  | Basic importing is a free-tier entitlement per FR-040                     |
| AC-005   | Free-tier manual meal planning                | REQ-005                            | Manual meal assignment                  | Manual meal planning is a free-tier entitlement per FR-040                |
| AC-006   | Free-tier grocery list                        | REQ-006                            | Grocery list without ordering           | Grocery list generation is a free-tier entitlement per FR-040             |
| AC-007   | Free-tier cooking mode                        | REQ-007                            | Cooking mode access                     | Cooking mode is a free-tier entitlement per FR-040                        |
| AC-008   | Free recipe public                            | REQ-008                            | Free recipes always public              | Private recipe visibility is premium-only; free recipes cannot be private |
| AC-009   | Premium private recipes                       | REQ-009                            | Private visibility for premium          | Premium entitlement unlocks private recipe visibility                     |
| AC-010   | Premium AI recipe generation                  | REQ-010                            | AI recipe gen for premium               | AI recipe generation is a premium entitlement (gates 005 FR-016)          |
| AC-011   | Premium AI meal suggestions                   | REQ-011                            | AI suggestions for premium              | AI meal suggestions are a premium entitlement (gates 006 FR-025)          |
| AC-012   | Premium auto meal plans                       | REQ-012                            | Auto-generated plans for premium        | Auto-generated meal plans are a premium entitlement (gates 006 FR-026)    |
| AC-013   | Premium food waste optimization               | REQ-013                            | Waste optimization for premium          | Food waste optimization is a premium entitlement (gates 006 FR-027)       |
| AC-014   | Premium AI instruction optimization           | REQ-014                            | AI instruction opt for premium          | AI instruction optimization is a premium entitlement (gates 005 FR-019)   |
| AC-015   | Premium grocery ordering                      | REQ-015                            | Online ordering for premium             | Online grocery ordering is a premium entitlement (gates 007 FR-031)       |
| AC-016   | Premium trainer nutrition planning            | REQ-016                            | Trainer planning for premium            | Trainer nutrition planning is a premium entitlement (gates 009 FR-038)    |
| AC-017   | Premium clone-to-private                      | REQ-017                            | Clone-to-private for premium            | Clone-to-private for imported recipes is a premium entitlement            |
| AC-018   | Upgrade prompt for gated features             | REQ-018, REQ-CN-002                | Upgrade prompt required                 | Upgrade prompts drive premium conversion per FR-042                       |
| AC-019   | Premium feature preview                       | REQ-019                            | Teaser in upgrade prompt                | Feature value preview motivates conversion per User Story 1, Scenario 3   |
| AC-020   | Immediate access on upgrade                   | REQ-020                            | Premium features unlocked on upgrade    | Immediate access on upgrade per User Story 1, Scenario 5                  |
| AC-021   | Data retained on lapse                        | REQ-021                            | Data retention on lapse                 | Data retention required per FR-043                                        |
| AC-022   | Non-premium features retained on lapse        | REQ-022                            | Free features remain on lapse           | Non-premium functionality retention on lapse per FR-043                   |
| AC-023   | Premium features locked on lapse              | REQ-023                            | Premium locked on lapse                 | Premium features locked on lapse per User Story 1, Scenario 6             |
| AC-024   | Private recipes stay private on lapse         | REQ-024                            | Private stays private on lapse          | Previously private recipes remain private after subscription lapse        |
| AC-025   | Upgrade prompt for each gated feature         | REQ-018                            | Each premium feature shows prompt       | Each gated feature must display upgrade prompt                            |
| AC-026   | Upgrade prompt dismissible                    | REQ-018                            | Prompt can be dismissed                 | Prompt dismisses; user remains on free tier                               |
| AC-027   | Premium users can cancel                      | REQ-025                            | Cancel subscription                     | Users must be able to cancel their subscription                           |
| AC-028   | Canceled subscription active until period end | REQ-026                            | Canceled remains active                 | Canceled subscription stays active until current period ends              |
| AT-010-A | Type safety + JSDoc                           | REQ-NF-001, REQ-NF-002             | Strict mode + documentation             | NFRs for type safety and maintainability                                  |
| AT-010-B | Accessibility + color/icon                    | REQ-NF-003, REQ-NF-004             | Accessible names + color not sole state | NFRs for accessibility compliance                                         |
| AT-010-C | Auth + recipe integration                     | REQ-IF-001, REQ-IF-002, REQ-CN-004 | Clerk + Recipe App integration          | Required dependencies for identity and content access                     |
| AT-010-D | Stripe lifecycle                              | REQ-IF-003                         | Stripe integration                      | Payment and subscription lifecycle management                             |
| AT-010-E | State change latency                          | REQ-CN-001                         | 5-second state change processing        | Constraint for user experience                                            |
| AT-010-F | Co-deployment with 002                        | REQ-CN-003                         | Cannot deploy without Clerk             | Runtime failure prevention                                                |

---

## Matrix C: Integration Verification

| Integration Point           | Description                                   | MOD Boundary     | UTP Coverage | Integration Test Gap        |
| --------------------------- | --------------------------------------------- | ---------------- | ------------ | --------------------------- |
| MOD-001 ↔ EXTERNAL (002)    | SubscriptionScreen → Clerk (tier check)       | UI → External    | UTP-001-C    | ⚠️ Gap: no integration test |
| MOD-001 ↔ EXTERNAL (Stripe) | SubscriptionScreen → Stripe (upgrade/cancel)  | UI → External    | UTP-001-D    | ⚠️ Gap: no integration test |
| MOD-002 ↔ EXTERNAL (002)    | SubscriptionState → Clerk (user identity)     | State → External | UTP-002-A    | ⚠️ Gap: no integration test |
| MOD-003 ↔ EXTERNAL (001)    | FeatureGate → Recipe App (recipe visibility)  | Logic → External | UTP-003-A/B  | ⚠️ Gap: no integration test |
| MOD-003 ↔ EXTERNAL (005)    | FeatureGate → AI Integration (AI features)    | Logic → External | UTP-003-C    | ⚠️ Gap: no integration test |
| MOD-003 ↔ EXTERNAL (006)    | FeatureGate → Meal Planning (auto-plan)       | Logic → External | UTP-003-D    | ⚠️ Gap: no integration test |
| MOD-003 ↔ EXTERNAL (007)    | FeatureGate → Grocery Lists (ordering)        | Logic → External | UTP-003-E    | ⚠️ Gap: no integration test |
| MOD-003 ↔ EXTERNAL (009)    | FeatureGate → Nutrition Planning (trainer)    | Logic → External | UTP-003-F    | ⚠️ Gap: no integration test |
| MOD-004 ↔ EXTERNAL (Stripe) | UpgradeFlow → Stripe (payment intent)         | Logic → External | UTP-004-A/B  | ⚠️ Gap: no integration test |
| MOD-005 ↔ EXTERNAL (Stripe) | LapseHandler → Stripe (webhook processing)    | Logic → External | UTP-005-A/B  | ⚠️ Gap: no integration test |
| MOD-006 ↔ MOD-001           | TierDisplay → SubscriptionScreen (tier badge) | Logic → UI       | UTP-006-A/B  | ⚠️ Gap: no integration test |

---

## Matrix D: Implementation Verification

| MOD-ID  | Module Name            | Source File                                                   | UTP Count | UTS Count | Verification         |
| ------- | ---------------------- | ------------------------------------------------------------- | --------- | --------- | -------------------- |
| MOD-001 | SubscriptionScreen     | `src/features/subscriptions/screens/SubscriptionScreen.tsx`   | 4         | 10        | ⬜ Pending Execution |
| MOD-002 | SubscriptionState      | `src/features/subscriptions/state/SubscriptionState.tsx`      | 3         | 8         | ⬜ Pending Execution |
| MOD-003 | FeatureGate            | `src/features/subscriptions/services/FeatureGate.ts`          | 6         | 15        | ⬜ Pending Execution |
| MOD-004 | UpgradeFlow            | `src/features/subscriptions/services/UpgradeFlow.ts`          | 3         | 8         | ⬜ Pending Execution |
| MOD-005 | LapseHandler           | `src/features/subscriptions/services/LapseHandler.ts`         | 3         | 7         | ⬜ Pending Execution |
| MOD-006 | TierDisplay            | `src/features/subscriptions/components/TierDisplay.tsx`       | 2         | 5         | ⬜ Pending Execution |
| MOD-007 | UpgradePrompt          | `src/features/subscriptions/components/UpgradePrompt.tsx`     | 3         | 7         | ⬜ Pending Execution |
| MOD-008 | SubscriptionRepository | `src/features/subscriptions/data/SubscriptionRepository.ts`   | 2         | 5         | ⬜ Pending Execution |
| MOD-009 | StripeWebhookHandler   | `src/features/subscriptions/services/StripeWebhookHandler.ts` | 3         | 7         | ⬜ Pending Execution |
| MOD-010 | CancelFlow             | `src/features/subscriptions/services/CancelFlow.ts`           | 2         | 4         | ⬜ Pending Execution |

### UTP → REQ Traceability (ISO 29119-4 Techniques)

| UTP-ID    | Test Case                                 | REQ Coverage              | Technique                |
| --------- | ----------------------------------------- | ------------------------- | ------------------------ |
| UTP-001-A | Subscription screen rendering             | REQ-001                   | Statement Coverage       |
| UTP-001-B | Tier display based on user tier           | REQ-008, REQ-009          | Equivalence Partitioning |
| UTP-001-C | Auth-based tier retrieval                 | REQ-IF-001                | Strict Isolation         |
| UTP-001-D | Stripe checkout session creation          | REQ-IF-003                | Statement Coverage       |
| UTP-002-A | Subscription state management             | REQ-001, REQ-020          | State Transition Testing |
| UTP-002-B | Tier transition on upgrade                | REQ-020                   | State Transition Testing |
| UTP-002-C | Lapse state transitions                   | REQ-021, REQ-022, REQ-023 | State Transition Testing |
| UTP-003-A | Free-tier recipe public by default        | REQ-008                   | Statement Coverage       |
| UTP-003-B | Premium-tier private recipe allowed       | REQ-009                   | Branch Coverage          |
| UTP-003-C | AI feature gate for free tier             | REQ-010, REQ-011, REQ-014 | Branch Coverage          |
| UTP-003-D | Auto-plan gate for free tier              | REQ-012                   | Branch Coverage          |
| UTP-003-E | Grocery ordering gate for free tier       | REQ-015                   | Branch Coverage          |
| UTP-003-F | Trainer planning gate for free tier       | REQ-016                   | Branch Coverage          |
| UTP-004-A | Upgrade flow initiation                   | REQ-018, REQ-020          | Statement Coverage       |
| UTP-004-B | Stripe payment intent handling            | REQ-IF-003                | Statement Coverage       |
| UTP-005-A | Lapse webhook processing                  | REQ-021, REQ-023          | State Transition Testing |
| UTP-005-B | Data retention on lapse                   | REQ-021                   | Statement Coverage       |
| UTP-006-A | Tier badge rendering                      | REQ-NF-004                | Equivalence Partitioning |
| UTP-006-B | Icon + text for tier state                | REQ-NF-004                | Equivalence Partitioning |
| UTP-007-A | Upgrade prompt display                    | REQ-018                   | Statement Coverage       |
| UTP-007-B | Feature preview in prompt                 | REQ-019                   | Boundary Value Analysis  |
| UTP-007-C | Prompt dismissal handling                 | REQ-018, REQ-026          | Statement Coverage       |
| UTP-008-A | Subscription persistence                  | REQ-001                   | Statement Coverage       |
| UTP-008-B | Subscription retrieval                    | REQ-001                   | Boundary Value Analysis  |
| UTP-009-A | Stripe webhook signature verification     | REQ-IF-003                | Statement Coverage       |
| UTP-009-B | Event type routing (upgrade/lapse/cancel) | REQ-CN-001                | Branch Coverage          |
| UTP-009-C | Idempotent webhook processing             | REQ-CN-001                | Statement Coverage       |
| UTP-010-A | Cancel flow initiation                    | REQ-025                   | Statement Coverage       |
| UTP-010-B | Period-end state update                   | REQ-026                   | State Transition Testing |

---

## Matrix H: Hazard Traceability

| HAZ-ID  | Hazard                                                                           | Affected REQ           | Mitigation REQ                                             | Verification   |
| ------- | -------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------- | -------------- |
| HAZ-001 | Free-tier user accesses premium feature without upgrade prompt → conversion loss | REQ-018, REQ-CN-002    | FeatureGate (MOD-003) enforces prompt                      | AC-018         |
| HAZ-002 | Premium features remain accessible after subscription lapses → revenue loss      | REQ-023                | LapseHandler (MOD-005) locks features                      | AC-023         |
| HAZ-003 | Stripe webhook missed → subscription state out of sync with payment              | REQ-IF-003, REQ-CN-001 | StripeWebhookHandler (MOD-009) + 5s constraint             | AT-010-D       |
| HAZ-004 | Private recipes become public after lapse → user data exposure                   | REQ-024                | FeatureGate maintains private flag on lapse                | AC-024         |
| HAZ-005 | User upgrades but features not immediately available → trust loss                | REQ-020                | SubscriptionState immediate unlock on confirmation         | AC-020         |
| HAZ-006 | Free-tier user sees upgrade prompt for already-accessible feature → confusion    | REQ-018                | FeatureGate checks tier before showing prompt              | AC-025         |
| HAZ-007 | Canceled subscription still active past period end → unexpected charges          | REQ-026                | CancelFlow (MOD-010) enforces period-end semantics         | AC-028         |
| HAZ-008 | TypeScript `any` in FeatureGate → premium features bypassed                      | REQ-NF-001             | `strict: true` enforcement, MOD-003 type guards            | AT-010-A       |
| HAZ-009 | Co-deployment violation → subscription feature crashes without Clerk             | REQ-CN-003             | REQ-CN-003 inspection, MOD-002 auth dependency             | AT-010-F       |
| HAZ-010 | Stripe secret key in client bundle → payment fraud                               | REQ-IF-003             | Server-side Stripe webhook handler only                    | AT-010-D       |
| HAZ-011 | Cancel flow creates race condition with lapse webhook                            | REQ-025, REQ-026       | Idempotent webhook processing (UTP-009-C)                  | AT-010-D       |
| HAZ-012 | Upgrade prompt blocks accessible free-tier feature → usability issue             | REQ-018                | Prompt dismissible (AC-026); gate only on premium features | AC-018, AC-026 |
| HAZ-013 | Subscription state change > 5s → user sees stale tier                            | REQ-CN-001             | 5s constraint enforced in LapseHandler                     | AT-010-E       |

---

## Coverage Audit

### Forward Coverage (REQ → ATP)

| Category            | Total  | With AT | Inspection-only | Analysis-only | Uncovered |
| ------------------- | ------ | ------- | --------------- | ------------- | --------- |
| Functional (FR)     | 20     | 20      | 0               | 0             | 0         |
| Non-Functional (NF) | 4      | 2       | 2               | 0             | 0         |
| Interface (IF)      | 3      | 3       | 0               | 0             | 0         |
| Constraint (CN)     | 4      | 3       | 1               | 0             | 0         |
| **Total**           | **31** | **28**  | **3**           | **0**         | **0**     |

### Backward Coverage (ATP → REQ)

| Direction | Total | Mapped | Orphan |
| --------- | ----- | ------ | ------ |
| AT → REQ  | 30    | 30     | 0      |

### Unit Test Coverage

| MOD Category                     | Count  | UTP Count | UTS Count |
| -------------------------------- | ------ | --------- | --------- |
| Runtime modules                  | 10     | 32        | 78        |
| Config/compile-time (no runtime) | 0      | 0         | 0         |
| **Total**                        | **10** | **32**    | **78**    |

**Overall coverage: 100%** (all 31 requirements have verification path)

---

## Orphan & Gap Report

### Orphans (ATP/UTS with no REQ)

**None found** — all 30 ATPs trace to at least one requirement.

### Gaps (REQ with no verification path)

**None found** — all 31 requirements have either an AT, inspection path, or demonstration justification.

### Integration Test Gaps (Priority Ordered)

| Priority | Integration Point                    | Risk                                                    |
| -------- | ------------------------------------ | ------------------------------------------------------- |
| P1       | MOD-001 ↔ EXTERNAL (Stripe)          | Upgrade flow fails; no payment collected                |
| P1       | MOD-003 ↔ EXTERNAL (005/006/007/009) | Premium features accessible to free users               |
| P1       | MOD-005 ↔ EXTERNAL (Stripe)          | Lapse not processed; premium features remain accessible |
| P2       | MOD-001 ↔ EXTERNAL (002)             | Tier check wrong; features gated incorrectly            |
| P2       | MOD-004 ↔ EXTERNAL (Stripe)          | Payment fails; upgrade incomplete                       |
| P3       | MOD-006 ↔ MOD-001 (tier badge)       | Badge wrong; user confusion                             |

**Recommendation**: Create `specs/010-subscriptions/v-model/integration-test.md` to address P1/P2 gaps before deployment.

---

## Baseline State

All matrix entries are set to **⬜ Pending Execution** — no acceptance tests, unit tests, or integration tests have been executed. This baseline reflects the pre-implementation state of the V-Model documentation.

---

_Matrix generated: 2026-05-09 | Source: speckit v model trace | Status: Baseline (pre-execution)_
