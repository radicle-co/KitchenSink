# Research: Nutrition Planning

**Branch**: `009-nutrition-planning` | **Date**: 2026-05-09
**Status**: Complete | **Input**: [spec.md](../spec.md), [plan.md](../plan.md), [research.md](../research.md)

---

This directory contains the Product Forge Phase 1 research artifacts for feature 009. Each file synthesizes existing SpecKit/V-Model output into a focused domain document and augments the existing research where requested.

## File Index

### [competitors.md](./competitors.md)

Nutrition-planning competitive landscape covering MyFitnessPal, Cronometer, Lose It!, and Carb Manager. Includes positioning by macro model (ratio vs fixed grams), micronutrient depth, coaching workflows, and premium gating patterns. Key finding: Cronometer leads on micronutrient depth; MyFitnessPal and Lose It! lead on ease of adherence UX; Carb Manager leads keto-centric workflows.

### [ux-patterns.md](./ux-patterns.md)

UX pattern reference for nutrition planning dashboards and workflows. Covers ring/bar progress systems, color-coded macro status with non-color redundant labels, goal setup and recalibration, dietary profile/tag filtering (keto, vegan, allergies, medical), meal-level nutrition rollup, and deficiency alert presentation patterns.

### [codebase-analysis.md](./codebase-analysis.md)

Monorepo placement and integration analysis grounded in root `package.json`, `AGENTS.md`, and `plan.md`. Covers feature dependency edges (003 USDA and 006 meal planning), expected API surface, compliance-domain data handling, and workspace-level implications for web/mobile parity.

### [tech-stack.md](./tech-stack.md)

Technology rationale for implementing nutrition planning with the existing stack: TypeScript strict mode, NestJS API, PostgreSQL/Drizzle model, and integration contracts across 003/006/009. Includes trade-offs for macro + optional micronutrient modeling and GDPR Article 9 constraints.

### [metrics-roi.md](./metrics-roi.md)

Operational and product metrics for nutrition planning outcomes, including target adherence, calculation accuracy, plan activation, retention, premium conversion signals for trainer-client and swap guidance, and deficiency alert quality metrics. Distinguishes story-level metrics (`product-spec/metrics.md`) from portfolio-level ROI.

---

## Traceability Notes

- Canonical FR source is [spec.md](../spec.md): `FR-036..FR-039`.
- NFR source is [spec.md](../spec.md): `NFR-001..NFR-004`.
- Success criterion source is [spec.md](../spec.md): `SC-010`.
- Requirement-level detail is in [spec.md](../spec.md).

Where this directory discusses nutrition dimensions not explicitly enumerated as FR IDs (for example, deficiency alerts and micronutrient surfacing), those are treated as **augmentation hypotheses** and are marked as warning-level scope candidates until promoted upstream.
