# Product Forge Revalidation Log: Feature 010

**Branch**: `010-subscriptions`
**Created**: 2026-05-09
**Last updated**: 2026-05-10
**Status**: Product decisions revalidated — implementation/test gate blocked pending V-Model regeneration and test execution
**Mode**: Retroactive bootstrap

## Milestone Assignment

- **Milestone**: `M6` Gondor
- **Public launch**: 1.0
- **Source of truth**: ../v1-launch-plan.md
- **Last updated**: 2026-08-02

---

## Purpose

This file records the iterative revalidation cycle for the Product Forge layer of feature 010. Each revision captures user feedback, the corrections applied, and an explicit approval marker.

This feature was **retroactively bootstrapped** — SpecKit, plan, tasks, and V-Model artifacts already existed before Product Forge artifacts were layered on. Revalidation here therefore focuses on:

1. Whether the synthesized `research/` and `product-spec/` artifacts faithfully reflect existing `spec.md`, `plan.md`, `tasks.md`, and `v-model/requirements.md`.
2. Whether the new artifacts reveal any contradictions, omissions, or stale assumptions in upstream documents.
3. Whether the MoSCoW decomposition and gating narratives in `product-spec/product-spec.md` match product intent for subscriptions and monetization.

---

## Revision Log

### Revision 0 — Initial Bootstrap (2026-05-09)

**Author**: Sisyphus (Product Forge retrofit)
**Trigger**: User-requested retroactive bootstrap for feature `010-subscriptions`.

**Artifacts produced**:

- [research/competitors.md](./research/competitors.md)
- [research/ux-patterns.md](./research/ux-patterns.md)
- [research/codebase-analysis.md](./research/codebase-analysis.md)
- [research/tech-stack.md](./research/tech-stack.md)
- [research/metrics-roi.md](./research/metrics-roi.md)
- [research/README.md](./research/README.md)
- [product-spec/product-spec.md](./product-spec/product-spec.md)
- [product-spec/user-journey.md](./product-spec/user-journey.md)
- [product-spec/wireframes/](./product-spec/wireframes/README.md)
- [product-spec/metrics.md](./product-spec/metrics.md)
- [product-spec/README.md](./product-spec/README.md)
- [.forge-status.yml](./.forge-status.yml)
- [verify-report.md](./verify-report.md)

**Synthesis sources**:

| Bootstrapped File    | Primary Source(s)                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| competitors.md       | `research.md` section 1 + domain additions requested by user (Paprika/Mealime/PlateJoy/SideChef Pro)                |
| ux-patterns.md       | `research.md` sections 1.2, 3.x + `plan.md` sections 3–4                                                            |
| codebase-analysis.md | root `package.json`, `AGENTS.md`, `plan.md`, `tasks.md`                                                             |
| tech-stack.md        | `research.md` sections 2–5, `plan.md` sections 1–5                                                                  |
| metrics-roi.md       | `spec.md` SC/NFR sections, `tasks.md` traceability map, `v-model/requirements.md`                                   |
| product-spec.md      | `spec.md` stories/FRs/NFRs, `plan.md` architecture, `v-model/requirements.md`                                       |
| user-journey.md      | `spec.md` user scenarios/edge cases, `plan.md` webhook + gating flows                                               |
| wireframes/          | `spec.md` FR-040..043, feature dependencies 001-FR-003/011/016/019/025/026/027/031/038, user-provided wireframe set |
| metrics.md           | `spec.md` success criteria + story-level derivation from FR-040..043                                                |

**Initial findings surfaced during bootstrap**:

- Core subscription scope is tightly constrained to **FR-040..FR-043**; all premium gating for dependent specs is transitive via FR-041.
- Plan and tasks include concrete Stripe + webhook idempotency implementation details not explicitly enumerated in spec FR text.
- Trial length appears as **14 days** in plan flow text while broader domain references often assume 7–30 day windows; this is a policy parameter and remains configurable.

**Status after revision 0**: Pending user review.

---

## Revision 1 — Decision Closure (2026-05-10)

**Author**: Product Owner (Feature 010)
**Trigger**: Director review found open decisions blocking engineering handoff.

### Closed Decisions

All three pending review questions from Revision 0 are now closed. Decisions are recorded below and propagated into `spec.md`, `product-spec/product-spec.md`, `plan.md`, and `tasks.md`.

---

#### Decision 1: Trial policy

**Question**: Confirm trial policy baseline for v1 (`14 days` in plan) and whether family-plan narratives should remain informational-only until a dedicated FR is added.

**Decision**: **14-day free trial, confirmed for v1.** The 14-day window is set in `plan.md §7` and reflected in `TASK-009` (`trial_period_days: 14`). No change to the trial length. Family-plan narratives remain informational-only; no family-plan FR exists in v1 scope. Any future family plan requires a new spec change and explicit FR before implementation begins.

**Propagated to**: `spec.md` (Assumptions + FR-040 note), `product-spec/product-spec.md` (pricing table + US-010-008 scope note).

---

#### Decision 2: Paywall placement hierarchy

**Question**: Confirm paywall placement hierarchy (contextual inline, modal on action, pricing page fallback) reflected in wireframes.

**Decision**: **Three-tier hierarchy, confirmed:**

1. **Contextual inline teaser** — shown at the feature entry point before the user takes action (e.g., a locked badge on the "Set Private" toggle, a grayed-out AI generation button with a "Premium" label). No interruption; user can see what they're missing.
2. **Modal on action** — triggered when a free-tier user actively invokes a gated action (e.g., taps "Generate AI Meal Plan"). The modal shows the feature value proposition and a "Start Free Trial" CTA. Dismissible.
3. **Pricing page fallback** — reachable from any upgrade CTA and from account settings. Shows the full free vs premium comparison table with monthly and annual pricing.

This hierarchy applies to both web and mobile. On mobile, the modal becomes a bottom sheet. The pricing page opens in the in-app browser (WebView) on mobile since Stripe Checkout is not embeddable in React Native.

**Propagated to**: `product-spec/product-spec.md` (paywall hierarchy section), `tasks.md` (TASK-022 and TASK-024 acceptance criteria updated).

---

#### Decision 3: Downgrade behavior for private recipes

**Question**: Confirm downgrade behavior framing: existing private recipes remain private, no new private recipes on free tier.

**Decision**: **Confirmed. Existing private recipes stay private after downgrade; no new private recipes on free tier.**

Specifically:

- A lapsed or canceled premium user retains read access to all their existing private recipes. Those recipes remain private (not auto-published).
- The lapsed user cannot set any new recipe to private until they renew.
- Imported, attributed recipes are always public regardless of tier (source TOS compliance, REQ-CN-001).
- This behavior is already implemented in `TASK-027` and `TASK-018`. No architecture change needed.

**Propagated to**: `spec.md` (FR-043 clarification note), `product-spec/product-spec.md` (US-010-004 acceptance note).

---

### Additional Decisions Closed (Director Review Items)

The following items were flagged by the director review as unresolved. All are now closed.

| #   | Topic                  | Decision                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-4 | Pricing                | **$6.99/month or $59.99/year.** Both plans available at launch. Annual saves ~29% ($5.00/mo effective). Confirmed in `plan.md §7`. Propagated to `spec.md` and `product-spec.md`.                                                                                                                                                                                                                                         |
| D-5 | Grace period           | **7 days past_due.** After a failed payment, the user retains premium access for 7 days while Stripe retries and the user can update their payment method. After 7 days with no resolution, `plan` downgrades to `free`. Confirmed in `plan.md §7` and `PlanGuard` implementation.                                                                                                                                        |
| D-6 | Free tier recipe quota | **Unlimited public recipes.** Free-tier users face no recipe count cap. The only restriction is visibility: all free-tier recipes are public. Confirmed in `plan.md OQ-1`. Propagated to `spec.md FR-040`.                                                                                                                                                                                                                |
| D-7 | Family plan v1 scope   | **Out of scope for v1.** Family plan is a future consideration only. No FR, no architecture, no task. Requires a dedicated spec change to enter scope. Confirmed in `plan.md OQ-2` and `product-spec.md US-010-008`.                                                                                                                                                                                                      |
| D-8 | Web vs mobile parity   | **Web is primary billing surface; mobile is secondary.** Stripe Checkout and Customer Portal are web-only. Mobile shows upgrade prompts (bottom sheet) and deep-links to the web checkout URL. Mobile users manage subscriptions via the web portal or platform settings (App Store / Play Store IAP is out of scope for v1). A dedicated task (TASK-028) covers mobile subscription status display and portal deep-link. |

---

## Approval Marker

> APPROVED by Product Owner (Feature 010) on 2026-05-10.
> Revision: 1
> All open product decisions are closed. Implementation and release gates remain blocked until Draft V-Model artifacts are regenerated/aligned and the blocked release audit is replaced after test execution.
