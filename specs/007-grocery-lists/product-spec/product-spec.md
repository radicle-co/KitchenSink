# Product Specification: Commise - Grocery Lists & Online Ordering

**Branch**: `007-grocery-lists`
**Date**: 2026-05-09
**Last Updated**: 2026-05-10 (added US-011, US-012; resolved partner API status; added mobile parity note)
**Status**: Pre-handoff
**Source**: [spec.md](../spec.md)

---

## Vision

Commise grocery lists transform meal planning into shopping execution. A generated list should feel trustworthy, fast to use in-store, and optionally seamless to hand off into online checkout for premium users.

**Tagline**: "From plan to cart, without the chaos."

**Core principles**:

- Generation quality is non-negotiable: aggregate and dedupe correctly.
- Users stay in control: pantry exclusions, manual adds, and clear review before ordering.
- Shopping speed matters: aisle grouping and low-friction check-off interactions.
- Premium value is additive: ordering features should not degrade core list utility.
- Lists are first-class objects: reachable from the dedicated Shopping Lists page, not only through meal plans.
- Meal plans and shopping lists are cross-linked: navigating between them is one tap in either direction.

---

## Personas

### Primary: P3 Riley — Family Meal Planner

**Archetype**: Family Meal Planner
**Core motivation**: Quick, kid-friendly, weekly rotation, household scale

**Grocery-list goals and pains**:

- Generates a single aisle-grouped weekly list from a 5–7 day meal plan in one tap, so the whole family's shop is covered without manual assembly.
- Needs deduplication and quantity summing across overlapping recipes (e.g., chicken thighs appearing in three dinners) to avoid overbuying.
- Relies on pantry exclusions to skip items already stocked, reducing waste and checkout cost.
- Wants fast in-store check-off that works one-handed while managing a cart and kids.
- Frustrated when flat, unordered lists force backtracking through the store.

---

### Secondary: P6 Avery — Waste Optimizer

**Archetype**: Waste Optimizer
**Core motivation**: Use-the-fridge, ingredient chaining, cost reduction

**Grocery-list goals and pains**:

- Expects the list to reflect pantry state accurately so already-owned ingredients are never re-purchased.
- Wants "use what's in the pantry first" logic surfaced during list generation, not as an afterthought.
- Values ingredient chaining across the week's meals so a bunch of cilantro bought for Monday's tacos also covers Thursday's soup.
- Frustrated by lists that ignore partial quantities already at home, leading to duplicate purchases and spoilage.
- Tracks spend per list and wants clear visibility into what's being skipped due to pantry coverage.

---

### Tertiary: P8 Alex — Commise Power User

**Archetype**: Commise Power User (multi-feature daily power use, integrations, automation)
**Core motivation**: Multi-feature daily power use, integrations, automation

**Grocery-list goals and pains**:

- Consolidates ingredients across multiple simultaneous meal plans (e.g., a batch-cook Sunday prep plus a weeknight rotation) into one unified list.
- Expects smart quantity scaling when batch-cooking recipes are multiplied, with correct unit conversions surfaced automatically.
- Wants manual add and edit to be fast and keyboard-friendly, not buried behind confirmation dialogs.
- Uses online ordering handoff regularly and expects store mapping quality to be high enough that the pre-order review step is a quick scan, not a correction session.
- Frustrated when premium ordering features require repeated store reconnection or lose mapping history between sessions.

---

## Epics

### Epic A: Generate and Maintain Accurate Grocery Lists

Scope: FR-028, FR-029.

### Epic B: Configure and Execute Premium Ordering

Scope: FR-030, FR-031.

### Epic C: Shopping UX Efficiency

Scope: Supports Epic A/B outcomes through grouping, fast interactions, and clear status signaling.

---

## MoSCoW Story Map with FR Traceability

## Must Have

### US-001: Generate List from Meal Plan

As an authenticated user, I can generate a grocery list from a meal plan so that all ingredients are aggregated in one place.

**FRs**: [FR-028](../spec.md#feature-requirements), [001-FR-045](../../001-commise-recipe-app/spec.md)

### US-002: Deduplicate and Sum Ingredient Quantities

As a user, I see duplicate ingredients collapsed into a single line with summed quantities so I can shop accurately.

**FRs**: [FR-028](../spec.md#feature-requirements)

### US-003: Mark "Already Have" Items

As a user, I can mark line items as already available at home so they are excluded from active shopping.

**FRs**: [FR-029](../spec.md#feature-requirements)

### US-004: Review List in Aisle-Oriented Grouping

As an in-store shopper, I can use grouped sections to reduce backtracking and complete shopping faster.

**FRs**: [FR-028](../spec.md#feature-requirements), [FR-029](../spec.md#feature-requirements)

## Should Have

### US-005: Configure Store Connection

As a user, I can connect a supported store so the app can prepare ordering handoff.

**FRs**: [FR-030](../spec.md#feature-requirements)

### US-006: Guided Setup on Order Attempt

As a user without a connected store, I receive setup guidance when initiating order flow.

**FRs**: [FR-030](../spec.md#feature-requirements)

### US-007: Create Order Handoff from List (Premium)

As a premium user, I can map list items to store products and continue checkout through a provider handoff.

**FRs**: [FR-031](../spec.md#feature-requirements)

> **Partner API status**: No grocery store partner API access is confirmed at spec time. Walmart is the first adapter to build (public API, key-based). Instacart requires a partner agreement. Both adapters ship behind a feature flag and the ordering UI degrades gracefully when no integration is active. The UI must not imply that ordering is always available.

### US-008: Pre-Order Review for Mapped vs Unmapped Items

As a premium user, I can inspect mapping quality before ordering to avoid missing items.

**FRs**: [FR-031](../spec.md#feature-requirements)

## Could Have

### US-009: Household List Sharing and Sync

As a household member, I can share a grocery list so multiple people can collaborate in real time.

**Traceability note**: Requested domain behavior; explicit FR missing in current `spec.md` (warning-level only).

### US-010: Voice Add for Quick Capture

As a busy shopper, I can add items by voice so I can capture forgotten items quickly.

**Traceability note**: UX accelerator pattern, not a normative FR in current `spec.md`. Deferred to post-MVP pending speech provider selection.

## Must Have (additions from 2026-05-10 review)

### US-011: Access Shopping Lists from Dedicated Page

As a user, I can navigate to a dedicated Shopping Lists page from the main navigation so I can view, create, and manage lists without going through a meal plan.

**FRs**: [FR-032](../spec.md#feature-requirements)

**Acceptance**: User can reach `/shopping-lists` (web) or the Shopping Lists tab (mobile) from the main nav, see all their lists, and create a new list from scratch or from a meal plan picker.

### US-012: Navigate Between Meal Plans and Shopping Lists

As a user, I can follow a link from a grocery list back to the meal plan it came from, and from a meal plan to any grocery lists generated from it.

**FRs**: [FR-033](../spec.md#feature-requirements)

**Acceptance**: Grocery list shows "From meal plan: [name]" link when applicable. Meal plan detail shows associated grocery lists. Both links work on web and mobile.

---

## Non-Functional Product Constraints

- Generation must support SC-004 timing target.
- End-to-end workflow should support SC-008.
- SC-009: Users can reach the Shopping Lists page from main nav and create a list without visiting a meal plan.
- Accessibility and state visibility follow NFR-003/NFR-004.
- Strict typing and documentation expectations align with NFR-001/NFR-002.
- **Mobile parity**: Every web UI capability has a corresponding mobile UI task. Web and mobile ship together; neither is considered done without the other.

## Out of Scope (Current Spec Baseline)

- Native payment processing inside Commise app.
- Fulfillment orchestration beyond provider handoff.
- Guaranteed real-time bidirectional multi-user conflict resolution semantics (unless explicit sharing FRs are added).
- Fully automated cross-unit conversion for unknown-density ingredients without user review.
- Webhook-based order status updates (deferred until a partner agreement confirms webhook delivery).
