# Wireframe: Tier Upgrade Flow (End-to-End)

**Branch**: `010-subscriptions` | **Date**: 2026-05-09
**FRs**: [FR-041](../../spec.md#functional-requirements), [FR-042](../../spec.md#functional-requirements)

---

## Flow Overview

1. User triggers premium-gated action
2. Contextual prompt appears
3. User selects trial/upgrade CTA
4. Redirect to Stripe Checkout
5. Return to success state with premium entitlement active

---

## ASCII Wireframe Sequence

### Step 1: Gated Action

```
[AI Meal Suggestions]
   ↓ (click)
403 PREMIUM_REQUIRED
```

### Step 2: Prompt

```
+-----------------------------------------+
| Unlock AI Meal Suggestions              |
| Premium helps you auto-build weekly     |
| plans and reduce food waste.            |
| [Start Free Trial] [View Pricing]       |
+-----------------------------------------+
```

### Step 3: Checkout Redirect

```
POST /api/v1/billing/checkout -> checkoutUrl
Redirect -> Stripe hosted checkout
```

### Step 4: Return and Confirm

```
+-----------------------------------------+
| Upgrade successful                       |
| Plan: Premium                            |
| Status: Active                           |
| [Try AI Meal Suggestions now]            |
+-----------------------------------------+
```

---

## Interaction Notes

- Success state should be triggered only after account state sync from webhook.
- If sync is pending, show deterministic "finalizing upgrade" state and retry entitlement check.
