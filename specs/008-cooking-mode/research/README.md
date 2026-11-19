# Research: Cooking Mode

**Branch**: `008-cooking-mode` | **Date**: 2026-05-09
**Status**: Complete | **Input**: [spec.md](../spec.md), [plan.md](../plan.md), [research.md](../research.md), [tasks.md](../tasks.md)

---

This directory contains the Product Forge Phase 1 research artifacts for feature 008. Each file synthesizes existing SpecKit/V-Model output into a focused domain document.

## File Index

### [competitors.md](./competitors.md)

Competitive landscape for cooking-mode experiences with direct focus on **Paprika cook mode**, **SideChef**, **Yummly**, and **Kitchen Stories**, plus secondary references from existing `research.md` market survey. Includes a parity matrix (step flow, timers, wake lock, voice, ingredient checkoff, scaling) and positioning guidance for Commise.

### [ux-patterns.md](./ux-patterns.md)

UX pattern reference for active-cooking interaction design: large touch targets, one-step focus, swipe/tap navigation, live progress, multi-timer control, wake-lock affordances, voice command surfaces, and accessible status signaling. Cross-references FR-032..FR-035 and NFR-001..NFR-004.

### [codebase-analysis.md](./codebase-analysis.md)

Monorepo fit analysis grounded in root `package.json`, `AGENTS.md`, and `plan.md`. Documents where cooking mode should land across shared/web/mobile workspaces, highlights missing implementation directories, and confirms build/lint/typecheck command surfaces.

### [tech-stack.md](./tech-stack.md)

Technology rationale for cooking mode from `research.md` RQ-2..RQ-8 and `plan.md`: Expo keep-awake, web Wake Lock API, timer model, local persistence, voice options, offline behavior, and integration with 001 recipe instructions endpoint.

### [metrics-roi.md](./metrics-roi.md)

Feature-level success and ROI model for cooking mode. Includes operational quality targets from NFRs and REQ-NF requirements, user outcome metrics tied to SC-007, and adoption/retention hypotheses for hands-free guided cooking.

---

## Source Fidelity Notes

- This folder **augments** `../research.md` and does not replace it.
- Canonical requirement IDs remain in `../spec.md`.
- Any net-new opportunity (ingredient checkoff, cook-time scaling, deeper voice automation) is documented as non-canonical unless promoted into FRs.

---

## Next-step Consumers

- `../product-spec/product-spec.md` consumes this research for persona/story prioritization.
- `../product-spec/user-journey.md` consumes interaction and edge-case assumptions.
- `../product-spec/metrics.md` consumes measurement definitions.
