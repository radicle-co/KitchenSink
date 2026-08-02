# Codebase Analysis: Subscriptions & Monetization Integration

**Branch**: `010-subscriptions` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [plan.md](../plan.md), [tasks.md](../tasks.md), root `package.json`, [AGENTS.md](../../../AGENTS.md)

---

## Monorepo Layout Context

KitchenSink uses npm workspaces + Turborepo orchestration.

Root `package.json` workspaces:

```json
"workspaces": [
    "packages/tools/*",
    "packages/services/*",
    "packages/shared/*",
    "packages/utils/*",
    "packages/infra/*",
    "packages/apps/commise/web",
    "packages/apps/commise/mobile",
    "packages/apps/commise/ui",
    "packages/apps/commise/i18n",
    "packages/apps/commise/features/*",
    "packages/clients/*"
]
```

Root scripts indicate cross-workspace quality gates:

- `build`: `turbo run build`
- `test`: `turbo run test`
- `lint`: `turbo run lint format:check`
- `typecheck`: `turbo run typecheck`

---

## Feature 010 Architectural Fit

Per `plan.md`, subscriptions is a cross-cutting concern centered on backend billing module plus frontend gating UX.

### Backend scope

- `billing.module.ts`
- `billing.controller.ts`
- `billing.service.ts`
- webhook controller/service + event handlers
- premium decorator + plan guard

### Frontend scope

- web: `403 PREMIUM_REQUIRED` interceptor + upgrade prompt components
- mobile: restore purchase / tier state access surfaces (implementation path may vary by billing channel)

---

## Dependency and Integration Boundaries

### Upstream dependencies

- **Feature 002**: authenticated account + plan fields on user model
- **Feature 001/004/005/006/007/009**: endpoints and capabilities gated by `@RequirePremium()`

### Internal dependency graph

```
AuthMiddleware (Clerk session token) -> PlanGuard -> gated route handlers
                |
                -> account.plan + account.subscriptionStatus

Stripe webhook events -> webhook_events idempotency table -> account subscription fields

Frontend interceptors -> 403 PREMIUM_REQUIRED payload -> pricing/paywall UX -> billing checkout endpoint
```

---

## Data Model Integration Surface

`plan.md` introduces subscription columns on `Account` and an idempotency table (`webhook_events`).

The model shape supports:

- free/premium entitlement checks
- active/trialing/past_due/canceled state transitions
- billing lifecycle timestamps and flags
- de-duplication of retried webhook events

This is sufficient for FR-040..043 gating and retention logic.

---

## Operational Considerations

1. **rawBody requirement** in Nest bootstrap is mandatory for webhook signature verification.
2. **Idempotency persistence** is non-optional because Stripe retries webhooks.
3. **Auth ordering** — `AuthMiddleware` must populate `req.user` before `PlanGuard` runs; middleware precedes guards in Nest, so this holds by construction, but `PlanGuard` MUST fail closed if `req.user` is absent.
4. **Error contract stability** for `PREMIUM_REQUIRED` is required by frontend interceptors.

---

## Gaps and Warnings (No New Requirements Invented)

### G-1: App Store / Play Store billing path not specified in implementation plan

- Domain context expects Stripe + mobile store billing coexistence.
- Current plan and tasks are Stripe-centric.
- Action: treat store billing as future extension unless explicit FR added.

### G-2: Family plans are domain-relevant but not represented in FR-040..043

- Family sharing/tiering appears as market expectation.
- No source artifact defines family entitlement model.
- Action: retain as future consideration only.

### G-3: Typo in tasks response code string

- `tasks.md` references `PREIMUM_REQUIRED` at one location.
- Plan/research consistently use `PREMIUM_REQUIRED`.
- Action: source cleanup in implementation cycle.

---

## Conclusion

Feature 010 has clear architectural boundaries and can be integrated without workspace restructuring. The current source set is implementation-ready for Stripe-based monetization gating and lifecycle management; mobile store billing and family-plan semantics remain intentionally out-of-scope pending explicit requirements.
