# Research: Subscriptions & Monetization

**Branch**: `010-subscriptions` | **Date**: 2026-05-09
**Status**: Complete | **Input**: [spec.md](../spec.md), [plan.md](../plan.md), [research.md](../research.md)

---

This directory contains the Product Forge Phase 1 research artifacts for feature 010. These documents **augment** the existing [`research.md`](../research.md) by decomposing it into implementation-ready lenses consistent with the 001 artifact pattern.

## File Index

### [competitors.md](./competitors.md)

Competitive landscape focused on monetization model fit for Commise subscriptions. Compares Paprika (one-time), Mealime (freemium), PlateJoy (subscription), and SideChef Pro (premium). Includes 2026 pricing posture, gating strategy matrix, and positioning implications for free-vs-paid boundaries.

### [ux-patterns.md](./ux-patterns.md)

UX patterns for monetization conversion and retention: paywall placement hierarchy, tier comparison tables, trial onboarding, dunning messaging flows, cancellation confirmation, and restore purchase on mobile. Maps each pattern to FR-040..FR-043 and upgrade CTA behavior.

### [codebase-analysis.md](./codebase-analysis.md)

Monorepo and implementation fit analysis grounded in root `package.json`, `AGENTS.md`, `plan.md`, and `tasks.md`. Covers workspace topology, billing module boundaries, guard/decorator composition strategy, and identified source-of-truth gaps (mobile stores, family plans).

### [tech-stack.md](./tech-stack.md)

Technology rationale for Stripe-hosted checkout + customer portal + webhook event ingestion with idempotency persistence. Includes backend framework fit (NestJS), storage model implications, and extension points for App Store / Play Store reconciliation.

### [metrics-roi.md](./metrics-roi.md)

Operational and product ROI metrics for subscription conversion funnel, trial progression, dunning recovery, and downgrade retention. Distinguishes portfolio ROI from story-level metrics in `product-spec/metrics.md`.

### [README.md](./README.md)

This index file.

---

## Source Traceability

| Research File        | Primary Sources                                                       |
| -------------------- | --------------------------------------------------------------------- |
| competitors.md       | `research.md` section 1, user-provided competitor set                 |
| ux-patterns.md       | `research.md` sections 1.2/3.x, `plan.md` gating + API response model |
| codebase-analysis.md | root `package.json`, `AGENTS.md`, `plan.md`, `tasks.md`               |
| tech-stack.md        | `research.md` sections 2/4/5, `plan.md` sections 1/3/5                |
| metrics-roi.md       | `spec.md` success criteria + NFRs, `tasks.md` traceability table      |

---

## Notes

- No upstream source files were modified during bootstrap.
- Any domain item not explicit in source requirements (for example family plans, App Store/Play Store parity details) is recorded as a **warning or future consideration**, not as a mandatory requirement.
