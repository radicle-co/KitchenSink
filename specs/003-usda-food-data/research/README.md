# Research: USDA Food Data Integration

**Branch**: `003-usda-food-data` | **Date**: 2026-05-09
**Status**: Complete | **Input**: [spec.md](../spec.md), [plan.md](../plan.md), [research.md](../research.md)

_Updated 2026-06-20: synced to the clarified design (Postgres-as-queue / rolling-window / demotion)._

---

This directory contains the Product Forge Phase 1 research artifacts for feature 003. Each file synthesizes existing SpecKit/V-Model output into a focused domain document.

## File Index

### [competitors.md](./competitors.md)

Competitive landscape for food/nutrition data providers covering USDA FoodData Central, Edamam, Spoonacular, Open Food Facts, Nutritionix, and Cronometer-style sourcing patterns. Includes parity matrix, launch-fit trade-offs, and differentiation thesis for event-driven local caching over direct third-party pass-through.

### [ux-patterns.md](./ux-patterns.md)

UX pattern reference for food search-as-you-type, food disambiguation (brand vs generic), ingredient picker workflows, nutrition panel behavior, pending-status polling, and substitution affordances. Each pattern maps to spec user stories and FR IDs.

### [codebase-analysis.md](./codebase-analysis.md)

Monorepo and implementation fit analysis grounded in root `package.json`, `AGENTS.md`, and `plan.md`. Covers current workspace baseline, USDA-specific package boundaries, queue + Lambda placement, API versioning path, and integration points with Commise applications.

### [tech-stack.md](./tech-stack.md)

Technology stack rationale extracted from `research.md` RQ-1..RQ-8 and `plan.md`. Covers API + data model, Postgres-as-queue (fetch_queue + LISTEN/NOTIFY) + Fargate worker, rolling-60-min-window rate limiter, PostgreSQL search (`pg_trgm` + FTS), and observability stack.

### [metrics-roi.md](./metrics-roi.md)

Success metrics and ROI hypothesis for the food data layer. Covers SLOs from `SC-001..SC-009`, constitutional NFR guardrails (`NFR-001..NFR-010`), throughput/cost guardrails under USDA limits, and product-level impact metrics for ingredient resolution quality.

## Relationship to Other Artifacts

| Artifact                     | Role                                                      |
| ---------------------------- | --------------------------------------------------------- |
| `../spec.md`                 | Canonical requirements source (FR/NFR/SC/A)               |
| `../plan.md`                 | Technical architecture and implementation sequencing      |
| `../tasks.md`                | Execution-level decomposition                             |
| `../product-spec/`           | Product/UX interpretation of this research                |
| `../v-model/requirements.md` | Atomic requirement decomposition and verification framing |

## What Is Grounded vs. TBD

- **Grounded**: Rate limits, single demand-weighted fetch_queue with dynamic demotion, polling-first launch approach, USDA endpoint boundaries, and strict local-read architecture.
- **TBD / Warning-surfaced**: First-class substitution semantics and hard unit-conversion requirements (currently represented as UX guidance, not explicit FRs).
