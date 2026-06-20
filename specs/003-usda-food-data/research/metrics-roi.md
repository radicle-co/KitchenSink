# Metrics and ROI: USDA Food Data Integration

**Branch**: `003-usda-food-data` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [spec.md](../spec.md), [plan.md](../plan.md), [v-model/requirements.md](../v-model/requirements.md)

_Updated 2026-06-20: synced to the clarified design (Postgres-as-queue / rolling-window / demotion)._

---

## Overview

This document captures success metrics and ROI hypotheses for feature 003. It covers operational SLOs, performance SLOs, throughput economics under USDA limits, and product outcomes for ingredient resolution quality.

---

## 1. Operational SLOs (Non-Functional Requirements)

### NFR-001..NFR-003: Type Safety, JSDoc, and Import Conventions

| SLO                              | Target                                     | Measurement     |
| -------------------------------- | ------------------------------------------ | --------------- |
| Strict TypeScript compliance     | 100% builds pass with strict typing        | CI typecheck    |
| Exported symbol documentation    | 100% exported symbols carry required JSDoc | Lint/doc checks |
| Import and workspace conventions | 0 convention violations before merge       | Lint gates      |

---

### NFR-004..NFR-005: Accessibility + Status Semantics

| SLO                                   | Target                                               | Measurement                  |
| ------------------------------------- | ---------------------------------------------------- | ---------------------------- |
| Accessible names for food UI controls | 100% interactive controls discoverable by role/label | Playwright/a11y checks       |
| Status not color-only                 | 100% status surfaces include text/icon               | UI review + automated checks |

---

### NFR-006..NFR-010: Governance + Test Quality

| SLO                            | Target                                           | Measurement         |
| ------------------------------ | ------------------------------------------------ | ------------------- |
| Workspace/tooling compliance   | 100% with shared configs + turbo tasks           | Repository checks   |
| Merge gate integrity           | 100% pass on `typecheck`, `lint`, `format:check` | CI                  |
| Test pyramid adherence         | >=70% unit, <=20% integration, <=10% E2E         | Test report summary |
| Error taxonomy correctness     | 100% custom errors with type guards              | Unit tests          |
| ISO date interface consistency | 100% date fields as ISO strings                  | Type + test checks  |

---

## 2. Performance SLOs (Success Criteria)

| Metric                         | SLO                                                                           | Source |
| ------------------------------ | ----------------------------------------------------------------------------- | ------ |
| Local cache-hit lookup latency | p95 <= 50ms                                                                   | SC-001 |
| USDA limit compliance          | 0 normal-operation 429s                                                       | SC-002 |
| Pending-to-available latency   | p95 <= 60s (queue depth <100)                                                 | SC-003 |
| Local cache hit rate           | >80% once store >5,000 foods                                                  | SC-004 |
| Batch throughput efficiency    | >=5,000 foods/hour effective                                                  | SC-005 |
| Queue failure capture          | 100% terminal failures tombstoned (status='tombstone') after the retry budget | SC-006 |
| Search latency                 | p95 <= 200ms at 50k foods                                                     | SC-007 |
| Nutrient fidelity              | Source-value parity at ingest                                                 | SC-008 |
| API availability               | 99.9% monthly                                                                 | SC-009 |

---

## 3. Throughput and Cost Hypothesis

### Token Economics

- Hard cap: 1,000 USDA calls/hour/API key.
- Batch strategy target: average 5 IDs/call yields ~5,000 foods/hour effective throughput.

### Cost/ROI Hypothesis

1. **Cost control**: USDA-first model avoids per-request vendor spend from commercial APIs.
2. **Latency resilience**: Local-read architecture protects cooking-time UX from external API volatility.
3. **Downstream value**: Better ingredient identity improves quality for meal planning, grocery aggregation, and nutrition planning features.

---

## 4. Product Outcome Metrics

| Outcome                     | Metric                                                                        | Initial Target |
| --------------------------- | ----------------------------------------------------------------------------- | -------------- |
| Ingredient match usefulness | % ingredient selections resolved to valid `fdcId` where user expected a match | >=85%          |
| Disambiguation quality      | % of brand/generic picks changed by user after initial selection              | <=10%          |
| Pending-flow usability      | % pending lookups that eventually resolve to fetched without user abandonment | >=90%          |
| Search usefulness           | % search sessions with a selected food record                                 | >=75%          |

---

## 5. Warning-Surfaced Gaps (Non-blocking)

- Explicit substitution semantics are not FR-defined.
- Unit conversion is UX-addressed but not yet encoded as a standalone requirement.

These remain tracked as warnings in `../verify-report.md` and should be resolved in revalidation if needed.
