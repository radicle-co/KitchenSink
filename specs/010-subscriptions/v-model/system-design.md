# System Design: Subscriptions & Monetization

**Feature Branch**: `010-subscriptions`
**Created**: 2026-05-09
**Status**: Active — updated 2026-05-10 to reflect closed product decisions (REQ-026–REQ-031)
**Source**: `specs/010-subscriptions/v-model/requirements.md`

## Overview

The Subscriptions & Monetization system decomposes into components that manage tier assignment, entitlement enforcement, feature gating, upgrade prompting, subscription lifecycle, and data retention. The design is a cross-cutting concern that integrates with Clerk identity (spec 002) and gates capabilities across recipe management (001), AI features (005), meal planning (006), grocery ordering (007), and trainer nutrition (009).

## ID Schema

- **System Component**: `SYS-NNN` — sequential identifier for each component
- **Parent Requirements**: Comma-separated `REQ-NNN` list per component (many-to-many)
- Example: `SYS-003` with Parent Requirements `REQ-001, REQ-005` — component satisfies both requirements

## Decomposition View (IEEE 1016 §5.1)

| SYS ID  | Name                               | Description                                                                                                                                                                                                                         | Parent Requirements                                                             | Type      |
| ------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------- |
| SYS-001 | Tier Assignment Service            | Assigns every newly registered user to the free tier upon account creation; manages tier state transitions (free→premium, premium→lapsed).                                                                                          | REQ-001, REQ-020, REQ-023                                                       | Service   |
| SYS-002 | Free-Tier Entitlement Module       | Enforces free-tier access rights: recipe CRUD, sharing/cloning, basic importing, manual meal planning, grocery list generation (no ordering), cooking mode.                                                                         | REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007                            | Module    |
| SYS-003 | Premium-Tier Entitlement Module    | Enforces premium-tier access rights: private recipe visibility, AI features, online grocery ordering, trainer nutrition planning, clone-to-private.                                                                                 | REQ-009, REQ-010, REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-016, REQ-017 | Module    |
| SYS-004 | Feature Gate Middleware            | Intercepts feature access requests, checks the user's current tier against the feature's required tier, and either permits access or triggers upgrade prompt.                                                                       | REQ-IF-002, REQ-018, REQ-023, REQ-025                                           | Subsystem |
| SYS-005 | Recipe Visibility Enforcement      | Enforces public-by-default for free-tier recipes; prevents free-tier users from setting recipes private; preserves privacy state on subscription lapse per source TOS rules.                                                        | REQ-008, REQ-024, REQ-025                                                       | Module    |
| SYS-006 | Upgrade Prompt Component           | Displays a contextual upgrade prompt with feature preview/tease when a free-tier user attempts to access a premium-gated feature. Implements the three-tier hierarchy: (1) inline teaser, (2) modal/bottom-sheet, (3) pricing page. | REQ-018, REQ-019, REQ-029, REQ-NF-003, REQ-NF-004                               | Module    |
| SYS-007 | Subscription Lifecycle Manager     | Manages subscription state machine: trial, active, past_due (7-day grace), lapsed, renewed. Handles lapse events (lock premium features, retain data), renewal events (re-enable features), and grace period expiry.                | REQ-021, REQ-022, REQ-023, REQ-024, REQ-025, REQ-028                            | Service   |
| SYS-008 | Clerk Identity Integration         | Exposes the authenticated user's current subscription tier (free/premium) via the `public_metadata.subscriptionTier` claim on the verified Clerk session token.                                                                     | REQ-IF-001                                                                      | Service   |
| SYS-009 | Subscription Webhook Receiver      | Receives subscription lifecycle events from the payment provider (upgrade, lapse, renewal) and triggers SYS-001 and SYS-007 state transitions.                                                                                      | REQ-IF-003                                                                      | Service   |
| SYS-010 | Data Retention Guard               | Ensures all user data is retained when a premium subscription lapses; prevents data loss on tier downgrade.                                                                                                                         | REQ-021, REQ-022                                                                | Module    |
| SYS-011 | TypeScript Strict Compliance Layer | Cross-cutting: enforces `strict: true` TypeScript compilation, prohibits `any` outside test doubles, mandates JSDoc on all exported functions/interfaces.                                                                           | REQ-NF-001, REQ-NF-002                                                          | Utility   |
| SYS-012 | Accessibility Compliance Layer     | Cross-cutting: ensures all UI components expose accessible names queryable via `getByRole`/`getByLabel`; enforces icon+text pairing for tier status display.                                                                        | REQ-NF-003, REQ-NF-004                                                          | Utility   |
| SYS-013 | Cross-Feature Gate Registry        | Maintains the registry of feature identifiers and their required tier; consumed by SYS-004 to resolve gate decisions for features across specs 001, 004–007, 009.                                                                   | REQ-CN-001, REQ-CN-002, REQ-IF-002, REQ-031                                     | Module    |
| SYS-014 | Stripe Billing Configuration       | Encapsulates Stripe product/price IDs for the monthly ($6.99) and annual ($59.99) plans, the 14-day trial configuration, and the 7-day grace period (past_due → canceled transition). Consumed by SYS-009 and SYS-007.              | REQ-026, REQ-027, REQ-028                                                       | Service   |
| SYS-015 | Mobile Billing Deep-Link Handler   | On mobile clients, intercepts upgrade CTA taps and deep-links the user to the web Stripe Checkout URL rather than triggering native IAP. Enforces web-only billing surface for v1.                                                  | REQ-030                                                                         | Module    |

## Dependency View (IEEE 1016 §5.2)

| Source  | Target  | Relationship | Failure Impact                                                                    |
| ------- | ------- | ------------ | --------------------------------------------------------------------------------- |
| SYS-004 | SYS-008 | Reads        | Gate cannot determine user tier; defaults to deny (fail-closed)                   |
| SYS-004 | SYS-013 | Reads        | Gate cannot resolve feature tier requirement; defaults to deny                    |
| SYS-004 | SYS-006 | Calls        | Upgrade prompt not shown; user sees generic error                                 |
| SYS-001 | SYS-008 | Writes       | Tier state not reflected in identity token; stale tier served to gate             |
| SYS-007 | SYS-001 | Calls        | Lifecycle events not propagated; tier state becomes inconsistent                  |
| SYS-007 | SYS-010 | Calls        | Data retention not enforced on lapse; risk of data loss                           |
| SYS-007 | SYS-005 | Calls        | Recipe visibility not enforced on lapse; private recipes may become accessible    |
| SYS-009 | SYS-007 | Calls        | Webhook events not processed; subscription state not updated                      |
| SYS-002 | SYS-004 | Uses         | Free-tier entitlement checks bypass gate; unauthorized access possible            |
| SYS-003 | SYS-004 | Uses         | Premium entitlement checks bypass gate; unauthorized access possible              |
| SYS-005 | SYS-004 | Uses         | Visibility enforcement bypasses gate; free-tier users may set recipes private     |
| SYS-006 | SYS-012 | Uses         | Upgrade prompt not accessible; WCAG violation                                     |
| SYS-011 | SYS-001 | Uses         | TypeScript compliance not enforced on tier assignment code                        |
| SYS-011 | SYS-004 | Uses         | TypeScript compliance not enforced on gate middleware                             |
| SYS-013 | SYS-002 | Reads        | Free-tier feature list unavailable; gate cannot resolve free entitlements         |
| SYS-013 | SYS-003 | Reads        | Premium feature list unavailable; gate cannot resolve premium entitlements        |
| SYS-009 | SYS-014 | Reads        | Billing configuration unavailable; webhook cannot map events to plan state        |
| SYS-007 | SYS-014 | Reads        | Grace period config unavailable; lifecycle manager cannot enforce past_due window |
| SYS-006 | SYS-015 | Delegates    | Mobile deep-link not triggered; mobile user sees broken upgrade flow              |

### Dependency Diagram

```text
[Payment Provider]
       │ webhook
       ▼
  SYS-009 (Webhook Receiver)
       │ calls
       ▼
  SYS-007 (Lifecycle Manager) ──calls──► SYS-010 (Data Retention Guard)
       │ calls                           SYS-005 (Recipe Visibility)
       ▼
  SYS-001 (Tier Assignment) ──writes──► SYS-008 (Clerk Identity Integration)
                                               │ reads
                                               ▼
[User Request] ──────────────────────► SYS-004 (Feature Gate Middleware)
                                         │ reads          │ calls
                                         ▼                ▼
                                    SYS-013 (Registry)  SYS-006 (Upgrade Prompt)
                                      │ reads              │ uses
                                      ├──► SYS-002         ▼
                                      └──► SYS-003      SYS-012 (A11y Layer)

Cross-cutting: SYS-011 (TS Strict) ──uses──► SYS-001, SYS-004, SYS-007, SYS-009
```

## Interface View (IEEE 1016 §5.3)

### External Interfaces

| Component | Interface Name       | Protocol         | Input                                                                                         | Output                                                 | Error Handling                                          |
| --------- | -------------------- | ---------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- | -------------------------------------- |
| SYS-009   | Subscription Webhook | HTTPS POST       | Derived — supports cross-cutting implementation constraints for traced parent system behavior | 200 OK or 4xx/5xx (Derived)                            | Retry with exponential backoff; DLQ on repeated failure |
| SYS-008   | Clerk User Identity  | `@clerk/backend` | Derived — supports cross-cutting implementation constraints for traced parent system behavior | User object with `subscriptionTier: 'free' \ (Derived) | 'premium'`                                              | Throw `AuthIdentityError`; deny access |
| SYS-006   | Upgrade Prompt UI    | React component  | Derived — supports cross-cutting implementation constraints for traced parent system behavior | Rendered upgrade prompt with feature preview (Derived) | Fallback to generic upgrade CTA                         |

### Internal Interfaces

| Source  | Target  | Interface Name                     | Protocol                                                                                      | Data Format                                                | Error Handling                    |
| ------- | ------- | ---------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------- | ---------------------------------------- |
| SYS-004 | SYS-008 | `getUserTier(userId)`              | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{ userId: string } → 'free' \ (Derived)                   | 'premium'`                        | Throw `TierResolutionError`; fail-closed |
| SYS-004 | SYS-013 | `getFeatureTier(featureId)`        | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{ featureId: string } → 'free' \ (Derived)                | 'premium'`                        | Throw `FeatureNotRegisteredError`; deny  |
| SYS-007 | SYS-001 | `setUserTier(userId, tier)`        | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{ userId: string, tier: Tier, reason: string }` (Derived) | Throw `TierUpdateError`; rollback |
| SYS-009 | SYS-007 | `handleLifecycleEvent(event)`      | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `SubscriptionEvent` (typed union) (Derived)                | Throw `LifecycleEventError`; DLQ  |
| SYS-007 | SYS-005 | `enforceVisibilityOnLapse(userId)` | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{ userId: string }` (Derived)                             | Log and alert; do not block lapse |
| SYS-007 | SYS-010 | `retainUserData(userId)`           | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{ userId: string }` (Derived)                             | Throw `DataRetentionError`; alert |

## Data Design View (IEEE 1016 §5.4)

| Entity                 | Component | Storage            | Protection at Rest          | Protection in Transit | Retention                                               |
| ---------------------- | --------- | ------------------ | --------------------------- | --------------------- | ------------------------------------------------------- |
| UserSubscriptionRecord | SYS-001   | PostgreSQL         | Row-level security, AES-256 | TLS 1.3               | Retained indefinitely; tier field updated on change     |
| FeatureGateRegistry    | SYS-013   | In-memory (config) | N/A (static config)         | N/A                   | Reloaded on deploy                                      |
| SubscriptionWebhookLog | SYS-009   | PostgreSQL         | AES-256                     | TLS 1.3               | 90-day rolling retention                                |
| VerifiedClerkClaims    | SYS-008   | Clerk (external)   | Clerk-managed               | TLS 1.3               | Managed by Clerk; carried in the verified session token |
| RecipeVisibilityState  | SYS-005   | PostgreSQL         | Row-level security, AES-256 | TLS 1.3               | Retained on lapse; not reset                            |

---

## Coverage Summary

| Metric                              | Count |
| ----------------------------------- | ----- |
| Total System Components (SYS)       | 15    |
| Total Requirements (REQ)            | 40    |
| Functional Requirements Covered     | 31    |
| Non-Functional Requirements Covered | 4     |
| Interface Requirements Covered      | 3     |
| Constraint Requirements Covered     | 2     |
| Uncovered Requirements              | 0     |

## Traceability Matrix

| REQ ID     | SYS IDs                   |
| ---------- | ------------------------- |
| REQ-001    | SYS-001                   |
| REQ-002    | SYS-002                   |
| REQ-003    | SYS-002                   |
| REQ-004    | SYS-002                   |
| REQ-005    | SYS-002                   |
| REQ-006    | SYS-002                   |
| REQ-007    | SYS-002                   |
| REQ-008    | SYS-005                   |
| REQ-009    | SYS-003                   |
| REQ-010    | SYS-003                   |
| REQ-011    | SYS-003                   |
| REQ-012    | SYS-003                   |
| REQ-013    | SYS-003                   |
| REQ-014    | SYS-003                   |
| REQ-015    | SYS-003                   |
| REQ-016    | SYS-003                   |
| REQ-017    | SYS-003                   |
| REQ-018    | SYS-004, SYS-006          |
| REQ-019    | SYS-006                   |
| REQ-020    | SYS-001, SYS-007          |
| REQ-021    | SYS-007, SYS-010          |
| REQ-022    | SYS-007, SYS-010          |
| REQ-023    | SYS-001, SYS-004, SYS-007 |
| REQ-024    | SYS-005, SYS-007          |
| REQ-025    | SYS-004, SYS-005, SYS-007 |
| REQ-NF-001 | SYS-011                   |
| REQ-NF-002 | SYS-011                   |
| REQ-NF-003 | SYS-006, SYS-012          |
| REQ-NF-004 | SYS-006, SYS-012          |
| REQ-IF-001 | SYS-008                   |
| REQ-IF-002 | SYS-004, SYS-013          |
| REQ-IF-003 | SYS-009                   |
| REQ-CN-001 | SYS-013                   |
| REQ-CN-002 | SYS-013                   |
| REQ-026    | SYS-014                   |
| REQ-027    | SYS-014                   |
| REQ-028    | SYS-007, SYS-014          |
| REQ-029    | SYS-006                   |
| REQ-030    | SYS-015                   |
| REQ-031    | SYS-013                   |
