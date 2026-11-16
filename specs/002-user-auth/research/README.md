# Research: Clerk User Authentication

**Branch**: `002-user-auth` | **Date**: 2026-05-09
**Status**: Complete | **Input**: [spec.md](../spec.md), [plan.md](../plan.md), [research.md](../research.md)

---

This directory contains the Product Forge Phase 1 research artifacts for feature 002. Each file synthesizes existing SpecKit/V-Model output into a focused domain document.

## File Index

### [competitors.md](./competitors.md)

Competitive landscape for authentication platforms covering Clerk, Amazon Cognito, Clerk, Supabase Auth, and custom in-house auth. Includes capability parity matrix, operational trade-offs, and risk notes for lifecycle operations (signup sync, suspension, deletion, MFA, and social linking). Key finding: Clerk best matches feature requirements requiring cross-platform SDK maturity plus advanced account lifecycle controls.

### [ux-patterns.md](./ux-patterns.md)

UX pattern reference for authentication and account lifecycle: signup, login, callback handling, session persistence, logout, password reset, MFA enrollment, suspension messaging, and mobile deep-link callback handling. Covers web and mobile parity constraints, explicit failure states, and confirmation patterns for irreversible actions.

### [codebase-analysis.md](./codebase-analysis.md)

Monorepo structure analysis grounded in root `package.json`, `AGENTS.md`, and [plan.md](../plan.md). Covers: existing workspaces (`packages/tools/*`, `packages/apps/commise/web`, `packages/apps/commise/mobile`, `packages/ui`), planned auth package layout under `src/auth/*`, Lambda/API Gateway boundaries, and observability stack alignment.

### [tech-stack.md](./tech-stack.md)

Full technology stack rationale extracted from [research.md](../research.md) and [plan.md](../plan.md). Sections for: Clerk SDKs (web/mobile), JWT verification (`jwks-rsa` + `jose`), secure token storage (`expo-secure-store`, httpOnly cookies), authorizer strategy, SQS retry pipeline, EventBridge reconciliation, and AWS observability components.

### [metrics-roi.md](./metrics-roi.md)

Success metrics and ROI hypothesis for authentication platform capability. Covers: operational SLOs from FR/NFR/SC constraints, security posture metrics (401/403 correctness, suspension enforcement), reliability metrics (signup sync and async deletion completion), and cost/benefit framing versus alternatives.

---

## Provenance Notes

- These artifacts are **retroactively bootstrapped** from existing feature docs.
- They do not replace canonical implementation contracts in [spec.md](../spec.md), [plan.md](../plan.md), or [tasks.md](../tasks.md).
- Any ambiguity discovered during synthesis is surfaced as a WARNING in [../verify-report.md](../verify-report.md).

---

## Next Phase Link

After human review, proceed to revalidation via `/speckit.product-forge.revalidate` using:

- [../review.md](../review.md)
- [../verify-report.md](../verify-report.md)
- [../product-spec/README.md](../product-spec/README.md)
