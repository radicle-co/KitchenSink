# Research: Grocery Lists & Online Ordering

**Branch**: `007-grocery-lists` | **Date**: 2026-05-09
**Status**: Complete | **Input**: [spec.md](../spec.md), [plan.md](../plan.md), [research.md](./research.md)

---

This directory contains the Product Forge Phase 1 research artifacts for feature 007. These files augment existing research with structured competitor, UX, architecture, stack, and metrics references aligned to current FR/NFR scope.

## File Index

### [competitors.md](./competitors.md)

Competitive landscape for grocery list and shopping assistants focusing on **AnyList**, **Out of Milk**, **Bring**, and **Apple Reminders**, with cross-reference notes from existing Paprika/Mealime research. Includes feature parity matrix against FR-028..FR-031 and differentiation opportunities.

### [ux-patterns.md](./ux-patterns.md)

UX pattern synthesis for list generation from meal plans, aisle grouping, swipe-to-check interactions, list sharing, manual item add, store-specific segmentation, and premium ordering handoff patterns.

### [codebase-analysis.md](./codebase-analysis.md)

Monorepo fit analysis grounded in root `package.json`, `AGENTS.md`, `plan.md`, and `tasks.md`. Covers workspace placement, likely service boundaries, shared utility placement, and integration touchpoints with features 001/003/006/010.

### [tech-stack.md](./tech-stack.md)

Technology rationale for aggregation, unit conversion, pantry modeling, store API integrations, premium gating, and UX delivery across web/mobile. Consolidates findings from plan and research RQ sections.

### [metrics-roi.md](./metrics-roi.md)

Operational SLOs and ROI hypotheses mapped to SC-004, SC-008, FR-028..FR-031, and NFR-001..NFR-004. Includes efficiency, conversion, and reliability metrics plus cost/risk guardrails.

---

## Traceability Notes

- Canonical requirement IDs remain in [spec.md](../spec.md).
- This research layer is additive and does not override upstream artifacts.
