# Research: Meal Planning

**Branch**: `006-meal-planning` | **Date**: 2026-05-09 | **Reconciled**: 2026-08-02
**Status**: Complete | **Input**: the codebase on `main` (authoritative), [spec.md](../spec.md), [plan.md](../plan.md),
[research.md](../research.md)

---

This directory contains the Product Forge research layer for feature 006. These files **augment** the root
[`research.md`](../research.md) (they do not replace it) and reorganize findings into implementation-facing documents.

> **Reconciliation note (2026-08-02).** The May 2026 research layer was written before 001, 002 and 003 shipped and
> derived its platform-facing conclusions from the then-current `plan.md`/`tasks.md` rather than from code. Three
> documents have been corrected against the shipped monorepo: `codebase-analysis.md` (full rewrite),
> `tech-stack.md` (Redis, the nutrition snapshot pipeline and the USDA adapter removed; a library-first gate added) and
> `ux-patterns.md` (mobile patterns added, lock/finalize removed). `competitors.md` and `metrics-roi.md` are external
> and product research and stand as written, with pointers updated. **Where any of these and the codebase disagree, the
> codebase wins.**

## File Index

### [competitors.md](./competitors.md)

Meal-planning competitor landscape: Plan To Eat, Mealime, PlateJoy, eMeals. Feature-parity matrix for weekly/monthly
planners, drag-drop scheduling, template reuse, leftovers workflow and shopping handoff. **Unaffected by the
reconciliation** — external market research, still current.

### [ux-patterns.md](./ux-patterns.md)

Interaction patterns for the week and month planners, **on both platforms**: web pointer-drag plus keyboard sensor,
mobile tap-to-assign, orphaned and degraded states, partial-nutrition presentation, templates with a skip report, and
the grocery entry point. _Reconciled: lock/finalize removed; mobile added; ingredient-manifest handoff narrowed to a
read projection; goal-aware guidance deferred to 009._

### [codebase-analysis.md](./codebase-analysis.md)

**Rewritten from the repository.** Actual workspace globs; the 001 assets 006 must consume rather than rebuild
(`recipe-core/nutrition`, branded ids, `recipeAccessPolicy`, `FoodCatalogGateway`); the Home widget contract already on
`main`; the naming/testing/pattern conventions 006 is bound by; and the infrastructure facts (ALB priorities, ADR-0004
NAT, ADR-0006 logical DBs, ADR-0008 cost levers, ADR-0010 deploy gate) the plan must respect.

### [tech-stack.md](./tech-stack.md)

Technology choices with the **library-first gate** run explicitly (`ky`, `date-fns`, `zod`; no hand-rolled breaker or
backoff). Records the three reversals: no cache tier, no nutrition snapshot table, no food-service call.

### [metrics-roi.md](./metrics-roi.md)

Portfolio-level metrics and ROI framing. Covers the constitution-derived NFRs, the end-to-end workflow objective, and
activation/retention hypotheses. Flags metrics that still require an instrumentation decision.

## Relationship to Other Artifacts

- [`../research.md`](../research.md) — the canonical deep research Q&A (RQ-1..RQ-9), with a Reconciliation section
  recording which answers were superseded and why.
- [`../product-spec/`](../product-spec/) — user-facing synthesis (stories, journeys, wireframes, story metrics).
- [`../spec.md`](../spec.md) — source of truth for FR/NFR/SC ids and the Clarifications that resolve the open questions.
- [`../plan.md`](../plan.md) — technical constraints, pattern register, data model, API contracts, infrastructure.
- [`../tasks.md`](../tasks.md) — delivery decomposition and test-tier coverage.

## What Is Grounded vs. TBD

**Grounded — read from code on `main`:**

- The monorepo's actual workspaces, package names and file-naming regimes.
- `RecipeNutrition` shape (calories/protein/carbs/fat + `isComplete`) and where per-100g values are persisted.
- That `subscriptionTier` lives in the identity `accounts` table and is **not** a session-token claim.
- The Home widget contract, the `meal-plan` capability, and the documented roadmap-retirement procedure.
- Shared-ALB priority allocation, logical-DB derivation, tagging and deploy-gate mechanics.
- That no Redis or ElastiCache exists anywhere in the platform.

**Grounded — decided in [spec.md](../spec.md) Clarifications:**

- Templates in scope (FR-028); recurrence and leftovers deferred — closes the long-open W-001/W-002.
- Family sizing is entry `servings` (FR-030); no separate household model.
- Lock/finalize dropped (C-006-007).
- FR-025/026/027 deferred to Phase 2 (C-006-009).

**TBD — genuinely open, not invented:**

- Retention and conversion thresholds beyond the workflow-time target (SC-006-001); needs product instrumentation.
- The AI provider contract and the premium entitlement mechanism, both owned by 005 and 010 respectively. Deliberately
  **not** guessed at — guessing is what produced the previous version's wrong entitlement design.
