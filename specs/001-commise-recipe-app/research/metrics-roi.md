# Metrics and ROI: Commise Recipe Management Core

**Branch**: `001-commise-recipe-app` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [spec.md](../spec.md) (NFR-008..011), [plan.md](../plan.md), [v-model/requirements.md](../v-model/requirements.md)

---

## Overview

This document captures the success metrics and ROI hypothesis for feature 001. Three categories are covered: **operational SLOs** (defined in spec/plan), **growth metrics** (TBD pending product input), and **cost constraints**.

---

## 1. Operational SLOs (Non-Functional Requirements)

### NFR-008: CI Pipeline Completeness

**Source**: [spec.md](../spec.md) NFR-008

| SLO                         | Target                                                  | Measurement                |
| --------------------------- | ------------------------------------------------------- | -------------------------- |
| CI checks pass before merge | 100%                                                    | GitHub Actions gate status |
| Checks enforced             | `typecheck`, `lint`, `format:check`, `test`, `test:e2e` | All five must pass         |

No explicit SLI/SLO numerics beyond "all checks must pass." This is the baseline operational contract.

---

### NFR-009: Configurable API Base URLs

**Source**: [spec.md](../spec.md) NFR-009

| Environment       | API URL                 | Notes |
| ----------------- | ----------------------- | ----- |
| Local development | `http://localhost:4000` |       |
| Next.js web       | `NEXT_PUBLIC_API_URL`   |       |
| Mobile (Expo)     | `EXPO_PUBLIC_API_URL`   |       |

No latency SLO here — purely a configuration correctness requirement.

---

### NFR-010: Deterministic E2E Seed Data

**Source**: [spec.md](../spec.md) NFR-010

E2E tests must run against seeded, deterministic data with stable fixture IDs. No numerics.

---

### NFR-011: Test Isolation

**Source**: [spec.md](../spec.md) NFR-011

Unit and component tests must use mocks and `make*` fixture factories — never live services or databases. No numerics.

---

## 2. Performance SLOs

### SC-009 / Plan Performance Goals

**Source**: [spec.md](../spec.md) SC-009; [plan.md](../plan.md) Section "Performance Goals"

| Metric                    | SLO             | Basis                                                                                      |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------------ |
| API response time (p95)   | **<= 500ms**    | Under 10,000 concurrent users                                                              |
| Search wall-clock latency | **< 2 seconds** | PostgreSQL FTS (launch config)                                                             |
| Search API p95            | **<= 400ms**    | If exceeded, triggers Typesense fallback                                                   |
| Recipe save p95           | **<= 500ms**    | Even when S3 version archive is queued (FR-007b-i)                                         |
| Cold start                | **< 200ms**     | Fargate eliminates Lambda cold start for API; Lambda photo processor is async/non-blocking |

**Measurement approach**: Load test with `k6` or ` Artillery`; p95 calculated over 5-minute sustained window. Wall-clock measured client-side (Playwright `page.timing()`).

---

### SYS-NF-004: Search Response Time

**Source**: `testing/test-plan.md` (referenced from v-model artifacts)

| Metric        | Target  |
| ------------- | ------- |
| FTS query p95 | < 200ms |

Note: `testing/test-plan.md` sets a tighter target (200ms) than [plan.md](../plan.md) (400ms API-level). The tighter internal target provides headroom before the 500ms system-level SLO is breached.

---

## 3. Growth Metrics (TBD Pending Product Input)

The following metrics are not yet defined in the existing artifacts. They are recorded here as placeholders to be confirmed by product input before Phase 9 (release-readiness).

| Metric                                                    | Placeholder Target        | Source                                                          |
| --------------------------------------------------------- | ------------------------- | --------------------------------------------------------------- |
| **North-star**: recipes saved per MAU                     | TBD pending product input | Industry benchmark: ~15 recipes/user/mo for active cooking apps |
| **Activation**: first recipe saved within 7 days          | TBD pending product input | Standard SaaS activation: 1 action within first session         |
| **W4 retention**: users who reuse a recipe within 4 weeks | TBD pending product input | Proxy for product-market fit in recipe apps                     |
| **Collection creation rate**                              | TBD pending product input | Indicator of organizational engagement                          |
| **Photo upload per recipe**                               | TBD pending product input | Benchmark: ~60% of recipes have at least 1 photo                |

**Note**: If product input does not define these before Phase 9, the release-readiness gate will flag them as open questions.

---

## 4. Cost Ceiling

### Infrastructure Cost Target

**Source**: [data-model.md](../data-model.md) Section "Design Constraints"

| Resource                       | Launch Target  | Actual (us-east-1)                            |
| ------------------------------ | -------------- | --------------------------------------------- |
| RDS (shared `db.t4g.small`, `kitchensink_recipes` logical DB) | $0 incremental | Instance already provisioned at the platform level; recipes add a free logical DB — no new/dedicated instance |
| S3 storage (photos + archives) | Cost-contained | ~$0.023/GB                                    |
| SQS queue                      | Minimal        | ~$0.40/million requests                       |
| Fargate (2 tasks for HA)       | Cost-contained | ~$0.0408/vCPU-hr                              |

**Total launch estimate**: ~$25–55/mo of feature-incremental cost for a production launch with conservative sizing (the shared RDS instance is already provisioned at the platform level and is **not** re-counted here; recipes add only a free logical DB).

**Cost ceiling rationale**: Per [plan.md](../plan.md), the architecture is designed to minimize per-user cost. SQS async processing means version archives don't add to API compute cost. S3 + CloudFront offloads photo serving from Fargate.

### Cost Scaling Model

| Scale       | Expected Cost |
| ----------- | ------------- |
| 1,000 MAU   | ~$50–80/mo    |
| 10,000 MAU  | ~$150–250/mo  |
| 100,000 MAU | ~$500–800/mo  |

---

## 5. ROI Hypothesis

**Hypothesis**: Commise achieves product-market fit at 5,000 MAU with premium conversion rate of 8–12%, yielding $2,000–5,000/mo revenue against ~$200/mo infrastructure cost at that scale (8x ROI).

**Key assumptions**:

- Premium tier priced at $5–10/mo (per [competitors.md](./competitors.md))
- Free tier covers basic recipe management; premium unlocks collaboration and advanced versioning
- Infrastructure cost scales linearly with MAU (SQS and S3 are cheap; main cost is RDS and Fargate)

**Risks**:

- Storage cost (S3 photos) could exceed projection at high photo-per-recipe rates
- RDS connection pool exhaustion if Fargate task count grows without RDS vertical scaling

**Mitigation**:

- Photo lifecycle policy: transition to S3 IA after 90 days
- Connection pool monitoring via CloudWatch `DatabaseConnections` metric; alert at 70% capacity

---

## 6. NFR Cross-Reference

| NFR     | Topic                          | Key Metric                            | Source                |
| ------- | ------------------------------ | ------------------------------------- | --------------------- |
| NFR-001 | TypeScript strict compile      | 0 errors                              | [spec.md](../spec.md) |
| NFR-002 | JSDoc documentation            | 100% exports documented               | [spec.md](../spec.md) |
| NFR-003 | Accessibility                  | All components have accessible name   | [spec.md](../spec.md) |
| NFR-004 | Color not sole state indicator | Icon or text pairing                  | [spec.md](../spec.md) |
| NFR-005 | TDD                            | Test before/co-commit with impl       | [spec.md](../spec.md) |
| NFR-006 | Playwright + Maestro E2E       | All flows covered                     | [spec.md](../spec.md) |
| NFR-007 | LocalStack for AWS emulation   | Docker Compose + CI service container | [spec.md](../spec.md) |
| NFR-008 | CI pipeline completeness       | All checks pass before merge          | [spec.md](../spec.md) |
| NFR-009 | Configurable API URLs          | Env var based per platform            | [spec.md](../spec.md) |
| NFR-010 | Deterministic E2E seed         | Stable fixture IDs                    | [spec.md](../spec.md) |
| NFR-011 | Test isolation via mocks       | Never live services                   | [spec.md](../spec.md) |

---

## Summary: Defined vs. TBD

| Category        | Defined in Artifacts            | TBD (Needs Product Input)            |
| --------------- | ------------------------------- | ------------------------------------ |
| Latency SLOs    | Yes — p95 <= 500ms, search < 2s | None                                 |
| Cost ceiling    | Yes — $25/mo RDS launch         | None                                 |
| CI completeness | Yes — 5 checks                  | None                                 |
| Growth metrics  | No                              | North-star, activation, W4 retention |
| Conversion rate | No                              | Premium conversion assumption        |
| Revenue model   | No                              | Pricing tiers                        |
